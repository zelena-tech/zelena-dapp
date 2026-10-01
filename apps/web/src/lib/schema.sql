-- Zelena DAO Dapp v0.1 — esquema SQLite.
-- Todo prepared-statement en la capa lib/db.ts. Reputacion y puntos se DERIVAN
-- por SUM sobre tablas append-only; nunca hay columnas mutables de saldo.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- users.wallet es la clave de usuario de TODO el esquema (projects.assignee_wallet,
-- points_ledger.wallet, assignments.owner_wallet…). Mientras el equipo interno no
-- tenga wallet ni login Entra (WP13) su principal es el placeholder determinista
-- `pending:<slug>` (ver lib/roles.ts); WP13 vincula la identidad real.
--
-- role e is_supervisor (WP14): `role` es la posición en el registro de contribuidor
-- (WP13: founder|core|contributor) y `is_supervisor` es un flag SEPARADO, porque
-- supervisor no es un rol (plano 07 §5: Vale es `core` Y supervisora del dashboard).
-- El default es conservador (contributor / no supervisor) y se deriva de is_founder
-- al sembrar el roster, para no cambiar el significado de ninguna fila existente.
CREATE TABLE IF NOT EXISTS users (
  wallet        TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'Bronze', -- Bronze | Silver | Gold
  invited_by    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | alumni
  is_demo       INTEGER NOT NULL DEFAULT 0,
  is_founder    INTEGER NOT NULL DEFAULT 0,
  cla_signed    INTEGER NOT NULL DEFAULT 0,
  role          TEXT NOT NULL DEFAULT 'contributor', -- founder | core | contributor
  is_supervisor INTEGER NOT NULL DEFAULT 0,          -- flag independiente de role
  -- WP13 (puerta corporativa Entra ID). `entra_oid` es el `oid` del token: un GUID
  -- opaco por tenant, NO un correo (los correos viven en user_emails). NULL = esta
  -- fila todavia no tiene identidad corporativa vinculada.
  --
  -- Por que la unicidad NO va aqui como `UNIQUE` de columna: es NULLABLE y la
  -- mayoria de filas la tienen a NULL. SQLite admite varios NULL en un UNIQUE, pero
  -- SQL Server (Azure, WP16) trata los NULL como iguales y solo admitiria UNO: un
  -- `UNIQUE` de columna funcionaria en local y romperia el alta en produccion al
  -- segundo usuario sin vincular. La unicidad vive en el indice PARCIAL unico
  -- `idx_users_entra_oid ... WHERE entra_oid IS NOT NULL` (al final del archivo), que
  -- es la forma portable: indice parcial en SQLite, indice filtrado en T-SQL.
  -- lib/entra.ts conserva su comprobacion en la misma transaccion, para dar un
  -- mensaje util en vez de un error de constraint.
  entra_oid     TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'invite',      -- entra | invite
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Correos vinculados al registro de contribuidor (doc 15 §2, plano 05: la identidad
-- ES el registro; los correos son credenciales vinculadas, no la identidad).
--
--  - `kind = 'primary'`   → con el que entra. El corporativo entra SIEMPRE como primary.
--  - `kind = 'recovery'`  → segundo correo personal. Obligatorio para core: si la
--    persona sale de la organizacion pierde la puerta corporativa pero NO su
--    progreso, y sigue entrando por la puerta de comunidad con este correo.
--  - `is_corporate = 1`   → es del dominio del tenant (@zelena.tech). Un correo
--    corporativo NO puede ser recovery: moriria con la baja.
--
-- UNIQUE (email) es la garantia de "un humano = UN registro" (criterio 5): dos
-- filas de `users` no pueden reclamar el mismo correo, asi que la puerta corporativa
-- y la de comunidad convergen en el mismo principal. `email` es NOT NULL, por lo
-- que este UNIQUE si se traduce fielmente a T-SQL.
CREATE TABLE IF NOT EXISTS user_emails (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet       TEXT NOT NULL,        -- principal de users (pending:<slug> | entra:<oid> | wallet Stellar)
  email        TEXT NOT NULL,        -- normalizado en minusculas por lib/entra.ts
  kind         TEXT NOT NULL DEFAULT 'primary',  -- primary | recovery
  is_corporate INTEGER NOT NULL DEFAULT 0,
  -- El prefijo `is_` no es cosmetico: es lo que hace que lib/sql-dialect.ts (WP16)
  -- materialice la columna como BIT en Azure SQL y no como INT.
  is_verified  INTEGER NOT NULL DEFAULT 0,       -- 1 = lo verifico el proveedor (Entra)
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS invites (
  code         TEXT PRIMARY KEY,
  issuer_wallet TEXT NOT NULL,
  used_by      TEXT,                 -- wallet que lo consumio (NULL = disponible)
  expires_at   TEXT NOT NULL,
  -- Codigo de cohorte multiuso: NULL = semantica original de UN SOLO USO
  -- (used_by manda). Si max_uses NO es NULL, el codigo vale mientras
  -- uses < max_uses y no haya expirado; used_by se ignora.
  max_uses     INTEGER,
  uses         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cla_signatures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet       TEXT NOT NULL,
  cla_version  INTEGER NOT NULL DEFAULT 1,
  cla_hash     TEXT NOT NULL,        -- SHA-256 del texto canonico del CLA
  signature    TEXT NOT NULL,        -- firma (Freighter o demo local)
  anchor_status TEXT NOT NULL DEFAULT 'pending', -- pending | anchored | failed
  tx_id        TEXT,
  signed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wallet, cla_version)
);

CREATE TABLE IF NOT EXISTS anchor_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,        -- cla | merkle_root | decision
  ref          TEXT NOT NULL,        -- clave logica (ej. wallet o period id)
  data_key     TEXT NOT NULL,        -- key para manageData (<= 64 bytes)
  payload_hash TEXT NOT NULL,        -- hash a anclar (hex)
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | anchored | failed
  tx_id        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign      TEXT NOT NULL,        -- campaña del proyecto de cliente
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,        -- cliente | comunidad (valores y etiquetas en agora-labels.ts; inmutable tras intake)
  budget_usd    INTEGER NOT NULL,
  weeks         INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'Open', -- Open|Assigned|Delivered|Scored|Distributed
  supervisor_wallet TEXT NOT NULL,
  assignee_wallet   TEXT,
  summary       TEXT NOT NULL,
  description   TEXT NOT NULL,
  acceptance    TEXT NOT NULL,        -- criterios de aceptacion (texto)
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  ord         INTEGER NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  week        TEXT NOT NULL,
  pct         INTEGER NOT NULL,
  amount_usd  INTEGER NOT NULL,
  approved    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS applications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  wallet      TEXT NOT NULL,
  approach    TEXT NOT NULL,
  timeline    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE (project_id, wallet)
);

