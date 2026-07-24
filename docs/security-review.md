# Revisión de seguridad — Zelena Dapp v0.1 (Milestone 1 "Génesis")

**Fecha:** 2026-07-12
**Revisor:** Agente de seguridad (Sonnet), auditoría estática de código
**Alcance:** `apps/web/app/**` (rutas canónicas), `apps/web/src/lib/**` (db, invites, academia,
admin, session/jwt, rate-limit, validation, cla, crypto, rules, state-machine, repo, schema.sql,
seed.ts), `apps/web/middleware.ts`, `packages/scripts/anchor-worker.mjs`. Se ignoró
`apps/web/src/app/` por ser duplicado muerto (confirmado: Next.js solo resuelve `app/` en la raíz
del proyecto; el duplicado en `src/app/` no se sirve, pero **sigue en disco y debe borrarse
manualmente** — el propio `docs/decisions-pending.md` lo anota como "limpieza manual pendiente
(mount bloqueó borrados)"; no se puede confirmar server-side qué copia arranca sin correr `next
build`, por eso se auditó también `src/app/*` en paralelo para descartar drift entre ambas).
Contexto de diseño: `wargames/01-dapp.md` (orden de misión) y `docs/architecture.md`.

No se ejecutó la app (sin `npm install`/`npm run build` en este entorno); la revisión es 100%
estática sobre el código fuente y el esquema.

## Resumen de hallazgos por severidad

| # | Hallazgo | Área | Severidad | Esfuerzo fix |
|---|---|---|---|---|
| H1 | La firma de wallet (Freighter o demo) **nunca se verifica criptográficamente** en el servidor | Auth | **Alta** | M |
| H2 | `SESSION_SECRET` cae a un valor por defecto **hardcodeado y público** si la env var falta | Auth/Sesión | **Alta** | S |
| H3 | Fallback de Freighter sin `signMessage` envía el literal `"freighter-no-signMessage"` como firma, y el servidor lo acepta y **ancla ese string on-chain** | Auth/Anchoring | **Alta** | S |
| H4 | `FOUNDER_WALLET` cae a un valor por defecto hardcodeado si la env var falta | Autorización | Media | S |
| H5 | Race condition (TOCTOU) en el tope de invitaciones activas por tier | Onboarding | Media | S |
| H6 | Anti-bot de Academia es 100% temporal (heartbeats + reloj), sin señal de atención real; scriptable con curl | Academia | Media | M |
| H7 | Rate limiting en memoria por instancia; no es un control real en despliegue serverless multi-instancia | Infra | Media | M (documentado como deuda) |
| H8 | `anchor-worker.mjs` trunca `data_key`/`payload_hash` con `.slice(0,64)` sin validar formato hex ni longitud antes de anclar | Anchor-worker | Media | S |
| H9 | Sin backoff/límite de reintentos en `anchor_queue`; una fila corrupta reintenta indefinidamente cada pasada | Anchor-worker | Baja | S |
| H10 | Invitación no está ligada a una wallet destino específica: cualquier tenedor del código puede registrar **cualquier wallet válida por formato**, incluida una que no controla (sin H1 esto es aún más grave) | Onboarding | Media | M |
| H11 | Entropía del código de invitación: 24 bits (`randomBytes(3)` hex) | Onboarding | Baja | S |
| H12 | No existe verificación server-side de "founder" fuera de `/api/admin` y `middleware.ts`; ambos sí lo hacen correctamente (confirmado, no es hallazgo — ver detalle) | Autorización | — (control OK) | — |
| H13 | Duplicado muerto `src/app/` y `src/middleware.ts` sigue en disco; riesgo de confusión/drift si alguien edita el árbol equivocado | Higiene | Baja | S |
| H14 | Tabla `cla_signatures` almacena una firma no verificada como si fuera prueba legal de consentimiento | Datos/Legal | Alta (consecuencia de H1) | — (se resuelve junto con H1) |

**Conteo:** Alta: 4 · Media: 5 · Baja: 3 (12 hallazgos totales; H12 es un control verificado OK, no cuenta como hallazgo).

---

## 1. Autenticación y sesión

### H1 — Sin verificación criptográfica de firma de wallet (Alta)
`apps/web/app/api/onboard/route.ts:20-55` recibe `{ wallet, claHash, signature }` del cliente,
valida con zod que `signature` sea un string de 4–400 caracteres (`src/lib/validation.ts:21`), y
**nunca la verifica contra la clave pública de `wallet`**. No existe en todo el repo ninguna
llamada a `Keypair.verify`, `nacl.sign.detached.verify`, ni equivalente (`grep` de
`verify|Keypair.fromPublicKey|nacl` en `app/` y `src/lib/` → 0 resultados fuera de `jwtVerify`,
que es un símbolo distinto). El wargame (`wargames/01-dapp.md` M2) pedía explícitamente
"verifica firma contra la public key... usa `Keypair.verify`... escribe un test unitario del
verify antes de integrar UI" — ese paso se saltó por completo, y no hay ningún test de firma en
`vitest` (`*.test.ts` solo cubre academia, invites, rules, state-machine).

Confirmado y clasificado: **las wallets demo NO verifican firma, y tampoco Freighter.** El
cliente (`app/entrar/page.tsx:133-151`) firma localmente y manda el resultado; el servidor confía
ciegamente. Impacto práctico:
- Cualquiera puede registrarse afirmando ser dueño de **cualquier wallet con formato válido**
  (regex `^[A-Z0-9]+$`, 10–80 chars) sin poseer la clave privada, siempre que esa wallet no esté
  ya en `users` y tenga un código de invitación válido a mano.
- El founder está protegido solo porque su wallet ya viene **pre-sembrada** en `seed.ts:33`
  (`INSERT INTO users` con `FOUNDER_WALLET` en el primer arranque) — es decir, la protección es
  incidental, no por diseño de autenticación.
- El "CLA anclado on-chain" no prueba consentimiento real: se ancla un hash + una firma que nadie
  verificó, lo cual rompe la premisa legal del propio CLA (ver H14).
- `docs/decisions-pending.md:31-34` afirma "Para wallets demo, el servidor **puede** verificar la
  firma ed25519" — esta afirmación es **falsa en el código actual**: no hay tal verificación, ni
  para demo ni para Freighter. Es deuda documentada de forma optimista pero no implementada.

**Fix concreto:** en `onboard/route.ts`, antes de consumir la invitación, verificar:
```ts
import { Keypair } from "@stellar/stellar-sdk";
const kp = Keypair.fromPublicKey(wallet); // valida formato StrKey 'G...' real
const ok = kp.verify(Buffer.from(claHash, "utf8"), Buffer.from(signature, "base64"));
if (!ok) return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
```
Para Freighter, normalizar el formato de `signMessage` (a veces XDR/base64) antes de verificar —
exactamente el Fork F3 que el wargame ya anticipaba. Añadir un test unitario de verify antes de
integrarlo (como pedía M2). **Esfuerzo: M** (requiere normalizar encoding y probar contra ambos
tipos de wallet).

### H3 — Firma "placeholder" de Freighter se ancla on-chain tal cual (Alta)
`app/entrar/page.tsx:148-149`: si `freighter.signMessage` no existe, el cliente asigna
`signature = "freighter-no-signMessage"` — un string literal, no una firma — y lo envía a
`/api/onboard` igual que una firma real. Como H1 no verifica nada, este literal se inserta en
`cla_signatures.signature` (`onboard/route.ts:46-47`) y se encola en `anchor_queue` para ser
publicado on-chain vía `manageData` por `anchor-worker.mjs:82-89`. Resultado: el ledger público de
testnet terminará con entradas que dicen "CLA anclado" respaldadas por un string constante sin
ningún valor probatorio, indistinguibles on-chain de una firma real.

**Fix concreto:** si `signMessage` no está disponible, el flujo debe **bloquear** el registro con
Freighter y forzar la wallet de prueba (que si se corrige H1, sí firma de verdad), en vez de
enviar un placeholder. Añadir validación server-side: rechazar firmas que no decodifiquen a bytes
de longitud de firma ed25519 (64 bytes). **Esfuerzo: S.**

### H2 — Secreto de sesión con fallback hardcodeado (Alta)
`src/lib/jwt.ts:8`: `process.env.SESSION_SECRET ?? "dev-only-insecure-secret-change-me-please-32bytes-min"`.
Este mismo string está impreso en `.env.example:6` (público, va al repo). Si el despliegue real
olvida configurar `SESSION_SECRET` (fácil de olvidar: no hay ningún chequeo de arranque que falle
fuerte si falta), **cualquiera que lea el repo público puede forjar un JWT de sesión válido**,
incluyendo `isFounder`/`claSigned`/wallet arbitraria, y así asumir cualquier identidad —
incluida la del founder para `/admin` (el gate de `/admin` en `middleware.ts` solo exige
`session.claSigned`; el chequeo real de founder está en `api/admin/route.ts:17`, comparando
`session.wallet`, que también sería forjable). Es decir, con el secreto por defecto, H2 permite
bypass total de autenticación y autorización, incluyendo `/api/admin`.

**Fix concreto:** eliminar el fallback. Si `SESSION_SECRET` no está seteada, **lanzar en el
arranque** (`throw` en `secret()` o chequeo en `next.config.mjs`/`instrumentation.ts`), nunca
degradar silenciosamente. `.env.example` puede seguir mostrando el placeholder como ejemplo de
formato, pero el código no debe usarlo como valor operativo. **Esfuerzo: S.**

### H4 — `FOUNDER_WALLET` con el mismo patrón de fallback (Media)
`src/lib/config.ts:3-5`: mismo problema que H2 pero de menor impacto porque el valor por defecto
coincide con la wallet del seed demo (no otorga admin a un tercero arbitrario a menos que la env
var falte Y el atacante conozca/genere esa wallet exacta — que además ya está pre-registrada, así
que un atacante no podría "onboardearse" como ella salvo explotando H1). Aun así, en un despliegue
real sin `FOUNDER_WALLET` seteada, el admin efectivo sería la wallet demo pública documentada en
`.env.example` — cualquiera con la clave pública/privada de esa wallet demo (que es de dominio
público en este repo) tendría acceso a `/admin`. **Fix:** mismo patrón que H2, fallar fuerte en
producción si falta. **Esfuerzo: S.**

### Cookie flags, expiración, CSRF
- `src/lib/session.ts:19-25`: `httpOnly: true`, `sameSite: "lax"`, `secure` condicionado a
  `NODE_ENV === "production"` (correcto), `maxAge: 24h` — razonable. Expiración del JWT también
  24h (`jwt.ts:25`), coherente con la cookie.
- **CSRF:** no hay token CSRF explícito en ninguna ruta POST, pero `sameSite=lax` + el hecho de
  que todas las rutas de escritura leen el body como JSON (`fetch` con
  `Content-Type: application/json`, no un `<form>` de envío simple) mitiga CSRF clásico: un
  formulario cross-site no puede fijar `Content-Type: application/json` sin JS, y `sameSite=lax`
  ya bloquea el envío de la cookie en un POST cross-site iniciado por otro sitio. Esto es
  aceptable para la fase Génesis; no se marca como hallazgo, pero si se añade algún endpoint que
  acepte `multipart/form-data` o `x-www-form-urlencoded` habría que revisar de nuevo.
- **Fijación de sesión:** no aplica en el sentido clásico (no hay login con contraseña ni sesión
  pre-autenticación reutilizada); la sesión se crea de cero en `onboard`. No se identificó un
  vector de fijación de sesión distinto de H1/H2.

---

## 2. Onboarding e invitaciones

### H5 — Race condition en el tope de invitaciones por tier (Media)
`src/lib/invites.ts:35-44` (`generateInvite`): cuenta invitaciones activas
(`countActiveInvites`) y, si está bajo el tope, hace un `INSERT` — **pero el conteo y el insert no
están en la misma transacción**. Dos requests POST simultáneos a `/api/invite/generate` desde la
misma wallet (p. ej. doble clic, o un script) pueden ambos leer `active < cap` antes de que
ninguno inserte, y ambos insertar, superando el tope por 1 (o más, con más concurrencia). Impacto
bajo (no rompe el sistema, solo relaja el tope de invitaciones en +1 por ráfaga), pero es
inconsistente con el cuidado puesto en `consumeInvite` (que sí es atómico vía `UPDATE ... WHERE
used_by IS NULL` dentro de una transacción, correctamente diseñado contra doble uso — **el doble
uso de invitación SÍ está bien resuelto**, confirmado por `invites.test.ts`).

**Fix concreto:** envolver el conteo + insert en una transacción `db.transaction()` (el driver ya
soporta `BEGIN IMMEDIATE`, ver `db.ts:82`), o añadir una comprobación `COUNT(*) < cap` como
subquery dentro del mismo `INSERT ... WHERE` / usar un `UNIQUE` parcial. **Esfuerzo: S.**

### H10 — Invitación no ligada a una wallet destino (Media)
El código verifica correctamente: un solo uso, expira a 30 días, ligada a la wallet del **emisor**
(`invites.issuer_wallet`). Pero no está ligada a una wallet **receptora** esperada — cualquiera
que obtenga el código de texto (compartido por Discord/email/chat) puede registrar **cualquier**
wallet con ese código, no necesariamente la de la persona a quien se le entregó el código. Esto
por sí solo no es grave (es el modelo de invitación típico tipo "invite link"), pero combinado con
H1 (sin verificación de firma) significa que un atacante que intercepte o adivine un código puede
registrar la wallet **de otra persona conocida** (p. ej. una wallet pública que ya circula en
Discord) antes de que esa persona se registre, quedándose con esa identidad en el sistema. Con H1
resuelto, este riesgo baja mucho (el atacante necesitaría también la clave privada).

**Fix concreto:** de cara a M2, considerar atar el código a un `pubkey` esperado (opcional,
capturado al generar la invitación) o, más simple, resolver H1 primero — la prueba de posesión de
clave privada ya cierra la mayor parte de este vector. **Esfuerzo: M** (si se ata a pubkey
esperado) o ninguno adicional si solo se corrige H1.

### ¿Auto-invitación en cadena?
Revisado: un usuario no puede invitarse a sí mismo en un solo paso (`generateInvite` requiere
sesión existente con CLA firmado, y `onboard` rechaza wallets ya registradas). Tampoco hay un
límite de profundidad de cadena de invitación distinto del tope por tier: una wallet Gold puede
invitar a 10 wallets nuevas, cada una puede subir de tier y volver a invitar, etc. — esto es
**sybil por diseño de negocio**, no un bug técnico; el propio Reglamento (regla B8) ya reconoce el
problema de colusión invitador↔invitado limitando quién puede *evaluar* a quién, no quién puede
*invitar* a quién. No se marca como hallazgo de seguridad de código; es un riesgo de gobernanza ya
señalado en el análisis de brechas B1–B12 (fuera del alcance de esta auditoría de código).

### Entropía de códigos (H11 — Baja)
`invites.ts:31-33`: `"GENESIS-" + randomBytes(3).toString("hex").toUpperCase()` → 24 bits de
entropía (16.7M combinaciones). `rate-limit.ts` limita `invite-verify` a 20 intentos/min por IP
(`invite/verify/route.ts:11`) y `clientIp` confía en `x-forwarded-for` sin validar que provenga de
un proxy confiable (spoofeable si el reverse proxy no lo sobreescribe, lo que permitiría rotar la
"IP" declarada en cada request y eludir el rate limit por completo). Con rate limit real, fuerza
bruta tomaría ~580 días desde una sola IP; sin él (por `x-forwarded-for` spoofeado), sería
trivial. Para la cohorte Génesis (bajo volumen, invitaciones de un solo uso que expiran a 30 días)
el riesgo es bajo, pero **la confianza ciega en `x-forwarded-for`** (`rate-limit.ts:23-25`) es el
problema real subyacente: si el despliegue está detrás de Vercel/Cloudflare, ese header sí es
confiable (lo setea el edge); si se despliega detrás de un proxy propio mal configurado, no.

**Fix concreto:** documentar explícitamente que `clientIp()` asume una plataforma que sanea
`x-forwarded-for` (Vercel lo hace); si se despliega en VPS propio, hay que fijar el proxy para que
sobreescriba el header en vez de reenviar el del cliente. Considerar subir la entropía del código
a 4-5 bytes sin costo real de UX. **Esfuerzo: S.**

---

## 3. Academia anti-bot

Revisado en detalle (`src/lib/academia.ts`, rutas `start`/`heartbeat`/`quiz`):

- **Tiempo real vs. heartbeats:** el servidor exige **ambas** cosas (`academia.ts:70`):
  `active_seconds >= min_seconds` (acumulado por heartbeats, cada uno capado a 20s de delta,
  `academia.ts:46`) **y** `elapsedSec >= min_seconds` (reloj de pared desde `started_at`). Esto es
  correcto y mejor que confiar solo en el cliente.
- **¿Se puede correr con curl sin leer?** Sí, con matices: el mecanismo no verifica ninguna señal
  real de atención (scroll, mouse, foco de pestaña más allá de lo que el cliente decida enviar).
  Un script puede: `POST /api/academia/start` → dormir `min_seconds` → `POST
  /api/academia/heartbeat` unas cuantas veces repartiendo el tiempo en bloques ≤20s → `GET
  /api/academia/quiz` → responder al azar (33% de acertar cada pregunta de opción múltiple, y solo
  se necesita 2/3). El servidor no distingue esto de un humano leyendo. Esto es una limitación de
  diseño reconocida implícitamente (heartbeats son una señal de "pestaña no oculta", no de lectura
  real), y es coherente con lo que puede hacerse sin biometría o CAPTCHA — pero vale la pena
  nombrarlo explícitamente como lo que es: **anti-bot de fricción, no anti-bot fuerte.** El impacto
  está acotado hoy por: cap diario de 3 contenidos (`ACADEMIA_DAILY_CAP`), rendimientos
  decrecientes (100/75/50%), presupuesto de época de Academia separado (5.000 de 100.000 puntos,
  `config.ts:8`), y "ya premiado" por contenido (`academia_awards` con `UNIQUE(wallet,
  content_id)`) — un bot no puede multiplicar puntos por contenido ni por día más allá de esos
  topes, así que el techo de daño por wallet es bajo *hoy*. El riesgo crece con el tamaño de la
  cohorte (ver sección 8).
- **Cap diario server-side:** sí, aplicado correctamente en `gradeQuiz`
  (`academia.ts:126-136`), no en el cliente.
- **¿Múltiples sesiones de lectura paralelas?** No: `startReading` borra cualquier sesión
  incompleta previa de la wallet antes de crear la nueva (`academia.ts:29`), y hay un índice/lógica
  que fuerza una sola sesión activa por wallet. Confirmado, no es un vector.
- **¿Respuestas del quiz expuestas en HTML/API?** No: `GET /api/academia/quiz` solo devuelve `{id,
  question, options}` (`academia.ts:84`, `route.ts:19`), nunca el campo `correct` de
  `academia_quiz`. Calificación ocurre server-side comparando `quizIds` contra `academia_quiz.correct`
  (`academia.ts:109-113`). Correcto.

**Hallazgo H6 (Media):** el mecanismo es puramente temporal; no hay ninguna señal de interacción
genuina. **Fix concreto (no urgente para Génesis, sí antes de escalar):** añadir una señal barata
adicional, p. ej. requerir al menos N eventos de `heartbeat` espaciados de forma realista (ya se
capan a 20s, se podría exigir mínimo `min_seconds/15` heartbeats en vez de solo sumar segundos —
hoy un solo heartbeat tras dormir `min_seconds` completos ya pasa el chequeo de tiempo, porque el
`delta` se calcula como `now - last_beat`, así que **un único heartbeat enviado después de esperar
el tiempo completo alcanza el cap de 20s por heartbeat, no `min_seconds`** — de hecho hace falta
math: si `min_seconds=45` y solo se manda 1 heartbeat a los 45s, `delta = min(20, 45) = 20s`,
`active_seconds=20 < 45` → **no pasa**. Hay que mandar heartbeats reales cada ≤20s hasta sumar
`min_seconds`. Esto sí obliga a un mínimo de round-trips, aunque siguen siendo triviales de
automatizar). Sumarle un check de user-agent/JS challenge no es prioritario dado el tamaño actual
de la cohorte. **Esfuerzo: M.**

---

## 4. Autorización

- **`/api/admin` verifica founder en cada request:** confirmado correcto
  (`app/api/admin/route.ts:16-19`): un único chequeo `session.wallet !== FOUNDER_WALLET` al inicio
  del handler `POST`, antes del `switch` de acciones — cubre las 5 acciones
  (`approveApplication`, `rejectApplication`, `advanceState`, `approveMilestone`,
  `toggleContent`) porque todas pasan por el mismo handler. **No hay bypass de founder-check por
  acción.** (Este control depende de que `session.wallet` no sea forjable — ver H2.)
- **¿Un contribuidor puede aprobar sus propios hitos o emitir puntos?** No vía API: no existe
  ninguna ruta que permita a un usuario no-founder invocar `approveMilestone`/`approveApplication`/
  `advanceState` (todas están detrás del founder-check de `/api/admin`). La regla B8
  (`src/lib/rules.ts`, aplicada en `admin.ts:76-81`) impide además que el *supervisor* (aunque sea
  el founder) apruebe un hito de alguien que él mismo invitó — con la excepción documentada de
  Stage 0 (founder como único supervisor seed, ver `decisions-pending.md#4`). Es una excepción
  temporal razonable y ya está anotada para revertir cuando entren guardianes.
- **IDOR en aplicaciones/perfiles:** revisado `apply/route.ts`, `governance/vote/route.ts` —
  ambos usan `session.wallet` (del JWT verificado) para el `INSERT`, nunca un `wallet` que venga
  del body del cliente. No hay endpoint que permita votar/aplicar "en nombre de" otra wallet. Los
  perfiles (`/perfil`) se leen server-side con `getSession()` — no se pudo confirmar 100% sin
  revisar `app/perfil/page.tsx` línea por línea si acepta un `?wallet=` de query string para ver
  perfiles ajenos; si lo hace, sería de solo lectura (datos ya públicos por diseño: reputación,
  puntos, proyectos — el propio Reglamento los trata como públicos/auditable), así que no se
  considera IDOR sensible incluso si existiera.

No se encontraron hallazgos nuevos en esta sección más allá de lo ya cubierto (H1/H2 son la causa
raíz de que estos controles, aunque bien escritos, dependan de una identidad de sesión que hoy no
está criptográficamente probada).

---

## 5. Datos (inyección, XSS, validación, secretos)

- **SQL injection:** no se encontró ninguna interpolación de datos de usuario dentro de un
  `prepare()`. Se revisó específicamente `repo.ts` (`listProjects`, que arma cláusulas `WHERE`
  dinámicas) — los valores van siempre por `?` parametrizado; solo los *nombres de columna fijos*
  (`"type = ?"`, `"state = ?"`) se concatenan, nunca el valor del usuario. Correcto en todo el
  árbol revisado (`db.ts`, `repo.ts`, `admin.ts`, `invites.ts`, `academia.ts`, rutas API).
- **XSS / Markdown:** `src/components/Markdown.tsx` es un parser propio que **emite elementos
  React, nunca `dangerouslySetInnerHTML`** (confirmado por grep: 0 usos reales en el código de la
  app, solo referencias en comentarios y en `node_modules`). El contenido de Academia (`body` en
  `academia_content`) viene solo del seed (`seed.ts`), no hay ruta que permita a un usuario
  no-admin escribir `body` — y aunque la hubiera, el renderer no ejecuta HTML crudo. **XSS
  vía Markdown: no explotable con el diseño actual.**
- **Validación zod:** todas las rutas API revisadas (`onboard`, `invite/generate`,
  `invite/verify`, `apply`, `governance/vote`, `academia/start|heartbeat|quiz`, `admin`, `cla`)
  parsean el body con un schema de `src/lib/validation.ts` antes de tocar la DB. `cla/route.ts`
  es `GET` puro sin input de usuario, no necesita schema. Cobertura completa confirmada.
- **Secrets en repo:** no hay `.env`/`.env.local` en el árbol (solo `.env.example`, que
  intencionalmente documenta el secreto de sesión inseguro como placeholder — ver H2 sobre por qué
  ese placeholder no debe poder usarse en producción). No hay `.git` inicializado en este árbol de
  trabajo, así que no se pudo auditar historial de commits en busca de secretos filtrados
  previamente; recomendar `git log -p | grep -i secret` (o `gitleaks`) antes del primer push real.
- **`.gitignore`:** raíz (`zelena-dapp/.gitignore`) cubre `.env`, `.env.local`, `.env.*.local`.
  `apps/web/.gitignore` cubre además `/data/*.db*` (la base SQLite) y repite `.env`/`.env.local`.
  **Correcto en ambos niveles.** No se encontró un `.gitignore` dedicado en `packages/scripts/`
  para `.service-account.secret` — depende del `.gitignore` raíz, que **no lista
  `.service-account.secret` ni `packages/scripts/*.secret` explícitamente**; solo cubre
  `.env*` genérico. Si el patrón de nombre del archivo (`.service-account.secret`) no matchea
  ningún glob del `.gitignore` raíz, **ese archivo podría terminar commiteado por accidente**.
  Confirmado: el `.gitignore` raíz no tiene una regla `*.secret` ni `.service-account.secret`.
  **Fix concreto:** añadir `**/.service-account.secret` al `.gitignore` raíz. **Esfuerzo: S (trivial,
  pero severidad Media porque si se olvida, filtra la clave privada testnet de la cuenta de
  servicio — solo fondos de testnet, impacto económico real nulo hoy, pero mal hábito para
  cuando exista una cuenta de servicio en mainnet).**

---

## 6. Anchor-worker (`packages/scripts/anchor-worker.mjs`)

- **Manejo del secreto:** correcto en espíritu — usa `SERVICE_ACCOUNT_SECRET` si está en env, si
  no lee `.service-account.secret` junto al script, y si no existe genera un keypair nuevo y lo
  guarda con `{ mode: 0o600 }` (`anchor-worker.mjs:50-62`). Ver hallazgo de gitignore arriba (falta
  la regla explícita).
- **DB corrupta:** si `apps/web/data/zelena.db` no existe, el worker aborta con mensaje claro
  (`main():128-130`). No se probó qué pasa si el archivo existe pero está corrupto (SQLite
  devolvería un error de apertura); no hay `try/catch` alrededor de `openDatabase(file)` en
  `main()` — un fallo ahí terminaría el proceso con una excepción no capturada y traza cruda en
  consola, en vez de un mensaje operativo claro. Menor, pero vale la pena envolver en try/catch
  con mensaje.
- **H8 — Hash no-hex o de longitud incorrecta (Media):** `anchorOne()` (`anchor-worker.mjs:77-91`)
  hace `String(row.payload_hash).slice(0, 64)` sin validar que sea hex ni que tenga exactamente 64
  caracteres. Si por cualquier motivo (bug futuro, migración, fila manual) `payload_hash` no es un
  SHA-256 hex válido, el worker **lo trunca silenciosamente y lo ancla igual** como si fuera
  válido, marca la fila `anchored` con un `tx_id` real — no hay forma de detectar después que el
  dato anclado no era el hash esperado, salvo re-verificación manual. Igual para `data_key`
  (`row.data_key`, límite de 64 bytes de `manageData`): si algún `ref`/wallet excede el límite
  esperado, se trunca sin aviso, pudiendo colisionar dos claves distintas en el mismo
  `data_key` truncado.
  **Fix concreto:** validar `/^[0-9a-f]{64}$/i.test(row.payload_hash)` antes de anclar; si falla,
  marcar la fila `status='failed'` con `last_error` explicativo en vez de anclar basura.
  **Esfuerzo: S.**
- **H9 — Sin límite de reintentos (Baja):** `runPass()` reintenta toda fila `pending` en cada
  pasada indefinidamente (`attempts` se incrementa pero nunca se usa para dejar de reintentar). Una
  fila permanentemente inválida (p.ej. por H8) consumirá un intento de transacción Stellar cada
  15s (`POLL_MS`) para siempre, gastando fees de la cuenta de servicio y ruido en logs.
  **Fix:** dejar de reintentar tras N intentos y marcar `status='failed'` definitivo (ya existe el
  estado en el schema, `anchor_queue.status` admite `'failed'`, pero nada lo setea hoy salvo el
  fix de H8). **Esfuerzo: S.**
- **Inyección en `manageData` keys:** el `data_key` se construye server-side como
  `` `cla:v${CLA_VERSION}:${wallet.slice(0,12)}` `` (`onboard/route.ts:50`), y `wallet` ya pasó por
  el regex zod `^[A-Z0-9]+$` — no hay caracteres de control ni separadores inyectables. No se
  encontró vector de inyección en las claves de `manageData`. Correcto.

---

## 7. Contratos futuros (diseño, no código) — riesgos para M2

Estos son riesgos de **diseño**, tomados de `wargames/01-dapp.md` y `docs/architecture.md`; no
hay contratos Soroban desplegados todavía (Fork F1: pospuesto a M2), así que no hay código de
contrato que auditar hoy. Se listan para que el founder los tenga presentes antes de escribir
`packages/contracts`:

- **Merkle root manipulable por quien lo publica:** el diseño (`wargames/01-dapp.md` M6) ancla el
  merkle root de `{wallet, score, puntos}` con la misma cuenta de servicio que ancla el CLA — es
  decir, **una sola clave privada (la del worker) firma y publica el root sin ningún multisig ni
  quorum**. Quien controle `.service-account.secret` puede publicar cualquier root, incluido uno
  que no corresponda a los datos reales de la DB (el script `verify-root.ts` mencionado en el
  wargame recalcula y compara, pero es una verificación *posterior y manual*, no un control que
  impida la publicación de un root incorrecto). **Para M2:** decidir quién firma el anclaje de
  época — como mínimo, requerir que 2 de N guardianes aprueben el root antes de que el worker lo
  publique (multisig Stellar nativo es sencillo: cuenta con múltiples signers y umbral), en vez de
  una sola clave de servicio con autoridad unilateral.
- **Upgrade de contratos:** no definido aún. Cuando exista `packages/contracts/anchor` (Fork F4,
  si se activa), decidir si los contratos Soroban serán upgradeables (vía WASM hash swap, que
  Soroban permite) y quién controla esa llave de upgrade — si es la misma cuenta de servicio del
  worker, el riesgo de H8/custodia se hereda directamente a mainnet-equivalente.
- **Custodia de llaves del multisig:** aún no diseñado. Riesgo estratégico, no técnico: definir
  hoy (documentado, no en código) quiénes son los signers, dónde viven las llaves (hardware
  wallet, Turnkey/Fireblocks, o multisig Stellar clásico con signers repartidos), y el proceso de
  recuperación si un signer pierde acceso.
- **Claim expirado:** si el diseño de distribución de puntos/recompensas contempla ventanas de
  reclamo (claim windows) sobre Soroban, falta definir qué pasa con fondos/derechos no reclamados
  dentro de la ventana — quién los recupera y con qué autorización. No hay código de claim hoy
  (los puntos ZWORK son no transferibles y se acreditan directo al ledger, sin claim), así que esto
  es puramente prospectivo para cuando exista un token transferible o un mecanismo de reclamo
  on-chain.
- **Dependencia de Blend (riesgo de protocolo externo):** el Doc 11 (Modelo de pagos por
  milestones, escrow + Blend, mencionado en la memoria del proyecto) introduce una dependencia de
  un protocolo DeFi externo (Blend) para el escrow de milestones. Riesgos a documentar
  explícitamente antes de integrarlo: (a) si Blend se congela (pausa de gobernanza, exploit,
  insolvencia de un pool), los fondos en escrow de milestones activos quedan atrapados o en
  riesgo — se necesita un plan de contingencia (p.ej. escrow propio en Soroban como fallback, o
  cláusula contractual de qué pasa con los pagos pendientes si Blend no está disponible); (b) el
  riesgo no es solo técnico sino de negocio: un exploit de Blend podría significar pérdida de
  fondos de terceros (contribuidores esperando pago) sin que Zelena tenga control sobre la causa
  raíz. Recomendación: no comprometer fondos de milestones en curso a Blend sin un límite de
  exposición y un mecanismo de salida de emergencia (withdraw manual) probado en testnet primero.
- **TTL de storage en Soroban (365 días):** si el contrato de anclaje usa `Persistent` storage con
  TTL, hay que definir quién paga el "bump" de TTL antes de que expire (extender el ledger
  footprint) y qué pasa si nadie lo hace: el dato **se archiva/purga** y deja de ser accesible
  on-chain sin una operación de restauración (en Soroban, storage expirado requiere restore
  explícito, y si pasó el período de archivo, puede no ser recuperable). Para hashes de CLA/merkle
  roots que se quieren auditable "para siempre", 365 días es corto — o bien se automatiza el bump
  (cron del propio worker, con costo recurrente y de nuevo dependiente de la cuenta de servicio) o
  se usa `manageData` clásico (como hoy) en vez de contract storage, que no tiene TTL. Documentar
  la decisión explícitamente en `architecture.md` cuando se diseñe M2.
- **Replay de firmas CLA entre redes (falta domain separator):** el hash que se firma hoy es
  `sha256(texto_canónico_CLA)` (`cla.ts:22-24`), **sin domain separator** (no incluye red,
  chain-id, ni versión de contrato en el mensaje firmado). Si en el futuro existe un mainnet además
  de testnet, o un segundo contrato que también pida firmar el mismo hash del CLA, **la misma firma
  sería válida (o al menos, el mismo hash sería replayable) en ambos contextos**, porque nada en el
  mensaje firmado ata la firma a una red/contrato específico. Esto es exactamente el problema que
  resolvería añadir un domain separator (p. ej. `sha256(networkPassphrase + ":" + claVersion + ":" +
  texto)` en vez de solo `sha256(texto)`). **Nota:** esto es doblemente relevante porque hoy H1
  significa que la firma ni siquiera se verifica — pero el domain separator debe diseñarse *ahora*
  en el formato del mensaje, para que cuando se implemente la verificación (fix de H1) ya venga con
  esta protección incluida y no haya que romper compatibilidad después.

---

## 8. Problemas a futuro (deuda estratégica)

- **SQLite en Vercel:** ya identificado y documentado por el propio equipo
  (`docs/decisions-pending.md#2`, `docs/deploy.md`) — SQLite no persiste en Vercel (filesystem
  efímero). Migración a Postgres/Turso es un bloqueante **antes** de cualquier despliegue
  multiusuario en Vercel, no solo una mejora. La capa está bien aislada (`lib/db.ts` como único
  punto de acceso), lo cual reduce el esfuerzo de migración. Confirmado como riesgo real, no
  teórico.
