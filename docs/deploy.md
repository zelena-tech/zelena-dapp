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

**IMPORTANTE — persistencia de datos en Vercel:** `better-sqlite3` escribe en el sistema de
archivos local, que en Vercel es **efímero y no persiste** entre invocaciones. Para producción
hay que migrar la capa de datos a **Postgres (Neon/Supabase) o Turso/libSQL**. Toda la
persistencia está aislada en un solo archivo — `apps/web/src/lib/db.ts` — precisamente para
facilitar este swap:

1. Reemplaza el motor `better-sqlite3` por el cliente elegido (p. ej. `@libsql/client` para
   Turso, que mantiene una API SQL casi idéntica y soporta el mismo `schema.sql`).
2. Ajusta `getDb()` para devolver un wrapper con `prepare().get/all/run` equivalente.
3. Mueve `DATABASE_URL`/credenciales a variables de entorno de Vercel (nunca al repo).
4. El worker de anclaje puede correr como cron job (Vercel Cron o una VM) apuntando a la
   misma base gestionada.

Variables de entorno de producción: `SESSION_SECRET`, `FOUNDER_WALLET`, `DATABASE_URL`
(cuando migres), `STELLAR_NETWORK=testnet`. El `SERVICE_ACCOUNT_SECRET` vive solo donde
corre el worker, jamás en el frontend.

## Notas

- Node 20+ (probado en Node 22). npm workspaces; un solo lockfile en la raíz.
- `next start` sirve el build; las páginas de datos son `force-dynamic` (leen SQLite en cada
  request), así que no se pre-renderizan estáticamente.
