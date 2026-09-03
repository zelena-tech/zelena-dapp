-- Zelena DAO Dapp v0.1 — esquema SQLite.
-- Todo prepared-statement en la capa lib/db.ts. Reputacion y puntos se DERIVAN
-- por SUM sobre tablas append-only; nunca hay columnas mutables de saldo.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  wallet        TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'Bronze', -- Bronze | Silver | Gold
  invited_by    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | alumni
  is_demo       INTEGER NOT NULL DEFAULT 0,
  is_founder    INTEGER NOT NULL DEFAULT 0,
  cla_signed    INTEGER NOT NULL DEFAULT 0,
  -- WP13: el correo corporativo es un ALIAS de acceso, no una identidad nueva.
  -- La wallet sigue siendo la PK de toda la reputacion ya acumulada.
  email          TEXT,
  recovery_email TEXT,               -- correo personal de continuidad (plano 05)
  is_supervisor  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
  campaign      TEXT NOT NULL,        -- LUMA | CREDIFONO
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,        -- SAS | DAO  (inmutable tras intake)
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

CREATE INDEX IF NOT EXISTS idx_rep_wallet ON reputation_events(wallet);
CREATE INDEX IF NOT EXISTS idx_points_wallet ON points_ledger(wallet);
CREATE INDEX IF NOT EXISTS idx_ms_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_app_project ON applications(project_id);
CREATE INDEX IF NOT EXISTS idx_reading_wallet ON reading_sessions(wallet);

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

-- =====================================================================
-- WP13 (parcial) · Enlace identidad: correo corporativo <-> wallet
-- =====================================================================
-- Las columnas users.email / users.recovery_email se declaran arriba, en el
-- CREATE TABLE. Para bases YA existentes las agrega applyMigrations() en
-- db.ts: un ALTER TABLE aqui reventaria en el segundo arranque, porque
-- schema.sql se ejecuta completo cada vez que se abre la conexion.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- =====================================================================
-- WP14 · Modulo equipo: iniciativas y asignaciones
-- =====================================================================
CREATE TABLE IF NOT EXISTS initiatives (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,            -- WMS | Odoo | DAO | Interno | Cliente-X
  horizon    TEXT NOT NULL DEFAULT 'ahora', -- ahora | siguiente | parqueado
  client_id  INTEGER,                  -- NULL = iniciativa interna
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS assignments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT NOT NULL,
  description         TEXT,
  initiative_id       INTEGER,
  client_id           INTEGER,          -- NULL = trabajo interno sin cliente
  owner_wallet        TEXT,             -- NULL mientras esta en Backlog
  status              TEXT NOT NULL DEFAULT 'Backlog',
  priority            TEXT NOT NULL DEFAULT 'media',  -- alta | media | baja
  size                TEXT NOT NULL DEFAULT 'M',      -- S | M | L
  due_date            TEXT,
  acceptance_criteria TEXT,
  spec_url            TEXT,             -- enlace al PR/issue de GitHub (nunca se duplica el trabajo)
  graph_node_id       TEXT,             -- referencia al nodo del grafo (WP20), por referencia
  blocked_reason      TEXT,             -- obligatorio cuando status = Bloqueada
  published_as_project_id INTEGER,      -- puente con el Agora
  created_by          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (initiative_id) REFERENCES initiatives(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (published_as_project_id) REFERENCES projects(id)
);

-- Append-only: historial completo de transiciones (trazabilidad, digest, fitness).
CREATE TABLE IF NOT EXISTS assignment_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor_wallet  TEXT NOT NULL,
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id)
);

-- Rito 1 del playbook: un check-in por persona por dia, editable el mismo dia.
CREATE TABLE IF NOT EXISTS checkins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet     TEXT NOT NULL,
  day        TEXT NOT NULL,            -- YYYY-MM-DD
  done       TEXT NOT NULL,
  doing      TEXT NOT NULL,
  blocked    TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wallet, day),
  FOREIGN KEY (wallet) REFERENCES users(wallet)
);

CREATE INDEX IF NOT EXISTS idx_assign_owner ON assignments(owner_wallet, status);
CREATE INDEX IF NOT EXISTS idx_assign_client ON assignments(client_id);
CREATE INDEX IF NOT EXISTS idx_assign_initiative ON assignments(initiative_id);
CREATE INDEX IF NOT EXISTS idx_aevents_assignment ON assignment_events(assignment_id);
