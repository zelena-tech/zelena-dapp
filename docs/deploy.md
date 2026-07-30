# Deploy — Zelena Dapp v0.1

> **Estado del motor de datos (decisión de John, WP16):** producción v1 = **Azure SQL
> Database** con el driver `mssql`. **Desarrollo local sigue con SQLite** (rápido, sin
> costo, sin red). El driver libSQL/Turso de WP03 se conserva para archivo local en
> dev/CI pero **no se usa en producción**; WP05 (Vercel/Turso) queda *superseded* por
> WP16. Ver la sección **Azure** más abajo.

## Correr local (dev)

```bash
# Desde la raíz del monorepo (zelena-dapp/)
npm install
cp apps/web/.env.example apps/web/.env.local   # ajusta SESSION_SECRET
npm run dev                                     # http://localhost:3000
```

La base SQLite se crea, migra y siembra sola en el primer arranque
(`apps/web/data/zelena.db`, gitignored). Códigos de invitación seed: `GENESIS-0001` …
`GENESIS-0006`. La wallet founder por defecto (acceso a `/admin`) está en `.env.example`;
para entrar como founder, cambia `FOUNDER_WALLET` a la public key de tu wallet de prueba
tras onboardearte, o usa el valor por defecto del seed.

## Build de producción

```bash
npm run build          # desde la raíz (compila apps/web)
npm run lint           # lint estricto
npm test               # tests unitarios (vitest) — desde apps/web o: npm --workspace apps/web test
npx --workspace apps/web next start   # sirve el build en :3000
```

## Correr el anchor-worker (en tu máquina)

El sandbox de desarrollo NO alcanza la red Stellar, por eso el anclaje es una **cola**.
El worker corre localmente y ancla los hashes pendientes:

```bash
# La cuenta de servicio se genera y se fondea con friendbot en el primer arranque,
# o exporta la tuya:
export SERVICE_ACCOUNT_SECRET=S....         # opcional (testnet)
node packages/scripts/anchor-worker.mjs      # una pasada
node packages/scripts/anchor-worker.mjs --watch   # en bucle cada 15s
```

Cada firma de CLA encolada se ancla con `manageData` en testnet; el `txId` queda visible en
el perfil con link a stellar.expert. El secreto de la cuenta de servicio nunca va al repo
(se guarda en `packages/scripts/.service-account.secret`, gitignored, o en tu env).

## Desplegar a Vercel (1 comando)

```bash
# Desde apps/web (o configurando el root directory a apps/web en el dashboard):
npx vercel --prod
```

**IMPORTANTE — persistencia de datos en Vercel:** `better-sqlite3`/`node:sqlite` escriben en el
sistema de archivos local, que en Vercel es **efímero y no persiste** entre invocaciones. La capa
de datos (`apps/web/src/lib/db.ts`) ya soporta **libSQL/Turso** como driver, seleccionado por
variable de entorno — sin cambiar código (WP03).

### Swap a Turso/libSQL (ya implementado)

El driver usa el paquete **`libsql`** (síncrono, compatible con la interfaz de `db.ts`; NO
`@libsql/client`, que es asíncrono e incompatible con la capa síncrona actual). Se activa solo
con configurar la env var:

```bash
# Turso remoto (producción):
TURSO_DATABASE_URL=libsql://<tu-db>.turso.io
TURSO_AUTH_TOKEN=<token de Turso>       # (o DATABASE_AUTH_TOKEN)

# Archivo libSQL local (dev/CI, sin cuenta Turso):
DATABASE_URL=file:./data/zelena.db
```

Reglas de selección en `getDb()`:
1. Si hay `TURSO_DATABASE_URL` o `DATABASE_URL` → driver **libSQL** (`libsql`), con `TURSO_AUTH_TOKEN`/`DATABASE_AUTH_TOKEN` si aplica.
2. Si no → `better-sqlite3` y, si no compila, `node:sqlite` (Node ≥22).

El mismo `schema.sql` y el mismo `seed.ts` corren en ambos (seed reproducible; ver
`db-libsql.test.ts`). Crear la cuenta y la DB en Turso y proveer las credenciales es tarea de
John (fuera del alcance de WP03).

### Pendiente para el deploy real (WP05)