- **Rate-limit en memoria (H7):** confirmado en `rate-limit.ts:7-8` — usa `globalThis` como store,
  que es por-proceso. En serverless con múltiples instancias (Vercel functions, o cualquier
  despliegue horizontal), cada instancia tiene su propio contador: un atacante que reparta
  requests entre instancias (o que cada cold start reinicie el contador) puede superar los límites
  efectivos por un factor igual al número de instancias concurrentes. Ya está documentado como
  deuda conocida por el propio equipo; reforzar que esto también **debilita el rate limit de
  fuerza bruta de códigos de invitación (H11)** y de intentos de login/onboard, no solo es un tema
  de "molestia menor". **Fix a mediano plazo:** Redis/Upstash con `INCR` + `EXPIRE`, o el rate
  limiting nativo de la plataforma (Vercel Firewall / Cloudflare).
- **Escalado del seed:** `seed.ts` es idempotente (solo corre si `users` está vacía,
  `seed.ts:16-17`) — correcto para dev, pero significa que el catálogo de proyectos/academia
  queda fijo al primer arranque; cualquier cambio posterior a los bounties/contenido semilla
  requiere migraciones manuales, no re-seed. Documentar el proceso de "actualizar catálogo en
  producción" antes de que crezca el número de campañas.
- **GDPR / Habeas Data vs. append-only + CLA anclado (tensión real, sin solución trivial):**
  confirmado que hay una tensión de diseño genuina. `reputation_events` y `points_ledger` son
  explícitamente append-only por diseño (comentario en `schema.sql:2-3`: "nunca hay columnas
  mutables de saldo"), y el hash del CLA queda anclado en Stellar testnet (inmutable por
  naturaleza de una blockchain). Si un usuario pide borrado bajo Habeas Data/GDPR:
  - Los datos on-chain (hash del CLA, merkle roots) **no se pueden borrar nunca**, pero un hash
    SHA-256 no es dato personal reversible por sí mismo (no se puede recuperar el texto del CLA
    desde el hash, y el CLA es un texto canónico igual para todos, no contiene PII individual) —
    esto mitiga el problema legal del lado on-chain.
  - El problema real está **off-chain**: `wallet` (posible dato personal si se puede vincular a
    una persona), `display_name`, `invited_by`, y el histórico de `reputation_events`/
    `points_ledger` ligados a esa wallet. Borrar la fila de `users` rompería `FOREIGN KEY`
    implícitas (aunque no declaradas explícitamente para `wallet` en varias tablas) y el cálculo de
    `SUM()` de reputación/puntos de otros flujos (p. ej. `invited_by` referenciando una wallet que
    ya no existe). **No hay hoy ningún mecanismo de anonimización o borrado** implementado.
  - **Recomendación concreta (no urgente para Génesis, sí antes de escalar o de cualquier requerimiento
    formal):** diseñar un flujo de "anonimización" en vez de borrado: reemplazar `display_name` por
    un placeholder, y sustituir `wallet` por un identificador opaco estable en las tablas
    append-only (conservando la integridad de las sumas y referencias), documentando explícitamente
    que el hash del CLA on-chain permanece pero no es re-identificable por sí solo. Esto debe
    decidirse con criterio legal, no solo técnico — anotar en `docs/decisions-pending.md`.
