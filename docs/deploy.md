# Deploy — Zelena Dapp v0.1

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

## Notas

- Node 20+ (probado en Node 22). npm workspaces; un solo lockfile en la raíz.
- `next start` sirve el build; las páginas de datos son `force-dynamic` (leen SQLite en cada
  request), así que no se pre-renderizan estáticamente.