-- Append-only. La reputacion por eje = SUM(delta) por (wallet, axis).
-- period_id permite medir el crecimiento por epoca (delta de la epoca) sin romper
-- el caracter append-only ni el calculo global por SUM.
CREATE TABLE IF NOT EXISTS reputation_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet      TEXT NOT NULL,
  axis        TEXT NOT NULL,  -- ejecucion | investigacion | comunidad | gobernanza
  delta       INTEGER NOT NULL,
  ref         TEXT NOT NULL,
  period_id   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only. Puntos ZWORK = SUM(points) por wallet. No transferibles.
CREATE TABLE IF NOT EXISTS points_ledger (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet      TEXT NOT NULL,
  points      INTEGER NOT NULL,
  period_id   INTEGER NOT NULL,
  bucket      TEXT NOT NULL DEFAULT 'ejecucion', -- ejecucion | academia
  ref         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  epoch_budget  INTEGER NOT NULL,
  academia_budget INTEGER NOT NULL,
  state         TEXT NOT NULL DEFAULT 'Open', -- Open | Closed | Anchored
  merkle_root   TEXT,
  anchor_tx_id  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decision_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  reason      TEXT NOT NULL,
  hash        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Reporte de fitness por epoca (WP07). Append-only: una fila por calculo de cierre.
-- El humano firma la recomendacion (keep/revert); la firma genera una entrada en
-- decision_log referenciada por decision_log_id. components = JSON explicable.
CREATE TABLE IF NOT EXISTS epoch_fitness (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch           INTEGER NOT NULL,
  genome_version  INTEGER,
  score           REAL NOT NULL,
  components       TEXT NOT NULL,          -- JSON: desglose por componente (explicabilidad)
  recommendation  TEXT NOT NULL,           -- keep | revert (propuesta del algoritmo)
  prev_score      REAL,                    -- score de la epoca anterior (NULL si primera)
  signed          INTEGER NOT NULL DEFAULT 0,
  signed_decision TEXT,                    -- keep | revert (lo que firmo el humano)
  decision_log_id INTEGER,                 -- entrada del decision_log de la firma
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_log_id) REFERENCES decision_log(id)
);