- **Rate limiting (`lib/rate-limit.ts`) es en memoria por proceso.** En serverless multi-instancia
  NO es un control real (cada instancia tiene su contador; un cold start lo reinicia). Antes de
  exponer a la cohorte hay que moverlo a storage compartido (Redis/Upstash con `INCR`+`EXPIRE`, o
  el rate limiting nativo de la plataforma). Anotado como bloqueante de WP05, no de WP03.
- El worker de anclaje puede correr como cron job (Vercel Cron o una VM) apuntando a la misma base.

Variables de entorno de producción: `SESSION_SECRET`, `FOUNDER_WALLET`, `TURSO_DATABASE_URL` +
`TURSO_AUTH_TOKEN` (o `DATABASE_URL` local), `STELLAR_NETWORK=testnet`. El
`SERVICE_ACCOUNT_SECRET` vive solo donde corre el worker, jamás en el frontend.

---

# Azure (producción v1) — WP16

Coherente con el tenant de Microsoft (Entra ID, WP13) y con el FMS que ya corre ahí.
Todo lo de esta sección **excepto crear los recursos** está implementado y probado en
la suite; crear la suscripción/recursos y el smoke test son el paso 6 de `docs/DESPLIEGUE-V1.md`.

## Arquitectura de la capa de datos

`apps/web/src/lib/db.ts` sigue siendo la **única** puerta a la persistencia y sigue
siendo **síncrona**. Para Azure SQL se apilan dos piezas nuevas:

| Archivo | Qué hace |
|---|---|
| `src/lib/sql-dialect.ts` | Traductor **puro** SQLite → T-SQL (tipos, fechas, `LIMIT`, `RETURNING`, `ON CONFLICT`, JSON, `PRAGMA`). Traduce el `schema.sql` **que exista en tiempo de ejecución**: no hay un `.sql` paralelo que se desincronice. |
| `src/lib/db-sync-bridge.ts` + `src/lib/db-query.worker.mjs` | Puente **síncrono** sobre un backend asíncrono: el hilo principal bloquea con `Atomics.wait` sobre un `SharedArrayBuffer` mientras un `worker_thread` ejecuta la consulta. |
| `src/lib/db-mssql-backend.mjs` | Backend real: `mssql`/tedious contra Azure SQL. Corre **solo** dentro del worker. |
| `src/lib/db-mssql.ts` | Une las tres cosas y expone la interfaz `DB` de siempre. |
| `src/lib/db-fake-backend.mjs` | Backend asíncrono **falso** (SQLite por debajo) para testear el puente sin Azure. |

**Por qué un puente y no `async`:** `mssql` (tedious) es solo asíncrono y no existe
cliente síncrono de Azure SQL para Node. Volver asíncrona la capa de datos obligaría a
reescribir toda la lógica de negocio, que el spec de WP16 prohíbe tocar (es la misma
trampa que WP03 evitó descartando `@libsql/client`). Efecto lateral **deseado**: como el
hilo principal se bloquea, una transacción entera es un bloque síncrono → sigue siendo
atómica frente a otras peticiones, igual que con `better-sqlite3` hoy.

**Nunca degrada en silencio:** si hay configuración de Azure SQL y falta el paquete
`mssql`, falta el worker, o el arranque/consulta excede su timeout → **lanza**. Caer a
SQLite local en producción es el fallo exacto que esto existe para evitar.

## Selección de driver (`resolveDriver`)

1. `DATABASE_DRIVER` explícito (`mssql` | `libsql` | `sqlite`) manda.
2. Si hay `AZURE_SQL_SERVER` (o `AZURE_SQL_CONNECTION_STRING`) → **`mssql`**.
3. Si hay `TURSO_DATABASE_URL`/`DATABASE_URL` → `libsql`.
4. Si no → SQLite local. **En local no hace falta configurar nada.**

## Variables de entorno (App Settings o Key Vault — NUNCA en el repo ni en `.env*`)