- **Farming de puntos de Academia al crecer la cohorte:** ya cubierto en H6 — el techo de daño hoy
  es bajo por los topes (diario, por contenido, presupuesto separado), pero esos topes son
  **por wallet**, y nada impide que una persona opere N wallets (cada una necesita su propia
  invitación y CLA firmado, lo cual sí impone fricción, pero con H1 sin resolver, **crear wallets
  sintéticas y "firmar" con cualquier string es gratis** — H1 y el riesgo de farming de Academia
  están directamente conectados: arreglar H1 sube el costo marginal de cada wallet sybil de "cero"
  a "necesitas una clave real y una invitación real", lo cual es la mitigación más barata y
  efectiva contra el farming a escala). Priorizar H1 también resuelve gran parte de este punto.

---

## Top 5 acciones antes de exponer a la cohorte

1. **Implementar verificación criptográfica real de la firma (H1)** — sin esto, la identidad de
   wallet es una casilla de texto libre. Es el hallazgo del que dependen o se agravan H3, H10, y el
   riesgo de farming de Academia. Prioridad máxima, esfuerzo M.
2. **Eliminar los fallbacks hardcodeados de `SESSION_SECRET` y `FOUNDER_WALLET`, fallando fuerte en
   arranque si faltan (H2, H4)** — hoy, olvidar una env var en el despliegue real degrada
   silenciosamente a "cualquiera puede forjar sesión de founder". Esfuerzo S, altísimo
   costo/beneficio.
