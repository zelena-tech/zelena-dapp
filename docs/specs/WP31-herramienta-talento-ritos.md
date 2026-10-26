# WP31 · Herramienta de talento, proyectos, SLA y ritos (+ sitio público minimalista)

> Base: `feat/v1-unificada` después de la fusión y del pipeline del paquete (≥ `1a4b747`), etiquetada `wp31-base` por el líder tras pegar
> los bloques SQL de §3.2 y §3.3 (paso 0 del plan). Este documento es público (repo público):
> no contiene datos privados del founder, nombres de clientes ni backlog real. El backlog real entra por la UI
> (importador de §4.A.9), nunca por archivos versionados.
>
> **Revisión 2 (tras dos críticas)**: identidad doble del founder, cuatro ojos reales (quien envía no aprueba,
> nada se replanifica en revisión, B8 en las dos direcciones), puertas por página, Telegram sin fugas para
> externos, recordatorios sin avalancha y con reintento, bono de puntualidad al **aprobar** (literal del líder),
> calendario por dependencias con hora de corte. Las decisiones y los rechazos están en el plan de la noche.
>
> Subsume el núcleo de **WP32** (roster como datos) y adelanta partes de WP26 (ritos), WP27 (misiones como
> reconocimiento de anfitrión/relator) y WP34 (reasignación). Lo que no cabe esta noche está en §12.

---

## 0. CONTEXTO

La v1 unificada ya tiene: iniciativas y asignaciones con máquina de estados (WP14), dashboard (WP15),
check-in, bot de Telegram del founder (WP19), genoma versionado (WP02/WP08), épocas con fitness (WP07),
Ágora, Academia, clientes y grafo (WP17/WP20), reingreso con wallet (`/api/login`, `/api/logout`) y la
migración de la base de producción (`prepararSqlite` + `COLUMNAS_NUEVAS`).

Faltan cinco cosas que el founder pidió y que este WP entrega en una sola noche:

| Bloque | Qué | Paquetes |
|---|---|---|
| A | Talento interno y externo **por proyecto** (iniciativa = proyecto) | WP31-A (proyectos, permisos, tablero), WP31-A2 (directorio, vincular, importar), WP31-C2 (puente al Ágora) |
| B | Gamificación: puntos y reputación al aprobar entregas; épocas que se cierran y abren | WP31-B (3 cortes), WP31-I1 (gancho), WP31-I2 (progreso), WP31-D (UI de épocas) |
| C | SLA en horas hábiles, semáforo, recordatorios (bandeja + Telegram) con cron | WP31-B, WP31-C1, WP31-C2, WP31-I2 |
| D | Ritos y comunidad: cadencia, código de asistencia rotativo, reputación de comunidad, `/comunidad` | WP31-B (genoma), WP31-D |
| E | Sitio público minimalista e inspiracional, sin mencionar la estructura societaria | WP31-E1, WP31-E2 |
| F | Contrato de datos para la migración de producción y el paquete de despliegue | este documento §3 y §9 (lo ejecutan el líder y la fusión) |
| G | Tarjeta única "Compruébalo tú mismo" con las pruebas de testnet | WP31-E1 (§5.E); el JSON lo llena el líder |

Las tablas nuevas (bloques SQL de §3.2 y §3.3) **no son de ningún paquete**: el líder las pega literalmente en
`schema.sql` en el paso 0 del plan, antes de crear los worktrees. Así ningún paquete depende de otro para tener
sus tablas, y `schema.sql` deja de ser un archivo caliente.

## 1. PROBLEMA

- `/equipo` solo deja entrar al equipo interno; un freelancer no puede trabajar por proyecto.
- No se pueden crear proyectos, editar ni reasignar tareas desde la web; el roster vive en código y el
  arranque re-impone los roles.
- Aprobar una tarea no da nada; el dueño puede aprobarse a sí mismo (también el founder, que tiene dos
  identidades: su fila de equipo `pending:<slug>` y la wallet de su sesión); el tope de puntos suma todas las
  épocas y la Academia.
- Las páginas de `/equipo` confían en el layout como puerta. En App Router el layout no se vuelve a evaluar en
  cada navegación, así que cada página y cada ruta tienen que autorizar por sí mismas. Además
  `/api/equipo/asignacion` usa `actorFromSession`, que cae a la cookie.
- No hay plazos ni recordatorios; nadie avisa de lo que vence.
- Los ritos no existen como dato; la comunidad no tiene página.
- El sitio público usa jerga, enseña herramientas internas y nombra la estructura societaria.

## 2. RESULTADO ESPERADO (al amanecer, en www.zelena.tech)

1. Un freelancer invitado firma el acuerdo, entra con su wallet, ve solo los proyectos donde es miembro, toma
   y entrega tareas; **otra persona** del proyecto (que no la envió a revisión y sin relación de invitación con
   él) la revisa y la aprueba; recibe puntos y reputación. Lo cubre de punta a punta `flujo-freelancer.test.ts` (I7).
2. El founder o un supervisor crea un proyecto, suma personas con su rol (estructura, ejecuta, revisa,
   vende), planifica el tablero y publica una tarea en el Ágora.
3. Cada tarjeta muestra su semáforo de plazo (A tiempo · Por vencer · Vencida) calculado en horas hábiles
   de Bogotá. Cada persona recibe un resumen diario en su bandeja (y por Telegram si lo vinculó); lo urgente
   (P1), en la siguiente corrida del cron.
4. `/comunidad` muestra los ritos (próximos y pasados), encuentros, Academia y decisiones, y cómo participar.
   El anfitrión muestra un código que rota; quien asiste lo escribe y suma +2 en comunidad.
5. La landing tiene una frase, cuatro puertas y la prueba en vivo. Ninguna página pública nombra la
   estructura societaria, con estas **excepciones legales aceptadas** (y solo estas): el texto del CLA en
   `/acuerdo` y en el paso de firma de `/entrar` (y `GET /api/cla`), `LICENSE` (enlazada desde el pie), la decisión
   histórica del 2026-07-01 en `/gobernanza` (se conserva con su huella y se marca "Reemplazada por…", §5.E) y el
   nombre legal del responsable del tratamiento en `/privacidad` (si `ZELENA_LEGAL_NAME` lo trae).

## 3. MODELO DE DATOS (contrato F)

### 3.1 Principios

- **Solo tablas nuevas. Ninguna columna nueva sobre tablas existentes** → `COLUMNAS_NUEVAS` y `db.ts` no
  cambian. En producción, `schema.sql` (`CREATE TABLE IF NOT EXISTS`) crea las tablas al arrancar; no hay
  `ALTER TABLE`. Se permiten **índices nuevos** sobre tablas existentes (`CREATE INDEX IF NOT EXISTS`): no
  cambian columnas.
- Los bloques de §3.2 y §3.3 los pega el líder **literalmente** en el paso 0 (con los comentarios de
  `schema.sql` que nombran ventures o la estructura societaria reescritos como "proyectos de cliente"). Después
  nadie edita `schema.sql` esta noche; si un paquete necesita algo más, lo pide al líder.
- Solo construcciones que ya existen en `schema.sql` (traducibles a T-SQL por `sql-dialect.ts`):
  `INTEGER PRIMARY KEY AUTOINCREMENT`, `TEXT`, `INTEGER`, `DEFAULT (datetime('now'))`, `UNIQUE (...)`,
  `FOREIGN KEY`, `CREATE INDEX IF NOT EXISTS`. Sin `CHECK`, sin `INSERT OR IGNORE` en el esquema.
- Columnas 0/1 con prefijo `is_` (se materializan como `BIT`). Ningún nombre ni comentario de columna
  contiene `password|secret|token|api_key` (lo bloquea `auditSchemaForSecretColumns`).
- Append-only donde dice "append-only": nunca `UPDATE`/`DELETE` salvo lo que este documento autoriza
  explícitamente (`vincularPrincipal`, §5.A.7; `is_leido` de avisos; `is_telegram` de `reminders_sent`, que pasa
  de 0 a 1 cuando Telegram confirma el envío).
- Fechas: instantes en UTC. Las columnas con `DEFAULT (datetime('now'))` guardan `AAAA-MM-DD HH:MM:SS`
  (UTC sin `Z`); lo que escribe la app con `toISOString()` lleva `Z`. `parseInstanteDb` (§5.0) lee ambos.
  **Todo INSERT nuevo en `assignment_events` escribe `created_at` explícito** con `instanteDb(now)` (mismo
  formato que el default), para que el `now` inyectado en tests y en el bot sea el que se guarda.
- **Zona horaria**: el código nuevo nunca usa `today()`, `getHours()` ni `getDate()`; usa
  `diaLocal(now, BUSINESS_TZ)` / `horaLocal`. Azure y GitHub corren en UTC y este equipo en America/Bogota; el
  líder fija `TZ=UTC` en `vitest.config.ts` (paso 0) para que local = CI = producción.
- **Ledgers y épocas**: todo INSERT nuevo en `reputation_events` y `points_ledger` lleva
  `period_id = currentEpoch(db)` **explícito** (la columna de `reputation_events` tiene `DEFAULT 1`, y una fila
  que lo omita caería en una época ya cerrada y cambiaría su raíz Merkle). Se corrige también la ruta de voto
  (`app/api/governance/vote/route.ts`, WP31-B).

### 3.2 Bloque A — se inserta en `schema.sql` **justo después** de la línea
`CREATE INDEX IF NOT EXISTS idx_checkins_day ON checkins(day);` (lo pega el líder en el paso 0; lo usan A y A2)

```sql
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
```

### 3.3 Bloque B — se añade **al final** de `schema.sql`, después de
`CREATE INDEX IF NOT EXISTS idx_leads_creado ON leads(created_at);` (lo pega el líder en el paso 0; lo usan B,
C1, D e I)

```sql
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
```

### 3.4 Convenciones de `ref` (idempotencia de emisión)

| Fuente | Tabla | `ref` | Eje / bucket |
|---|---|---|---|
| Tarea aprobada | `points_ledger` | `assignment:<id>` | bucket `ejecucion` |
| Tarea aprobada | `reputation_events` | `assignment:<id>` | eje `ejecucion` |
| Asistencia a rito | `reputation_events` | `rito:<sessionId>:asistencia` | eje `comunidad` |
| Anfitrión de rito | `reputation_events` | `rito:<sessionId>:anfitrion` | eje `comunidad` |
| Relator de rito | `reputation_events` | `rito:<sessionId>:relator` | eje `comunidad` |

Antes de insertar se comprueba `SELECT 1 … WHERE ref = ?` **en `points_ledger` y en `reputation_events`**
(si cualquiera de las dos ya tiene el `ref`, es `ya_emitido`), sin filtrar wallet, para que sobreviva a una
vinculación. Ningún delta es negativo. Todo INSERT lleva `period_id = currentEpoch(db)` explícito. Las filas
existentes (`Hito aprobado: …`, `Academia #…`, `Voto en propuesta`) no cambian.

### 3.5 Migraciones de datos al arrancar (idempotentes, en `seedIfEmpty`)

| Paso | Función | Dueño | Qué toca |
|---|---|---|---|
| 1 | `seedTeamRoster` (ya existe) pasa a **solo insertar** | WP31-A2 | Ya no re-impone `role`/`is_supervisor` a filas existentes; salta los slugs de `roster_links` |
| 2 | `seedGenomeV2(db)` | WP31-B | Inserta una versión nueva con las claves nuevas (§6) + entrada en `decision_log`. Una sola vez |
| 3 | `aplicarContenidoPublico(db)` | WP31-E2 | Academia S1 (mismos ids), decisión S2 nueva, reemplazo S3. Una sola vez |

**El arranque no se cae por contenido.** Los pasos 2 y 3 son migraciones de contenido idempotentes: cada una se
llama dentro de su propio `try { … } catch (e) { console.error("[seed] …", e) }` y el arranque sigue (se
reintentan en el siguiente). Siguen siendo fatales solo el esquema y la migración de la fusión. Con el paso 2
fallido la app funciona igual, porque `getActiveGenome` mezcla con los defaults.

No se reescribe ninguna fila de `cla_signatures`, `anchor_queue`, `points_ledger`, `reputation_events`,
`projects`, `milestones`, `invites`, `genome_versions`, `decision_log` (salvo inserciones nuevas), `votes`,
`periods` (salvo el cierre/apertura que dispara el founder).

## 4. ALCANCE (por bloque)

### A · Talento y proyectos (WP31-A, WP31-A2; puente al Ágora en WP31-C2)

1. **Iniciativa = proyecto.** No se crea tabla `proyectos`: `initiatives` es el proyecto; `notes` es su
   descripción. El `slug` es inmutable tras crearse (es la URL).
2. **Membresía** (`project_members`): roles `estructura | ejecuta | revisa | vende`; vínculo
   `interno | externo` (por defecto: `externo` si `users.role='contributor'`, si no `interno`). **Sin acuerdo de
   contribución no hay primer trabajo**: sumar a un contributor o con vínculo `externo` exige `cla_signed=1`.
3. **Acceso a `/equipo`**: equipo interno (founder, core, supervisor) como hoy, **más** cualquier
   `contributor` con CLA firmado y al menos una membresía. El contributor ve y actúa **solo** en sus proyectos;
   no ve el check-in diario (no se mide jornada), ni el dashboard, ni `/equipo/talento`, ni `/clientes`.
   En `/equipo/hoy` ve "Tus proyectos" (nombre, su rol, piezas sin dueño para tomar).
4. **Permisos por proyecto** (§5.A.1). **Cuatro ojos de verdad**: quien es dueño de una entrega no la aprueba
   ni la devuelve, ni siquiera el founder (sus dos identidades cuentan como una: `identidadesDe`, §5.0);
   quien la envió a revisión tampoco; y quien invitó al dueño (o fue invitado por él) tampoco, salvo el
   founder (regla B8 en las dos direcciones). Solo el founder o un supervisor conceden los roles `estructura`
   y `revisa`; nadie cambia sus propios roles.
5. **Tablero** `/equipo/proyectos/[slug]`: columnas Backlog · Asignada · En curso · En revisión · Bloqueada ·
   Hecha (últimos 14 días); filtros por responsable, prioridad, tamaño, horizonte, vencimiento y texto
   (query string, render en servidor); crear, editar y reasignar tareas; panel de miembros. **Una entrega en
   revisión no se reasigna ni se replanifica** (responsable, tamaño, fecha, prioridad y criterio quedan fijos
   hasta que se devuelve o se aprueba).
6. **Proyectos**: crear y editar (founder o supervisor; editar nombre, horizonte y descripción también
   `estructura` del proyecto; el cliente asociado, solo founder o supervisor).
7. **Directorio de talento** `/equipo/talento` (founder y supervisores lo ven; acciones según §7):
   cambiar rol `core ↔ contributor`, dar/quitar supervisión, ver membresías y carga abierta, filtrar
   Interno · Externo, y **vincular** una fila del roster `pending:<slug>` con la cuenta real con la que la
   persona ya entró (con simulación previa). WP31-A2.
8. **Roster como dato**: `seedTeamRoster` solo inserta lo que falta; un cambio hecho en la UI sobrevive
   al reinicio. WP31-A2.
9. **Importar backlog por la UI** (founder/supervisor): pegar o subir el CSV en `/equipo/talento#importar`
   (enlazado como "Importar CSV" desde `/equipo/proyectos`) → `importTasks` (ya existe). Resuelve el Assignee por datos (roster vinculado o `display_name`), no
   solo por la constante. Importar **no emite puntos** (no crea eventos `aprobar`). WP31-A2.
10. **Reingreso con wallet**: ya portado por la fusión (`/api/login`, `/api/logout`). Este WP solo verifica
    que un contributor miembro vuelve a entrar y llega a su tablero.
11. **Publicar una tarea en el Ágora** (WP31-C2): crea `projects` (estado `Open`) + `milestones` y rellena
    `assignments.published_as_project_id`. Solo trabajo en `Backlog` sin responsable, con campos públicos
    editables y vista previa; la pieza publicada se paga por sus hitos, no por la aprobación interna.
12. **Proyectos de cliente**: una iniciativa con `client_id` solo la ven el founder y quien participa
    (`client_members` o `project_members`), igual que `/clientes` (WP17).
13. **Puertas por página**: cada `app/equipo/**/page.tsx` y cada `app/api/equipo/**/route.ts` autoriza por sí
    misma (§5.A.2). El layout es un atajo de UX, no la puerta.

### B · Gamificación (WP31-B reglas, WP31-I1 gancho, WP31-I2 progreso, WP31-D UI de épocas)

1. Al pasar una tarea a `Hecha` (acción `aprobar`, aprobador que no es la misma persona que el dueño, §4.A.4)
   se emite, en la misma transacción: puntos `TASK_POINTS[tamaño]` (+ `ON_TIME_BONUS_PCT` % si se aprobó a
   tiempo) en bucket `ejecucion`, y reputación `TASK_REP[tamaño]` en eje `ejecucion`. Sin tamaño cuenta como `S`.
   Una pieza publicada en el Ágora (`published_as_project_id`) no emite aquí: se paga por sus hitos (§5.B.3).
2. **"A tiempo"** (literal de la decisión del líder) = la tarea **se aprobó** antes de su vencimiento de
   entrega: fin del día hábil de `due_date` o, sin fecha, el SLA de entrega por prioridad desde el inicio del
   reloj. Sin plazo (Low sin fecha), no hay bono. Si llega tarde, no hay bono y **no se resta nada**: se pierde
   solo el extra (R1). Para que la demora de revisión no se coma el bono, el motor de recordatorios avisa a quien
   revisa (§5.C.1, `revision_pendiente`). La variante "medir al entregar" queda como propuesta para el founder (§12).
3. **Tope**: puntos de la época actual en bucket `ejecucion` ≤ `EPOCH_BUDGET`. Si no alcanza, se emite el
   remanente (clamp); la reputación se emite completa. Se corrige el mismo bug en `approveMilestone`
   (rechaza, como hoy, pero contando solo época + bucket) y en la Academia (época + bucket `academia`).
   **Tareas e hitos del Ágora comparten a propósito** el presupuesto `ejecucion` de la época (es el mismo tipo
   de trabajo). Con 100.000 de presupuesto el choque es improbable; separar un `TEAM_BUDGET` (requisitos d.2)
   es un siguiente paso (§12).
4. **Nunca se resta nada**: sin deltas negativos, sin `UPDATE`/`DELETE` de ledgers en el motor.
5. **Idempotente** por `ref` (§3.4).
6. `getActiveGenome` **mezcla con los defaults** (`{...GENOME_DEFAULTS, ...guardado}`).
7. **"Tu progreso"** (en `/equipo/hoy` y `/perfil`): puntos y reputación de la época por entregas,
   entregas a tiempo, e **insignias derivadas** por `COUNT`/`SUM` (§5.B.4), sumando todas las identidades de la
   persona (`identidadesDe`). Las metas de las insignias viven en el genoma (`BADGE_GOALS`); el nombre y la
   descripción, en código (son copy). Sin rankings de personas; nada se pierde.
8. **Épocas**: "Cerrar esta época y abrir la siguiente" en `/admin` (una sola operación atómica, §5.B.5), y
   "Abrir época" solo si no hay ninguna abierta.

### C · SLA y recordatorios (WP31-B `sla.ts`, WP31-C1 motor y cron, WP31-C2 Telegram, WP31-I2 badges)

1. Claves `SLA_*`, horario hábil (L-V 08:00–18:00, `America/Bogota`) y política de recordatorios en el
   genoma (§6). Sin festivos en v1.
2. `sla.ts` puro: horas hábiles, vencimientos por fase (respuesta, entrega, revisión, bloqueo) y semáforo
   `a_tiempo | por_vencer | vencida | sin_plazo`.
3. Badge de semáforo en `/equipo/hoy`, en el tablero del proyecto y en el dashboard.
4. Motor de recordatorios puro + `reminders_sent` (idempotencia y reintento) + bandeja `avisos` + página
   `/equipo/avisos`.
5. Transporte Telegram para todo el equipo (vinculación voluntaria con `/start CODIGO`). Flag
   `SLA_REMINDERS_ENABLED` gobierna **todo** el motor (apagada no escribe ni envía nada). En código está
   apagada por defecto; **en producción se despliega encendida** (`=1`) después de una corrida de simulación
   (`?simular=1`) con conteos razonables, porque el founder pidió los recordatorios. Sin `TELEGRAM_BOT_TOKEN` →
   solo bandeja. Ni el envío ni la vinculación exigen `ANTHROPIC_API_KEY`. Con la flag apagada,
   `/equipo/avisos` lo dice ("Los recordatorios están en pausa…", §8.5).
6. `POST /api/cron/recordatorios` protegido por `CRON_SECRET` (≥ 32, comparación en tiempo constante) y un
   workflow de GitHub Actions programado que lo llama (el secreto va en GitHub Secrets; el repo es público). El
   workflow tiene que estar en la rama por defecto (`main`): GitHub solo dispara `schedule` y `workflow_dispatch`
   desde ahí (§9).
7. **Un mensaje agrupado por persona y día** (a `REMINDER_DIGEST_HOUR`). **Solo lo urgente (P1) sale en la
   corrida**, y los inmediatos de una persona en una misma corrida van juntos en un mensaje, con tope
   `REMINDER_MAX_INMEDIATOS`. Los escalamientos de High y Normal van al resumen del día. Lo que ya estaba vencido
   antes de encender el motor no escala (guarda de arranque, §5.C.2). Fuera de horario hábil, silencio. El texto
   habla de la entrega, nunca de la persona (el responsable se ve en el enlace, no en el mensaje). GitHub puede
   retrasar los programados de 5 a 30 min: "inmediato" significa "en la siguiente corrida".

### D · Comunidad y ritos (WP31-B genoma, WP31-D lógica y UI; tablas del paso 0)

1. Tres ritos con cadencia en el genoma (`RITES_CADENCE`): sync semanal 30 min, demo quincenal, retro
   mensual. Las próximas ocurrencias se **calculan**; solo se guarda la que se prepara. Cada rito tiene
   **audiencia**: el sync es del equipo (y de quien trabaja en un proyecto); la demo y la retro son de la
   comunidad. La landing y "Próximos" en `/comunidad` solo anuncian ritos de comunidad.
2. Asistencia con código de 6 dígitos que rota cada `RITE_CODE_ROTATION_S` s
   (HMAC con `RITES_SECRET` o derivado de `SESSION_SECRET`; en producción, sin un secreto real, falla). Se
   acepta el bucket actual y el anterior, solo con el rito `Open` y dentro de su ventana
   (`[inicio − RITE_WINDOW_MIN, inicio + duración + RITE_WINDOW_MIN]`).
3. Reputación de comunidad: `+RITE_ATTEND_REP` por asistir; `+RITE_HOST_REP` / `+RITE_RECORDER_REP` al
   cerrar el rito para anfitrión y relator. Faltar no resta nada. Cuentas demo, principales `pending:` y
   personas sin CLA no registran asistencia.
4. Cerrar un rito: hash determinista → `anchor_queue(kind='rite')` + entrada en `decision_log` (título que
   empieza por "Rito "; las listas públicas de decisiones las excluyen: se ven en los pasados de `/comunidad`).
5. Página pública `/comunidad`: ritos (con lugar; el enlace de conexión solo con sesión) + encuentros +
   Academia + las 3 decisiones más recientes, cómo participar, y "Tu asistencia" si hay sesión.
