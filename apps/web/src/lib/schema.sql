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
  -- Por que NO lleva UNIQUE en el esquema: es NULLABLE y la mayoria de filas la
  -- tienen a NULL. SQLite admite varios NULL en un UNIQUE, pero SQL Server (Azure,
  -- WP16) trata los NULL como iguales y solo admitiria UNO. Un `UNIQUE` aqui
  -- funcionaria en local y romperia el alta en produccion al segundo usuario sin
  -- vincular. La unicidad se garantiza en lib/entra.ts (linkEntraIdentity valida
  -- que ningun otro principal tenga ese oid, dentro de la misma transaccion).
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  owner_wallet            TEXT,
  status                  TEXT NOT NULL DEFAULT 'Backlog',
  status_before_block     TEXT,
  priority                TEXT NOT NULL DEFAULT 'Normal',  -- Urgent | High | Normal | Low
  size                    TEXT,                            -- S | M | L (opcional)
  horizon                 TEXT NOT NULL DEFAULT 'Ahora',   -- horizonte propio de la fila
  due_date                TEXT,                            -- YYYY-MM-DD
  acceptance_criteria     TEXT NOT NULL DEFAULT '',
  spec_url                TEXT,
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
CREATE INDEX IF NOT EXISTS idx_assign_status ON assignments(status);
CREATE INDEX IF NOT EXISTS idx_assign_events ON assignment_events(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assign_events_day ON assignment_events(day);
CREATE INDEX IF NOT EXISTS idx_checkins_day ON checkins(day);

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