-- Auditoría de funciones latentes (WP12) — Doc 16 salvaguarda 1 (Merton): toda
-- mecánica produce consecuencias no buscadas; se auditan trimestralmente. La
-- disfunción detectada puede entrar como propuesta de mutación (WP08). Registro
-- público (transparencia = legitimidad weberiana).
CREATE TABLE IF NOT EXISTS latent_audits (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  mechanism         TEXT NOT NULL,   -- invitaciones|academia|rankings|scoring|ritos|gobernanza|...
  period            TEXT NOT NULL,   -- trimestre/época auditada
  manifest_function TEXT NOT NULL,   -- para qué se diseñó
  latent_observed   TEXT NOT NULL,   -- qué produce que no buscábamos
  functional_for    TEXT NOT NULL,   -- ¿funcional para quién?
  dysfunctional_for TEXT NOT NULL,   -- ¿disfuncional para quién?
  action            TEXT NOT NULL DEFAULT 'none', -- none|mutation_proposed|mechanism_change
  decision_log_id   INTEGER,         -- enlace a la propuesta/decisión (si aplica)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_log_id) REFERENCES decision_log(id)
);

-- Decisión de mutación por época (WP08). Salvaguarda 4: cada época DEBE decidir
-- la mutación de la siguiente, aunque la decisión sea "sin cambios" (excepción
-- explícita, no silenciosa). No se puede cerrar una época sin esta decisión.
CREATE TABLE IF NOT EXISTS mutation_decisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  epoch           INTEGER NOT NULL,       -- época a la que aplica la decisión
  kind            TEXT NOT NULL,           -- mutation | no_change
  genome_version  INTEGER,                 -- versión propuesta (si kind=mutation)
  decision_log_id INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (epoch),
  FOREIGN KEY (decision_log_id) REFERENCES decision_log(id)
);

-- Genoma versionado: los parametros evolutivos del sistema (presupuestos, caps,
-- topes) viven aqui, NO hardcodeados. Append-only: cada cambio es una version
-- nueva ligada a una entrada del decision_log; nada aplica retroactivamente
-- (effective_from_epoch marca desde que epoca rige). Ver docs/specs/WP02-genoma.md.
CREATE TABLE IF NOT EXISTS genome_versions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  version              INTEGER NOT NULL UNIQUE,
  params               TEXT NOT NULL,           -- JSON de los parametros evolutivos
  effective_from_epoch INTEGER NOT NULL,        -- epoca desde la que rige (nunca retroactivo)
  decision_log_id      INTEGER,                 -- entrada del decision_log que la publica
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (decision_log_id) REFERENCES decision_log(id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open', -- open | closed
  threshold   INTEGER NOT NULL DEFAULT 66,  -- % para aprobar (critica)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id INTEGER NOT NULL,
  wallet      TEXT NOT NULL,
  choice      TEXT NOT NULL,  -- favor | contra | abstencion
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (proposal_id) REFERENCES proposals(id),
  UNIQUE (proposal_id, wallet)
);

CREATE TABLE IF NOT EXISTS academia_content (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL,   -- article | video
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  axis        TEXT NOT NULL DEFAULT 'investigacion',
  points      INTEGER NOT NULL,
  min_seconds INTEGER NOT NULL,
  body        TEXT,            -- markdown para articulos
  video_id    TEXT,            -- id de YouTube para videos
  enabled     INTEGER NOT NULL DEFAULT 1, -- moderacion admin
  ord         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS academia_quiz (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id  INTEGER NOT NULL,
  question    TEXT NOT NULL,
  options     TEXT NOT NULL,   -- JSON array de strings
  correct     INTEGER NOT NULL, -- indice correcto
  pool        INTEGER NOT NULL DEFAULT 0, -- grupo de rotacion
  FOREIGN KEY (content_id) REFERENCES academia_content(id)
);

-- Una sesion de lectura activa por wallet a la vez (server-side timing).
CREATE TABLE IF NOT EXISTS reading_sessions (
  token         TEXT PRIMARY KEY,
  wallet        TEXT NOT NULL,
  content_id    INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,     -- epoch ms
  active_seconds INTEGER NOT NULL DEFAULT 0,
  last_beat     INTEGER NOT NULL,     -- epoch ms
  completed     INTEGER NOT NULL DEFAULT 0,
  passed        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (content_id) REFERENCES academia_content(id)
);

-- Registro de premios de Academia por dia para cap diario + rendimientos decrecientes.
CREATE TABLE IF NOT EXISTS academia_awards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet      TEXT NOT NULL,
  content_id  INTEGER NOT NULL,
  day         TEXT NOT NULL,   -- YYYY-MM-DD
  ord_of_day  INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wallet, content_id)
);