6. Gestión en `/admin` (preparar con lugar y enlace, asignar anfitrión/relator, abrir, cerrar) y vista del
   anfitrión en `/comunidad/ritos/[id]`. Anfitrión y `/admin` ven **solo el conteo** de asistentes; la lista
   nominal existe solo dentro del hash de cierre, y cada persona ve la suya.
7. El fitness deja de degradar `participation`: `gatherEpochData` cuenta asistencia a ritos.

### E · Sitio público (WP31-E1 páginas, WP31-E2 contenido)

0. **Lenguaje visual**: las páginas públicas nuevas o reescritas (landing, `/metodo`, `/comunidad`,
   `/privacidad`, `/acuerdo`, cabeceras de `/gobernanza` y `/academia`) usan el lenguaje editorial de
   `/manifiesto` (`font-serif` en titulares, una idea por bloque, mucho aire, sin prompts de terminal ni el
   componente `Type`). El mono (Space Mono) queda para `/equipo` y `/admin`.
1. **Landing `/`**: hero de una frase, cuatro puertas (Manifiesto · Método · Comunidad · Para empresas),
   prueba en vivo (solo cifras, sin listar proyectos), próximo rito de comunidad o encuentro, cierre con dos
   CTA (Entrar · Ven a un encuentro / Ven a la próxima demo, §8.1).
2. **`/metodo`** (reemplaza `/ecosistema`, redirección 308): los 8 pasos en lenguaje llano.
3. **Menú público** de 4 enlaces + Entrar. Las herramientas internas solo con sesión. **Pie** con legales
   (Acuerdo de contribución, Privacidad, Licencia → `LICENSE` en GitHub) y aviso de testnet.
4. **Reemplazos** U1–U13 (UI), W1–W17 y W-R1..W-R3 (whitepaper), S1 (Academia, migración con los mismos ids
   de quiz), S2 (decisión nueva transparente; no se reescriben hashes), S3 ("score por entrega"). Textos de
   reemplazo: anexo §13.
5. **`/empresas`**: "Nómina por desempeño" → "Incentivos por desempeño"; fuera la promesa de rendimiento
   sobre fondos; los pagos a cuentas bancarias se marcan "piloto en testnet"; "en camino a mainnet" sale.
6. **`/privacidad`**: aviso de tratamiento de datos; los formularios (`/empresas/contacto`, `/encuentros`),
   `/entrar` y `/equipo/telegram` lo enlazan; los dos formularios añaden una casilla de aceptación **no
   premarcada**.
7. **Ágora**: estados en español y etiquetas **Cliente / Comunidad** (el valor `SAS|DAO` se conserva en base).
   Los literales `"SAS"`/`"DAO"` viven **solo** en `src/lib/agora-labels.ts`. Junto a cada monto, "Red de pruebas".
8. `CLA.md` y `LICENSE` **no se tocan**; el CLA viaja byte a byte en el paquete.
9. **`/gobernanza`** (pie: "Decisiones"): cabecera en lenguaje llano, la auditoría de funciones latentes pasa a
   "Lo que aprendimos de cada regla", "hash" → "huella", las actas "Rito …" no se listan y la decisión
   reemplazada por S2 muestra "Reemplazada por: Las etiquetas de proyecto pasan a Cliente y Comunidad".

### G · Pruebas de Stellar (una sola tarjeta)

Tarjeta única **"Compruébalo tú mismo"** (`PruebaTestnet`) que lee `apps/web/src/data/pruebas-testnet.json`
(§5.E): muestra la última transacción verificable del JSON y, si no hay, la última firma del acuerdo anclada de
verdad (tx de 64 hex, cuenta no demo). `PruebaEnVivo` queda solo con las cifras. El líder llena el JSON antes del
despliegue con los contratos y transacciones públicas de la corrida de testnet (contenido en el plan).

## 5. REGLAS PURAS Y FIRMAS

> Toda la lógica vive en `src/lib/` y se testea con base en memoria (`openDb(":memory:")` + `schema.sql`).
> Los handlers solo validan (zod), autorizan con estas funciones e invocan. **Las firmas exportadas
> existentes no cambian** (solo se añaden exports o parámetros opcionales al final).
>
> Reglas de construcción que solo falla `next build` (tsc y vitest no las ven):
> - **Límite cliente/servidor**: los módulos que importa un componente `"use client"` (`menu.ts`,
>   `agora-labels.ts`, `metodo.ts`, `sla.ts`, `zona-horaria.ts`, `ritos-labels.ts`) no importan, ni en cadena,
>   `db.ts`, `crypto.ts`, `session.ts` ni nada con `node:`. Lo que necesita HMAC o la base va en módulos de
>   servidor aparte (`ritos-codigo.ts`, `ritos.ts`, `sla-db.ts`).
> - **CLI con type-stripping**: `packages/scripts/import-tareas.mjs` carga `team-import.ts` → `team.ts` con el
>   type-stripping de Node. Todo import **de valor** nuevo en la cadena de `team.ts` (`gamificacion.ts`,
>   `sla.ts`, `sla-db.ts`, `genome.ts`, `zona-horaria.ts`, `identidades.ts`, `talento.ts`) lleva sufijo `.ts` y
>   sintaxis borrable (sin `enum`, `namespace` ni propiedades de parámetro). Los `import type` no importan.
> - **Lint**: `next/core-web-vitals` falla con comillas sin escapar en JSX (`react/no-unescaped-entities`); el
>   copy en español va entre llaves (`{"«…»"}`) o con entidades. Todo paquete que toque `app/` o
>   `src/components/` corre `npm run lint` y `npm run build` antes de entregar.

### 5.0 Módulos base (WP31-B, corte 1a)

```ts
// src/lib/zona-horaria.ts (puro, apto para cliente)
export function parseInstanteDb(s: string): Date;            // 'AAAA-MM-DD HH:MM:SS' = UTC; ISO tal cual
export function instanteDb(d: Date): string;                 // 'AAAA-MM-DD HH:MM:SS' en UTC (formato del default de SQLite)
export function diaLocal(instante: Date, tz: string): string;  // AAAA-MM-DD
export function horaLocal(instante: Date, tz: string): number; // 0-23
export function diaSemanaIso(dia: string): number;             // 1 = lunes … 7 = domingo
export function instanteLocal(dia: string, hhmm: string, tz: string): Date; // esa fecha y hora local → instante
```
Algoritmo: `Intl.DateTimeFormat` con `timeZone` y `hourCycle:'h23'`; la conversión local→instante calcula el
desfase con `formatToParts` (sin constantes de zona). `sla.ts` y los ritos importan de aquí.

```ts
// src/lib/identidades.ts (servidor)
/** Principal de equipo del founder: la wallet vinculada a su slug del roster (`roster_links`) o
 *  `pending:<slug>` si aún existe; null si no hay ninguno. */
export function principalFounder(db: DB): string | null;
/** Wallets que son la misma persona: ella misma; su `pending:<slug>` o la wallet vinculada a ese slug
 *  (`roster_links`); y, si es founder (rol en la base) o es `principalFounder`, todas las filas activas con
 *  `role='founder'` más `principalFounder`. Sin duplicados, ordenadas. */
export function identidadesDe(db: DB, wallet: string): string[];
export function mismaPersona(db: DB, a: string, b: string): boolean;
```
Se usa en: `esDueno`, "quien envió" y B8 (A), la defensa de `emitirPorAprobacion`, `senalesProgreso` y
`progresoDeTareas` (B), la bandeja de avisos y los destinatarios (C1), `founderTeamWallet` (C2) y la asistencia
(D). **Nunca** se compara contra `FOUNDER_WALLET` (test `sin-gates-por-persona`): el founder se reconoce por su
rol en la base y por el roster.

### 5.A Talento y proyectos (WP31-A; directorio, vinculación e importador en WP31-A2)

#### 5.A.1 `src/lib/roles.ts` (puro)

```ts
export const ROLES_PROYECTO = ["estructura", "ejecuta", "revisa", "vende"] as const;
export type RolProyecto = (typeof ROLES_PROYECTO)[number];
export const ROL_PROYECTO_LABEL: Record<RolProyecto, string>; // Estructura · Ejecuta · Revisa · Vende
export const VINCULOS = ["interno", "externo"] as const;
export type Vinculo = (typeof VINCULOS)[number];
export function isRolProyecto(v: unknown): v is RolProyecto;

export interface PermisosProyecto {
  ver: boolean;        // ver el proyecto y su tablero
  crear: boolean;      // crear entregas en el proyecto (para sí o sin dueño)
  planificar: boolean; // título, criterio, prioridad, tamaño, horizonte, fecha, responsable, mover piezas ajenas
  revisar: boolean;    // aprobar / devolver entregas AJENAS
  tomar: boolean;      // tomar una pieza sin dueño (acción `asignar` para sí)
}

export function permisosEnProyecto(
  actor: { role: Role; isSupervisor: boolean },
  roles: readonly RolProyecto[]
): PermisosProyecto;

export function puedeTransicionar(input: {
  accion: TeamAction;            // de team-state-machine.ts (no se modifica)
  esDueno: boolean;              // identidadesDe(actor) incluye al dueño
  sinDueno: boolean;
  permisos: PermisosProyecto;
  esQuienEnvio?: boolean;        // identidadesDe(actor) incluye a quien hizo el último enviar_a_revision
  vinculoInvitacion?: boolean;   // B8: el actor invitó al dueño o el dueño al actor (false si el actor es founder)
  duenoPendiente?: boolean;      // el dueño es un `pending:<slug>` sin vincular
  esGlobal?: boolean;            // founder o supervisor
}): { ok: true } | { ok: false; motivo: string };

/** Qué roles de proyecto puede conceder o quitar el actor. Founder/supervisor: los 4. Rol `estructura`
 *  (sin ser founder ni supervisor): solo `ejecuta` y `vende`. Nunca sobre sí mismo (lo resuelve team.ts). */
export function rolesQuePuedeConceder(actor: { role: Role; isSupervisor: boolean }, rolesDelActor: readonly RolProyecto[]): RolProyecto[];
```

Tabla de `permisosEnProyecto` (OR de lo que da cada fila que aplica):

| Quién | ver | crear | planificar | revisar | tomar |
|---|---|---|---|---|---|
| founder o `isSupervisor` | ✓ | ✓ | ✓ | ✓ | ✓ |
| core (sin roles en el proyecto) | ✓ | ✓ | – | – | ✓ |
| contributor sin roles | – | – | – | – | – |
| rol `estructura` | ✓ | ✓ | ✓ | ✓ | ✓ |
| rol `ejecuta` | ✓ | ✓ | – | – | ✓ |
| rol `revisa` | ✓ | – | – | ✓ | – |
| rol `vende` | ✓ | – | – | – | – |

`permisosDe` (team.ts) aplica esta tabla y además: si `puedeVerProyecto` es falso (p. ej. un proyecto de cliente
sin participación), devuelve todo en falso.

`puedeTransicionar`:

| Acción | Permitida si | Motivo si no (en este orden) |
|---|---|---|
| `aprobar`, `devolver` | `!esDueno && !esQuienEnvio && !vinculoInvitacion && permisos.revisar && (!duenoPendiente \|\| esGlobal)` | dueño: "Quien entrega no aprueba su propia entrega." · envió: "Quien la envió a revisión no la aprueba: la revisa otra persona." · B8: "Esta entrega la revisa otra persona: quien invita no evalúa a su invitado, ni al revés." · pendiente: "Esta entrega es de alguien del equipo que aún no vincula su cuenta: la revisa el founder o un supervisor." · resto: "La revisión es de quien revisa o estructura el proyecto." |
| `asignar` | `sinDueno && (permisos.tomar \|\| permisos.planificar)` | "Esta pieza ya tiene responsable." / "No puedes tomar trabajo en este proyecto." |
| `empezar`, `enviar_a_revision`, `bloquear`, `desbloquear` | `esDueno \|\| permisos.planificar` | "Solo quien la tiene a cargo (o quien planifica el proyecto) puede moverla." |

`applyAssignmentAction` calcula los flags así: `esDueno = mismaPersona(owner, actor)`; `esQuienEnvio` =
`identidadesDe(actor)` contiene el `actor_wallet` del último evento `enviar_a_revision`; `vinculoInvitacion` =
el actor no es founder y (`users.invited_by` del dueño ∈ `identidadesDe(actor)` o `invited_by` del actor ∈
`identidadesDe(dueño)`); `duenoPendiente` = el dueño empieza por `pending:` y su slug no está en `roster_links`.

#### 5.A.2 `src/lib/authz.ts`

```ts
export interface EquipoActor extends TeamActor {
  alcance: "equipo" | "proyectos"; // equipo = interno; proyectos = contributor con membresía
  proyectos: number[];             // initiative_id donde tiene al menos un rol
}
/** Gate de /equipo. Interno → alcance 'equipo'. Contributor con `cla_signed=1` y ≥1 membresía → 'proyectos'.
 *  Si no, null. Lee la base, nunca la cookie. */
export function equipoActor(session: AdminSession | null, db?: DB): EquipoActor | null;
export function accesoEquipo(session: AdminSession | null, db?: DB): boolean;
```
`equipoInternoActor`, `adminActor`, `clientActor` no cambian. Usuarios `status='alumni'` → `null`.
Contributor sin CLA → `null` aunque tenga membresía.

**Regla dura: el layout no es la puerta.** En Next 14 App Router el layout no se vuelve a evaluar en la
navegación del cliente, y una petición RSC puede pedir solo el segmento de la página. Por eso:
1. Todo `app/equipo/**/page.tsx` empieza con `const actor = equipoActor(session, db); if (!actor) redirect("/perfil")`
   (o `equipoInternoActor`/`adminActor` si la página es solo del equipo interno) y además aplica **su** puerta:
   `puedeVerProyecto` → `notFound()`; founder o supervisor para talento, publicar y dashboard (si no, la
   explicación de siempre, sin datos).
2. Toda ruta `app/api/equipo/**/route.ts` usa `equipoActor`, `equipoInternoActor` o `adminActor`; **nunca**
   `actorFromSession` (cae a los claims de la cookie). Hoy lo usan `asignacion`, `digest` y la página del
   dashboard: A los cambia.
3. Para el alcance `'proyectos'`, las listas de los formularios salen de `proyectosVisibles` y
   `miembrosDeProyecto`, nunca de `listInitiatives`, `listTeamMembers` ni del directorio.
4. Test estático en `authz.test.ts`: recorre `app/equipo/**/page.tsx` y `app/api/equipo/**/route.ts` y falla si
   alguno no contiene `equipoActor(`, `equipoInternoActor(` o `adminActor(`, o si contiene `actorFromSession(`.
   Exento solo `app/equipo/page.tsx` (redirección pura). Las páginas que creen C1, C2, D e I lo cumplen.

#### 5.A.3 `src/lib/team.ts` — proyectos y membresías

```ts
export interface ProjectMemberRow {
  id: number; initiative_id: number; wallet: string; rol_proyecto: RolProyecto;
  vinculo: Vinculo; added_by: string | null; created_at: string;
}
export interface MiembroProyecto extends ProjectMemberRow { display_name: string; role: Role }

export function rolesEnProyecto(db: DB, wallet: string, initiativeId: number): RolProyecto[];
export function membresiasDe(db: DB, wallet: string): Array<{ initiativeId: number; roles: RolProyecto[] }>;
export function permisosDe(db: DB, actor: TeamActor, initiativeId: number | null): PermisosProyecto;
export function miembrosDeProyecto(db: DB, initiativeId: number): MiembroProyecto[];
/** Wallets con rol 'estructura' en el proyecto; si no hay, supervisores globales activos (no demo). */
export function supervisoresDeProyecto(db: DB, initiativeId: number | null): string[];

export function agregarMiembro(db: DB, actor: TeamActor,
  input: { initiativeId: number; wallet: string; rol: RolProyecto; vinculo?: Vinculo }): number;
export function quitarMiembro(db: DB, actor: TeamActor,
  input: { initiativeId: number; wallet: string; rol: RolProyecto }): void;

export function crearProyecto(db: DB, actor: TeamActor,
  input: { name: string; horizon?: Horizon; notes?: string; clientId?: number | null }): InitiativeRow;
export function editarProyecto(db: DB, actor: TeamActor,
  input: { initiativeId: number; name?: string; horizon?: Horizon; notes?: string | null; clientId?: number | null }): InitiativeRow;
export function getProyectoPorSlug(db: DB, slug: string): InitiativeRow | undefined;
export function proyectosVisibles(db: DB, actor: EquipoActor): InitiativeRow[];
export function puedeVerProyecto(db: DB, actor: EquipoActor, initiativeId: number): boolean;
/** Personas que el actor puede sumar o asignar en el proyecto (para los selects). Founder/supervisor:
 *  activas no demo del equipo interno + contributors con CLA. `estructura` sin ser founder/supervisor: solo el
 *  equipo interno y los miembros actuales; a un externo lo suma por su wallet exacta. */
export function candidatosParaProyecto(db: DB, actor: TeamActor, initiativeId: number): Array<{ wallet: string; nombre: string; interno: boolean }>;
```
Reglas:
- `agregarMiembro`/`quitarMiembro` exigen `permisosDe(...).planificar` **y** que el rol esté en
  `rolesQuePuedeConceder` (estructura solo da o quita `ejecuta`/`vende`; `estructura` y `revisa` los dan o quitan
  founder o supervisor). Sobre uno mismo (`mismaPersona`) → 403 "Tus propios roles los cambia otra persona."
- La persona debe existir, estar activa y no ser demo. Si es `contributor` o el vínculo es `externo`, debe tener
  `cla_signed=1`; si no → `TeamError(409, "Primero tiene que firmar el acuerdo de contribución.")`.
- Duplicado (mismo rol) → `TeamError(409)`. `quitarMiembro` con entregas abiertas o bloqueadas de esa persona en
  el proyecto y sin otro rol que la mantenga dentro → `TeamError(409, "Primero reasigna sus entregas abiertas en
  este proyecto.")`.
- `crearProyecto`: founder o supervisor; nombre 2–80; slug único (si existe → 409). `editarProyecto`: founder,
  supervisor o `estructura`; nunca cambia el `slug`; `clientId` solo founder o supervisor (403 si no).
- `puedeVerProyecto`: founder, todo. Si la iniciativa tiene `client_id`, cualquier otra persona necesita
  `client_members` de ese cliente o `project_members` del proyecto. Si no tiene cliente: supervisor y core, sí;
  contributor, solo con membresía.
- `permisosDe(db, actor, null)` (pieza sin proyecto) = permisos globales: founder y supervisor, todo; core,
  `ver`/`crear`/`tomar`; contributor, nada. Mover una pieza a `initiativeId: null` solo founder o supervisor.
- Cada operación escribe en `talent_events`.

#### 5.A.4 `src/lib/team.ts` — tablero y edición

```ts
export interface FiltrosTablero {
  owner?: string | "sin"; priority?: Priority; size?: Size | "sin"; horizon?: Horizon;
  vence?: "vencidas" | "semana"; q?: string; hechasDias?: number; // por defecto 14
}
export function parseFiltrosTablero(sp: Record<string, string | string[] | undefined>): FiltrosTablero; // puro, ignora valores inválidos
export function tableroDeProyecto(db: DB, initiativeId: number, filtros: FiltrosTablero, now?: Date):
  { columnas: Record<TeamStatus, AssignmentView[]>; total: number };

export interface EditarAsignacionInput {
  assignmentId: number;
  // contexto (dueño o planificador)
  description?: string; specUrl?: string | null;
  // planificación (solo planificador del proyecto actual y, si cambia, del destino)
  title?: string; acceptanceCriteria?: string; priority?: Priority; size?: Size | null;
  horizon?: Horizon; dueDate?: string | null; initiativeId?: number | null;
  ownerWallet?: string | null; needsFounder?: boolean;
  motivo?: string; // opcional, ≤ 300, va al evento
}
export const editarAsignacionSchema: z.ZodType<EditarAsignacionInput>;
export function editarAsignacion(db: DB, actor: TeamActor, input: EditarAsignacionInput, now?: Date): AssignmentRow;
```
Reglas de `editarAsignacion`:
- `Hecha` no se edita (409 "Una entrega aprobada no se edita.").
- **`En revisión`**: no se cambian `ownerWallet`, `size`, `dueDate`, `priority` ni `acceptanceCriteria`
  (409 "Una entrega en revisión no se reasigna ni se replanifica: devuélvela primero."). Así nadie se queda con
  los puntos de otra persona, ni se fabrica o se quita el bono, ni se infla el tamaño después de entregar.
- Campo de planificación sin permiso → 403; el dueño solo cambia `description` y `specUrl`.
- `ownerWallet` nuevo debe ser del equipo interno (activo, no demo) o miembro del proyecto; si es contributor
  no miembro → 400 "Primero súmale al proyecto." `ownerWallet: null` solo en `Backlog`.
- `initiativeId` nuevo exige `planificar` en el origen y en el destino; `null`, solo founder o supervisor.
- Si la pieza está en `Backlog` y recibe dueño, pasa a `Asignada` **por la máquina de estados** (`asignar`).
- Un evento por llamada en `assignment_events`: `reasignar` (si cambió el dueño) o `editar`; `from_status` =
  `to_status` = estado vigente (salvo el caso `asignar`); `reason` = motivo o lista de campos cambiados
  (nombres de campo, nunca valores personales). `updated_at` = `now`; `created_at` = `instanteDb(now)`.

`createAssignmentAs` (misma firma) amplía: un contributor puede crear **solo** con `initiativeId` de un
proyecto donde `permisosDe(...).crear`; si quien crea no `planificar`, `size` se fuerza a `null` (el tamaño lo
fija quien asigna); asignar a otra persona exige `planificar` (o founder/supervisor, como hoy) y que el
destino sea interno o miembro del proyecto. Acepta un `now?: Date` opcional al final (por defecto `new Date()`)
y su INSERT del evento `crear` escribe `created_at = instanteDb(now)`.

`applyAssignmentAction` (misma firma): autoriza con `permisosDe` + `puedeTransicionar` (con los flags de
§5.A.1) en lugar de la regla actual. El INSERT del evento escribe `created_at = instanteDb(now)`. El resto
(máquina pura, UPDATE + evento en una transacción) no cambia. **WP31-I1** añade después el gancho de emisión
(§5.B.3), **sin `try/catch` alrededor**: si la emisión falla, se revierte la aprobación entera.

#### 5.A.5 `src/lib/talento.ts` (nuevo, WP31-A2) — directorio y roster como dato

```ts
export interface PersonaDirectorio {
  wallet: string; nombre: string; role: Role; isSupervisor: boolean; status: string;
  pendiente: boolean;            // principal pending:<slug> sin vincular
  tieneCla: boolean;
  vinculo: "interno" | "externo" | "mixto" | null; // derivado de sus membresías (null = sin proyectos)
  abiertas: number;              // piezas abiertas a su nombre: carga para repartir (R3), nunca calidad
  membresias: Array<{ initiativeId: number; slug: string; nombre: string; roles: RolProyecto[] }>;
}
export function directorioTalento(db: DB, filtro?: { vinculo?: "interno" | "externo" }): PersonaDirectorio[]; // sin is_demo=1; orden por nombre
export function candidatosAVincular(db: DB): Array<{ wallet: string; nombre: string }>; // no pending, cla_signed=1, sin roster_links; no demo salvo la excepción del founder (§5.A.7)
export function cambiarRol(db: DB, actor: TeamActor, input: { wallet: string; role: "core" | "contributor" }): void;
export function cambiarSupervisor(db: DB, actor: TeamActor, input: { wallet: string; isSupervisor: boolean }): void;
export function walletDeRoster(db: DB, slug: string): string | null; // roster_links.wallet ?? (pending:<slug> si existe) ?? null
export function rosterMemberFor(db: DB, wallet: string): RosterMember | undefined; // por pending o por roster_links
```
- `cambiarRol` y `cambiarSupervisor`: solo founder; nunca sobre sí mismo (`mismaPersona`) ni sobre un
  `founder`; el rol `founder` no se asigna desde la UI. Escriben `talent_events`.