| Variable | Obligatoria | Para qué |
|---|---|---|
| `AZURE_SQL_SERVER` | sí | `zelena-sql.database.windows.net`. Su presencia activa el driver. |
| `AZURE_SQL_DATABASE` | sí | nombre de la base (p. ej. `zelena`). |
| `AZURE_SQL_PORT` | no | por defecto `1433`. |
| `AZURE_SQL_CLIENT_ID` | no | *client id* de una managed identity **asignada por el usuario**. Si se omite, se usa la asignada por el sistema. |
| `AZURE_SQL_USER` / `AZURE_SQL_PASSWORD` | no | **fallback** si la managed identity complica. Los dos o ninguno. |
| `AZURE_SQL_CONNECTION_STRING` | no | alternativa a todo lo anterior. |
| `AZURE_SQL_ENCRYPT` | no | solo `false` para pruebas locales; Azure SQL exige TLS. |
| `DATABASE_DRIVER` | no | forzar driver (`sqlite` para depurar en producción con archivo local). |
| `SESSION_SECRET` | sí | firma de la cookie de sesión. La app no arranca sin él en producción. |
| `FOUNDER_WALLET` | sí | acceso a `/admin`. |
| `STELLAR_NETWORK` | sí | `testnet`. **Nunca** mainnet en v1. |
| `AZURE_AD_TENANT_ID` / `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` | WP13 | login Entra. |
| `SERVICE_ACCOUNT_SECRET` | worker | cuenta de **testnet** del anclaje. Vive SOLO donde corre el worker, jamás en el frontend. |
| `ZELENA_DB_WORKER` | no | ruta alternativa al worker del puente (por defecto `src/lib/db-query.worker.mjs`). |

**Cero secretos en la base de datos** (regla transversal): ninguna tabla guarda
contraseñas, tokens ni claves. El log de arranque imprime servidor/base/método de
autenticación, **nunca** la contraseña ni el token.

## Autenticación a la base: managed identity (recomendado)

1. App Service → *Identity* → System assigned → **On**.
2. En la base (conectado como administrador de Entra):
   ```sql
   CREATE USER [zelena-workspace] FROM EXTERNAL PROVIDER;  -- nombre del App Service
   ALTER ROLE db_datareader ADD MEMBER [zelena-workspace];
   ALTER ROLE db_datawriter ADD MEMBER [zelena-workspace];
   ALTER ROLE db_ddladmin  ADD MEMBER [zelena-workspace];   -- crea las tablas al arrancar
   ```
3. **No** configurar `AZURE_SQL_USER`/`AZURE_SQL_PASSWORD`: sin ellos el driver usa
   managed identity automáticamente.

El backend intenta primero `azure-active-directory-default` de tedious, que pide un
token **fresco a `@azure/identity` en cada conexión nueva** (los tokens de Entra viven
~1 h; así no hay problema de expiración). Si esa versión de tedious no lo soporta, cae a
pedir el token a mano con `DefaultAzureCredential`; ese camino de compatibilidad **no
renueva el token**, así que conexiones nuevas después de ~1 h fallarían — si aparece ese
síntoma, actualizar `mssql`/`tedious`.

`mssql` y `@azure/identity` están declarados como **`optionalDependencies`** de
`apps/web` (igual que `libsql` y `better-sqlite3`): no hacen falta en desarrollo local,
pero el App Service **sí** debe instalarlos.

> **Paso pendiente de una sola vez (antes del primer despliegue):** el `package-lock.json`
> de la raíz todavía no incluye `mssql` ni `@azure/identity` (WP16 no lo regeneró para no
> chocar con el trabajo en paralelo). Correr **una vez** desde la raíz del monorepo:
> ```bash
> npm install                 # resuelve las nuevas optionalDependencies y actualiza el lock
> git add package-lock.json   # el lock debe viajar al repo
> ```
> Sin eso, `npm ci` fallará por lockfile desincronizado y el driver de Azure SQL no
> cargará (y entonces **lanza**, como debe: no arranca contra SQLite local por error).

## Recursos y configuración de Azure

- **Resource group** `rg-zelena-workspace`.
- **App Service** Linux, **Node 20**, plan **B1** (el free tier duerme la app).
  Arranque: `npm --workspace apps/web run build && npx --workspace apps/web next start`.
  El árbol de `apps/web/src/lib` debe existir en el destino: en tiempo de ejecución se
  leen `schema.sql` y el worker `db-query.worker.mjs` desde `process.cwd()/src/lib`.
- **Azure SQL Database** tier **Basic** (o General Purpose Serverless con auto-pausa si
  se prefiere que duerma fuera de horario).