-- =====================================================================
-- WP17 · Entornos por cliente
-- =====================================================================
-- REGLA TRANSVERSAL INVIOLABLE: ninguna tabla de este bloque almacena
-- secretos, contraseñas ni tokens. El inventario guarda DONDE vive la
-- credencial y QUIEN responde por ella, jamas su valor. Verificado por
-- auditSchemaForSecretColumns() en clients.test.ts (no por inspeccion manual).

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'prospecto', -- activo | pausado | prospecto
  industry    TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- La participacion define el permiso. Quien no es miembro no ve el cliente
-- (ni en listados ni por URL directa: la vista responde 404, no 403).
CREATE TABLE IF NOT EXISTS client_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL,
  wallet       TEXT NOT NULL,
  access_level TEXT NOT NULL,          -- lead | colaborador | lectura
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, wallet),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

CREATE TABLE IF NOT EXISTS brand_assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL,
  kind       TEXT NOT NULL,            -- logo | color | tipografia | guia
  label      TEXT NOT NULL,
  value      TEXT,                     -- hex, nombre de fuente o texto
  file_url   TEXT,
  notes      TEXT,
  ord        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- SIN columna de secreto. `location` es una REFERENCIA legible por humanos
-- ("Key Vault kv-zelena / secret azure-wms-prod"), nunca el valor.
CREATE TABLE IF NOT EXISTS credential_inventory (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,          -- nube | servidor | api | db | otro
  location     TEXT NOT NULL,          -- DONDE vive el secreto (referencia)
  owner_wallet TEXT,                   -- quien responde por el
  scope        TEXT,                   -- alcance/permisos concedidos
  rotated_at   TEXT,
  expires_at   TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Saber DONDE esta una credencial ya es informacion sensible: toda consulta
-- al inventario queda registrada. Append-only.
CREATE TABLE IF NOT EXISTS credential_access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  credential_id INTEGER,               -- NULL = listado completo del inventario
  wallet        TEXT NOT NULL,
  action        TEXT NOT NULL,         -- list | view
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- =====================================================================
-- WP20 · Grafo de operacion del cliente (READ MODEL)
-- =====================================================================
-- La fuente de verdad de este grafo es el repositorio zelena-ops (markdown
-- versionado en git, revisado por PR). Estas tablas son una PROYECCION de
-- solo lectura, reconstruida de forma idempotente por importGraph().
-- La dapp NUNCA escribe de vuelta al grafo. Editar = PR en zelena-ops.

CREATE TABLE IF NOT EXISTS graph_nodes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL,
  node_id        TEXT NOT NULL,        -- montoc.variante.facturacion-credito
  kind           TEXT NOT NULL,        -- proceso | variante | sistema | modulo | ...
  name           TEXT NOT NULL,
  state          TEXT NOT NULL,        -- activo | propuesto | deprecado | roto
  confidence     TEXT NOT NULL,        -- verificado | declarado | inferido | sospechoso
  criticality    TEXT,
  bus_factor     INTEGER,
  owner_zelena   TEXT,
  owner_client   TEXT,
  source         TEXT,                 -- procedencia del conocimiento
  verified_at    TEXT,
  tags           TEXT,                 -- JSON array
  source_path    TEXT,                 -- ruta del nodo en zelena-ops
  -- Los tres niveles de explicacion (capa de ensenanza):
  what_is        TEXT,
  how_it_works   TEXT,
  tech_detail    TEXT,
  business_rules TEXT,
  open_questions TEXT,
  open_count     INTEGER NOT NULL DEFAULT 0,
  imported_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, node_id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL,
  from_node  TEXT NOT NULL,
  to_node    TEXT NOT NULL,
  kind       TEXT NOT NULL,            -- pertenece_a | varia_de | depende_de | ...
  UNIQUE (client_id, from_node, to_node, kind),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Historial de importaciones: permite ver como evoluciona la cobertura del
-- conocimiento en el tiempo (metrica vendible: "pasamos de 3% a 68% verificado").
CREATE TABLE IF NOT EXISTS graph_imports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL,
  generated_at  TEXT NOT NULL,         -- fecha que reporta el grafo.json
  nodes         INTEGER NOT NULL,
  edges         INTEGER NOT NULL,
  pct_verified  REAL NOT NULL,
  open_questions INTEGER NOT NULL,
  bus_factor_critical INTEGER NOT NULL,
  imported_by   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE INDEX IF NOT EXISTS idx_cmembers_wallet ON client_members(wallet);
CREATE INDEX IF NOT EXISTS idx_cred_client ON credential_inventory(client_id);
CREATE INDEX IF NOT EXISTS idx_gnodes_client ON graph_nodes(client_id, kind);
CREATE INDEX IF NOT EXISTS idx_gedges_from ON graph_edges(client_id, from_node);
CREATE INDEX IF NOT EXISTS idx_gedges_to ON graph_edges(client_id, to_node);

-- ============================================================================
-- MÓDULO EQUIPO (WP14) — el trabajo real del equipo interno.
-- Dos vistas de la misma pieza de trabajo: `assignments` es la vista interna;
-- `projects` (Ágora) es la vista pública/bounty. El puente es
-- assignments.published_as_project_id — se enlaza, NUNCA se duplica.
-- ============================================================================

-- Iniciativa = contenedor de trabajo (WMS, DAO, Harmony, Productos Nuevos,
-- Sistema Operativo…). El horizonte es de la iniciativa (spec WP14); cuando sus
-- asignaciones tienen horizontes distintos, la iniciativa toma el MÁS urgente.
CREATE TABLE IF NOT EXISTS initiatives (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  horizon    TEXT NOT NULL DEFAULT 'Ahora',   -- Ahora | Siguiente | Parqueado
  client_id  INTEGER,                         -- WP17: NULL = iniciativa interna
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- Máquina de estados en lib/team-state-machine.ts (función PURA, igual que la del
-- Ágora en lib/state-machine.ts; son dos máquinas distintas y no se comparten):
--   Backlog → Asignada → En curso → En revisión → Hecha
--   rama Bloqueada (motivo OBLIGATORIO) y retorno al estado previo. Sin saltos.
-- status_before_block guarda el estado desde el que se bloqueó para poder volver.
-- blocked_at permite al dashboard (WP15) contar días bloqueado.
-- needs_founder = bandeja de gates de John (decisión, visual, inversión).
-- import_key = idempotencia del importador de CSV; NULL para lo creado en la app.
CREATE TABLE IF NOT EXISTS assignments (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  title                   TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  initiative_id           INTEGER,
  client_id               INTEGER,                         -- WP17: NULL = trabajo interno
  owner_wallet            TEXT,
  status                  TEXT NOT NULL DEFAULT 'Backlog',
  status_before_block     TEXT,
  priority                TEXT NOT NULL DEFAULT 'Normal',  -- Urgent | High | Normal | Low
  size                    TEXT,                            -- S | M | L (opcional)
  horizon                 TEXT NOT NULL DEFAULT 'Ahora',   -- horizonte propio de la fila
  due_date                TEXT,                            -- YYYY-MM-DD
  acceptance_criteria     TEXT NOT NULL DEFAULT '',
  spec_url                TEXT,
  graph_node_id           TEXT,                            -- WP20: nodo del grafo, por referencia
  blocked_reason          TEXT,
  blocked_at              TEXT,
  needs_founder           INTEGER NOT NULL DEFAULT 0,
  published_as_project_id INTEGER,                         -- puente con el Ágora
  created_by              TEXT,
  import_key              TEXT UNIQUE,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at               TEXT,                            -- cuándo pasó a Hecha
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (owner_wallet) REFERENCES users(wallet),
  FOREIGN KEY (published_as_project_id) REFERENCES projects(id)
);

-- Append-only: historial de transiciones. Se califican ENTREGAS (doc 16), así que
-- esto registra qué le pasó a la pieza de trabajo, nunca un juicio sobre la persona.
-- `day` alimenta el digest diario de WP15 sin recalcular fechas.
CREATE TABLE IF NOT EXISTS assignment_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  action        TEXT NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  actor_wallet  TEXT NOT NULL,
  day           TEXT NOT NULL,                             -- YYYY-MM-DD
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id)
);