- `cambiarRol` a `contributor` con piezas abiertas en proyectos donde la persona no es miembro →
  409 "Primero reasigna sus entregas abiertas o súmale a esos proyectos." (si no, perdería el acceso a su trabajo).
- `seedTeamRoster` (en `team.ts`; A2 es dueño **solo del cuerpo de esa función**): **solo inserta** las filas
  que faltan; salta los slugs presentes en `roster_links`; la línea de retrocompatibilidad
  `is_founder=1 → founder` se conserva.

#### 5.A.6 `src/lib/team-import.ts` (WP31-A2)

`importTasks(db, csvText, createdBy?)` (misma firma). El Assignee se resuelve con
`resolverPersona(db, nombre): string | null` (nuevo export): alias del roster → `walletDeRoster`; si no,
coincidencia única de `display_name` normalizado entre activos no demo; si no, error de fila como hoy.
`mapRow` sigue siendo puro (devuelve el nombre crudo; la resolución pasa a `importTasks`).

#### 5.A.7 `vincularPrincipal` (en `talento.ts`, WP31-A2; operación sensible, autorizada a reescribir wallet)

```ts
export const REFERENCIAS_WALLET: ReadonlyArray<{ tabla: string; columna: string; unicaCon?: readonly string[] }>;
export function vincularPrincipal(db: DB, actor: TeamActor, input: { slug: string; wallet: string; simular?: boolean }):
  { movidas: Record<string, number>; descartadas: Record<string, number>; simulado: boolean };
```
- Solo founder. `pending:<slug>` debe existir; `wallet` debe existir, no ser `pending:`, no `is_demo`, tener
  `cla_signed=1` y no estar en `roster_links`. La fila pending no puede tener `cla_signatures` (si tiene, error).
  **Excepción del founder** (decisión de esta noche): si `slug` es el del founder en el roster y el destino
  tiene `role='founder'` en la base, se acepta aunque sea `is_demo=1`, y la operación lo deja en `is_demo=0`
  (es la cuenta real del founder). Se reconoce por rol y roster, nunca comparando con `FOUNDER_WALLET`.
- **No reescribe historia sellada**: si el pending tiene filas de `points_ledger` o `reputation_events` en
  periodos que no están `Open`, o asistencia, anfitrionía o relatoría en ritos `Closed`, → 409 "Esta cuenta tiene
  historia en una época o un rito ya cerrados: su huella no se puede reescribir." (cambiar esas wallets haría
  irreproducible la raíz Merkle ya anclada).
- `simular: true` ejecuta todo dentro de la transacción, cuenta `movidas`/`descartadas` y hace ROLLBACK (lanza un
  centinela interno y lo atrapa fuera). La UI muestra esos conteos en la confirmación antes de vincular.
- En **una transacción**: para cada `(tabla, columna)` de `REFERENCIAS_WALLET` cuya tabla exista
  (`PRAGMA table_info`), `UPDATE tabla SET columna = :wallet WHERE columna = :pending`. Si la entrada tiene
  `unicaCon` (columnas que forman UNIQUE con la wallet), antes se borran las filas del pending que chocarían
  con una del destino (gana el destino) y se cuentan en `descartadas`.
- Luego: `users(wallet)` toma el rol más alto de los dos (founder > core > contributor) y
  `is_supervisor = max`; se conserva su `display_name`. Se borra `users(pending)`; se inserta `roster_links`;
  se escribe `talent_events(action='vincular', detail = JSON con los conteos exactos de movidas y descartadas)`.
  Si algo falla, ROLLBACK.
- `REFERENCIAS_WALLET` incluye **todas** las columnas de wallet del esquema, también las de las tablas nuevas
  de §3.3 (`rite_sessions.host_wallet`, `rite_sessions.recorder_wallet`, `rite_sessions.created_by`,
  `rite_attendance.wallet` con `unicaCon ['session_id','layer']`, `avisos.wallet` con `unicaCon ['clave']`,
  `reminders_sent.wallet` con `unicaCon ['clave']`) y excluye `talent_events` (historia). Lista mínima de
  la base: `assignments.owner_wallet`, `assignments.created_by`, `assignment_events.actor_wallet`,
  `checkins.wallet` (`['day']`), `project_members.wallet` (`['initiative_id','rol_proyecto']`),
  `client_members.wallet` (`['client_id']`), `telegram_links.wallet`, `user_emails.wallet`, `notes.author`,
  `bot_drafts.wallet`, `bot_actions.wallet`, `points_ledger.wallet`, `reputation_events.wallet`,
  `users.invited_by`, `invites.issuer_wallet`, `invites.used_by`, `projects.supervisor_wallet`,
  `projects.assignee_wallet`, `applications.wallet` (`['project_id']`), `votes.wallet` (`['proposal_id']`),
  `academia_awards.wallet` (`['content_id']`), `reading_sessions.wallet`, `credential_inventory.owner_wallet`,
  `credential_access_log.wallet`, `graph_imports.imported_by`, `project_members.added_by`. Para
  `telegram_links` (una por wallet): si ambos tienen fila, se conserva la del destino.
- Un test de introspección recorre `schema.sql` y falla si una columna llamada `wallet` o terminada en
  `_wallet`, o `created_by|author|invited_by|issuer_wallet|used_by|imported_by|added_by`, no está en la
  lista (salvo `users.wallet` —la PK—, `cla_signatures.wallet` —cubierta por la precondición—,
  `talent_events.*` y `roster_links.*`).

### 5.B Reglas puras de gamificación, SLA y épocas (WP31-B)

WP31-B entrega en tres cortes, cada uno fusionado por el líder apenas está en verde (el plan los etiqueta
`wp31-b1a`, `wp31-b1b`, `wp31-b2`): **1a** genoma v2 + `zona-horaria.ts` + `identidades.ts` (+ los ajustes de
tipos en `sim.ts`, `mutation.ts` y sus tests); **1b** `sla.ts` + `sla-db.ts`; **2** `gamificacion.ts`, `epocas.ts`,
topes de `admin.ts` y `academia.ts` y el `period_id` de la ruta de voto.

#### 5.B.1 `src/lib/genome.ts`

```ts
export type SizeTable = { S: number; M: number; L: number };
export type RiteKind = "sync" | "demo" | "retro";
export type CadenciaRito =
  | { frecuencia: "semanal"; dia_semana: number; hora: string; duracion_min: number }
  | { frecuencia: "quincenal"; dia_semana: number; hora: string; duracion_min: number; ancla: string }
  | { frecuencia: "mensual"; semana_del_mes: 1 | 2 | 3 | 4; dia_semana: number; hora: string; duracion_min: number };
// dia_semana ISO: 1 = lunes … 7 = domingo. hora "HH:MM" local de BUSINESS_TZ. ancla "AAAA-MM-DD" de una ocurrencia.

export interface GenomeV1 { /* las 8 claves actuales, sin cambios */ }
export interface Genome extends GenomeV1 { /* + claves de §6 */ }
export const GENOME_V1: GenomeV1;                                  // intacto (test de regresión)
export const GENOME_V2_NUEVAS: Omit<Genome, keyof GenomeV1>;       // valores de §6
export const GENOME_DEFAULTS: Genome;                              // { ...GENOME_V1, ...GENOME_V2_NUEVAS }
export function getActiveGenome(db: DB, epoch?: number): Genome;   // { ...GENOME_DEFAULTS, ...JSON.parse(params) } o GENOME_DEFAULTS
export function seedGenomeV2(db: DB): { insertada: boolean; version: number | null };
```
`seedGenomeV2`: si alguna fila de `genome_versions` ya tiene `TASK_POINTS` en `params` → no hace nada.
Si no: `base` = params de la versión más alta (o `GENOME_V1`); `params = { ...base, ...claves de
GENOME_V2_NUEVAS que falten en base }`; `version = MAX(version)+1`; `effective_from_epoch =
max(currentEpoch+1, effective_from_epoch de la versión más alta)`; inserta `decision_log` (título
"Genoma v<n>: claves nuevas de entregas, plazos y ritos"; razón: "Se añaden claves sin cambiar ningún valor
existente. Rigen con sus valores por defecto desde su publicación y quedan versionadas desde la época <e>.";
`hash = sha256Hex(title|reason)`, misma convención que `mutation.ts`); no toca `mutation_decisions`;
`clearGenomeCache`. Se llama en `seedIfEmpty` justo después de `txTeam();`, dentro de su propio `try/catch`
(§3.5). La caché de genoma guarda el objeto **ya mezclado**.

Efectos que B absorbe en archivos que pasan a ser suyos:
- **Tipos**: `GENOME_V1` pasa a `GenomeV1`. `sim.ts` (`SimConfig.genome: GenomeV1`, `genomePreset` devuelve
  `GenomeV1`, `compareGenomes(a: GenomeV1, b: GenomeV1, …)`), `sim.test.ts` (spreads tipados `GenomeV1`),
  `mutation.ts` (`validateMutation(current: GenomeV1, …)`) y `mutation.test.ts`. Solo tipos, sin cambiar valores.
- **`pendingMutation`** ignora las versiones cuyos genes numéricos (`NUMERIC_GENES`) no cambian respecto a la
  vigente: la v2 no aparece en `/admin` como "mutación pendiente".
- **`revertToVersion`** guarda `{ ...GENOME_DEFAULTS, ...params de la versión destino }`: toda versión guardada
  queda completa y revertir a la v1 no borra las claves nuevas.
- **`migracion-fusion.test.ts`**: su huella de `decision_log` y `genome_versions` pasa a compararse como
  **prefijo** (las filas con id ≤ al máximo previo, idénticas) y comprueba exactamente 1 versión y 1 decisión
  nuevas tras `prepararSqlite` (las de `seedGenomeV2`). El resto de la huella sigue con `toEqual(antes)`.
`proposeMutation` y `NUMERIC_GENES` no cambian (las claves nuevas no son mutables desde la UI esta noche).
`genome.ts` sigue con sintaxis borrable (lo importa `sim.ts` con sufijo `.ts` desde el CLI).

#### 5.B.2 `src/lib/sla.ts` (puro) y `src/lib/sla-db.ts` (cargadores)

```ts
export type SlaPrioridad = "Urgent" | "High" | "Normal" | "Low";
export type SlaEstado = "a_tiempo" | "por_vencer" | "vencida" | "sin_plazo";
export type SlaFase = "respuesta" | "entrega" | "revision" | "bloqueo";
export const SLA_LABEL: Record<SlaEstado, string>;        // A tiempo · Por vencer · Vencida · Sin plazo
export const PRIORIDAD_CORTA: Record<SlaPrioridad, string>; // P1 · P2 · P3 · P4
// parseInstanteDb, diaLocal y horaLocal se re-exportan desde zona-horaria.ts (§5.0); sla.ts no las reimplementa.

export interface SlaConfig {
  tz: string; diasHabiles: number[]; horaInicio: number; horaFin: number;
  respuestaH: Record<SlaPrioridad, number>;          // horas hábiles
  entregaH: Record<SlaPrioridad, number | null>;     // null = sin plazo propio (Low)
  revisionH: Record<SlaPrioridad, number>;
  bloqueoEscalaH: number; bloqueoFounderH: number;
  avisoPct: number; avisoMaxH: number;
}
export function slaConfigDesdeGenoma(g: Genome): SlaConfig;
export function horasPorDiaHabil(c: SlaConfig): number;                 // horaFin - horaInicio
export function parseInstanteDb(s: string): Date;                       // 'AAAA-MM-DD HH:MM:SS' = UTC; ISO tal cual
export function diaLocal(instante: Date, tz: string): string;           // AAAA-MM-DD
export function horaLocal(instante: Date, tz: string): number;          // 0-23
export function esHorarioHabil(instante: Date, c: SlaConfig): boolean;
export function sumarHorasHabiles(desde: Date, horas: number, c: SlaConfig): Date;
export function horasHabilesEntre(desde: Date, hasta: Date, c: SlaConfig): number; // 0 si hasta <= desde
export function diasHabilesAntes(dia: string, n: number, c: SlaConfig): string;    // AAAA-MM-DD, n días hábiles antes
export function finDeDia(fechaYmd: string, c: SlaConfig): Date;                    // esa fecha a horaFin local

export interface EventoSla { action: string; from_status: string; to_status: string; created_at: string }
export interface PiezaSla {
  id: number; priority: SlaPrioridad; status: TeamStatus; due_date: string | null;
  created_at: string; blocked_at: string | null; eventos: EventoSla[]; // eventos en orden de id
}
export interface SlaResultado {
  fase: SlaFase | null; vence: Date | null; estado: SlaEstado;
  horasRestantes: number | null; respondida: boolean;
}
export function inicioReloj(p: PiezaSla): Date;              // primer evento con to_status 'Asignada'; si no, created_at
export function respondida(p: PiezaSla): boolean;            // algún evento posterior al inicio con to_status ∈ {En curso, En revisión, Bloqueada, Hecha}
export function venceRespuesta(p: PiezaSla, c: SlaConfig): Date;                // inicio + respuestaH
export function venceEntrega(p: PiezaSla, c: SlaConfig): Date | null;          // due_date → finDeDia; si no, inicio + entregaH (null si Low)
export function venceRevision(p: PiezaSla, c: SlaConfig): Date | null;         // último enviar_a_revision + revisionH
export function momentoEntrega(p: PiezaSla): Date | null;                      // último evento enviar_a_revision
export function momentoAprobacion(p: PiezaSla): Date | null;                   // último evento aprobar
/** Bono de puntualidad (literal del líder): se aprobó a tiempo. `aprobadaEn` por defecto = momentoAprobacion.
 *  aprobadaEn <= venceEntrega → true; sin plazo (venceEntrega null) o sin aprobación → false. */
export function aprobadaATiempo(p: PiezaSla, c: SlaConfig, aprobadaEn?: Date): boolean;
export function evaluarSla(p: PiezaSla, c: SlaConfig, ahora: Date): SlaResultado;
export function formatoVence(vence: Date, ahora: Date, c: SlaConfig): string;  // "hoy 14:00", "mañana 09:00", "jue 16:00", "3 oct 18:00"

// sla-db.ts
export function slaConfig(db: DB, epoch?: number): SlaConfig;                   // slaConfigDesdeGenoma(getActiveGenome(db, epoch))
export function cargarPiezaSla(db: DB, assignmentId: number): PiezaSla | undefined;
export function cargarPiezasAbiertas(db: DB): PiezaSla[];                       // status ∉ {Hecha}
export function slaDeAsignaciones(db: DB, ids: number[], ahora?: Date, c?: SlaConfig): Map<number, SlaResultado>;
```
Mapeo genoma → `SlaConfig` (h = `horasPorDiaHabil`):

| | respuestaH | entregaH | revisionH |
|---|---|---|---|
| Urgent (P1) | `SLA_P1_RESPONSE_H` | `SLA_P1_RESTORE_H` | `SLA_P1_REVIEW_H` |
| High (P2) | `SLA_P2_RESPONSE_H` | `SLA_P2_RESOLVE_D × h` | `SLA_REVIEW_D × h` |
| Normal (P3) | `SLA_P3_RESPONSE_D × h` | `SLA_P3_RESOLVE_D × h` | `SLA_REVIEW_D × h` |
| Low (P4) | `SLA_P4_TRIAGE_D × h` | `null` | `SLA_REVIEW_D × h` |

`bloqueoEscalaH = SLA_BLOCK_ESCALATE_D × h`, `bloqueoFounderH = SLA_BLOCK_FOUNDER_D × h`,
`avisoPct = SLA_WARN_PCT`, `avisoMaxH = SLA_WARN_MAX_H`.

`evaluarSla` por estado:

| Estado de la pieza | Fase | `vence` |
|---|---|---|
| `Backlog` Urgent | respuesta | `venceRespuesta` (desde `created_at`) |
| `Backlog` resto | – | `null` → `sin_plazo` |
| `Asignada` sin respuesta | la más próxima entre respuesta y entrega | min(`venceRespuesta`, `venceEntrega`) |
| `Asignada` respondida / `En curso` | entrega | `venceEntrega` (Low sin `due_date` → `sin_plazo`) |
| `En revisión` | revision | `venceRevision` |
| `Bloqueada` | bloqueo | `blocked_at + bloqueoEscalaH` |
| `Hecha` | – | `null` → `sin_plazo` |

Estado: `ahora > vence` → `vencida`; si no, `restante = horasHabilesEntre(ahora, vence)` y `ventana =
horasHabilesEntre(inicio de la fase, vence)`; `restante <= min(ventana × avisoPct/100, avisoMaxH)` →
`por_vencer`; si no `a_tiempo`. Inicio de fase: respuesta/entrega = `inicioReloj`; revisión = último
`enviar_a_revision`; bloqueo = `blocked_at`.

Algoritmo de horas hábiles: por días locales de `tz` con las funciones de `zona-horaria.ts` (§5.0; sin
constantes de zona). Sin festivos.

#### 5.B.3 `src/lib/gamificacion.ts`

```ts
export interface PremioTarea { tamano: Size; base: number; bono: number; puntos: number; reputacion: number }
export function calcularPremioTarea(
  input: { size: Size | null; aTiempo: boolean },
  g: Pick<Genome, "TASK_POINTS" | "TASK_REP" | "ON_TIME_BONUS_PCT">
): PremioTarea; // tamano = size ?? 'S'; bono = aTiempo ? round(base × pct / 100) : 0; puntos = base + bono; reputacion = TASK_REP[tamano]
export function refTarea(assignmentId: number): string;                       // `assignment:${id}`
export function presupuestoEjecucionRestante(db: DB, periodId: number, g?: Genome): number; // EPOCH_BUDGET − SUM(points) WHERE period_id=? AND bucket='ejecucion' (≥ 0)

export interface EmisionTarea {
  emitido: boolean;
  motivo?: "ya_emitido" | "autoaprobacion" | "invitacion" | "sin_responsable" | "publicada_en_agora" | "presupuesto_agotado";
  puntos: number; reputacion: number; bono: number; periodo: number;
}
/** Abre su propia transacción (anidable: se une a la del llamador). Nunca lanza por reglas de negocio; un error
 *  de base sí se propaga (y revierte la aprobación entera: el gancho no lleva try/catch). */
export function emitirPorAprobacion(db: DB, input: {
  assignmentId: number; ownerWallet: string | null; aprobadorWallet: string;
  size: Size | null; aTiempo: boolean;
}): EmisionTarea;

export interface SenalesProgreso {
  entregasAprobadas: number; entregasATiempo: number; entregasL: number;
  revisionesHechas: number; ritosAsistidos: number; ritosAnfitrion: number;
}
export interface Insignia { id: string; nombre: string; descripcion: string; obtenida: boolean; actual: number; meta: number }
export const INSIGNIAS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; senal: keyof SenalesProgreso }>;
export function insignias(s: SenalesProgreso, metas: Genome["BADGE_GOALS"]): Insignia[];     // puro; metas del genoma
export function senalesProgreso(db: DB, wallet: string): SenalesProgreso;                    // suma identidadesDe(wallet)
export function progresoDeTareas(db: DB, wallet: string, epoch: number):
  { puntos: number; reputacion: number; entregas: number };                                  // refs 'assignment:%' de la época, todas las identidades
```
`emitirPorAprobacion`, en orden: sin dueño → `sin_responsable`; `mismaPersona(aprobador, dueño)` →
`autoaprobacion`; B8 en las dos direcciones con el founder exento (misma regla que `puedeTransicionar`) →
`invitacion` (las dos son defensa en profundidad; la regla real está en `puedeTransicionar`); la asignación
tiene `published_as_project_id` → `publicada_en_agora` (se paga por sus hitos del Ágora, que ya emiten puntos y
reputación: así la misma pieza no cobra dos veces); `ref` ya presente en `points_ledger` **o** en
`reputation_events` → `ya_emitido`. Si no: periodo = `currentEpoch`; puntos = `min(premio.puntos, restante)`;
inserta `points_ledger` solo si puntos > 0; inserta siempre `reputation_events(ejecucion, reputacion)`; las dos
con `period_id` explícito. Si `puntos < premio.puntos` → `motivo: 'presupuesto_agotado'`.

`senalesProgreso` (sobre todas las identidades de la wallet): `entregasAprobadas` = asignaciones del dueño con
evento `aprobar` de otra persona; `entregasATiempo` = de esas, `aprobadaATiempo` true; `entregasL` = de esas,
`size='L'`; `revisionesHechas` = eventos `aprobar` hechos por la persona sobre piezas ajenas; `ritosAsistidos` =
filas de `rite_attendance` capa 1; `ritosAnfitrion` = `rite_sessions` cerradas donde es anfitrión o relator.

Catálogo `INSIGNIAS` (reconocimiento, no moneda; sin rachas). La **meta** sale de `BADGE_GOALS` del genoma
(valores por defecto en la tabla); nombre y descripción son copy y viven en código:

| id | Nombre | Señal | Meta | Descripción |
|---|---|---|---|---|
| `primera-entrega` | Primera entrega | entregasAprobadas | 1 | Tu primera entrega aprobada por otra persona. |
| `diez-entregas` | Diez entregas | entregasAprobadas | 10 | Diez entregas aprobadas. |
| `a-tiempo` | A tiempo | entregasATiempo | 5 | Cinco entregas aprobadas dentro de su plazo. |
| `pieza-grande` | Pieza grande | entregasL | 1 | Una entrega de tamaño L aprobada. |
| `ojo-de-revisor` | Ojo de revisor | revisionesHechas | 5 | Cinco entregas de otras personas revisadas y aprobadas por ti. |
| `presente` | Presente | ritosAsistidos | 3 | Tres ritos con asistencia registrada. |
| `anfitrion` | Anfitrión | ritosAnfitrion | 1 | Un rito sostenido como anfitrión o relator. |

**Integración (WP31-I1)** en `applyAssignmentAction`, dentro de la transacción y después del INSERT del evento,
**sin `try/catch`** (imports con sufijo `.ts`, §5):
```ts
if (next.status === "Hecha" && row.status !== "Hecha") {
  const pieza = cargarPiezaSla(db, row.id);
  const aTiempo = pieza ? aprobadaATiempo(pieza, slaConfig(db), now) : false; // now = instante de esta aprobación
  emitirPorAprobacion(db, { assignmentId: row.id, ownerWallet: owner, aprobadorWallet: input.actor.wallet,
                            size: row.size, aTiempo });
}
```
Transacciones anidadas: `node:sqlite` (producción hoy) y `mssql` se unen a la transacción externa sin
savepoint; `better-sqlite3` usa savepoints. Con el gancho sin `try/catch`, los dos se comportan igual: un error
revierte todo.

**Correcciones de tope** (WP31-B): `approveMilestone` compara contra
`SUM(points) WHERE period_id = currentEpoch AND bucket = 'ejecucion'`; `academia.ts` contra
`SUM(points) WHERE period_id = currentEpoch AND bucket = 'academia'`.