- **Red**: regla de firewall **"Allow Azure services"** o private endpoint.
  **Nunca abrir a 0.0.0.0.** El *outbound* del App Service alcanza la base sin abrir nada más.
- **Backups**: retención automática **≥ 7 días** (Basic trae 7 por defecto; confirmar en
  *Backups → Retention policies*). Nada de datos reales que perder aún, pero la política
  se activa antes del alta del equipo.
- **Worker de anclaje**: **WebJob** de App Service (triggered, cada 15 min) o container
  job, con la **cuenta de servicio de testnet**. **Jamás llaves de mainnet ahí.**

## Costos estimados (mensual, USD)

| Recurso | Estimado |
|---|---|
| App Service B1 | ~13 |
| **Azure SQL Basic** (5 DTU, 2 GB) | **~5** |
| Blob Storage (evidencia, WP19 fase B) | ~1 |
| Entra ID (incluido en M365) | 0 |
| Testnet Stellar | 0 |
| API de Claude para el bot (uso personal de John) | ~2–5 |
| **Total** | **~20–25** |

Cifras de referencia para presupuestar; confirmar en la calculadora de Azure con la
región y el tier exactos antes de crear los recursos. Azure SQL **Serverless con
auto-pausa** puede bajar más el costo si la app solo se usa en horario laboral.

## Límite conocido: rate limiting en memoria

`apps/web/src/lib/rate-limit.ts` cuenta **en memoria, por proceso**. Es un control real
**solo con UNA instancia** de App Service (el escenario de v1). Con más de una instancia
—o con *Always On* desactivado y reinicios frecuentes— cada instancia tiene su propio
contador y un reinicio lo pone a cero.

**Regla:** antes de escalar a >1 instancia (o de activar autoescalado), mover el contador
a almacenamiento compartido (Azure Cache for Redis con `INCR`+`EXPIRE`, o una tabla en
Azure SQL). Mientras v1 corra en una instancia, no hay que tocarlo. Anotado también en
`docs/DESPLIEGUE-V1.md` parte E.

## Diferencias de dialecto ya resueltas (`sql-dialect.ts`)

| SQLite | T-SQL |
|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `INT IDENTITY(1,1) PRIMARY KEY` |
| `TEXT` | `NVARCHAR(MAX)`, y `NVARCHAR(200)` si la columna es clave o va indexada |
| `REAL` | `FLOAT` (o `DECIMAL(18,6)` si se pide) |
| banderas 0/1 (`is_*`, `approved`, `enabled`, …) | `BIT` (el worker las devuelve como 0/1, así que la app no cambia) |
| `datetime('now')` · `CURRENT_TIMESTAMP` | `CONVERT(NVARCHAR(19), SYSUTCDATETIME(), 120)` |
| `datetime('now','+30 days')` | `CONVERT(NVARCHAR(19), DATEADD(day, 30, SYSUTCDATETIME()), 120)` |
| `date('now')` | `CONVERT(NVARCHAR(10), SYSUTCDATETIME(), 23)` |
| `strftime('%Y-%m', x)` | `FORMAT(CONVERT(datetime2, x), 'yyyy-MM')` |
| `LIMIT n` | `SELECT TOP (n)` |
| `LIMIT n OFFSET m` | `OFFSET m ROWS FETCH NEXT n ROWS ONLY` |
| `ORDER BY RANDOM()` | `ORDER BY NEWID()` |
| `INSERT OR IGNORE` | `INSERT` con `BEGIN TRY/CATCH` que se traga **solo** el error de clave duplicada (2601/2627) |
| `ON CONFLICT … DO NOTHING` | `IF NOT EXISTS (… WITH (UPDLOCK, HOLDLOCK)) INSERT …` |
| `ON CONFLICT … DO UPDATE` | `MERGE … WITH (HOLDLOCK)`, `excluded.` → `src.` |
| `RETURNING x` | cláusula `OUTPUT INSERTED.x` / `OUTPUT DELETED.x` |
| JSON (`params` del genoma) | `NVARCHAR(MAX)` con `CHECK (ISJSON(col) = 1)`; lectura con `JSON_VALUE` |
| `PRAGMA …` | no-op (WAL y `foreign_keys` son propiedades del motor) |
| `lastInsertRowid` | `SELECT CAST(SCOPE_IDENTITY() AS BIGINT)` en el **mismo lote** que el INSERT |
| `INSERT INTO periods (id, …) VALUES (1, …)` (id explícito sobre PK autoincremental, lo hace el seed) | `SET IDENTITY_INSERT periods ON; … OFF;` — las columnas IDENTITY se descubren del esquema ya traducido, no de una lista a mano |
| `SELECT (a <= b) AS x` (booleano escalar) | `SELECT CASE WHEN a <= b THEN 1 ELSE 0 END AS x` — T-SQL no admite booleanos en la lista de selección (caso real: `checkInvite`) |
| `FROM (SELECT … UNION ALL …)` sin alias | `FROM (…) AS __d1` — T-SQL exige alias en tablas derivadas (caso real: wallets activas en `epochs.ts`) |
| `?` posicional | `@p0`, `@p1`, … (parámetros nombrados; el paso a nombrados es lo que permite reusar un valor en `IF NOT EXISTS`/`MERGE` sin duplicar bindings) |