-- Check-in diario async (rito 1): hecho / haciendo / bloqueado.
-- UNIQUE (wallet, day) = uno por persona por día, editable el mismo día.
CREATE TABLE IF NOT EXISTS checkins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet     TEXT NOT NULL,
  day        TEXT NOT NULL,                                -- YYYY-MM-DD
  done       TEXT NOT NULL DEFAULT '',
  doing      TEXT NOT NULL DEFAULT '',
  blocked    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wallet, day),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

CREATE INDEX IF NOT EXISTS idx_assign_owner ON assignments(owner_wallet);
CREATE INDEX IF NOT EXISTS idx_assign_initiative ON assignments(initiative_id);
CREATE INDEX IF NOT EXISTS idx_assign_client ON assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_assign_status ON assignments(status);
CREATE INDEX IF NOT EXISTS idx_assign_events ON assignment_events(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assign_events_day ON assignment_events(day);
CREATE INDEX IF NOT EXISTS idx_checkins_day ON checkins(day);

-- ============================================================================
-- WP31-A · PROYECTOS Y TALENTO — iniciativa = proyecto.
-- La membresía define qué ve y qué puede hacer cada persona en un proyecto.
-- Roles, no personas: se edita desde /equipo/talento y desde el tablero.
-- ============================================================================

-- Una fila por (proyecto, persona, rol). Una persona puede tener varios roles en
-- el mismo proyecto (en uno pequeño, quien estructura también revisa).
CREATE TABLE IF NOT EXISTS project_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  initiative_id INTEGER NOT NULL,
  wallet        TEXT NOT NULL,
  rol_proyecto  TEXT NOT NULL,                    -- estructura | ejecuta | revisa | vende
  vinculo       TEXT NOT NULL DEFAULT 'interno',  -- interno | externo
  added_by      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (initiative_id, wallet, rol_proyecto),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

-- Vínculo de una fila del roster (`pending:<slug>`) con la cuenta real que la
-- absorbió. Existe para que el arranque no vuelva a crear la fila pendiente.
CREATE TABLE IF NOT EXISTS roster_links (
  slug       TEXT PRIMARY KEY,
  wallet     TEXT NOT NULL UNIQUE,
  linked_by  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

-- Append-only. Cambios de talento: roles, supervisión, membresías, vinculación,
-- proyectos e importaciones. Describe el cambio; nunca juzga a la persona.
-- Sin FK a users a propósito: la historia sobrevive a una vinculación.
CREATE TABLE IF NOT EXISTS talent_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_wallet  TEXT NOT NULL,
  target_wallet TEXT,
  initiative_id INTEGER,
  action        TEXT NOT NULL,  -- rol | supervisor | miembro_alta | miembro_baja | vincular | proyecto_crear | proyecto_editar | importar
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pmembers_wallet ON project_members(wallet);
CREATE INDEX IF NOT EXISTS idx_pmembers_initiative ON project_members(initiative_id);
CREATE INDEX IF NOT EXISTS idx_talent_events_target ON talent_events(target_wallet);

-- WP13: indice PARCIAL unico. entra_oid es nullable (la mayoria de filas lo tienen a
-- NULL) y un UNIQUE normal pasaria en SQLite pero rompe en SQL Server, que trata los
-- NULL como iguales entre si y solo admitiria UNA fila sin vincular. El filtro
-- `WHERE entra_oid IS NOT NULL` es la forma portable: indice parcial en SQLite,
-- indice filtrado en T-SQL. WP13 lo dejo NO unico porque lib/sql-dialect.ts
-- descartaba la clausula WHERE en silencio; ese bug ya esta corregido y con test, asi
-- que la unicidad vuelve a la base. La comprobacion de lib/entra.ts se conserva: da
-- un mensaje util en vez de un error de constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_entra_oid ON users(entra_oid) WHERE entra_oid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_emails_wallet ON user_emails(wallet);

CREATE INDEX IF NOT EXISTS idx_rep_wallet ON reputation_events(wallet);
CREATE INDEX IF NOT EXISTS idx_points_wallet ON points_ledger(wallet);
CREATE INDEX IF NOT EXISTS idx_ms_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_app_project ON applications(project_id);
CREATE INDEX IF NOT EXISTS idx_reading_wallet ON reading_sessions(wallet);

-- ============================================================================
-- ASISTENTE DE TELEGRAM (WP19) — el bot personal de John.
--
-- CERO SECRETOS AQUI. El token del bot y la API key viven en variables de
-- entorno / Key Vault, nunca en una fila. El codigo de alta se guarda HASHEADO
-- (sha256): la dapp muestra el texto plano una sola vez y la base solo conserva
-- con que comparar.
--
-- Tampoco se guarda ningun dato de horas, ubicacion ni "ultima vez visto": el
-- seguimiento es por objetivos, no por horas (NO-alcance explicito de WP19).
-- El texto crudo de los mensajes y los audios NO se persisten: solo la pieza
-- resultante (la nota o la asignacion) y una linea de log sin contenido.
-- ============================================================================

-- Identidad: telegram_user_id -> principal de `users`. La PK de users (wallet)
-- NUNCA muta (regla heredada de WP13): esto VINCULA, no reescribe.
-- Alta en dos pasos: la dapp crea la fila con link_code_hash y sin
-- telegram_user_id; John envia `/start CODIGO` y ahi se completa el vinculo.
-- is_authorized = permiso de ESCRITURA. v1: exactamente uno (John).
CREATE TABLE IF NOT EXISTS telegram_links (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet           TEXT NOT NULL,
  telegram_user_id TEXT,             -- NULL mientras el alta esta pendiente
  link_code_hash   TEXT,             -- sha256 del codigo de un solo uso; NULL al consumirse
  code_expires_at  TEXT,
  is_authorized    INTEGER NOT NULL DEFAULT 0,
  linked_at        TEXT,             -- cuando se consumio el codigo
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

-- Indices PARCIALES unicos (misma leccion que idx_users_entra_oid de WP13): las
-- dos columnas son nullable y un UNIQUE normal pasaria en SQLite pero en SQL
-- Server solo admitiria UNA fila sin vincular.
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_links_uid ON telegram_links(telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_links_code ON telegram_links(link_code_hash) WHERE link_code_hash IS NOT NULL;

-- Notas de reunion: la pieza RESULTANTE de un `/nota` o de un audio. Es lo unico
-- que se conserva del mensaje original.
CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author      TEXT NOT NULL,
  text        TEXT NOT NULL,
  meeting_ref TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (author) REFERENCES users(wallet)
);

-- Estado PENDIENTE de confirmacion. Nada se escribe en assignments/checkins/notes
-- sin que John toque `Confirmar`: la pieza propuesta espera aqui, no alla. Evita
-- asignaciones fantasma salidas de una reunion.
-- payload_json = la pieza YA ESTRUCTURADA (titulo, responsable, fecha...), nunca
-- el mensaje crudo.
CREATE TABLE IF NOT EXISTS bot_drafts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet       TEXT NOT NULL,
  tool         TEXT NOT NULL,        -- una de las 5 herramientas
  payload_json TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | confirmado | descartado
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT,
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

-- Log de TODA accion del bot, visible en admin. Append-only.
-- `detail` describe la pieza (titulo, id, alcance), nunca el mensaje del usuario.
-- `sender_ref` solo se llena cuando el remitente NO esta registrado: es el minimo
-- para diagnosticar un id desconocido que insiste, y no lleva contenido alguno.
CREATE TABLE IF NOT EXISTS bot_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet     TEXT,
  sender_ref TEXT,
  action     TEXT NOT NULL,
  outcome    TEXT NOT NULL,          -- ok | rechazado | ignorado | no_entendido | error
  target     TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bot_actions_wallet ON bot_actions(wallet);
CREATE INDEX IF NOT EXISTS idx_bot_drafts_wallet ON bot_drafts(wallet);
CREATE INDEX IF NOT EXISTS idx_notes_author ON notes(author);

-- Solicitudes comerciales desde /empresas/contacto y avisos de /encuentros
-- (interes = INTERES_ENCUENTROS). Sin relacion con users: quien escribe es un
-- prospecto, no un miembro de la DAO, y no tiene wallet. Anadida como excepcion
-- autorizada por John (2026-09-23); este archivo se ejecuta en cada arranque.
CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  email      TEXT NOT NULL,
  empresa    TEXT,
  interes    TEXT NOT NULL,            -- slug de src/lib/servicios.ts
  mensaje    TEXT,
  estado     TEXT NOT NULL DEFAULT 'nuevo',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_creado ON leads(created_at);

-- ============================================================================
-- WP31 · RITOS — la cadencia vive en el genoma (RITES_CADENCE); aquí, lo que pasó.
-- ============================================================================

-- Una ocurrencia real de un rito. Se crea al prepararla; las futuras se calculan
-- desde el genoma y no se guardan.
CREATE TABLE IF NOT EXISTS rite_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,                   -- sync | demo | retro
  scheduled_for   TEXT NOT NULL,                   -- inicio programado, ISO UTC con Z
  duration_min    INTEGER NOT NULL,
  state           TEXT NOT NULL DEFAULT 'Planned', -- Planned | Open | Closed
  host_wallet     TEXT,
  recorder_wallet TEXT,
  lugar           TEXT,                            -- dónde ocurre (texto público), opcional
  join_url        TEXT,                            -- enlace de conexión; solo se muestra con sesión
  summary         TEXT,                            -- resumen público, opcional
  notes_url       TEXT,                            -- enlace al acta, opcional
  opened_at       TEXT,
  closed_at       TEXT,
  hash            TEXT,                            -- sha256 del cierre; se ancla en testnet
  decision_log_id INTEGER,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, scheduled_for),
  FOREIGN KEY (host_wallet) REFERENCES users(wallet),
  FOREIGN KEY (recorder_wallet) REFERENCES users(wallet),
  FOREIGN KEY (decision_log_id) REFERENCES decision_log(id)
);

-- Asistencia. Capa 1 = código rotativo. Estar es lo normal: faltar no resta nada.
CREATE TABLE IF NOT EXISTS rite_attendance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  wallet     TEXT NOT NULL,
  layer      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, wallet, layer),
  FOREIGN KEY (session_id) REFERENCES rite_sessions(id),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