**Ruta de voto** (WP31-B, corte 2): `app/api/governance/vote/route.ts` inserta su `reputation_events` con
`period_id = currentEpoch(db)` explícito (hoy lo omite y cae en la época 1 por el `DEFAULT 1`).

#### 5.B.4 Insignias y progreso: reglas de copy

Sin posiciones, sin comparación con otras personas, sin "racha". Una insignia no obtenida se muestra como
"4 de 10", nunca como "perdida". Junto al bloque va "Lo ganado no se quita." Si la emisión salió recortada por
el tope (`presupuesto_agotado`), la respuesta de la aprobación lo explica con el copy de §8.5.

#### 5.B.5 `src/lib/epocas.ts`

```ts
export interface EstadoCierreEpoca {
  periodo: { id: number; name: string; state: string; created_at: string } | null;
  fitnessFirmado: boolean; mutacionDecidida: boolean; puedeCerrar: boolean; faltantes: string[];
  puedeAbrir: boolean; // true si no hay ninguna época Open (la última está Closed/Anchored o no hay filas)
}
export function estadoCierreEpoca(db: DB): EstadoCierreEpoca;
export function hojasDeEpoca(db: DB, periodId: number): string[]; // JSON canónico por fila de points_ledger y reputation_events del periodo, orden (tabla, id)
export interface ResultadoCierre { cerrada: number; abierta: number; merkleRoot: string; anchorQueueId: number; decisionLogId: number }
export function cerrarYAbrirEpoca(db: DB, actor: TeamActor,
  input: { justificacion: string; nombreSiguiente?: string }): ResultadoCierre;
/** Solo founder y solo si `puedeAbrir`: inserta la época siguiente con los presupuestos de su genoma y una entrada en decision_log. */
export function abrirEpoca(db: DB, actor: TeamActor, input: { justificacion: string; nombre?: string }): { abierta: number; decisionLogId: number };
```
Como todo INSERT de ledgers usa `period_id = currentEpoch` (la época más reciente) y `vincularPrincipal` no toca
historia sellada, después de cerrar la época N **ninguna fila nueva cae en N**: la raíz anclada sigue siendo
reproducible (criterio B10b).
Precondiciones (si falta alguna, `Error` con el texto de `faltantes`): actor founder
(`rolPuedeAdministrar`); periodo actual `Open`; `epoch_fitness` de la época con `signed=1`;
`mutationDecidedFor(db, epoch+1)`; justificación ≥ 10. En **una transacción**: `merkleRoot(hojasDeEpoca)`;
`UPDATE periods SET state='Closed', merkle_root=?`; `anchor_queue(kind='merkle_root', ref=String(id),
data_key='epoch:<id>', payload_hash=root)`; `decision_log` ("Cierre de la época N y apertura de la N+1", con
root y justificación); `INSERT periods (name = nombreSiguiente ?? 'Época N+1', epoch_budget, academia_budget)`
con `getActiveGenome(db, N+1)`. Nunca toca ledgers.

### 5.C Recordatorios (WP31-C1) y Telegram (WP31-C2)

#### 5.C.1 `src/lib/recordatorios.ts` (puro)

```ts
export type TipoRecordatorio =
  | "p1_asignada" | "p1_sin_respuesta" | "vence_pronto" | "vence_hoy" | "vencida"
  | "revision_pendiente" | "bloqueo" | "escala_supervisor" | "escala_founder";
export type Destino =
  | { tipo: "persona"; wallet: string }
  | { tipo: "supervision"; initiativeId: number | null; incluyeRevisa: boolean } // incluyeRevisa solo en revision_pendiente
  | { tipo: "founder" };
export interface PiezaRecordable extends PiezaSla {
  title: string; owner_wallet: string | null;
  initiative_id: number | null; initiative_slug: string | null; initiative_name: string | null;
  blocked_reason: string | null;
}
export interface ConfigRecordatorios extends SlaConfig {
  digestHora: number; p1SinRespuestaH: number;
  antesDias: { High: number; Normal: number };
  escalaSupervisorD: { High: number; Normal: number };
  escalaFounderD: { High: number; Normal: number };
  p1FounderFactor: number;
  maxInmediatos: number;           // REMINDER_MAX_INMEDIATOS: tope por persona y corrida
  activadoDesde: Date | null;      // guarda de arranque; la calcula recordatorios-db (§5.C.2)
}
export interface Recordatorio {
  tipo: TipoRecordatorio; assignmentId: number; destino: Destino;
  clave: string; inmediato: boolean; texto: string; enlace: string; // enlace = ruta relativa
}
export function configRecordatoriosDesdeGenoma(g: Genome): ConfigRecordatorios;
export function planificarRecordatorios(piezas: PiezaRecordable[], cfg: ConfigRecordatorios, ahora: Date): Recordatorio[];
export function renderDigest(items: Recordatorio[], appUrl: string): string;
export function renderInmediato(r: Recordatorio, appUrl: string): string;
export const VOCABULARIO_PROHIBIDO: readonly RegExp[];
```
Reglas (`hoy` = `diaLocal(ahora)`; "días" son hábiles; Low no genera nada). **Inmediato solo si la pieza es
Urgent (P1)**: todo lo de High y Normal, escalamientos incluidos, va al resumen del día.

| Tipo | Cuándo | Destino | Inmediato | Clave |
|---|---|---|---|---|
| `p1_asignada` | Urgent `Asignada`, sin respuesta | dueño | sí | `p1_asignada:<id>` |
| `p1_sin_respuesta` | Urgent sin respuesta y `horasHabilesEntre(inicio, ahora) ≥ p1SinRespuestaH` | dueño | sí | `p1_sin_respuesta:<id>` |
| `vence_pronto` | High/Normal en `Asignada`/`En curso`; `hoy == diasHabilesAntes(diaLocal(venceEntrega), antesDias[p])` | dueño | no | `vence_pronto:<id>:<díaVence>` |
| `vence_hoy` | Urgent/High/Normal en `Asignada`/`En curso`; `diaLocal(venceEntrega) == hoy` | dueño | Urgent sí | `vence_hoy:<id>:<díaVence>` |
| `vencida` | en `Asignada`/`En curso` y `ahora > venceEntrega` | dueño | Urgent sí | `vencida:<id>:<díaVence>` |
| `revision_pendiente` | `En revisión` y `ahora > venceRevision` | supervision con `incluyeRevisa` | Urgent sí | `revision:<id>:<díaEnvío>` |
| `bloqueo` | `Bloqueada` y horas bloqueada ≥ `bloqueoEscalaH` | supervision | Urgent sí | `bloqueo:<id>:<blocked_at>` |
| `escala_supervisor` | Urgent: `ahora > venceEntrega`; High/Normal: `ahora ≥ venceEntrega + escalaSupervisorD[p]` | supervision | Urgent sí | `escala_supervisor:<id>:<díaVence>` |
| `escala_founder` | Urgent: `ahora ≥ inicio + entregaH × p1FounderFactor`; High/Normal: `ahora ≥ venceEntrega + escalaFounderD[p]`; Bloqueada: horas ≥ `bloqueoFounderH` | founder | Urgent sí | `escala_founder:<id>:<díaVence o blocked_at>` |

**Guarda de arranque** (`activadoDesde`): si el vencimiento que dispara el tipo (`venceEntrega`, `venceRevision`
o `blocked_at + bloqueoEscalaH`) es anterior a `activadoDesde`, la pieza no genera `escala_supervisor`,
`escala_founder`, `bloqueo` ni `revision_pendiente`, y su `vencida` sale como **no inmediata** (resumen del dueño).
Así el backlog real importado con fechas viejas no inunda a nadie en la primera corrida. `activadoDesde = null`
(sin filas previas) equivale a `ahora`.

Textos (siempre sobre la entrega, con su título entre « »; el responsable se ve en el enlace, nunca en el texto):
- `vence_pronto`: «{título}» ({P}) vence {formatoVence}.
- `vence_hoy`: «{título}» ({P}) vence hoy a las {HH:MM}.
- `vencida`: «{título}» ({P}) pasó su fecha de entrega ({formatoVence}). Puedes pedir nueva fecha o bloquearla con motivo.
- `p1_asignada`: «{título}» (P1) es urgente y te espera. Primera respuesta antes de {HH:MM}.
- `p1_sin_respuesta`: «{título}» (P1) aún no tiene primera respuesta. Plazo: {formatoVence}.
- `revision_pendiente`: «{título}» espera revisión desde {formatoVence(envío)}.
- `bloqueo`: «{título}» lleva {n} días hábiles bloqueada: «{motivo}».
- `escala_supervisor`: «{título}» ({P} · {proyecto}) pasó su plazo. ¿Ayudas a destrabarla o a acordar nueva fecha?
- `escala_founder`: «{título}» ({P} · {proyecto}) lleva {el doble de su plazo | n días} sin entrega. Está en tu bandeja.
- Inmediatos agrupados (más de uno para la misma persona en la corrida): "Lo urgente de ahora:\n· …\n· …\nVer en Zelena: {appUrl}/equipo/avisos".
- Digest: "Esto es lo de hoy en tus entregas:\n· …\n· …\nVer en Zelena: {appUrl}/equipo/hoy".
- Mensajes de Telegram **sin `parse_mode`**: los títulos los escribe la gente y no se interpretan como Markdown ni HTML.

`VOCABULARIO_PROHIBIDO` incluye al menos: `/atrasad/i, /vas tarde|llegó tarde/i, /bajo desempeño/i,
/\brojo\b/i, /ranking/i, /última conexión/i, /horas trabajadas/i, /perdiste/i, /castigo/i, /jornada/i`.

#### 5.C.2 `src/lib/recordatorios-db.ts` y `src/lib/avisos.ts`

```ts
export interface ResultadoCorrida {
  enabled: boolean; omitido?: "flag_apagada" | "fuera_de_horario" | "en_curso";
  simulado: boolean;
  evaluadas: number; avisosCreados: number; inmediatosEnviados: number; digestEnviados: number; errores: number;
  porTipo: Partial<Record<TipoRecordatorio, number>>; destinatarios: number; // conteos, nunca wallets ni nombres
}
export async function correrRecordatorios(db: DB, opts?: {
  ahora?: Date; transport?: TelegramTransport | null; appUrl?: string; enabled?: boolean;
  cfg?: ConfigRecordatorios; simular?: boolean;
}): Promise<ResultadoCorrida>;
export function cargarPiezasRecordables(db: DB): PiezaRecordable[];
export function activadoDesde(db: DB): Date | null; // MIN(created_at) de reminders_sent; null si no hay filas
export function resolverDestinatarios(db: DB, d: Destino, dueno: string | null): string[];
export function autorizarCron(header: string | null, esperado: string | null): "ok" | "sin_configurar" | "rechazado"; // constantTimeEquals

// avisos.ts
export interface AvisoRow { id: number; wallet: string; clave: string; tipo: string; assignment_id: number | null; texto: string; is_leido: number; created_at: string }
export function crearAviso(db: DB, a: { wallet: string; clave: string; tipo: string; assignmentId: number | null; texto: string }): boolean; // false si ya existía
export function avisosDe(db: DB, wallet: string, opts?: { soloNoLeidos?: boolean; limite?: number }): AvisoRow[];
export function contarNoLeidos(db: DB, wallet: string): number;
export function marcarLeidos(db: DB, wallet: string, ids?: number[]): number; // solo los propios
```
`resolverDestinatarios` (destinatario válido = activo, no demo y no un `pending:` sin vincular, salvo
`principalFounder`; deduplicado por `identidadesDe`; **nunca el dueño** ni sus identidades en escalamientos):
- `persona`: el dueño, si es válido.
- `supervision`: miembros con rol `estructura` del proyecto (más los de rol `revisa` si `incluyeRevisa`), menos el
  dueño. Si queda vacío → supervisores globales (`is_supervisor=1`) válidos, menos el dueño. Si sigue vacío → founder.
- `founder`: `principalFounder(db)` si existe; si no, filas `role='founder'` válidas (nunca la demo).

`correrRecordatorios`:
0. **Candado en proceso** (`globalThis.__zelenaRecordatorios`; producción es una sola instancia): si hay una
   corrida viva, responde `{ omitido: 'en_curso' }` sin hacer nada.
1. `enabled` (por defecto `isSlaRemindersEnabled()`) falso → `{enabled:false, omitido:'flag_apagada'}` sin escribir nada
   (salvo `simular`, que corre igual: no escribe).
2. `!esHorarioHabil(ahora)` → `omitido:'fuera_de_horario'`, sin escribir nada (salvo `simular`).
3. `cfg.activadoDesde = activadoDesde(db) ?? ahora`; `planificarRecordatorios(cargarPiezasRecordables(db), cfg, ahora)`.
   Los **no inmediatos** solo se procesan si `horaLocal(ahora) ≥ digestHora`. Por persona, los inmediatos que
   pasen de `maxInmediatos` se degradan a no inmediatos (van al resumen).
4. `simular` → devuelve los conteos (`porTipo`, `destinatarios`) **sin escribir ni enviar**, como si fuera la
   primera corrida hábil después de `digestHora` (ignora la flag, el horario y la hora del resumen). Se usa antes
   de encender la flag en producción (`POST …?simular=1`), aunque el despliegue sea de madrugada.
5. Por cada recordatorio y cada destinatario: si `(clave, wallet)` ya está en `reminders_sent` → se salta. Si no,
   en una transacción **síncrona** (nunca `await` dentro de `db.transaction`): `crearAviso` + INSERT de
   `reminders_sent(clave, wallet, dia, is_inmediato, is_telegram=0)`. Un choque con el UNIQUE cuenta como "ya
   procesado", no como error.
6. Telegram (si hay `transport` y la persona tiene `telegram_links.telegram_user_id`), fuera de toda transacción:
   - **Inmediatos**: sus filas con `is_inmediato=1`, `is_telegram=0`, `dia = hoy` y clave presente en el plan de
     esta corrida → **un** mensaje con todas (texto agrupado de §5.C.1). Al confirmarse, `is_telegram=1`.
   - **Resumen**: si `horaLocal ≥ digestHora` y no existe `('digest:<hoy>', wallet)` con `is_telegram=1`: sus filas
     `is_inmediato=0`, `is_telegram=0`, `dia ≥` el día hábil anterior y clave presente en el plan → **un** mensaje.
     Al confirmarse: INSERT (o UPDATE) de `digest:<hoy>` con `is_telegram=1` y `is_telegram=1` en esas filas.
   - Un fallo de envío no aborta la corrida (`errores++`): las filas siguen en `is_telegram=0` y se reintentan en
     la corrida siguiente (el aviso in-app ya quedó). Un inmediato de un día anterior ya no sale por Telegram; un no
     inmediato del día hábil anterior que siga en el plan entra en el resumen de hoy.
   - `chat_id = Number(telegram_user_id)` (en chats 1:1, chat.id = from.id).
7. `transport` por defecto: `createTelegramTransport(token)` si hay `TELEGRAM_BOT_TOKEN`; si no, `null`.
   Nunca exige `ANTHROPIC_API_KEY` ni `TELEGRAM_ENABLED`.

`/equipo/avisos` y `contarNoLeidos` leen los avisos de **todas** las identidades de la persona
(`identidadesDe`): así el founder ve también los de su fila de equipo antes de vincularla.

Ruta `POST /api/cron/recordatorios`: solo POST; `export const dynamic = "force-dynamic"`;
`export const maxDuration = 60`; `cronSecret()` devuelve `null` si `CRON_SECRET` falta o tiene menos de 32
caracteres (→ 503 `sin_configurar`); nunca registra la cabecera; responde solo `ResultadoCorrida` (conteos).
`?simular=1` pasa `simular: true`.

#### 5.C.3 Telegram para todo el equipo (WP31-C2)

```ts
// bot-store.ts
export function founderTeamWallet(db: DB, sessionWallet: string): string; // misma firma; = principalFounder(db) ?? sessionWallet
export function walletParaVinculo(db: DB, sessionWallet: string): string;  // founder → founderTeamWallet; resto → sessionWallet
// bot-agent.ts
export interface BotDeps { db: DB; transport: TelegramTransport; claude: ClaudeClient | null; transcriber?: Transcriber | null; now?: Date }
// telegram.ts
BOT_COPY.soloComandos = "Por ahora atiendo comandos: /pendientes, /focos, /nota y /ayuda. Para capturar tareas, usa la app.";
BOT_COPY.soloComandosLectura = "Por aquí te atiendo con /pendientes, /focos y /ayuda. Lo demás está en la app.";
```
- `/api/telegram/vincular`: cualquier `equipoActor` emite **su** código; `is_authorized` (escritura) sigue
  siendo solo del founder (`canAuthorizeWrite` no cambia).
- Webhook: exige flag `TELEGRAM_ENABLED`, secret y `TELEGRAM_BOT_TOKEN`; `ANTHROPIC_API_KEY` opcional
  (sin ella `claude = null`: comandos y `/start` funcionan; texto libre responde `soloComandos`). C2 es dueño del
  bloque `telegramMissingVars`/`telegramStatus` de `config.ts` (la clave de Anthropic deja de ser obligatoria
  para el webhook y pasa a "opcional" en `BotLinkPanel`).
- **Lo que ve por Telegram quien no ve todo el equipo** (`!puedeVerTodoElEquipo(ctx.actor)`: core sin
  supervisión y contributors). Hoy `consultar_estado` no filtra por actor en `bloqueos`, `esperando_a_mi`,
  `iniciativas`, `carga`, `epoca`, `ritos` ni `digest`; al abrir la vinculación, un externo vería el tablero
  interno, la carga por persona y los check-ins de los demás. Por eso:
  1. Su **texto libre nunca llega al modelo**, haya o no `ANTHROPIC_API_KEY`: responde `soloComandosLectura`.
  2. `renderEstado` solo acepta `mis_pendientes` y `equipo` (este último ya usa `visibleAssignments`); cualquier
     otro alcance responde `renderPendientes` (solo lo propio).
  3. `/focos` (`focosDelDia`) usa solo su trabajo abierto (sin `founderInbox`); `hintsFor` solo nombra
     `proyectosVisibles`.
  4. Quien no tiene escritura recibe `soloComandosLectura` (sin `/nota`, que sería rechazada).
  Si C2 no llega con esto en verde a la hora de corte, **la vinculación sigue siendo solo del founder** esta noche
  (no se fusiona esa parte).
- `resolveOwnerAndInitiative` (bot-tools) resuelve el roster con `walletDeRoster` (talento.ts).
- Nombres de cliente en comentarios y tests del bot (`bot-agent.ts`, `bot-agent.test.ts`, `bot-store.test.ts`)
  pasan a "un cliente" / "Cliente Demo".

#### 5.C.4 Puente al Ágora (WP31-C2) — `src/lib/agora-publicar.ts`