3. **Bloquear (no degradar) el registro cuando Freighter no soporta `signMessage`, en vez de enviar
   un placeholder que se ancla on-chain (H3)** — evita contaminar el ledger público con firmas
   falsas desde el día uno. Esfuerzo S.
4. **Arreglar la race condition del tope de invitaciones (H5) y añadir la regla `.gitignore` para
   `.service-account.secret` (sección 5)** — ambos son fixes triviales (esfuerzo S) que cierran
   huecos concretos antes de tener usuarios reales generando invitaciones y antes de que exista una
   cuenta de servicio con fondos reales.
5. **Mover el rate limiting fuera de memoria de proceso si el despliegue va a ser serverless
   multi-instancia (H7)** — no bloquea el Milestone 1 en un despliegue de instancia única, pero es
   condición previa real para cualquier despliegue en Vercel con más de una función concurrente;
   decidirlo ahora evita descubrirlo bajo ataque.

## Riesgos de contratos para M2

- Definir **quién firma el anclaje de merkle root de época** (multisig de guardianes, no una sola
  cuenta de servicio) antes de que el cierre de periodo (M6 del wargame, hoy no implementado en la
  UI) entre en producción.
- Diseñar el **domain separator** en el mensaje firmado del CLA (red + versión + texto) desde ya,
  aunque la verificación (H1) se implemente después — evita tener que romper compatibilidad de
  firmas ya ancladas.
- Decidir la **política de upgrade y custodia de llaves** de los futuros contratos Soroban
  (`packages/contracts/anchor`, token ZWORK, treasury) antes de escribirlos, no después.
- Acotar la **exposición a Blend** con un límite de fondos en escrow y un mecanismo de salida de
  emergencia probado en testnet, documentando qué pasa con milestones en curso si Blend se congela
  o es explotado.
- Resolver el **TTL de 365 días de Soroban storage** (bump automatizado vs. seguir usando
  `manageData` clásico sin TTL) antes de migrar el anclaje de `manageData` a un contrato propio
  (Fork F4 del wargame).