Dos diferencias que **no** se pueden traducir y hay que tener presentes al escribir SQL nuevo:

- **`UNIQUE` sobre columna que admite NULL:** SQLite permite varios NULL; T-SQL solo uno.
  Si hace falta, usar índice único filtrado (`WHERE col IS NOT NULL`). Hoy ninguna
  constraint del esquema está sobre columna nullable.
- **`GROUP BY`/`DISTINCT` sobre `NVARCHAR(MAX)`:** permitido, pero sin poder indexar.
  Si una columna de agrupación crece en volumen (hoy: `axis`, `bucket`, `choice`),
  acotar su longitud en `schema.sql` para que el traductor le dé `NVARCHAR(n)`.

**Fechas:** se conservan como TEXTO con el formato de SQLite (`YYYY-MM-DD HH:MM:SS`, UTC)
para que las comparaciones de cadena que hace la app sigan ordenando igual. `SYSUTCDATETIME()`
desnudo daría `datetime2` con separador `T` y rompería `expires_at > datetime('now')`.

**Consumo atómico de invitaciones (superficie crítica V5):** el `UPDATE` condicional se
traduce con `UPDATE invites WITH (UPDLOCK, ROWLOCK) SET … WHERE … used_by IS NULL` dentro
de la transacción → exactamente una transacción gana la carrera, igual que en SQLite.

**Si algo no se puede traducir con fidelidad, el traductor LANZA** (`UnsupportedSqlError`)
en vez de emitir T-SQL "parecido": una traducción silenciosamente incorrecta es peor que
un error. Si aparece al añadir SQL nuevo, ampliar `sql-dialect.ts` **con su test**.

Las 125 sentencias SQL que hoy escribe la app se revisaron una por una contra el
traductor; las tres trampas que aparecieron (id explícito sobre IDENTITY, booleano
escalar en `SELECT`, tabla derivada sin alias) están traducidas y con test. **Al añadir
consultas nuevas conviene repetir la revisión** — el traductor no las conoce de antemano.

## Qué queda por verificar contra la instancia real (paso 6)

La suite (127 tests) cubre el traductor de dialecto (puro) y el puente síncrono de punta a
punta contra un backend asíncrono falso. **No** cubre —porque necesita la suscripción:

1. Que Azure SQL **acepte** el T-SQL generado (ejecutar el `schema.sql` traducido y correr
   la suite con `DATABASE_DRIVER=mssql` apuntando a la instancia).
2. Managed identity de verdad (token de Entra, permisos del usuario externo).
3. Latencia real y el timeout del puente (`callTimeoutMs`, 30 s por defecto).
4. El **worker de anclaje** (`packages/scripts/anchor-worker.mjs`) abre **SQLite
   directamente**, sin pasar por `lib/db.ts`. Tal cual **no** lee Azure SQL: hay que
   migrarlo a la capa `db.ts` (o darle su propio cliente `mssql` asíncrono, que ahí sí es
   trivial porque es un script suelto). **Pendiente declarado**, no cubierto por WP16.

## Notas

- Node 20+ (probado en Node 22). npm workspaces; un solo lockfile en la raíz.
- `next start` sirve el build; las páginas de datos son `force-dynamic` (leen SQLite en cada
  request), así que no se pre-renderizan estáticamente.