```ts
export interface HitoPublicar { nombre: string; semana: string; pct: number }
export function hitosPorDefecto(db: DB): HitoPublicar[]; // getActiveGenome(db).AGORA_HITOS_DEFAULT (§6)
export const publicarSchema: z.ZodType<{
  assignmentId: number; tipo: "cliente" | "comunidad"; presupuestoUsd: number; semanas: number;
  campana: string; titulo: string; resumen: string; descripcionPublica: string; criterioPublico: string;
  hitos: HitoPublicar[];
}>; // presupuesto 1..1_000_000 entero; semanas 1..52; campana 2..60 (por defecto "Zelena"); titulo 4..120;
    // resumen 10..400; descripcionPublica 10..2000; criterioPublico 10..2000; hitos 4..10, pct entero 1..25
export function validarHitos(hitos: HitoPublicar[]): { ok: true } | { ok: false; error: string }; // suma 100
export function montosDeHitos(presupuesto: number, pcts: number[]): number[];                    // suma exacta; el último absorbe el redondeo
export function publicarEnAgora(db: DB, actor: TeamActor, input: z.infer<typeof publicarSchema>): { projectId: number };
```
Reglas: founder o supervisor; la asignación existe, **está en `Backlog` sin responsable** (si no → 409 "Solo se
publica trabajo que aún no tiene responsable.") y no tiene `published_as_project_id` (si lo tiene → 409).
**Nada interno se copia sin confirmación**: el formulario prellena `titulo`, `descripcionPublica` y
`criterioPublico` desde la tarea, y `campana` con "Zelena" (nunca con el nombre de la iniciativa, que puede ser
de un cliente); todo es editable y hay una vista previa "Así se verá" antes de confirmar. `notes`, la
descripción interna y el nombre de la iniciativa nunca se escriben en `projects` salvo que se hayan dejado
tal cual en el formulario. En una transacción: `projects(campaign = campana, title = titulo, type = 'SAS' si
cliente / 'DAO' si comunidad (mapa de `agora-labels.ts`), budget_usd, weeks, state 'Open', supervisor_wallet =
actor, summary = resumen, description = descripcionPublica, acceptance = criterioPublico)`, `milestones (ord,
code 'H<ord>', name, week, pct, amount_usd)`, `UPDATE assignments SET published_as_project_id`, evento `publicar`
(from = to = estado, `created_at = instanteDb(now)`). Desde ese momento la pieza se paga por sus hitos
(`emitirPorAprobacion` devuelve `publicada_en_agora`). Nunca toca dinero real: es testnet.

### 5.D Ritos (WP31-D)

```ts
// ritos-labels.ts (puro, apto para cliente: sin crypto ni db)
export type AudienciaRito = "equipo" | "comunidad";
export const RITE_LABEL: Record<RiteKind, { nombre: string; descripcion: string; audiencia: AudienciaRito }>; // sync → equipo; demo y retro → comunidad
export interface OcurrenciaRito { kind: RiteKind; inicio: Date; duracionMin: number }
export function proximasOcurrencias(cad: Genome["RITES_CADENCE"], desde: Date, tz: string, n: number, audiencia?: AudienciaRito): OcurrenciaRito[]; // orden por inicio
export function esOcurrenciaValida(cad: Genome["RITES_CADENCE"], kind: RiteKind, inicio: Date, tz: string, ahora: Date): boolean; // coincide con la cadencia y está en [ahora−24 h, ahora+60 d]
export function ventanaRito(inicio: Date, duracionMin: number, margenMin: number): { abre: Date; cierra: Date }; // [inicio − margen, inicio + duración + margen]

// ritos-codigo.ts (solo servidor: HMAC)
export function ritesSecret(env?: NodeJS.ProcessEnv): string; // RITES_SECRET (≥16) o hmacHex(SESSION_SECRET ≥32, 'zelena-ritos-v1'); en producción sin ninguno de los dos, LANZA (como jwt.ts); fuera de producción cae al de desarrollo
export function bucketDe(ahoraMs: number, rotacionS: number): number;
export function codigoRito(secret: string, sessionId: number, bucket: number): string; // 6 dígitos: parseInt(hmacHex(secret, `${sessionId}:${bucket}`).slice(0,8),16) % 1e6, con ceros
export function verificarCodigo(secret: string, sessionId: number, codigo: string, ahoraMs: number, rotacionS: number): boolean; // bucket actual o anterior, comparación en tiempo constante
export function hashCierre(i: { kind: RiteKind; scheduledFor: string; asistentes: string[]; host: string | null; recorder: string | null; summary: string | null }): string; // sha256 de JSON canónico, asistentes ordenados

// ritos.ts (DB, solo servidor)
export interface RiteSessionRow { id: number; kind: RiteKind; scheduled_for: string; duration_min: number; state: "Planned" | "Open" | "Closed"; host_wallet: string | null; recorder_wallet: string | null; lugar: string | null; join_url: string | null; summary: string | null; notes_url: string | null; opened_at: string | null; closed_at: string | null; hash: string | null; decision_log_id: number | null; created_by: string | null; created_at: string }
export class RitoError extends Error { status: number }
export function prepararRito(db: DB, actor: TeamActor, input: { kind: RiteKind; scheduledFor: string; lugar?: string | null; joinUrl?: string | null }): RiteSessionRow;
export function asignarRolesRito(db: DB, actor: TeamActor, input: { sessionId: number; hostWallet?: string | null; recorderWallet?: string | null }): RiteSessionRow;
export function abrirRito(db: DB, actor: TeamActor, sessionId: number, ahora?: Date): RiteSessionRow;
export function cerrarRito(db: DB, actor: TeamActor, input: { sessionId: number; summary?: string; notesUrl?: string }, ahora?: Date): RiteSessionRow;
export function codigoActual(db: DB, actor: TeamActor, sessionId: number, ahora?: Date): { codigo: string; expiraEnS: number; asistentes: number };
export function registrarAsistencia(db: DB, wallet: string, input: { sessionId: number; codigo: string }, ahora?: Date):
  { registrada: boolean; yaEstaba: boolean; reputacion: number };
export function ritosPublicos(db: DB, ahora?: Date, n?: number): {
  proximos: Array<OcurrenciaRito & { sessionId: number | null; state: string | null; lugar: string | null }>; // solo audiencia comunidad
  pasados: Array<{ id: number; kind: RiteKind; scheduledFor: string; asistentes: number; summary: string | null; txId: string | null }>;
}; // SIN wallets, nombres ni join_url
export function detalleRito(db: DB, sessionId: number, conSesion: boolean): (RiteSessionRow & { asistentes: number }) | undefined; // join_url = null si !conSesion; sin wallets de asistentes
export function asistenciaPropia(db: DB, wallet: string, epoch?: number): { total: number; estaEpoca: number }; // todas sus identidades
export function sesionesGestionables(db: DB): Array<RiteSessionRow & { asistentes: number }>; // Planned + Open + últimas 5 Closed; solo conteo
export function decisionesPublicas(db: DB, n?: number): Array<{ id: number; date: string; title: string; reason: string; hash: string }>; // ORDER BY id DESC, sin actas "Rito …" ni la reemplazada por S2; n = 3
```
Permisos: `prepararRito`, `asignarRolesRito` → founder o supervisor (`puedeVerTodoElEquipo`); `abrirRito`,
`cerrarRito`, `codigoActual` → además el anfitrión de esa sesión.
- `prepararRito`: normaliza `scheduledFor = new Date(x).toISOString()` antes de insertar (el UNIQUE compara texto)
  y exige `esOcurrenciaValida`; `lugar` ≤ 120; `joinUrl` https opcional.
- `abrirRito`: solo desde `Planned` y solo dentro de `ventanaRito(inicio, duración, RITE_WINDOW_MIN)` (si no →
  409 "Este rito todavía no se puede abrir: se abre media hora antes de empezar.").
- `registrarAsistencia`: solo con la sesión `Open` **y** dentro de su ventana; la wallet debe estar activa, con
  `cla_signed=1`, no demo y no `pending:`; si el rito es de audiencia `equipo`, además `equipoActor` no nulo. Una
  vez por persona (si cualquiera de sus `identidadesDe` ya está, `yaEstaba`), `+RITE_ATTEND_REP` una vez por `ref`,
  con `period_id` explícito. Límites: 10 intentos/min por wallet y 20 fallos por (sesión, wallet); pasado eso, la
  ruta responde 429 con "Demasiados intentos con este rito. Pide ayuda a quien presenta."
- `/api/ritos/codigo` responde con `Cache-Control: no-store`.
- **Quién ve la lista**: el anfitrión y `/admin` ven solo el **conteo** de asistentes; la lista nominal existe solo
  dentro del hash de cierre; cada persona ve la suya (`asistenciaPropia`).
- `cerrarRito`: solo desde `Open`; hash → `rite_sessions.hash`; `anchor_queue(kind='rite', ref=String(id),
  data_key='rite:<id>', payload_hash=hash)`; `decision_log` ("Rito <nombre> del <fecha> cerrado · N
  asistentes"); reputación de anfitrión y relator una vez por `ref`, con `period_id` explícito. No hay cierre
  automático: pasada la ventana ya no se registra asistencia y `/admin` lo muestra como "pendiente de cerrar".
  `txId` de `ritosPublicos` = `tx_id` de la fila de `anchor_queue` con `kind='rite' AND ref=id` (no se modifica
  `anchor.ts`), y solo si cumple `txVerificable`.
- `decisionesPublicas` reconoce la decisión reemplazada con `esDecisionReemplazada` de `agora-labels.ts` (E1).
`epochs.ts#gatherEpochData`: `checkins = COUNT(rite_attendance capa 1 de sesiones cerradas en la época)`,
`expectedCheckins = usuarios activos no demo × sesiones cerradas en la época` (solo si hay ≥1 cerrada; como la
asistencia de cuentas demo se rechaza, la participación no pasa del 100 %).

### 5.E Sitio público (WP31-E1 / WP31-E2)

```ts
// src/lib/menu.ts (E1)
export interface EnlaceMenu { href: string; label: string }
export const MENU_PUBLICO: readonly EnlaceMenu[]; // Manifiesto /manifiesto · Método /metodo · Comunidad /comunidad · Para empresas /empresas
export const MENU_EMPRESAS: readonly EnlaceMenu[]; // el de hoy, con "Zelena" en lugar de "La DAO"
export function menuPara(o: { ruta: string; conSesion: boolean; accesoEquipo: boolean; esInterno: boolean; puedeVerTodo: boolean }): EnlaceMenu[];
//  sin sesión → MENU_PUBLICO; /empresas* → MENU_EMPRESAS;
//  con sesión → [Mi día, Proyectos]? (si accesoEquipo) + [Talento] (si puedeVerTodo) + [Clientes] (si esInterno) + [Ágora, Academia, Comunidad]
//  menuPara NO reemplaza el botón de perfil ni el enlace "Admin" por rol (claimsPuedenAdministrar), que NavContextual conserva.
export const RUTA_COMUNIDAD: string; // "/comunidad"; puerta, menú y CTA la usan. Si D no llega a la hora de corte, el líder la cambia a "/encuentros" (una línea).
export const FOOTER_GRUPOS: ReadonlyArray<{ titulo: string; enlaces: readonly EnlaceMenu[] }>;
//  Legal: Acuerdo de contribución /acuerdo · Privacidad /privacidad · Licencia https://github.com/zelena-tech/zelena-dapp/blob/main/LICENSE
export const AVISO_LEGAL: string; // "Las funciones de pago de la plataforma corren en la red de pruebas de Stellar. Nada aquí es oferta de valores ni asesoría."

// src/lib/agora-labels.ts (E1) — ÚNICO archivo de la app con los literales "SAS" y "DAO" del tipo de proyecto
export const TIPO_PROYECTO_LABEL: Record<"SAS" | "DAO", string>;   // Cliente · Comunidad
export const ESTADO_PROYECTO_LABEL: Record<string, string>;        // Open Abierto · Assigned Asignado · Delivered Entregado · Scored Evaluado · Distributed Recompensas repartidas
export function tipoDesdeQuery(v: string | undefined): "SAS" | "DAO" | undefined; // cliente|comunidad (y SAS|DAO heredado)
export function queryDesdeTipo(t: "SAS" | "DAO"): "cliente" | "comunidad";
export function tipoDesdeEtiqueta(t: "cliente" | "comunidad"): "SAS" | "DAO";    // lo usa el puente al Ágora (C2)
export function esDecisionReemplazada(reason: string): boolean;                  // la del 2026-07-01 (reason contiene la etiqueta vieja)
export const REEMPLAZO_DECISION = "Las etiquetas de proyecto pasan a Cliente y Comunidad";

// src/lib/metodo.ts (E1)
export const PASOS_METODO: ReadonlyArray<{ n: string; titulo: string; texto: string }>; // 8 pasos (§8.3)

// src/lib/legal.ts (E1)
export function responsableTratamiento(env?: NodeJS.ProcessEnv): { nombre: string; contacto: string | null };
// nombre = ZELENA_LEGAL_NAME || "Zelena"; contacto = ZELENA_PRIVACY_EMAIL || null

// src/lib/pruebas-testnet.ts (E1) + src/data/pruebas-testnet.json
export interface PruebasTestnet { actualizado: string | null; transacciones: Array<{ etiqueta: string; tipo: "contrato" | "pago" | "anclaje"; tx: string; fecha: string }>; contratos: Array<{ etiqueta: string; id: string }> }
export function txVerificable(tx: string): boolean;        // /^[0-9a-f]{64}$/
export function contratoVerificable(id: string): boolean;  // /^C[A-Z2-7]{55}$/
export function pruebasVisibles(p: PruebasTestnet): PruebasTestnet; // filtra lo no verificable
export const EXPLORADOR_TX = "https://stellar.expert/explorer/testnet/tx/";
export const EXPLORADOR_CONTRATO = "https://stellar.expert/explorer/testnet/contract/";

// src/lib/prueba-en-vivo.ts (E1, servidor) — cifras de la landing, solo lo real
export function cifrasEnVivo(db: DB): { proyectosAbiertos: number; entregasAprobadas: number; firmasRegistradas: number;
  ultimaFirmaAnclada: { tx: string; fecha: string } | null };

// src/lib/contenido-publico.ts (E2)
export function aplicarContenidoPublico(db: DB): { academia: boolean; decision: boolean; reemplazos: number };
```
Definición de las cifras (`cifrasEnVivo`), sin cuentas demo:
- **Proyectos abiertos** = `projects.state = 'Open'`.
- **Entregas aprobadas** = `milestones.approved = 1` de proyectos cuyo `assignee_wallet` no es demo **+**
  asignaciones con evento `aprobar` cuyo dueño no es demo.
- **Firmas registradas** = `cla_signatures` con `tx_id` que cumple `txVerificable` y wallet no demo (las semillas
  `SEEDTX_…` no cuentan).
- Con cifras en 0 se muestra el 0 (primero lo real) y el texto de §8.1.

**Una sola tarjeta "Compruébalo tú mismo"** (`PruebaTestnet`): la última transacción de `pruebasVisibles(json)` y
los contratos; si el JSON no tiene nada verificable, `ultimaFirmaAnclada`; si tampoco, no se pinta. `PruebaEnVivo`
deja de tener su propia tarjeta de tx y queda solo con las cifras. `/perfil` (WP31-I2) solo enlaza un `tx_id` que
cumple `txVerificable`.

JSON inicial (lo importa la app con `import`, no con `fs`, para que viaje en el bundle). E1 lo crea vacío; **el
líder lo llena antes del despliegue** desde `stellar-evidencia.json` con hashes públicos de testnet (contenido
exacto en el plan):
```json
{ "actualizado": null, "transacciones": [], "contratos": [] }
```
`aplicarContenidoPublico` (idempotente, una transacción; la llamada va en su propio `try/catch`, §3.5):
- **S1**: si ya existe `slug='construir-sin-riesgo'`, no hace nada (guarda contra el UNIQUE). Si no, y existe
  `academia_content.slug='por-que-sas-dao'` → `UPDATE` de `slug='construir-sin-riesgo'`,
  `title`, `summary`, `body` (textos del anexo); las **5** filas de `academia_quiz` de ese contenido se
  actualizan **en su sitio, por orden de id** (`question`, `options`, `correct`; mismos `id`); si no son
  exactamente 5, no toca el quiz y escribe `console.warn` (el ensayo del plan comprueba antes de desplegar que en
  producción son 5; si no, el quiz viejo seguiría público y el líder lo resuelve antes de salir). Reordena: `como-se-mide-el-valor` → `ord=1`, el
  módulo S1 → `ord=2` (los demás conservan su orden relativo). No toca `academia_awards`, `reading_sessions`
  ni `points_ledger`.
- **S2**: si existe una decisión cuyo `reason` contiene "etiquetadas SAS" y no existe la nueva, inserta
  `decision_log(date=hoy, title='Las etiquetas de proyecto pasan a Cliente y Comunidad', reason='Desde hoy los
  proyectos se etiquetan como de un cliente o de la comunidad. El valor interno no cambia y la decisión
  anterior se conserva tal cual, con su huella.', hash=sha256Hex(date|title|reason))`. No modifica filas.
- **S3**: en `academia_content.body`, reemplaza "score compuesto** por contribuidor" por "score compuesto**
  por entrega" (y la variante sin negrita) si aparece. Cuenta reemplazos.
- Se llama al final de `seedIfEmpty`, después de `seedCohortInvite(db, env);`, dentro de su `try/catch`.
- El `seed()` de base nueva escribe ya el contenido nuevo (misma forma final), así que en una base nueva
  `aplicarContenidoPublico` no hace nada.

## 6. CLAVES NUEVAS DEL GENOMA (`GENOME_V2_NUEVAS`, valores por defecto)

| Clave | Valor | Unidad / nota |
|---|---|---|
| `TASK_POINTS` | `{ S: 10, M: 30, L: 80 }` | puntos ZWORK por entrega aprobada |
| `TASK_REP` | `{ S: 1, M: 3, L: 8 }` | reputación de ejecución |
| `ON_TIME_BONUS_PCT` | `25` | % extra de puntos si la entrega llegó a tiempo |
| `BUSINESS_TZ` | `"America/Bogota"` | zona del horario hábil |
| `BUSINESS_DAYS` | `[1, 2, 3, 4, 5]` | ISO, lunes a viernes |
| `BUSINESS_HOUR_START` | `8` | hora local |
| `BUSINESS_HOUR_END` | `18` | hora local (1 día hábil = 10 h) |
| `SLA_P1_RESPONSE_H` | `2` | h hábiles |
| `SLA_P1_RESTORE_H` | `8` | h hábiles |
| `SLA_P1_REVIEW_H` | `4` | h hábiles |
| `SLA_P2_RESPONSE_H` | `10` | h hábiles = 1 día hábil (requisitos e.1) |
| `SLA_P2_RESOLVE_D` | `3` | días hábiles |
| `SLA_P3_RESPONSE_D` | `2` | días hábiles |
| `SLA_P3_RESOLVE_D` | `10` | días hábiles |
| `SLA_P4_TRIAGE_D` | `5` | días hábiles |
| `SLA_REVIEW_D` | `1` | días hábiles |
| `SLA_BLOCK_ESCALATE_D` | `2` | días hábiles |
| `SLA_BLOCK_FOUNDER_D` | `5` | días hábiles |
| `SLA_WARN_PCT` | `25` | "por vencer" cuando queda ≤ 25 % de la ventana… |
| `SLA_WARN_MAX_H` | `10` | …y como máximo 10 h hábiles antes |
| `REMINDER_DIGEST_HOUR` | `8` | hora local del resumen diario (no es `DAILY_FOCUS_HOUR`=7 porque las 7 quedan fuera del horario hábil; los focos del founder no cambian) |
| `REMINDER_MAX_INMEDIATOS` | `3` | tope de urgentes por persona y corrida; el resto va al resumen |
| `REMINDER_P1_NO_RESPONSE_H` | `1` | h hábiles sin respuesta antes del aviso P1 |
| `REMINDER_BEFORE_D` | `{ High: 1, Normal: 2 }` | días hábiles antes del vencimiento |
| `ESCALATE_SUPERVISOR_D` | `{ High: 1, Normal: 2 }` | días hábiles después del vencimiento |
| `ESCALATE_FOUNDER_D` | `{ High: 3, Normal: 5 }` | días hábiles después del vencimiento |
| `ESCALATE_P1_FOUNDER_FACTOR` | `2` | P1: al founder al doble de la ventana de restablecimiento |
| `RITES_CADENCE.sync` | `{ frecuencia: "semanal", dia_semana: 1, hora: "09:00", duracion_min: 30 }` | lunes |
| `RITES_CADENCE.demo` | `{ frecuencia: "quincenal", dia_semana: 5, hora: "16:00", duracion_min: 60, ancla: "2026-10-09" }` | viernes, coincide con la época |
| `RITES_CADENCE.retro` | `{ frecuencia: "mensual", semana_del_mes: 1, dia_semana: 1, hora: "10:00", duracion_min: 60 }` | primer lunes |
| `RITE_ATTEND_REP` | `2` | comunidad por asistir |
| `RITE_HOST_REP` | `5` | comunidad para el anfitrión |
| `RITE_RECORDER_REP` | `5` | comunidad para el relator |
| `RITE_CODE_ROTATION_S` | `90` | segundos de vida del código |
| `RITE_WINDOW_MIN` | `30` | minutos antes y después del rito en que se puede abrir y registrar asistencia |
| `AGORA_HITOS_DEFAULT` | `[{nombre:"Anticipo",semana:"1",pct:20},{nombre:"Primera entrega",semana:"2",pct:25},{nombre:"Segunda entrega",semana:"4",pct:25},{nombre:"Entrega final",semana:"6",pct:20},{nombre:"Retención de calidad",semana:"8",pct:10}]` | reparto por hitos del doc 11 (20/70/10); lo usa el puente al Ágora |
| `BADGE_GOALS` | `{ "primera-entrega":1, "diez-entregas":10, "a-tiempo":5, "pieza-grande":1, "ojo-de-revisor":5, "presente":3, "anfitrion":1 }` | metas de las insignias |

Ninguna clave nueva entra en `NUMERIC_GENES` esta noche. Cambiarlas = versión nueva del genoma (siguiente paso:
UI para claves no numéricas).

## 7. RUTAS Y APIs (permisos por rol)

Leyenda: F = founder · S = supervisor (`is_supervisor`) · C = core · X = contributor miembro del proyecto ·
E = rol `estructura` en el proyecto · R = rol `revisa` · Ej = rol `ejecuta` · H = anfitrión del rito ·
U = cualquier sesión con fila en `users` · P = público. Todos los POST/PATCH validan con zod, limitan tasa
(`rateLimit`) y responden `{ error }` con 400/401/403/404/409.

| Ruta | Método | Quién | Cuerpo / efecto | WP |
|---|---|---|---|---|
| `/equipo/*` (layout) | – | `equipoActor` ≠ null | sin acceso → `/perfil`. Atajo de UX: **cada página repite su puerta** (§5.A.2) | A |
| `/equipo/hoy` | GET | F S C X | mis entregas; check-in solo alcance `equipo`; X ve "Tus proyectos" | A, I |
| `/equipo/proyectos` | GET | F S C X | proyectos visibles; "Nuevo proyecto" y el enlace "Importar CSV" (→ `/equipo/talento#importar`) para F S | A |
| `/equipo/proyectos/[slug]` | GET | F S C (todos) · X (sus proyectos) | tablero; 404 si no lo ve | A, I |
| `/equipo/talento` | GET | F S | directorio con filtro Interno · Externo; acciones de rol/supervisión/vincular solo F | A2 |
| `/equipo/dashboard` | GET | F S | puerta propia con `equipoActor` + `puedeVerTodoElEquipo` (A); semáforos (I) | A, I |
| `/equipo/avisos` | GET | `equipoActor` | bandeja propia | C1 |
| `/equipo/telegram` | GET | `equipoActor` | vincular Telegram | C2 |
| `/equipo/publicar/[id]` | GET | F S | formulario de publicación | C2 |
| `/api/equipo/proyectos` | POST | F S | `{ name, horizon?, notes?, clientId? }` → `{ ok, id, slug }` | A |
| `/api/equipo/proyectos` | PATCH | F S E | `{ initiativeId, name?, horizon?, notes?, clientId? }` | A |
| `/api/equipo/miembros` | POST | F S E (E solo `ejecuta`/`vende`; nunca sobre sí) | `{ action: 'agregar'\|'quitar', initiativeId, wallet, rol, vinculo? }` | A |
| `/api/equipo/crear` | POST | `equipoActor` (reglas §5.A.4) | igual que hoy + proyecto obligatorio para X | A |
| `/api/equipo/asignacion` | POST | `equipoActor` + `puedeTransicionar` (nunca `actorFromSession`) | `{ assignmentId, action, reason? }` (igual) | A |
| `/api/equipo/asignacion` | PATCH | dueño (contexto) · F S E (planificación) | `EditarAsignacionInput` | A |
| `/api/equipo/talento` | POST | F (`adminActor`) | `{ action:'rol', wallet, role } \| { action:'supervisor', wallet, isSupervisor } \| { action:'vincular', slug, wallet, simular? }` | A2 |
| `/api/equipo/importar` | POST | F S (`equipoInternoActor` + `puedeVerTodoElEquipo`) | `{ csv }` (≤ 500 KB) → `ImportSummary` | A2 |
| `/api/equipo/publicar` | POST | F S | `publicarSchema` → `{ ok, projectId }` | C2 |
| `/api/avisos` | GET / POST | U (propios) | GET lista · POST `{ ids?: number[] }` marca leídos | C1 |
| `/api/cron/recordatorios` | POST | cabecera `x-cron-secret` | sin `CRON_SECRET` (o < 32) → 503; incorrecto → 401; corrida viva → 200 `en_curso`; ok → `ResultadoCorrida` (solo conteos); `?simular=1` no escribe | C1 |
| `/api/telegram/vincular` | GET / POST | `equipoActor` | su propio código (founder: su fila de equipo) | C2 |
| `/api/telegram/webhook` | POST | Telegram (secret) | `ANTHROPIC_API_KEY` opcional | C2 |
| `/comunidad` | GET | P | ritos + encuentros + Academia + 3 decisiones recientes + cómo participar; "Tu asistencia" con sesión | D |
| `/comunidad/ritos/[id]` | GET | P (vista) · H F S (código) · U (registrar) | | D |
| `/api/ritos` | POST | preparar/asignar: F S · abrir/cerrar: F S H | `{ action, ... }` (§5.D) | D |
| `/api/ritos/codigo` | GET | H F S | `?sesion=<id>` → `{ codigo, expiraEnS }` | D |
| `/api/ritos/asistir` | POST | U con CLA, no demo (sync: además `equipoActor`) | `{ sessionId, codigo }` · 10/min por wallet · 20 fallos por (sesión, wallet) | D |
| `/api/admin/epoca` | GET / POST | F (`adminActor`) | GET `EstadoCierreEpoca` · POST `{ action: 'cerrar', justificacion, nombreSiguiente? } \| { action: 'abrir', justificacion, nombre? }` | D |
| `/admin` | GET | F | + secciones "Épocas" y "Ritos" | D |
| `/` | GET | P | landing nueva | E1, D (slot) |
| `/metodo` | GET | P | 8 pasos | E1 |
| `/ecosistema` | – | – | 308 → `/metodo` (`next.config.mjs` `redirects`) | E1 |
| `/academia/por-que-sas-dao` | – | – | 308 → `/academia/construir-sin-riesgo` | E1 |
| `/privacidad`, `/acuerdo` | GET | P | aviso de datos · texto del CLA (lectura de `readClaText`) | E1 |

Sin cambios en `middleware.ts`: `/equipo` ya exige sesión. La autorización real la hace **cada página y cada ruta**
(§5.A.2, test estático en `authz.test.ts`); el layout solo evita pintar el marco a quien no tiene acceso.

## 8. COPY CLAVE (español, minimalista, segunda persona)

### 8.1 Landing `/`
- H1: **Lo que entregas decide lo que recibes.**
- Sub: No el cargo. No la antigüedad. No las horas.
- Puertas:
  - **Manifiesto** — Lo que creemos, en nueve principios.
  - **Método** — Cómo una necesidad se convierte en una entrega que se paga.
  - **Comunidad** — Ritos cortos, encuentros abiertos y una Academia. Nadie construye solo.
  - **Para empresas** — Software para tu operación y un equipo que lo sostiene.
- Prueba en vivo: título "Esto no es una maqueta" · cifras "proyectos abiertos", "entregas aprobadas",
  "firmas registradas" (definiciones en §5.E) · nota bajo las cifras: "Contamos solo lo real: sin cuentas de
  prueba." · si las tres están en 0: "Las primeras entregas se registran aquí, a la vista de todos." · tarjeta
  única "Compruébalo tú mismo" (si hay datos verificables): "Cada pago de prueba deja una huella pública. Ábrela
  en el explorador de la red de pruebas de Stellar." La landing **no lista proyectos**.
- Próximo: "Próxima demo: viernes 16:00" (solo ritos de comunidad) o "Próximo encuentro: …"; si no hay nada:
  "Las próximas fechas se publican en Comunidad."
- Cierre: **¿Construimos?** · botones **Entrar** · y, según haya o no encuentros publicados: **Ven a un
  encuentro** (`/encuentros`) o **Ven a la próxima demo** (`RUTA_COMUNIDAD#proximos`).

### 8.2 Menú y pie
- Menú público: Manifiesto · Método · Comunidad · Para empresas · [Entrar].
- Pie: Proyectos abiertos (Ágora) · Academia · Decisiones · Whitepaper · Servicios · Contacto ·
  **Legal**: Acuerdo de contribución · Privacidad · Licencia. Aviso: `AVISO_LEGAL`.
- Con sesión: además de `menuPara`, se conservan el botón de perfil y "Admin" (solo founder, por rol).

### 8.3 `/metodo` — H1 **De una necesidad a una entrega que se paga.**
1. **Llega una necesidad.** Una empresa o la comunidad trae un problema real. Se define qué hay que
   entregar, cuánto vale y cómo se va a evaluar.
2. **Se publica.** El proyecto se abre con su alcance, sus hitos y su forma de evaluación, a la vista de todos.
3. **Aplicas con tu enfoque.** No hay puja por precio: cuentas cómo lo resolverías, en qué tiempo y cómo
   sabremos que salió bien.
4. **Se elige quién lo hace.** Por el enfoque y el historial. El motivo queda escrito.
5. **Construyes por hitos.** El trabajo se parte en entregas cortas; la primera llega en una o dos semanas.
6. **Otra persona revisa la entrega.** Contra el criterio acordado. Se califica la entrega, nunca a la persona.
7. **Se paga el hito.** Cada hito aprobado se paga. Los pagos que ves dentro de la plataforma corren hoy en la
   red de pruebas de Stellar; cuando hay un pago real, se hace por fuera contra el hito aprobado y aquí queda el
   registro.
8. **Tu historial crece.** Lo que entregaste queda registrado a tu nombre. No se borra y no se quita.

### 8.4 `/comunidad` — H1 **Nadie construye solo.**
- Sub: Ritos cortos y fijos, encuentros abiertos y una Academia para aprender haciendo.
- Ritos: **Sync semanal** · 30 min · Qué avanzó, qué está trabado y qué sigue. · **Demo quincenal** ·
  Quien construye muestra lo que salió, lo que no y lo que aprendió. · **Retro mensual** · Qué funcionó,
  qué cambiamos y qué decidimos.
- Audiencia: el sync dice "Del equipo y de quien trabaja en un proyecto."; la demo y la retro, "Abierta a la
  comunidad."
- Nota: Estar es suficiente. Faltar no resta nada.
- Cómo participar: "La entrada es por invitación. El camino más corto: ven a una demo abierta o a un encuentro."
  · lugar del rito si lo hay · "Enlace para conectarte" solo con sesión; sin sesión: "Entra para ver el enlace."
- Próximos (`id="proximos"`) vacío: "Aún no hay ritos abiertos a la comunidad en el calendario."
- Pasados vacío: "Todavía no se ha cerrado ningún rito."
- Academia: H2 "Aprende haciendo" · vacío: "La Academia se está preparando."
- Decisiones: H2 "Lo último que decidimos" (las 3 más recientes de `decisionesPublicas`) · enlace "Ver todas
  las decisiones" (`/gobernanza`) · vacío: "Todavía no hay decisiones publicadas."
- Tu asistencia (con sesión): "Has estado en {n} ritos. Esta temporada: {m}."
- Rito (asistente): "Escribe el código que ves en pantalla." · éxito: "Listo. Quedó registrada tu asistencia."
  · errores: código incorrecto o vencido → "Ese código ya cambió. Pide el actual a quien presenta." · rito no
  abierto o fuera de su ventana → "Este rito no está abierto ahora." · ya registrado → "Ya estabas registrado." ·
  sin sesión → "Entra para registrar tu asistencia." · sin acuerdo firmado → "Para registrar asistencia primero
  firma el acuerdo de contribución." · demasiados intentos → "Demasiados intentos con este rito. Pide ayuda a
  quien presenta."
- Rito (anfitrión): "Código de asistencia" · "Cambia cada 90 segundos." · "{n} personas registradas" (solo el
  conteo).

### 8.5 Equipo
- Tablero: columnas con los nombres de estado; filtros "Responsable · Prioridad · Tamaño · Horizonte ·
  Vence"; vacío: "Nada por aquí con estos filtros."; "Nueva entrega"; "Editar"; "Reasignar". En una tarjeta
  En revisión, los campos fijos se ven deshabilitados con: "Una entrega en revisión no se reasigna ni se
  replanifica: devuélvela primero."
- Tamaño vacío: "Sin tamaño: cuenta como S hasta que quien planifica lo defina."
- Nuevo proyecto (founder/supervisor): H2 "Nuevo proyecto" · campos "Nombre" (ayuda: "Así se verá en el tablero.
  La dirección no cambia después."), "Horizonte" (Ahora · Siguiente · Parqueado), "Descripción" (opcional),
  "Cliente" (opcional; solo founder/supervisor) · botón "Crear proyecto" · error de nombre repetido: "Ya existe
  un proyecto con ese nombre."
- Importar CSV (founder/supervisor): "Pega el CSV con columnas Initiative, Title, Assignee, Status, Priority,
  Size, Due. Importar no da puntos." · botón "Importar" · resultado: "{n} creadas · {m} ya estaban · {k} con
  error" y, por fila con error, "Fila {i}: {motivo}" (p. ej. "no encuentro a «{Assignee}» en el equipo").
- Miembros: "Quiénes están en este proyecto" · "Sumar a alguien" (quien estructura sin ser supervisor ve:
  "Puedes sumar a quien ejecuta o vende. Para revisar o estructurar, pídeselo a un supervisor.") · campo "o
  pega su wallet" para un externo · ayuda: "¿Aún no tiene cuenta? Genera una invitación en tu perfil; cuando
  firme el acuerdo, aparecerá aquí para sumarla." (enlace a `/perfil#invitar`) · errores: "Primero reasigna sus
  entregas abiertas en este proyecto." · "Primero tiene que firmar el acuerdo de contribución." · "Tus propios
  roles los cambia otra persona."
- Tus proyectos (contributor, en `/equipo/hoy`): H2 "Tus proyectos" · tarjeta: nombre, "Tu rol: {roles}",
  "{n} piezas sin responsable para tomar" · sin check-in.
- Talento: H1 **Talento** · "Las personas y sus roles son datos: se cambian aquí, no en el código." · filtro
  "Todas · Interno · Externo" · por persona: rol, supervisión, proyectos y "{n} abiertas" (carga para repartir,
  no evaluación) · cambiar rol: "¿Pasar a {nombre} a {Core|Contributor}? Cambia lo que puede ver en /equipo." ·
  error: "Primero reasigna sus entregas abiertas o súmale a esos proyectos." · supervisión: "¿Dar supervisión a
  {nombre}? Podrá ver todo el equipo y aprobar entregas ajenas." · vincular: "Esta fila del equipo aún no tiene
  cuenta. Vincúlala con la cuenta con la que ya entró la persona: su trabajo, sus puntos y su historial pasan a
  esa cuenta." · confirmación (tras la simulación): "Se moverán {n} registros ({detalle}). No se puede deshacer."
  · error de historia sellada: "Esta cuenta tiene historia en una época o un rito ya cerrados: su huella no se
  puede reescribir."
- Semáforo: "A tiempo · vence jue 14:00" · "Por vencer · quedan 3 h hábiles" · "Vencida · desde ayer 18:00" ·
  "Sin plazo".
- Tu progreso: "Esta temporada sumaste {p} puntos y {r} de reputación en ejecución por entregas aprobadas." ·
  "Lo ganado no se quita." · insignias: "Primera entrega · conseguida" / "Diez entregas · 4 de 10". · Tope
  alcanzado (`presupuesto_agotado`): "Esta temporada el presupuesto de puntos se completó: tu reputación quedó
  entera." · Pieza publicada en el Ágora: "Esta pieza se paga por sus hitos en el Ágora."
- Avisos: H1 **Avisos** · "Lo que necesita tu atención en tus entregas. Un resumen al día; lo urgente, al
  momento." · vacío: "No tienes avisos." · "Marcar como leídos" · "Recibir también por Telegram" · flag
  apagada: "Los recordatorios están en pausa. Los plazos se ven igual en cada tarjeta."
- Telegram (`/equipo/telegram`): H1 **Telegram** · "Recibe aquí el resumen de tus entregas y lo urgente." ·
  "1. Genera tu código. 2. Escríbele a {bot} «/start CÓDIGO». Vence en 30 minutos." ({bot} =
  `TELEGRAM_BOT_USERNAME` si está, con @; si no, "el bot de Zelena") · vinculado: "Listo: tu Telegram está
  vinculado." · "Desvincular" · "Por Telegram solo guardamos tu id de chat. Ver el aviso de privacidad."
- Publicar en el Ágora (`/equipo/publicar/[id]`): H1 "Publicar en el Ágora" · aviso: "Lo que publiques será
  visible para cualquiera. No incluyas nombres de clientes sin su permiso." · campos "Para quién" (Un cliente ·
  La comunidad), "Campaña" (prellenado "Zelena"), "Título", "Resumen" (10–400), "Qué hay que entregar",
  "Cómo se va a evaluar", "Presupuesto (USD, red de pruebas)", "Semanas", "Hitos" (nombre, semana, %: "Suman
  {s} %; deben sumar 100 y ninguno pasar de 25.") · "Ver cómo quedará" → vista previa "Así se verá" · "Publicar"
  · "Los pagos dentro de la plataforma corren en la red de pruebas de Stellar." · errores: "Solo se publica trabajo que aún no tiene responsable." · "Esta
  pieza ya está publicada."
- `/admin` · Épocas: H2 "Épocas" · "{nombre} · abierta desde {fecha}" · faltantes: "Falta firmar el fitness de
  esta época." · "Falta decidir la mutación de la siguiente (aunque sea «sin cambios»)." · botón "Cerrar esta
  época y abrir la siguiente" · confirmación: "¿Cerrar la época {N}? Se calcula su huella, se encola para la red
  de pruebas y se abre la {N+1}. No se puede deshacer." · si no hay ninguna abierta: "No hay ninguna época
  abierta." + "Abrir época".
- `/admin` · Ritos: H2 "Ritos" · "Preparar" (tipo, fecha de la cadencia, lugar, enlace) · "Anfitrión" ·
  "Relator" · "Abrir" (fuera de ventana: "Este rito todavía no se puede abrir: se abre media hora antes de
  empezar.") · "Cerrar" (resumen y acta opcionales) · "{n} personas registradas" · pasada la ventana: "Pendiente
  de cerrar".

### 8.6 Ágora (U1–U4, U8–U11)
- Filtros: Todos · Clientes · Comunidad. Texto: "Cada proyecto dice si es para un cliente o para la
  comunidad, con sus hitos, sus pagos y cómo se va a evaluar la entrega. Aplica con tu enfoque y tu
  historial." Ficha: "Para quién" + etiqueta. Estados: Abierto · Asignado · Entregado · Evaluado ·
  Recompensas repartidas. Junto a cada monto: "Red de pruebas".

### 8.7 `/privacidad` (resumen de contenido)
Responsable: `responsableTratamiento().nombre` y su contacto; si `ZELENA_PRIVACY_EMAIL` falta, el canal es el
formulario de `/empresas/contacto` (enlazado). Qué datos (nombre, correo, empresa y mensaje de los formularios;
wallet pública; correos vinculados; id de Telegram si lo vinculas), para qué (responder, avisar de encuentros,
operar tu cuenta), qué no hacemos (no vendemos datos; no medimos horas, ubicación ni conexión), tus derechos
(conocer, actualizar, rectificar, suprimir, revocar la autorización) y cómo ejercerlos. Los formularios de
`/empresas/contacto` y `/encuentros` añaden una casilla **no premarcada** y obligatoria: "Acepto el tratamiento de
mis datos según el aviso de privacidad." (enlace a `/privacidad`). `/entrar` (junto al segundo correo) y
`/equipo/telegram` enlazan el aviso.

### 8.8 Vocabulario
Prohibido en copy nuevo: estructura societaria (en público), "bajo desempeño", "rojo", "atrasado",
"ranking" (solo), "jornada", "horas trabajadas", "última conexión", "perdiste", "empleado", "jefe",
"bounty", "on-chain", "wallet" (salvo `/entrar` y el campo "pega su wallet"), "hash" (salvo detalle técnico;
en público, "huella"), "Intake", "Stage", "treasury" (es "fondo común"), "farmeo".

## 9. CONTRATO DE DESPLIEGUE (F)

- **Variables nuevas** (App Settings): `CRON_SECRET` (≥ 32, obligatorio para el cron; con menos, la ruta da 503),
  `SLA_REMINDERS_ENABLED` (`1|true|yes`; en código apagada por defecto; **en producción `=1`** tras la simulación),
  `RITES_SECRET` (≥ 16; si falta, se deriva de `SESSION_SECRET`, que en producción ya es obligatorio),
  `ZELENA_APP_URL` (host canónico exacto, `https://www.zelena.tech`; enlaces de los mensajes),
  `TELEGRAM_BOT_USERNAME` (opcional, no es secreto: solo para el copy de `/equipo/telegram`),
  `ZELENA_LEGAL_NAME` y `ZELENA_PRIVACY_EMAIL` (los decide el founder; mientras no estén, `/privacidad` dice
  "Zelena" y usa el formulario de contacto como canal). Sin secretos en el repo.
- **Telegram en producción** (para que alguien pueda vincular): `TELEGRAM_ENABLED=1`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET` y una llamada a `setWebhook` con `secret_token` hacia
  `https://www.zelena.tech/api/telegram/webhook`. **Nunca** se corre `packages/scripts/telegram-bot.mjs` con el
  token de producción: el modo polling llama a `deleteWebhook` y apaga el bot de la web.
- **GitHub**: secret `CRON_SECRET`; variable `ZELENA_APP_URL`. `schedule` **y** `workflow_dispatch` solo se
  disparan si el workflow está en la rama por defecto (`main`): `recordatorios.yml` llega a `main` en un PR propio
  que solo contiene ese archivo, **después** de que el endpoint esté desplegado (antes daría 404 cada 15 min). El
  workflow usa `concurrency: { group: recordatorios, cancel-in-progress: false }`, `curl` **sin `--retry`** (un
  reintento por timeout lanzaría una segunda corrida) y comprueba el código HTTP de forma explícita (`curl -f`
  no falla ante un 301/308). GitHub puede retrasar los programados de 5 a 30 min y los pausa en un repo público
  tras 60 días sin actividad.
- **Pipeline de build** (F, del líder; ya existe como `.github/workflows/paquete-azure.yml` + `apps/web/start-standalone.sh`,
  y este contrato es lo que debe seguir cumpliendo): disparador `push` sobre `feat/v1-unificada` (y `workflow_dispatch`
  cuando llegue a `main`); `node-version` igual a la del App Service (22.x: comprobar `node -v` en Kudu; el
  `ci.yml` actual usa 20 y dejaría un `better-sqlite3` con otra ABI); artefacto descargable. Si el arranque es
  standalone: script de arranque con la misma lógica de `NODE_OPTIONS`/`--experimental-sqlite` que
  `start-azure.sh` y `HOSTNAME=0.0.0.0`; copiar `.next/static` y `public/`. Smoke en el CI sobre el artefacto
  extraído: `node -e "require('better-sqlite3')"` desde la carpeta de la app, arrancar con un `DATABASE_FILE`
  temporal, `curl /` y `curl /api/cla` (hash `03293c93…edb9`), y comprobar que existen `.next/static`, `public/`,
  `CLA.md` ×2, `docs/whitepaper.md` y `src/lib/schema.sql`. El artefacto **no lleva** `.env*`, `*.db` ni
  `*.secret` (repo público: los artefactos los descarga cualquiera con cuenta). Pasar de `node:sqlite` a
  `better-sqlite3` en producción alinea producción con los tests (savepoints en transacciones anidadas).
- **App Service**: `SCM_DO_BUILD_DURING_DEPLOYMENT=false` (que Oryx no reconstruya el paquete), una sola
  instancia (el candado del cron y el rate limit son en proceso).
- **Paquete**: además de lo que ya traza `next.config.mjs` (`schema.sql`, workers, `CLA.md` ×2,
  `whitepaper.md`), nada nuevo se lee con `fs`; `src/data/pruebas-testnet.json` se importa. `CLA.md` y
  `apps/web/CLA.md` byte a byte (sha256 `03293c93…edb9`).
- **Base de producción**: tablas nuevas por `schema.sql`; sin columnas nuevas; migraciones de datos de §3.5.
  Respaldo **con la app parada** (Kudu corre en otro contenedor y `/home` es almacenamiento de red: una copia en
  caliente de una base en WAL puede salir inconsistente): parar, `PRAGMA wal_checkpoint(TRUNCATE)`, copiar
  `zelena.db`, desplegar, arrancar. Secuencia exacta y go/no-go en el plan.
- `DATABASE_DRIVER=sqlite` explícito (no cambia).
- **Smoke** (`packages/scripts/smoke-wp31.sh <base>`, WP31-E2): en 200 `/`, `/metodo`, `/comunidad`, `/manifiesto`,
  `/encuentros`, `/empresas`, `/privacidad`, `/acuerdo`, `/agora`, `/academia`, `/academia/construir-sin-riesgo`,
  `/whitepaper`, `/gobernanza`; 308 en `/ecosistema` y `/academia/por-que-sas-dao`; `/equipo/hoy` sin sesión →
  redirección a `/entrar`; `POST /api/cron/recordatorios` sin cabecera → 401; `GET /api/cla` con hash
  `03293c93…edb9`; en `/`, al menos un enlace `stellar.expert/explorer/testnet/tx/<64 hex>`; y
  `grep -cE '\bSAS\b|S\.A\.S|societari|sociedad'` = 0 en el HTML de `/`, `/metodo`, `/comunidad`, `/agora`,
  `/academia`, `/academia/construir-sin-riesgo`, `/whitepaper`, `/empresas` y `/encuentros` (no en `/acuerdo`,
  `/entrar`, `/gobernanza` ni `/privacidad`: excepciones legales de §2.5). Sin secretos: la cabecera del cron
  solo se prueba sin secreto.

## 10. NO-ALCANCE (esta noche)

ZGOLD; tarjeta de cumplimiento (scorecard); reparto por rol con splits; escrow Modo B real; disputas; célula
dedicada y capacidad comprometida; ficha de servicio del cliente con SLA contractual; EN/ES; Entra (sigue
detrás de su flag apagado); botones interactivos en Telegram ("Pedir nueva fecha"); digest semanal de P4;
festivos; quiz de ritos (capa 2) y NFT (capa 3); QR gráfico (se muestra el código y la URL); límite de WIP
como gen; mutación de claves no numéricas desde la UI; baja de personas (WP34); misiones como tabla (WP27);
vista pública del genoma; anclaje automático por cron (lo decide el founder); cierre automático de ritos;
`TEAM_BUDGET` separado; persistir el consentimiento de los formularios en la base; pasar `today()` de
`team.ts` a la zona del genoma.

## 11. CRITERIOS DE ACEPTACIÓN (binarios) Y TESTS

Comandos (desde `apps/web`): `npx tsc --noEmit -p .` · `npm test` · `npm run lint` · `npm run build`. Todos verdes
al cerrar cada paquete (lint y build si toca `app/` o `src/components/`) y tras cada merge. Ningún test existente
se borra; los que se autoaprobaban se ajustan para que apruebe otra persona. Los tests corren con `TZ=UTC`.

### WP31-A
- [ ] A1 `equipoActor`: contributor sin membresía → null; con membresía y CLA → `alcance:'proyectos'`,
  `proyectos=[id]`; con membresía y sin CLA → null; core → `'equipo'`; alumni → null. *(authz.test.ts)*
- [ ] A1b `agregarMiembro` de un contributor o con vínculo externo sin `cla_signed` → 409 "Primero tiene que
  firmar…"; con CLA → ok. *(team-proyectos.test.ts)*
- [ ] A2 Tabla completa de `permisosEnProyecto`, de `puedeTransicionar` (con todos los flags y el orden de los
  motivos) y de `rolesQuePuedeConceder`. *(roles.test.ts)*
- [ ] A3 El dueño no puede `aprobar` ni `devolver` su entrega (403), tampoco el founder. *(team.test.ts)*
- [ ] A3b Identidad doble: el founder actúa con su wallet de sesión X (`role='founder'`) y la pieza está a nombre de
  su principal de equipo `pending:<slug>` → aprobar da 403 y **no** hay filas nuevas en `points_ledger` ni
  `reputation_events`; y al revés (actor = principal de equipo, dueño = X). *(team.test.ts)*
- [ ] A4 Un `revisa` aprueba una entrega ajena de su proyecto; un `ejecuta` no; un `revisa` de otro proyecto
  no. *(team-proyectos.test.ts)*
- [ ] A4b Quien hizo el último `enviar_a_revision` (aunque planifique) no la aprueba ni la devuelve (403); otra
  persona con `revisar` sí. *(team-proyectos.test.ts)*
- [ ] A4c B8 en las dos direcciones: quien invitó al dueño no aprueba; el invitado del aprobador tampoco al
  revés; el founder sí puede. Dueño `pending:` sin vincular: un `revisa` no aprueba; un supervisor sí.
  *(team-proyectos.test.ts)*
- [ ] A5 Un contributor solo ve sus proyectos (`proyectosVisibles`, `puedeVerProyecto`) y crea solo en ellos;
  el tamaño que manda se ignora. Un proyecto con `client_id` no lo ve un core sin `client_members` ni membresía;
  el founder sí. *(team-proyectos.test.ts)*
- [ ] A6 `editarAsignacion`: permisos por clase de campo; reasignar a externo no miembro → 400; `Backlog` +
  dueño → `Asignada` vía máquina; `Hecha` → 409; un evento `editar`/`reasignar` por llamada con
  `created_at = instanteDb(now)`. *(team-proyectos.test.ts)*
- [ ] A6b `En revisión`: cambiar `ownerWallet`, `size`, `dueDate`, `priority` o `acceptanceCriteria` → 409; la
  descripción sí se puede. *(team-proyectos.test.ts)*
- [ ] A7 `crearProyecto`/`editarProyecto`/`agregarMiembro`/`quitarMiembro` con sus permisos: `estructura` no
  concede ni quita `revisa`/`estructura` (403); nadie sobre sí mismo (403); `clientId` solo founder o supervisor;
  409 de duplicado y de entregas abiertas; slug inmutable; `talent_events` escrito. *(team-proyectos.test.ts)*
- [ ] A8 `describe("ataques")`: (1) un externo con `estructura` invita a una segunda wallet suya: sumarla como
  `revisa` → 403; sumarla como `ejecuta` y que apruebe la entrega del externo → 403 (B8); (2) reasignar a esa
  cuenta una entrega En revisión → 409; (3) mover `dueDate` de una entrega En revisión → 409. Ningún ataque deja
  filas en los ledgers. *(team-proyectos.test.ts)*
- [ ] A9 Puertas: test estático de §5.A.2 punto 4 sobre `app/equipo/**/page.tsx` y `app/api/equipo/**/route.ts`;
  además `dashboard/page.tsx` y `talento/page.tsx` llaman a `puedeVerTodoElEquipo(`. *(authz.test.ts)*
- [ ] A10 Un contributor miembro: `clientActor` → null (no entra a `/clientes`); `puedeVerProyecto` de un proyecto
  ajeno → false (el tablero responde `notFound`); su `/equipo/hoy` no carga check-in. *(authz.test.ts, team-proyectos.test.ts)*
- [ ] A11 Reingreso: `performLogin` de un contributor miembro + `equipoActor` → alcance `'proyectos'`. *(authz.test.ts)*
- [ ] A12 `TeamNewAssignment.tsx` y los comentarios de `roles.ts` y `equipo/layout.tsx` sin nombres de cliente ni
  estructura societaria (lo cubre el grep de E2-1).

### WP31-A2
- [ ] A2-1 `cambiarRol`/`cambiarSupervisor`: solo founder, nunca sobre sí ni sobre founder; el cambio **persiste
  tras `seedTeam`**; a `contributor` con piezas abiertas fuera de sus proyectos → 409. *(team-talento.test.ts)*
- [ ] A2-2 `vincularPrincipal`: mueve asignaciones, eventos, check-ins, membresías, avisos, puntos y reputación; las
  sumas por eje y de puntos son iguales antes y después; borra `pending:<slug>`; `seedTeam` posterior no lo recrea;
  rechaza destino demo / pending / sin CLA, **salvo** la excepción del founder (destino `role='founder'` demo → ok
  y queda `is_demo=0`); 409 si hay historia en una época no `Open` o en un rito `Closed`; `simular: true` deja la
  huella de la base igual y devuelve los mismos conteos que la real; `talent_events` con los conteos. Test de
  introspección de `REFERENCIAS_WALLET`. *(team-talento.test.ts)*
- [ ] A2-3 Importador: resuelve Assignee por roster vinculado y por `display_name`; importar filas `Hecha` no crea
  filas en `points_ledger` ni `reputation_events`. *(team-import.test.ts)*
- [ ] A2-4 `directorioTalento`: `vinculo` derivado, `abiertas`, filtro Interno · Externo, sin cuentas demo. *(team-talento.test.ts)*
- [ ] A2-5 CLI: desde `apps/web`, `node --experimental-strip-types -e "import('./src/lib/team-import.ts')"` termina
  sin error (Node 22). *(comando en la descripción del PR)*

### WP31-B
- [ ] B1 `getActiveGenome` sin filas = `GENOME_DEFAULTS`; con la fila v1 guardada → claves nuevas presentes;
  `GENOME_V1` sin cambios; la caché devuelve el objeto mezclado. *(genome.test.ts)*
- [ ] B1b `zona-horaria`: `instanteDb` = formato de SQLite; frontera 23:30 de Bogotá (04:30 UTC del día siguiente)
  → `diaLocal` da el día de Bogotá; `instanteLocal` ida y vuelta. *(zona-horaria.test.ts)*
- [ ] B1c `identidadesDe`/`principalFounder`/`mismaPersona`: founder con fila de sesión + `pending:<slug>`;
  slug vinculado por `roster_links`; persona normal = solo ella. *(identidades.test.ts)*
- [ ] B2 `seedGenomeV2` idempotente; efectiva desde la época siguiente; conserva una versión pendiente; no
  escribe `mutation_decisions`; `pendingMutation` no la muestra; `revertToVersion(1)` guarda una versión completa
  (con las claves nuevas). *(genome.test.ts, mutation.test.ts)*
- [ ] B2b `migracion-fusion.test.ts` en verde con la huella de `decision_log`/`genome_versions` como prefijo + 1
  versión y 1 decisión nuevas; `sim.test.ts` y `mutation.test.ts` en verde con los tipos nuevos.
- [ ] B3 `calcularPremioTarea` (S/M/L/null × a tiempo). *(gamificacion.test.ts)*
- [ ] B4 `emitirPorAprobacion`: filas con bucket/eje/ref/`period_id` correctos; segunda vez `ya_emitido` (también
  si el `ref` está solo en `points_ledger`); misma persona → `autoaprobacion`; B8 → `invitacion`;
  `published_as_project_id` → `publicada_en_agora` sin filas; clamp (presupuesto 100, gastado 90 → 10 puntos y
  reputación completa); puntos de otra época o de Academia no cuentan; nunca deltas negativos. *(gamificacion.test.ts)*
- [ ] B5 `approveMilestone` y Academia filtran el tope por época y bucket. *(points-ledger.test.ts, academia.test.ts)*
- [ ] B6 Horas hábiles: lun 17:00 + 2 h → mar 09:00; vie 17:00 + 2 h → lun 09:00; sáb 10:00 + 1 h → lun 09:00;
  `horasHabilesEntre` inverso; `parseInstanteDb` con y sin `Z`. *(sla.test.ts)*
- [ ] B7 `evaluarSla`: tabla de §5.B.2 (Backlog Normal → sin_plazo; P1 asignada a 1,5 h → por_vencer; 2,1 h →
  vencida; `due_date` manda; revisión > 1 día → vencida; bloqueo 2 días → vencida; Hecha → sin_plazo). *(sla.test.ts)*
- [ ] B8 `aprobadaATiempo` (literal): `due_date` mañana y aprobada hoy → true; entregada hoy pero aprobada pasado
  mañana → false; sin plazo → false; sin evento `aprobar` → false. *(sla.test.ts)*
- [ ] B9 `insignias` con metas del genoma: progreso actual/meta y nunca "perdida"; `senalesProgreso` cuenta solo
  aprobaciones de otra persona y suma las identidades. *(gamificacion.test.ts)*
- [ ] B10 `cerrarYAbrirEpoca`: precondiciones; cierra con merkle root determinista, encola `merkle_root`,
  escribe decisión y abre la siguiente con presupuestos del genoma de esa época, todo atómico; `abrirEpoca` solo
  si no hay ninguna `Open`. *(epocas.test.ts)*
- [ ] B10b Tras cerrar la época N: emitir una tarea, una reputación de voto (misma sentencia que la ruta) y una
  Academia → `merkleRoot(hojasDeEpoca(N))` sigue igual a `periods.merkle_root`; la ruta de voto contiene
  `period_id` (estático). *(epocas.test.ts)*
- [ ] B11 Esquema: las tablas del paso 0 existen; `sql-dialect.test.ts` y el auditor de secretos siguen verdes. *(suite)*
- [ ] B12 Estático: `gamificacion.ts` y `epocas.ts` no contienen `UPDATE points_ledger`, `DELETE FROM
  points_ledger`, `UPDATE reputation_events` ni `DELETE FROM reputation_events`. *(gamificacion.test.ts)*
- [ ] B13 Arranque: con `seedGenomeV2` forzado a fallar, `seedIfEmpty` no lanza y `getActiveGenome` devuelve los
  defaults. *(genome.test.ts)*

### WP31-E1
- [ ] E1-1 Test estático sobre la lista **generada** de archivos públicos: `app/**/*.tsx` sin `app/api`,
  `app/equipo`, `app/admin`, `app/clientes` ni `app/perfil`, más `src/components/{Nav,NavContextual,Footer,IntroEcosistema,PruebaEnVivo,PruebaTestnet,ProximoEncuentro,ui}.tsx`,
  `src/lib/{menu,metodo,servicios,encuentros}.ts`. Ninguno casa con `/\bSAS\b|S\.A\.S/` (con mayúsculas) ni con
  `/societari|\bsociedad\b|empresa detr[aá]s|empresa formal|acuerdo de servicios|accionista/i`. *(sitio-publico.test.ts)*
- [ ] E1-2 `menuPara` sin sesión = 4 enlaces en orden y ninguno empieza por `/equipo`, `/clientes` o `/admin`;
  con sesión de equipo incluye Mi día y Proyectos. *(menu.test.ts)*
- [ ] E1-2b `NavContextual.tsx` conserva el enlace `/admin` condicionado al rol de founder y el botón de perfil. *(sitio-publico.test.ts, estático)*
- [ ] E1-3 `next.config.mjs#redirects()` tiene las dos redirecciones con `permanent: true`. *(sitio-publico.test.ts)*
- [ ] E1-4 Etiquetas del Ágora, `tipoDesdeQuery`, `tipoDesdeEtiqueta` y `esDecisionReemplazada`. *(agora-labels.test.ts)*
- [ ] E1-5 `/empresas` no contiene "Nómina", "Blend", "rendimiento" ni "mainnet"; contiene "piloto en testnet". *(sitio-publico.test.ts)*
- [ ] E1-6 `FOOTER_GRUPOS` enlaza `/privacidad`, `/acuerdo` y la licencia en GitHub; `AVISO_LEGAL` es el texto
  nuevo y no contiene "sin dinero real". *(menu.test.ts)*
- [ ] E1-7 `pruebasVisibles` descarta hashes que no son 64 hex y contratos mal formados; JSON vacío y sin firma
  anclada → la tarjeta no se pinta. *(pruebas-testnet.test.ts)*
- [ ] E1-8 `PASOS_METODO` tiene 8 pasos; ningún texto contiene bounty, on-chain, wallet, hash ni Intake; el paso 7
  menciona la red de pruebas y no dice "sin dinero real". *(sitio-publico.test.ts)*
- [ ] E1-9 `/privacidad` contiene "conocer, actualizar, rectificar"; `ContactoForm` y `AvisoEncuentrosForm`
  enlazan `/privacidad` y tienen una casilla `required` sin `defaultChecked`. *(sitio-publico.test.ts)*
- [ ] E1-10 Landing: `app/page.tsx` contiene el H1 exacto, las 4 puertas en orden (`/manifiesto`, `/metodo`,
  `RUTA_COMUNIDAD`, `/empresas`), los 2 CTA, no importa `Type` ni llama a `listProjects`. *(sitio-publico.test.ts)*
- [ ] E1-11 Jerga: la lista de E1-1 no casa con `/\bbounty|on-chain|\bIntake\b|\bStage\b|treasury|farmeo/i`, ni con
  `/\bhash\b/i` salvo en `app/entrar/**`. *(sitio-publico.test.ts)*
- [ ] E1-12 `cifrasEnVivo` no cuenta cuentas demo ni `tx_id` `SEEDTX_…`. *(prueba-en-vivo.test.ts)*
- [ ] E1-13 Los literales `"SAS"`/`"DAO"` (entre comillas) solo aparecen en `src/lib/agora-labels.ts` entre
  `app/**` y `src/components/**`. *(sitio-publico.test.ts)*

### WP31-E2
- [ ] E2-1 `docs/whitepaper.md`, `README.md`, `CONTRIBUTING.md`, `CODEOWNERS`, `docs/specs/WP06…`, `WP10…`, `WP19…`,
  `WP21…`, `WP23…` y `docs/blueprints/01…`, `02…`, `04…`, `07…` no casan con las dos regexes de E1-1 ni con
  `UNIfication`; ningún archivo versionado de `apps/web/src` o `docs/` (salvo `seed.ts` y `__fixtures__/`) contiene nombres de
  clientes o ventures: la lista **no se versiona** (el líder la pasa en el prompt de E2 y la comprueba con `git grep` antes
  de desplegar); el whitepaper ya no contiene "se pierde si la propuesta es
  spam", "deja valor en la mesa", "pierde lo que más le costó ganar" ni "recompras". *(contenido-publico.test.ts)*
- [ ] E2-2 `aplicarContenidoPublico` sobre una base con el contenido viejo: slug, título y cuerpo nuevos; mismos
  5 ids de quiz con preguntas nuevas; `academia_awards` y `points_ledger` intactos (huella); orden nuevo;
  segunda corrida no hace nada; con el slug destino ya existente no hace nada. *(contenido-publico.test.ts)*
- [ ] E2-3 S2 inserta una sola decisión nueva con su hash y no modifica la vieja; en base nueva no inserta nada. *(contenido-publico.test.ts)*
- [ ] E2-4 `seedIfEmpty` en base vacía: ni `academia_content`, ni `academia_quiz`, ni `decision_log` casan con las
  regexes de E1-1. Si `aplicarContenidoPublico` lanza, `seedIfEmpty` no lanza. *(contenido-publico.test.ts)*
- [ ] E2-5 `sha256(CLA.md) === sha256(apps/web/CLA.md) === claCanonicalHash()` (si `migracion-fusion.test.ts` ya
  lo cubre, no se duplica) y `git diff --exit-code wp31-base -- CLA.md apps/web/CLA.md LICENSE` sale con 0.
- [ ] E2-6 `packages/scripts/smoke-wp31.sh <base-url>` existe, no contiene secretos y hace: rutas en 200 / 308 / 401
  (lista "Smoke" de §9), grep de la estructura societaria = 0 en las rutas públicas, hash del CLA en `/api/cla` y enlace
  `stellar.expert/explorer/testnet/tx/<64 hex>` en `/`; acepta `SIN_CRON=1` y `SIN_COMUNIDAD=1` para omitir lo que no
  salió a la hora de corte. *(contenido-publico.test.ts, estático)*

### WP31-C1
- [ ] C1-1 `planificarRecordatorios`: tabla de §5.C.1 con reloj y configuración fijos; Low no genera nada; solo
  Urgent es inmediato (un escalamiento de High sale no inmediato). *(recordatorios.test.ts)*
- [ ] C1-2 Dos corridas con el mismo `ahora` → la segunda crea 0 avisos y envía 0 mensajes. *(recordatorios-db.test.ts)*
- [ ] C1-3 Tres items de resumen para la misma persona → 1 mensaje; dos P1 de la misma persona en una corrida → 1
  mensaje agrupado; cinco P1 → 3 en el mensaje inmediato y 2 al resumen; segundo resumen el mismo día → no.
  *(recordatorios-db.test.ts, transporte doble)*
- [ ] C1-4 Fuera de horario hábil → no escribe ni envía. Flag apagada → no escribe ni envía. *(recordatorios-db.test.ts)*
- [ ] C1-5 Sin transporte (sin token) → crea avisos in-app y 0 envíos, sin error. *(recordatorios-db.test.ts)*
- [ ] C1-6 Destinatarios: escalamientos a quien estructura y nunca al dueño (ni a sus identidades);
  `revision_pendiente` incluye a quien revisa; si queda vacío → supervisores globales → founder; nunca un
  `pending:` sin vincular (salvo el principal del founder), una cuenta demo ni una inactiva; un contributor solo
  recibe avisos de sus piezas. *(recordatorios-db.test.ts)*
- [ ] C1-7 Ningún texto generado casa con `VOCABULARIO_PROHIBIDO` ni contiene el nombre del responsable; todos
  contienen «título». *(recordatorios.test.ts)*
- [ ] C1-8 `autorizarCron`: sin secreto → `sin_configurar` (ruta 503); distinto o de otro largo → `rechazado`
  (401); igual → `ok`. `cronSecret()` con menos de 32 caracteres → null. *(recordatorios-db.test.ts)*
- [ ] C1-9 `.github/workflows/recordatorios.yml`: tiene `schedule`, `workflow_dispatch` y `concurrency`; usa
  `secrets.CRON_SECRET` y `x-cron-secret`; no hace `echo` del secreto; no usa `--retry`; comprueba `http_code` = 200.
  La ruta exporta `dynamic = "force-dynamic"` y `maxDuration` y solo `POST`. *(recordatorios-db.test.ts, estático)*
- [ ] C1-10 `avisosDe`/`marcarLeidos` solo sobre los propios (todas sus identidades); el esquema de `avisos` no
  tiene columnas de fecha de lectura. *(avisos.test.ts)*
- [ ] C1-11 Guarda de arranque: 20 piezas vencidas antes de la activación → 0 inmediatos, 0 escalamientos y 1
  resumen por dueño. *(recordatorios-db.test.ts)*
- [ ] C1-12 Concurrencia y reintento: dos `correrRecordatorios` a la vez con un transporte lento → 1 mensaje y la
  segunda devuelve `en_curso`; un transporte que falla una vez → el mensaje sale en la corrida siguiente. *(recordatorios-db.test.ts)*
- [ ] C1-13 `simular` → conteos por tipo sin escribir (huella de `avisos` y `reminders_sent` igual). *(recordatorios-db.test.ts)*

### WP31-C2
- [ ] C2-1 Cualquier `equipoActor` emite su código; solo el founder queda con `is_authorized=1`. *(bot-store.test.ts)*
- [ ] C2-2 `founderTeamWallet` = `principalFounder` y `walletDeRoster` respetan `roster_links`. *(bot-store.test.ts, bot-tools.test.ts)*
- [ ] C2-3 `handleUpdate` con `claude: null`: `/start CODIGO` vincula, `/pendientes` responde, texto libre →
  `soloComandos` sin llamar al modelo. *(bot-agent.test.ts)*
- [ ] C2-4 `publicarEnAgora`: permisos; solo `Backlog` sin dueño; criterio público obligatorio; hitos por defecto del
  genoma; hitos 4..10 que suman 100 y cada uno ≤ 25; montos que suman el presupuesto; `published_as_project_id`
  relleno; segunda vez → 409; evento `publicar`. *(agora-publicar.test.ts)*
- [ ] C2-4b Publicar no escribe en `projects` las `notes`, la descripción interna ni el nombre de la iniciativa
  si no se dejaron tal cual en el formulario; `campaign` = `campana`. *(agora-publicar.test.ts)*
- [ ] C2-5 Un contributor vinculado (y un core sin supervisión) que pide por texto libre o por alcance `carga`,
  `bloqueos`, `esperando_a_mi`, `iniciativas`, `epoca`, `ritos` o `digest` recibe solo lo suyo o
  `soloComandosLectura`, y el modelo **no se invoca** aunque haya API key (doble de Claude con contador = 0);
  `/focos` no incluye la bandeja del founder. *(bot-agent.test.ts, bot-tools.test.ts)*

### WP31-D
- [ ] D1 `proximasOcurrencias`: sync lunes 09:00, demo quincenal desde el ancla, retro primer lunes 10:00, en
  orden y en la zona del genoma; con `audiencia:'comunidad'` no aparece el sync. *(ritos-labels.test.ts)*
- [ ] D2 Código de 6 dígitos determinista; acepta bucket actual y anterior; rechaza dos atrás y el de otra sesión;
  `ritesSecret` lanza en producción sin `RITES_SECRET` ni `SESSION_SECRET`. *(ritos-codigo.test.ts)*
- [ ] D3 `registrarAsistencia`: solo con sesión `Open` y dentro de la ventana; una fila por persona (también con
  dos identidades); `+2` comunidad una sola vez con `period_id` explícito; rechaza demo, `pending:`, sin CLA y, en
  el sync, a quien no tiene `equipoActor`. *(ritos.test.ts)*
- [ ] D4 `cerrarRito`: hash determinista; `anchor_queue(kind='rite')`; decisión "Rito …"; reputación de anfitrión
  y relator una vez; no se cierra dos veces. *(ritos.test.ts)*
- [ ] D5 Permisos de preparar/abrir/cerrar/código; `abrirRito` fuera de ventana → 409; `prepararRito` con el mismo
  instante en dos formatos → 409 (normalizado). *(ritos.test.ts)*
- [ ] D5b Tras cerrar la época N, registrar asistencia y cerrar un rito no cambia `merkleRoot(hojasDeEpoca(N))`. *(ritos.test.ts)*
- [ ] D6 `ritosPublicos`, `detalleRito` y `sesionesGestionables` no devuelven wallets ni nombres; `join_url` solo
  con sesión. *(ritos.test.ts)*
- [ ] D7 Con ≥ 1 rito cerrado en la época, `computeAndStoreEpochFitness` trae `participation.value !== null` y ≤ 1. *(epochs.test.ts)*
- [ ] D8 Estático: `admin/page.tsx` importa `EpocaPanel` y `RitosAdminPanel`; `app/api/admin/epoca/route.ts` llama a
  `adminActor(`; `ritos-labels.ts` no importa `crypto`, `db` ni `node:`; `/api/ritos/codigo` pone
  `Cache-Control: no-store`. *(ritos.test.ts)*
- [ ] D9 `decisionesPublicas`: orden descendente, sin actas "Rito …" ni la decisión reemplazada. *(ritos.test.ts)*

### WP31-I (I1 gancho: I1, I2, I3, I7, I8, I9 · I2 UI: I4, I5, I6)
- [ ] I1 Aprobar emite puntos y reputación en la misma transacción; si la aprobación se rechaza, el dueño no recibe
  nada; si la emisión falla (base), la aprobación se revierte. *(team-puntos.test.ts)*
- [ ] I2 Bono (literal): `due_date` mañana, aprobada mañana → con bono; entregada hoy y aprobada pasado mañana →
  sin bono y sin descuento. *(team-puntos.test.ts)*
- [ ] I3 Sin tamaño → premio S; la suite previa (dashboard, digest, bot) sigue verde. *(team-puntos.test.ts + suite)*
- [ ] I4 `plazosDelEquipo` (dashboard) separa vencidas y por vencer. *(dashboard.test.ts)*
- [ ] I5 Estático: `/equipo/hoy`, `/equipo/proyectos/[slug]` y `/equipo/dashboard` usan `SlaBadge`; `/equipo/hoy`
  y `/perfil` usan `Insignias`; ninguno contiene "ranking" ni "posición"; `/perfil` usa `txVerificable`. *(equipo-ui.test.ts)*
- [ ] I6 `menuPara` con `accesoEquipo` real: un contributor miembro ve "Mi día". *(menu.test.ts)*
- [ ] I7 `flujo-freelancer.test.ts` (base en memoria, de punta a punta): alta con invitación y CLA → `agregarMiembro`
  (`ejecuta`, externo) → `equipoActor` = `'proyectos'` y `proyectosVisibles` = [su proyecto] → toma una pieza sin
  dueño → empezar → enviar a revisión → un `revisa` (otra persona, sin relación de invitación) aprueba → filas en
  `points_ledger` y `reputation_events` con `ref='assignment:<id>'` y la época actual → `puedeVerProyecto` de otro
  proyecto = false.
- [ ] I8 Una pieza con `published_as_project_id` aprobada → `publicada_en_agora`, sin filas de la tarea en los ledgers. *(team-puntos.test.ts)*
- [ ] I9 Tras el gancho, el CLI de A2-5 sigue cargando `team-import.ts`.

### Despliegue (líder)
- [ ] DEP-1 `bash packages/scripts/smoke-wp31.sh https://www.zelena.tech` en verde.
- [ ] DEP-2 Corrida de simulación (`?simular=1`) con conteos razonables antes de encender la flag (anotada en el resumen).
- [ ] DEP-3 Una corrida manual del workflow (`gh workflow run recordatorios.yml`) devolvió HTTP 200 y `enabled: true`.
- [ ] DEP-4 En la copia de ensayo, el quiz de S1 tenía exactamente 5 filas; tras arrancar, conteos de `users`,
  `cla_signatures`, `points_ledger`, `reputation_events`, `projects`, `milestones` y `anchor_queue` sin cambios
  (salvo las filas nuevas esperadas).

## 12. SIGUIENTES PASOS (fuera de esta noche) Y DECISIONES PARA EL FOUNDER

**Siguientes pasos**: ZGOLD (presupuesto con tope y muro de honor) · tarjeta de cumplimiento del contrato · reparto
por rol con splits congelados en el intake · escrow Modo B real en testnet · disputas por hito · célula dedicada ·
ficha de servicio del cliente con SLA contractual (sustituye al SLA por defecto) · EN/ES · botones de Telegram con
"Pedir nueva fecha" aprobada por el supervisor · digest semanal de P4 · festivos · capas 2 y 3 de asistencia ·
WIP personal como gen · UI para mutar claves no numéricas · baja y reasignación masiva (WP34) · misiones (WP27)
· vista pública del genoma · anclaje programado (cuando el founder lo apruebe) · `TEAM_BUDGET` separado del de
hitos del Ágora · cierre automático de ritos vencidos (desde el cron) · persistir el consentimiento de los
formularios · `today()` de `team.ts` en la zona del genoma · reiniciar la guarda de arranque de los recordatorios
si la flag se apaga mucho tiempo.

**Decisiones tomadas en nombre del founder que conviene que revise al despertar**:
1. **Vincular su principal de equipo** (`pending:<slug>`) con la cuenta con la que entra a la web, desde
   `/equipo/talento` (simular → confirmar). Es su primer paso: une sus avisos, su Telegram y su historial.
   Mientras tanto `identidadesDe` ya trata las dos filas como una sola persona.
2. **Bono de puntualidad**: esta noche se mide **al aprobar** (literal del líder). Alternativa propuesta: medirlo
   **al entregar**, para que la demora de revisión no le quite el extra a quien entregó (requiere la regla de "nada
   se replanifica en revisión", que ya está).
3. **W-R2** (whitepaper): "el vesting solo define cuándo se puede usar lo ganado, nunca si se conserva" cambia la
   semántica del vesting.
4. **S2**: se conservó la decisión histórica con su huella y se añadió la nueva (opción a). La opción b (reescribir
   y registrar el hash anterior) queda a su criterio.
5. **Licencia**: el whitepaper dice "open source", el README "propietario" y §9.2 "source-available"; hay que elegir
   una. `LICENSE` no se tocó.
6. **Fichas del Ágora**: los 5 proyectos sembrados publican nombres de ventures, presupuesto y su modelo de
   cobranza. Anonimizar (p. ej. "Fintech de crédito de celulares") o mantener. Esta noche la landing no lista
   proyectos.
7. **Datos legales de `/privacidad`**: `ZELENA_LEGAL_NAME` y `ZELENA_PRIVACY_EMAIL` (no van al repo).
8. **Recordatorios encendidos** en producción (`SLA_REMINDERS_ENABLED=1`) tras la simulación; la regla "sin
   notificaciones en v1" de `CLAUDE.md` queda como excepción registrada.
9. **Excepción de vinculación**: si su cuenta de sesión es la fila sembrada como demo con rol founder, la
   vinculación la acepta y la deja como cuenta real (`is_demo=0`).

## 13. ANEXO — textos de reemplazo

Se indica dónde va cada texto (archivo y sección), no el texto viejo. Los reemplazos son literales.

**UI (WP31-E1)**

| # | Dónde | Texto nuevo |
|---|---|---|
| U1 | `app/agora/page.tsx`, filtros | Todos · Clientes · Comunidad (query `?tipo=cliente\|comunidad`; se acepta el `?type=` heredado) |
| U2 | `app/agora/page.tsx`, descripción | Cada proyecto dice si es para un cliente o para la comunidad, con sus hitos, sus pagos y cómo se va a evaluar la entrega. Aplica con tu enfoque y tu historial. |
| U3 | `src/components/ui.tsx#Tag` | muestra `TIPO_PROYECTO_LABEL[type]` (las clases CSS no cambian) |
| U4 | `app/agora/[id]/page.tsx`, ficha | "Para quién" + etiqueta |
| U5 | `app/entrar/page.tsx`, paso de firma | Tu autoría es tuya para siempre. Al firmar cedes a Zelena los derechos patrimoniales de lo que aportes, para que pueda llegar a clientes. Firmar no te convierte en empleado ni en socio. Guardamos la huella del acuerdo en la red de pruebas de Stellar. |
| U6 | `Footer.tsx` | `AVISO_LEGAL` |
| U7 | `app/layout.tsx`, metadata | título "Zelena — Lo que entregas decide lo que recibes", plantilla "%s · Zelena", `siteName`/`applicationName` "Zelena", descripción "Una comunidad donde lo que entregas decide lo que recibes: reglas públicas, pago por hitos y un historial que es tuyo. En la red de pruebas de Stellar.", `SITE_URL` por defecto `https://www.zelena.tech` |
| U8 | `app/agora/[id]/page.tsx`, proyecto cerrado | Este proyecto ya no recibe aplicaciones ({ESTADO_PROYECTO_LABEL[state]}). |
| U9 | `app/agora/page.tsx`, vacío y textos | "proyecto" en lugar de "bounty" en todo el Ágora · vacío: "No hay proyectos con este filtro. Vuelve pronto: se abren nuevos cada temporada." |
| U10 | `app/entrar/page.tsx`, cabecera | Tres pasos: tu invitación, tu cuenta y tu firma. *(con `IntroEcosistema` en modo `compacta`; SHA-256 y Freighter solo tras "ver detalle")* |
| U11 | Ágora (lista y ficha), junto a cada monto | Red de pruebas |
| U12 | `app/gobernanza/page.tsx`, cabecera | H1 **Decisiones** · "Cada decisión se registra aquí con su razón y su huella, para que cualquiera pueda revisarla." · la sección de funciones latentes pasa a "Lo que aprendimos de cada regla" · "hash:" → "huella:" |
| U13 | `app/academia/page.tsx`, cabecera y vacío | "Se premia aprender, no acumular sin aprender." · vacío: "La Academia se está preparando. Mientras tanto, explora el Ágora y toma tu primer proyecto: tu reputación puede empezar hoy." |

**Whitepaper `docs/whitepaper.md` (WP31-E2)**

| # | Dónde | Texto nuevo |
|---|---|---|
| W1 | aviso inicial (primera frase) | Este documento describe cómo funciona la comunidad Zelena. *(el resto del aviso se conserva)* |
| W2 | §1, si aparece la frase de "firma de gestión de activos" | se sustituye por el párrafo de posicionamiento actual de §1 |
| W3 | §1, párrafo de la estructura | Zelena se hace cargo de lo que exige una contraparte formal (contratos, clientes y responsabilidad por lo que se entrega) para que quien contribuye pueda construir sin cargar con ese peso (§4.2). |
| W4 | título de §4 | ## 4. La comunidad: tesis y reglas de juego |
| W5 | título y primer párrafo de §4.2 | ### 4.2 Quién carga con qué — Alguien tiene que firmar contratos, responder ante un cliente y asumir lo que se entrega. Si eso recayera sobre cada persona, entrar a construir costaría demasiado. Zelena carga con ese peso para que la comunidad pueda concentrarse en el trabajo. *(sin la referencia al modelo de inspiración)* |
| W6 | tabla de §4.2 | dos filas: **Zelena** · Contraparte formal · Contratos con clientes, marca y responsabilidad por lo entregado — **La comunidad** · Red de contribuidores · Coordinar el trabajo, evaluar entregas, reputación y gobernanza. Se elimina la fila del conector. |
| W7 | cierre de §4.2 | Así, quien contribuye no asume riesgos frente a clientes ni obligaciones de socio. Firmar el acuerdo de contribución o recibir reputación o ZWORK **no te convierte en empleado ni en socio**, y nada de eso es salario. |
| W8 | tabla de pasos, fila 01 | …Aquí se define si el proyecto es para un cliente o para la comunidad. |
| W9 | tabla de activos, fila USDC | Pago por el trabajo (proyectos de clientes) |
| W10 | tabla de activos, fila ZWORK | …Derecho a participar de la regalía que recibe el fondo común cuando se comercializa código de la comunidad. |
| W11 + W-R1 | §7.1, párrafo de demanda estructural | Cuando Zelena comercializa código del repositorio de la comunidad, paga una **regalía al fondo común** bajo la licencia dual (ver sección 9). Esa regalía puede distribuirse pro-rata a quienes tengan vesting cumplido. Fuentes de demanda estructural, sin especulación: (a) participación en esa regalía; (b) lo que la gobernanza decida destinar del fondo común; (c) un umbral de **reputación** para publicar propuestas, en lugar de fianzas que se pierden. |
| W12 | frase "si la empresa comercializa ese código" | Y si Zelena comercializa ese código… |
| W13 | §9, destino de la PI | **Cliente** → repositorio **privado**, según lo acordado con cada cliente. / **Comunidad** → repositorio **público**, custodiado por Zelena en nombre de la comunidad. |
| W14 | §9, licencia dual | …si Zelena lo comercializa, paga una regalía al fondo común. |
| W15 | §9, onboarding | …se ceden a Zelena los derechos patrimoniales… |
| W16 | §10, workstream legal | legal y PI en paralelo (marca, acuerdo de contribución publicado, cesiones del equipo actual) |
| W17 | aviso final | se conserva; si nombra la estructura, pasa a "…ni te convierten en empleado ni en socio". |
| W-R2 | §7.1, frase sobre abandonar a mitad de vesting | El vesting solo define **cuándo** se puede usar lo ganado, nunca si se conserva. Si te alejas, lo consolidado sigue siendo tuyo y el resto se retoma cuando vuelves. |
| W-R3 | §8, frase sobre quien infla evaluaciones | Inflar no paga: la revisión cruzada corrige las evaluaciones infladas, y eso pesa en la próxima asignación de supervisión. |
| S3 | §5/§6, "score compuesto por contribuidor" | un score compuesto **por entrega** |

Cualquier otra mención que el test E2-1 encuentre se reescribe con el mismo criterio ("Zelena", "la
comunidad", "el fondo común").

**Repo público (WP31-E2)**: `README.md` — la descripción de la arquitectura queda "**Zelena**: marca, clientes y
responsabilidad frente a ellos. **La comunidad**: reputación y ZWORK. Detalle en `docs/architecture.md`."; la
cesión del CLA dice "…a Zelena (ver `CLA.md`)."; se retira el bloque de la demo de cohorte con la URL antigua.
`CONTRIBUTING.md`: "…cedes a Zelena los…". `CODEOWNERS`: "(Founder)". `LICENSE` y `CLA.md` no se tocan.
- **S1 · Academia**
  - Título: **Construir sin cargar con el riesgo**
  - Resumen: Quién responde ante los clientes, qué es tuyo para siempre y por qué firmar no te convierte en empleado.
  - Cuerpo (5 puntos): (1) Zelena firma con los clientes y responde por lo que se entrega. (2) La comunidad
    coordina el trabajo, evalúa entregas y guarda la reputación. (3) Tu autoría es tuya; tu historial es
    verificable y lo ganado no se quita. (4) Firmar el acuerdo de contribución no crea relación laboral ni te
    convierte en socio, y nada de lo que recibes es salario. (5) La autonomía de la comunidad se gana por etapas.
  - Quiz (5, en este orden; índice correcto entre paréntesis):
    1. ¿Quién responde ante el cliente por lo que se entrega? — [La comunidad, **Zelena**, Cada contribuidor, El cliente] (1)
    2. ¿Firmar el acuerdo de contribución crea una relación laboral? — [Sí, **No**, Solo si cobras, Solo para el equipo] (1)
    3. ¿Qué se evalúa? — [La persona, **La entrega**, Las horas, La antigüedad] (1)
    4. ¿Se puede perder lo que ya ganaste? — [Sí, si faltas a un rito, Sí, al irte, **No**, Solo al cambiar de época] (2)
    5. La autonomía de la comunidad es… — [Inmediata, **La recompensa de la madurez**, Decisión de un cliente, Un token] (1)
- **S2 · Decisión**: título y razón en §5.E.
- **Seed nuevo** (base vacía): la decisión de apertura dice "…las dos primeras campañas (5 proyectos)
  etiquetadas como proyectos de cliente…"; la del reparto dice "…el fondo común recibe 30 % de cada proyecto."

## 14. PAQUETES DE TRABAJO Y PROPIEDAD DE ARCHIVOS

Cada paquete trabaja en su worktree y **solo toca sus archivos**. Si necesita algo de un archivo ajeno, lo deja
escrito en la descripción del PR y lo integra el líder. Nadie toca `package.json`, `package-lock.json`, `db.ts`,
`team-state-machine.ts`, `middleware.ts`, `schema.sql` (lo edita solo el líder en el paso 0), `CLA.md`,
`apps/web/CLA.md`, `LICENSE`, `docs/specs/QUEUE.md` ni `CLAUDE.md` (estos dos los actualiza el líder al final).

Los paquetes no esperan a una "oleada": arrancan cuando lo que consumen está fusionado (calendario, cortes y hora
de corte en el plan). Quien empieza antes de que se fusione algo que consume escribe contra la firma de §5 y hace
`git merge feat/v1-unificada` en su rama apenas el líder etiqueta ese corte.

| Paquete | Arranca con | Archivos propios (crear ✚ / modificar ✎) |
|---|---|---|
| **Líder · paso 0** | — | ✎ `schema.sql` (bloques de §3.2 y §3.3, literales, y los comentarios con ventures o estructura societaria) · ✎ `vitest.config.ts` (`TZ=UTC`) · ✎ `src/data/pruebas-testnet.json` antes de desplegar · pipeline F |
| **WP31-B** Genoma, base, SLA, gamificación y épocas (3 cortes) | `wp31-base` | **1a** ✎ `genome.ts` (+test) · ✚ `zona-horaria.ts`, `identidades.ts` (+tests) · ✎ `sim.ts`, `sim.test.ts`, `mutation.ts`, `mutation.test.ts` (tipos, `pendingMutation`, `revertToVersion`) · ✎ `migracion-fusion.test.ts` (huella como prefijo) · ✎ `seed.ts`: **solo** añadir `seedGenomeV2` al import de `./genome` y la línea `try { seedGenomeV2(db); } catch (e) { console.error("[seed] genoma v2", e); }` justo después de `txTeam();` · **1b** ✚ `sla.ts`, `sla-db.ts` (+tests) · **2** ✚ `gamificacion.ts`, `epocas.ts` (+tests) · ✎ `admin.ts`, `academia.ts` (tope; +tests) · ✎ `app/api/governance/vote/route.ts` (solo `period_id`) |
| **WP31-A** Proyectos, permisos y tablero (2 cortes: **1** lógica, puertas, rutas y tests; **2** UI) | `wp31-base` (+ `wp31-b1a` para `identidades`/`zona-horaria`) | ✎ `roles.ts` · ✎ `authz.ts` · ✎ `team.ts` (todo **salvo** el cuerpo de `seedTeamRoster`) · tests de esos módulos · ✚ `team-proyectos.test.ts` · ✎ `app/equipo/layout.tsx`, `hoy/page.tsx`, `proyectos/page.tsx`, `dashboard/page.tsx` (**solo** la puerta) · ✚ `app/equipo/proyectos/[slug]/page.tsx` · ✎ `app/api/equipo/{crear,asignacion,checkin,digest}/route.ts` · ✚ `app/api/equipo/{proyectos,miembros}/route.ts` · ✎ `TeamNewAssignment.tsx` · ✚ `Team{Board,EditAssignment,ProjectForm,MembersPanel}.tsx`. Puede ajustar `bot-tools.test.ts`, `dashboard.test.ts` y `digest.test.ts` **solo** donde un test se autoaprueba. |
| **WP31-A2** Directorio, vinculación e importador | `wp31-base` (+ `wp31-b1a`) | ✚ `talento.ts`, `team-talento.test.ts` · ✎ `team.ts` **solo el cuerpo de `seedTeamRoster`** · ✎ `team-import.ts` (+test) · ✚ `app/equipo/talento/page.tsx` · ✚ `app/api/equipo/{talento,importar}/route.ts` · ✚ `Team{TalentRow,ImportCsv}.tsx` · el formulario de importación vive en `/equipo/talento#importar`; `/equipo/proyectos` (A) solo lo enlaza ("Importar CSV"), para no compartir la página |
| **WP31-E1** Sitio público | `wp31-base` | ✎ `app/page.tsx`, `app/layout.tsx`, `app/agora/page.tsx`, `app/agora/[id]/page.tsx`, `app/entrar/page.tsx` (solo textos, cabecera, intro `compacta` y enlace a `/privacidad`), `app/empresas/page.tsx`, `app/gobernanza/page.tsx` (cabecera, sección renombrada, "Reemplazada por", "huella", sin actas "Rito …"), `app/academia/page.tsx` (solo copy), `app/manifiesto/page.tsx` (solo el comentario), y el **copy visible** de cualquier otra página pública que recorran E1-1/E1-11 (sin lógica; salvo `/comunidad` y `/perfil`), `next.config.mjs` (**solo** `redirects()` tras `headers()`) · ✚ `app/metodo`, `app/privacidad`, `app/acuerdo` · ✖ `app/ecosistema/page.tsx` · ✎ `Nav.tsx`, `NavContextual.tsx`, `Footer.tsx`, `MutationBanner.tsx`, `IntroEcosistema.tsx`, `PruebaEnVivo.tsx`, `ui.tsx` (solo `Tag` y `StateBadge`), `ContactoForm.tsx`, `AvisoEncuentrosForm.tsx` · ✚ `PruebaTestnet.tsx`, `ProximoEncuentro.tsx` · ✚ `src/lib/{menu,agora-labels,metodo,legal,pruebas-testnet,prueba-en-vivo}.ts` (+tests), `src/data/pruebas-testnet.json` (vacío), `sitio-publico.test.ts` |
| **WP31-E2** Contenido público y repo | `wp31-base` | ✎ `docs/whitepaper.md`, `README.md`, `CONTRIBUTING.md`, `CODEOWNERS`, `docs/specs/{WP06,WP10,WP19,WP21,WP23}*.md`, `docs/blueprints/{01,02,04,07}*.md` · ✎ `seed.ts`: contenido de `seed()`/`seedAcademia` (S1, S2, S3, S4), un import nuevo **después** de `import { createCohortInvite } from "./invites";` y la línea `try { aplicarContenidoPublico(db); } catch (e) { console.error("[seed] contenido público", e); }` **después** de `seedCohortInvite(db, env);` · ✚ `contenido-publico.ts` (+test) · ✚ `packages/scripts/smoke-wp31.sh` |
| **WP31-D** Ritos, `/comunidad` y épocas en admin (2 cortes) | `wp31-b1a` (+ A corte 1 para la regla del sync y la puerta; + E1 y `wp31-b2` para el corte 2) | **1** ✚ `ritos-labels.ts`, `ritos-codigo.ts`, `ritos.ts` (+tests) · ✚ `app/comunidad/page.tsx` (la crea D; E1 no) · ✚ `app/comunidad/ritos/[id]/page.tsx` · ✚ `app/api/ritos/{route,codigo/route,asistir/route}.ts` · ✚ `RitoCodigo.tsx` (cliente, refresca cada 15 s), `RitoAsistenciaForm.tsx` · ✎ `src/lib/epochs.ts` + `epochs.test.ts` (solo `gatherEpochData`) · **2** ✎ `app/admin/page.tsx` (**solo** dos `<section>` nuevas "Épocas" y "Ritos" antes de "Motor de épocas · Fitness", y sus imports) · ✚ `app/api/admin/epoca/route.ts` · ✚ `RitosAdminPanel.tsx`, `EpocaPanel.tsx` · ✎ `ProximoEncuentro.tsx` (añade la próxima demo o retro) |
| **WP31-C1** Recordatorios y avisos | `wp31-b1b` (+ A corte 1 para `supervisoresDeProyecto` y `equipoActor`; hasta entonces, firma de §5 con un sustituto local) | ✚ `recordatorios.ts`, `recordatorios-db.ts`, `avisos.ts` (+tests) · ✎ `config.ts` (**al final**: `isSlaRemindersEnabled`, `cronSecret`, `appBaseUrl`) · ✚ `app/api/cron/recordatorios/route.ts`, `app/api/avisos/route.ts`, `app/equipo/avisos/page.tsx`, `AvisosLista.tsx` · ✚ `.github/workflows/recordatorios.yml` |
| **WP31-C2** Puente al Ágora y Telegram para el equipo | A corte 1 + A2 + E1 | ✚ `agora-publicar.ts` (+test), `app/api/equipo/publicar/route.ts`, `app/equipo/publicar/[id]/page.tsx`, `PublicarAgoraForm.tsx` · ✎ `bot-store.ts`, `bot-agent.ts`, `bot-tools.ts`, `telegram.ts` (+tests) · ✎ `app/api/telegram/{webhook,vincular}/route.ts`, `BotLinkPanel.tsx` (props compatibles con `/admin`) · ✎ `config.ts` (**solo** el bloque `telegramMissingVars`/`telegramStatus`) · ✚ `app/equipo/telegram/page.tsx` |
| **WP31-I1** Gancho de emisión | A (corte 1) + `wp31-b2` | ✎ `team.ts` (**solo** el gancho de §5.B.3 y sus imports con `.ts`) · ✚ `team-puntos.test.ts`, `flujo-freelancer.test.ts` |
| **WP31-I2** Semáforos, progreso y menú | A (corte 2) + `wp31-b1b` (+ `wp31-b2` para Insignias) | ✎ `dashboard.ts` (`plazosDelEquipo`; +test) · ✎ `app/equipo/hoy/page.tsx`, `app/equipo/proyectos/page.tsx`, `app/equipo/proyectos/[slug]/page.tsx` (badges, enlace "Publicar en el Ágora" a `/equipo/publicar/<id>` solo F S y si está en Backlog sin publicar), `app/equipo/dashboard/page.tsx` (semáforos), `app/perfil/page.tsx` (Insignias, `txVerificable`, copy "proyecto" en lugar de "bounty", vacío del contributor sin proyectos) · ✚ `SlaBadge.tsx`, `Insignias.tsx`, `equipo-ui.test.ts` · ✎ `Nav.tsx` (`accesoEquipo`), `src/lib/menu.ts` (enlace "Avisos" a `/equipo/avisos`) |

Interfaces entre paquetes: las firmas de §5 son el contrato. Nadie importa de un paquete que no esté ya fusionado
o anunciado como corte en el plan; los enlaces de I a rutas de C1/C2 son solo `href`.

---

OWNER — Paquetes WP31-B, -A, -A2, -E1, -E2, -D, -C1, -C2, -I1 e -I2; calendario, cortes, merge y despliegue en el plan
de la noche. HUMANO (founder, al despertar): revisar §12 (vincular su principal de equipo primero; bono al aprobar
o al entregar; W-R2; S2; licencia; fichas del Ágora; datos legales de `/privacidad`; recordatorios encendidos).
TAMAÑO — XL repartido en 10 paquetes de S–L, con 5 agentes a la vez como máximo. Depende: fusión v1 (`afe3856`) y su ajuste de despliegue.