-- ============================================================================
-- WP31 · AVISOS Y RECORDATORIOS DE SLA
-- Sin horas, sin "última conexión", sin fecha de lectura: solo la entrega.
-- ============================================================================

-- Bandeja in-app. is_leido lo marca la persona; no existe "cuándo leyó".
CREATE TABLE IF NOT EXISTS avisos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet        TEXT NOT NULL,
  clave         TEXT NOT NULL,       -- idempotencia: <tipo>:<asignación>:<hito>
  tipo          TEXT NOT NULL,
  assignment_id INTEGER,
  texto         TEXT NOT NULL,
  is_leido      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wallet, clave),
  FOREIGN KEY (wallet) REFERENCES users(wallet),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id)
);

-- Lo ya procesado por el motor de recordatorios: una fila por (clave, persona),
-- así nunca se crea dos veces el mismo aviso. Solo cambia is_telegram (0 → 1) cuando
-- Telegram confirma el envío; lo que sigue en 0 se reintenta en la corrida siguiente.
-- La clave 'digest:AAAA-MM-DD' marca el resumen diario ya enviado a esa persona.
CREATE TABLE IF NOT EXISTS reminders_sent (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  clave        TEXT NOT NULL,
  wallet       TEXT NOT NULL,
  dia          TEXT NOT NULL,                -- AAAA-MM-DD en la zona horaria del genoma
  is_inmediato INTEGER NOT NULL DEFAULT 0,   -- 1 = sale en la corrida (P1); 0 = va al resumen del día
  is_telegram  INTEGER NOT NULL DEFAULT 0,   -- 1 = Telegram confirmó el envío
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (clave, wallet),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

CREATE INDEX IF NOT EXISTS idx_rite_sessions_state ON rite_sessions(state);
CREATE INDEX IF NOT EXISTS idx_rite_attendance_wallet ON rite_attendance(wallet);
CREATE INDEX IF NOT EXISTS idx_avisos_wallet ON avisos(wallet);
CREATE INDEX IF NOT EXISTS idx_reminders_wallet ON reminders_sent(wallet, dia);

-- Idempotencia de emisión por ref (§3.4): índices sobre tablas existentes, sin columnas nuevas.
CREATE INDEX IF NOT EXISTS idx_rep_ref ON reputation_events(ref);
CREATE INDEX IF NOT EXISTS idx_points_ref ON points_ledger(ref);
