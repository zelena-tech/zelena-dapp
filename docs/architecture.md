# Arquitectura — Zelena Dapp v0.1 (Milestone 1 "Génesis")

Estado: testnet. Sin mainnet, sin dinero real, sin USDC, sin ZWORK transferible.
Esta Dapp implementa la primera vuelta del flywheel con humanos reales: invitación →
wallet → CLA anclado → Ágora → reputación → puntos ZWORK → decision log + votación.

## Stack

- **Next.js 14 (App Router) + TypeScript estricto + Tailwind** en `apps/web`.
- **DB: SQLite** vía `better-sqlite3` (síncrono), capa única en `apps/web/src/lib/db.ts`.
  El archivo vive en `apps/web/data/zelena.db` (gitignored) y se crea + migra + siembra
  al primer arranque. Esquema en `src/lib/schema.sql`; seed en `src/lib/seed.ts`.
- **Sesión:** cookie httpOnly firmada (JWT con `jose`). Lógica pura en `src/lib/jwt.ts`
  (usable en el edge middleware); helpers de cookie en `src/lib/session.ts`.
- **Anclaje on-chain:** cola `anchor_queue` + worker `packages/scripts/anchor-worker.mjs`
  que corre en la máquina del usuario (la red del sandbox no alcanza Stellar). El worker
  ancla cada hash con `manageData` desde una cuenta de servicio fondeada por friendbot.
- **Sin contratos Soroban** en M1 (Fork F1 del wargame: no hay Rust en el entorno; el
  anclaje por `manageData` es suficiente). `packages/contracts` queda pospuesto.

## Forks del wargame aplicados

- **F1 (sin Rust/stellar-cli):** no se construyen contratos; el anclaje es `manageData`.
- **F2 (sin Postgres/Docker):** SQLite para dev. En Vercel NO persiste → migrar a
  Postgres/Turso (ver `deploy.md`); toda la DB está detrás de `lib/db.ts` para swap fácil.
- **F3 (firma de mensajes Freighter):** el onboarding intenta Freighter y, si no expone
  firma o no está instalado, ofrece una **wallet de prueba** (keypair generado client-side,
  `is_demo=true`) que firma el hash del CLA localmente. Nada custodial.

## Modelo de datos (append-only donde importa)

`users`, `invites`, `cla_signatures`, `anchor_queue`, `projects`, `milestones`,
`applications`, `reputation_events` (append-only), `points_ledger` (append-only, no
transferible), `periods`, `decision_log`, `proposals`, `votes`, `academia_content`,
`academia_quiz`, `reading_sessions`, `academia_awards`.

- **Reputación por eje** y **total de puntos ZWORK** se **derivan** por `SUM()` — nunca
  hay columna de saldo mutable. Ver `lib/repo.ts`.
- Los **puntos son no transferibles**: no existe ningún endpoint de transferencia (V7).

## Máquina de estados de proyectos

`Open → Assigned → Delivered → Scored → Distributed`, sin saltos. Función pura única en
`lib/state-machine.ts` con tests de tabla (`state-machine.test.ts`). Los handlers de admin
solo la invocan (`lib/admin.ts`).

## Puerta de invitación

`lib/invites.ts`: un solo uso, expira a 30 días, ligada a la wallet del emisor. Topes por
tier (Bronze 2 · Silver 5 · Gold 10) sobre invitaciones **activas**. Consumo atómico
(`UPDATE ... WHERE used_by IS NULL AND no expirado` dentro de transacción) → en carreras
simultáneas gana exactamente una wallet (V5).

## Flujo del CLA

`/entrar` (3 pasos). El cliente obtiene el texto de `CLA.md` vía `/api/cla`, calcula el
SHA-256 y firma. `/api/onboard` **re-verifica** que el hash coincide con el texto canónico
del servidor, consume la invitación de forma atómica, crea el usuario + `cla_signatures`
(estado `pending`) y **encola** el anclaje. El acceso se desbloquea de inmediato; el worker
confirma el `txId` minutos después (anclaje asíncrono).

## Academia (anti-bot)

`lib/academia.ts`: (a) tiempo mínimo activo validado en servidor por heartbeats (pestaña
oculta no cuenta, `visibilitychange`); el servidor exige además tiempo real transcurrido
entre inicio y quiz; (b) quiz de 3 preguntas rotadas de un pool, aprobar 2/3 desbloquea;
(c) cap diario de 3 contenidos con puntos por wallet; (d) rendimientos decrecientes
(100/75/50%); (e) puntos al eje Investigación/Contenido (pesan la mitad para voto futuro);
(f) presupuesto de época separado (5.000 de 100.000). Una sola sesión de lectura activa por
wallet (`reading_sessions`).

## Seguridad

- Prepared statements en todo acceso (better-sqlite3 por defecto).
- Validación **zod** en todas las API routes (`lib/validation.ts`).
- Rate limiting en memoria por IP+wallet en endpoints sensibles (`lib/rate-limit.ts`).
- Cookies httpOnly + sameSite=lax + secure en prod.
- CSP + cabeceras de seguridad en `next.config.mjs`.
- Sin `dangerouslySetInnerHTML`: el Markdown se renderiza con un parser propio limitado que
  emite elementos React (`components/Markdown.tsx`).

## Rutas

Páginas: `/`, `/entrar`, `/agora`, `/agora/[id]`, `/academia`, `/academia/[slug]`,
`/perfil`, `/gobernanza`, `/admin`, `/whitepaper`.
API: `/api/cla`, `/api/invite/verify`, `/api/invite/generate`, `/api/onboard`, `/api/apply`,
`/api/governance/vote`, `/api/academia/start|heartbeat|quiz`, `/api/admin`.

## Middleware

Lectura pública (`/`, `/agora`, `/academia`, `/gobernanza`, `/whitepaper`). `/perfil` y
`/admin` exigen sesión con CLA firmado. Las mutaciones (aplicar, votar, generar invitación,
Academia, admin) revalidan sesión y CLA en el handler (defensa en profundidad).

## Deudas conocidas

Ver `decisions-pending.md`.
