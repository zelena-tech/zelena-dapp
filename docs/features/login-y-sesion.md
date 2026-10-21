# Ficha: Login y sesión

Dueño: QA (por asignar) · Revisor: John · Fecha: 2026-10-21 · Commit de referencia: 0e07d8f

> **Pregunta del founder: "¿por qué me pide wallet? ¿puedo entrar con Freighter o con mi correo?"**
>
> **Por qué pide wallet.** En la puerta de comunidad la wallet *es* la cuenta: `users.wallet` es la llave primaria del registro (`src/lib/schema.sql`, tabla `users`) y la única prueba de identidad es la firma ed25519 del acuerdo de contribución (CLA) hecha con esa wallet (`src/lib/onboard.ts#performOnboard` y `#performLogin`, verificada en `src/lib/crypto.ts#verifyWalletSignature`). No hay contraseñas ni códigos por correo: sin una llave que firme, la app no tiene con qué reconocerte.
>
> **Caminos que existen hoy (en el código del commit 0e07d8f):**
>
> | Camino | ¿Existe? | Cómo se entra | Qué pide | Dónde está |
> | --- | --- | --- | --- | --- |
> | **Freighter** (tu wallet de Stellar) | **Sí** | `/entrar` → "Conectar mi wallet" → firmar el acuerdo. Si tu wallet ya está registrada: "Ya estoy registrado — entrar con mi wallet" (no pide código). | Freighter instalado y desbloqueado, con `signMessage`. Código de invitación solo la primera vez. | `app/entrar/page.tsx#connectFreighter` (l. 201) y `#signAndFinish` (l. 297-318); el servidor acepta el formato SEP-53 que usa Freighter (`src/lib/crypto.ts`, l. 52 y 70-79). |
> | Wallet de prueba del navegador | Sí | `/entrar` → "Crear wallet de prueba". | Código de invitación. La llave secreta queda en `localStorage`. | `app/entrar/page.tsx#crearWalletDemo` (l. 132-166). Queda `is_demo = 1`: no cuenta en cifras públicas ni se puede vincular al equipo. **No sirve para el founder.** |
> | **Correo corporativo de Microsoft (Entra ID)** | **Solo si se enciende** | `/entrar` → "Continuar con Microsoft". Sin código y sin wallet. | `AUTH_ENTRA_ENABLED=1` + `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`, `NEXTAUTH_SECRET` en App Settings. Cuenta del tenant y del dominio corporativo (no invitados B2B). | `src/components/EntraSignInButton.tsx` (l. 66: si la puerta no está disponible el botón **no se dibuja**), `app/api/auth/[...nextauth]/route.ts` (503 con el flag apagado), `src/lib/entra.ts#validateEntraToken`. |
> | **Correo personal** (Gmail u otro) | **No** | — | — | No hay ruta, ni enlace mágico, ni contraseña. El "segundo correo" (`user_emails.kind = 'recovery'`) se guarda pero ningún login lo lee. |
>
> **Lo que confunde hoy:**
> 1. Con el flag apagado (estado por defecto, y el que describe `docs/DESPLIEGUE-V1.md` §"Acceso del founder" para la fusión del 2026-09-30) el botón de Microsoft no aparece, así que la única puerta visible es la wallet.
> 2. Entrar por Microsoft deja la sesión con `claSigned = false` (`app/api/auth/entra/exchange/route.ts`, l. 79-88): llegas a `/equipo/hoy`, pero el middleware te devuelve a `/entrar` si abres `/perfil` o `/admin` (`middleware.ts`, l. 24 y 41). Para el founder eso significa que **por Microsoft no se abre la página `/admin`** mientras su fila del roster (`pending:<slug>`, sembrada con `cla_signed = 0` en `src/lib/team.ts#seedTeamRoster`) no esté vinculada a su wallet con `vincularPrincipal` (`/equipo/talento`). Después de vincularla, Entra lo resuelve por correo a la fila de la wallet, que sí tiene el CLA firmado.
> 3. Tres textos prometen un login con correo personal que no existe: `src/lib/entra.ts` l. 545-546, `src/components/EntraSignInButton.tsx` l. 22-23 y el comentario de `user_emails` en `src/lib/schema.sql` l. 53.
> 4. Para entrar como founder con Freighter: la llave pública de tu Freighter debe estar en `FOUNDER_WALLET` (cada arranque la promueve a `founder`, `src/lib/db.ts#backfillFounder`, l. 580) o usar una sola vez el código `FOUNDER_BOOTSTRAP_CODE` (`src/lib/onboard.ts`, l. 92-93 y 113-125).
>
> **Si se quiere un login con correo personal**, hace falta enviar correos (enlace mágico o código de un solo uso), y el envío de correos está fuera del alcance de v1 según `CLAUDE.md` ("sin envío de correos/Teams"). Es una decisión de John, no un arreglo.

## 1. Resumen

Qué hace: decide **quién es** cada petición y **qué puede hacer**. Tiene dos puertas que terminan en la misma cookie de sesión:

- **Puerta de comunidad (la única encendida por defecto):** código de invitación (personal de un solo uso, código de cohorte multiuso o escotilla del founder) + wallet Stellar (Freighter o wallet de prueba del navegador) + firma ed25519 del CLA. El alta (`/api/onboard`) consume el cupo, crea la fila en `users` como `contributor`, guarda la firma y la encola para anclarla en la red de pruebas. El reingreso (`/api/login`) vuelve a verificar la firma y no escribe nada.
- **Puerta corporativa (Entra ID, detrás de `AUTH_ENTRA_ENABLED`):** NextAuth hace el baile OIDC con el tenant; `/api/auth/entra/exchange` valida tenant y dominio, vincula la identidad a la fila del roster (`pending:<slug>`) o crea `entra:<oid>` como `core`, y emite la misma cookie con `claSigned = false`.

La sesión es un JWT HS256 en la cookie `zelena_session` (httpOnly, SameSite=lax, 24 h). La cookie es una **pista**: las puertas reales (`adminActor`, `equipoActor`, `equipoInternoActor`, `clientActor` en `src/lib/authz.ts`) releen el rol en la tabla `users`. El `middleware.ts` es una segunda capa: exige sesión en `/equipo` y `/clientes`, y sesión **con CLA firmado** en `/perfil` y `/admin`. `/api/logout` borra la cookie.

Quién lo usa: cualquier persona invitada (comunidad, cohortes de clase), el equipo interno (por Entra cuando se encienda) y el founder (por firma de wallet o por la escotilla de arranque).

Casos de uso:

1. Alta con código de invitación personal o de cohorte (`/entrar?code=...` lo prellena desde un QR).
2. Reingreso de una wallet ya registrada, sin código.
3. Primera entrada del founder en un despliegue nuevo con `FOUNDER_BOOTSTRAP_CODE` (nace o se promueve a `founder`).
4. Entrada del equipo con su cuenta corporativa de Microsoft (si el flag está encendido) y registro del segundo correo.
5. Emisión de invitaciones personales desde `/perfil` (tope por tier del genoma).
6. Cerrar sesión (y, si era una wallet de prueba, borrarla del navegador).
7. Autorizar cada página y ruta por rol leído de la base.

Nota sobre el sitio público: el comentario de `middleware.ts` (l. 5-6) lista `/whitepaper` entre las páginas públicas. Esta ficha asume que `/whitepaper` redirige a `/manifiesto` (decisión del founder, en curso en otra rama); el middleware no la cubre en ningún caso.

## 2. Diagrama (DFD)

Archivo: [`docs/dfd/login-y-sesion.tm7`](../dfd/login-y-sesion.tm7), más la imagen exportada [`docs/dfd/login-y-sesion.svg`](../dfd/login-y-sesion.svg). Los dos se generan desde la fuente [`docs/dfd/login-y-sesion.json`](../dfd/login-y-sesion.json) con `python docs/dfd/generar_tm7.py docs/dfd/login-y-sesion.json --estricto`, que pasa: cada `codigo` existe en el repo. La fuente tiene 34 elementos (3 actores, 21 procesos, 10 almacenes), 47 flujos (35 sensibles) y 6 fronteras de confianza.

Vista para GitHub (salida de `--mermaid`): `[/ /]` actor, `(( ))` proceso, `[( )]` almacén, cada `subgraph` es una frontera de confianza y los flujos con `*` y en rojo llevan datos sensibles.

```mermaid
flowchart LR
  subgraph F1["Navegador de la persona (no confiable)"]
    u[/"Persona (navegador)"/]
    wiz(("Asistente /entrar: valida código, crea/conecta wallet y firma"))
    btn(("Botón 'Continuar con Microsoft' (solo si la puerta está disponible)"))
    salir(("Botón Salir (borra la wallet de prueba si se pide)"))
    ls[("localStorage: llave secreta de la wallet de prueba")]
    cookie[("Cookie zelena_session (JWT HS256, 24 h)")]
  end
  subgraph F2["Extensión Freighter (custodia la llave privada)"]
    fr[/"Extensión Freighter (llave privada de la persona)"/]
  end
  subgraph F3["Servidor Next.js en Azure App Service"]
    mw(("Middleware: exige sesión (y CLA en /perfil y /admin)"))
    verify(("POST /api/invite/verify (valida sin consumir)"))
    gen(("POST /api/invite/generate (invitación personal desde /perfil)"))
    cla(("GET /api/cla (texto y hash canónicos)"))
    onb(("POST /api/onboard (alta)"))
    onbl(("performOnboard: hash, firma, cupo y alta en una transacción"))
    login(("POST /api/login (reingreso por firma)"))
    loginl(("performLogin: verifica firma y lee rol de la base"))
    firma(("Verificación ed25519 (plano, sha256, SEP-53)"))
    inv(("Invitaciones: consumo atómico, cohorte y topes por tier"))
    ses(("Sesión: firma/verifica el JWT y escribe la cookie"))
    logout(("POST /api/logout"))
    estado(("GET /api/auth/entra/status (¿se ofrece la puerta?)"))
    na(("NextAuth: baile OIDC con Entra (503 con el flag apagado)"))
    exch(("GET /api/auth/entra/exchange: sesión de Entra → cookie interna"))
    entral(("entraLogin: tenant, dominio y vinculación sin mutar la PK"))
    authz(("Puertas por rol leído de la base (adminActor, equipoActor, equipoInternoActor)"))
    arr(("Arranque: retira demos, siembra escotilla/cohorte y promueve FOUNDER_WALLET"))
    rl[("Contadores de intentos en memoria del proceso")]
    clamd[("CLA.md (texto canónico del acuerdo)")]
  end
  subgraph F4["Configuración del App Service (App Settings)"]
    env[("App Settings (SESSION_SECRET, FOUNDER_WALLET, FOUNDER_BOOTSTRAP_CODE, AUTH_ENTRA_ENABLED, AZURE_AD_*, NEXTAUTH_SECRET)")]
  end
  subgraph F5["Base SQLite persistente (/home/data)"]
    users[("users (wallet, nombre, rol, supervisión, cla_signed, status, entra_oid)")]
    invites[("invites (código, emisor, used_by, max_uses, uses, expires_at)")]
    clas[("cla_signatures (hash, firma, estado de anclaje)")]
    aq[("anchor_queue (huellas pendientes de anclar en testnet)")]
    mails[("user_emails (correo corporativo y segundo correo)")]
  end
  subgraph F6["Tenant de Microsoft Entra ID"]
    ms[/"Microsoft Entra ID (proveedor OIDC del tenant)"/]
  end
  u -->|"f1 Escribe código, nombre visible y elige wallet *"| wiz
  wiz -->|"f2 Validar código *"| verify
  verify -->|"f3 Consultar cupo y vencimiento *"| invites
  wiz -->|"f4 Pedir el acuerdo"| cla
  cla -->|"f5 Leer CLA.md del paquete"| clamd
  wiz -->|"f6 Crear o reutilizar la wallet de prueba *"| ls
  wiz -->|"f7 Pedir acceso y firma *"| fr
  fr -->|"f8 Dirección y firma *"| wiz
  wiz -->|"f9 Alta *"| onb
  onb -->|"f10 Contar intento por IP *"| rl
  onb -->|"f11 Entrada validada con zod *"| onbl
  onbl -->|"f12 ¿La firma es de esa wallet? *"| firma
  onbl -->|"f13 Consumir cupo (después de la firma) *"| inv
  inv -->|"f14 UPDATE condicional (used_by o uses+1) *"| invites
  onbl -->|"f15 INSERT del registro (o promoción por escotilla) *"| users
  onbl -->|"f16 Guardar la firma del CLA *"| clas
  onbl -->|"f17 Encolar huella para anclar"| aq
  onb -->|"f18 Firmar la sesión *"| ses
  env -->|"f19 Leer SESSION_SECRET *"| ses
  ses -->|"f20 Set-Cookie zelena_session *"| cookie
  wiz -->|"f21 Reingreso ('Ya estoy registrado' o 409 wallet_registrada) *"| login
  login -->|"f22 Entrada validada con zod *"| loginl
  loginl -->|"f23 ¿La firma es de esa wallet? *"| firma
  loginl -->|"f24 Leer la fila (solo lectura)"| users
  login -->|"f25 Firmar la sesión *"| ses
  cookie -->|"f26 Cookie en cada petición a /perfil, /admin, /equipo, /clientes *"| mw
  mw -->|"f27 Pasar o redirigir a /entrar?next=…"| u
  authz -->|"f28 Resolver el rol contra la base"| users
  u -->|"f29 Generar invitación personal *"| gen
  gen -->|"f30 INSERT de invitación con tope por tier *"| invites
  salir -->|"f31 Borrar la wallet de prueba (opcional) *"| ls
  salir -->|"f32 Cerrar sesión"| logout
  logout -->|"f33 Borrar la cookie (sin revocar el JWT) *"| cookie
  btn -->|"f34 ¿Dibujar el botón?"| estado
  btn -->|"f35 signIn(microsoft-entra-id)"| na
  na -->|"f36 Autorización OIDC (openid profile email) *"| ms
  na -->|"f37 JWT efímero de NextAuth con los claims puenteados *"| exch
  exch -->|"f38 Validar y resolver identidad *"| entral
  entral -->|"f39 Vincular entra_oid o crear entra:‹oid› core *"| users
  entral -->|"f40 Correo corporativo como primary *"| mails
  exch -->|"f41 Set-Cookie zelena_session (claSigned=false) y borrar cookies de NextAuth *"| cookie
  env -->|"f42 Variables de arranque *"| arr
  arr -->|"f43 Sembrar escotilla/cohorte y vencer GENESIS demo *"| invites
  arr -->|"f44 Promover FOUNDER_WALLET a founder (nunca degrada)"| users
  ses -->|"f45 Claims verificados (desde cada página y ruta protegida) *"| authz
  u -->|"f46 Clic en Continuar con Microsoft"| btn
  u -->|"f47 Clic en Salir"| salir
  linkStyle 0,1,2,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,24,25,28,29,30,32,35,36,37,38,39,40,41,42,44 stroke:#b03a2e,color:#b03a2e
  style F1 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F2 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F3 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F4 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F5 fill:none,stroke:#c0392b,stroke-dasharray:6 4
  style F6 fill:none,stroke:#c0392b,stroke-dasharray:6 4
```

## 3. Recorrido de una acción

Acción elegida: **una persona nueva entra con un código de invitación y su wallet de Freighter, y firma el acuerdo de contribución.**

1. **Pantalla o componente:** `app/entrar/page.tsx#Entrar`, asistente de 4 pasos (`STEPS`, l. 23). Paso 1: escribe el código (o llega prellenado por `?code=`, l. 80-95) y `verifyCode` (l. 97-118) llama a `POST /api/invite/verify`, que solo consulta (`src/lib/invites.ts#checkInvite`, l. 111-140) y nunca consume. Paso 2: "Conectar mi wallet" → `connectFreighter` (l. 201-253) pide permiso con `requestAccess`/`getAddress`; escribe su nombre visible. Paso 3: carga el acuerdo con `GET /api/cla` (l. 65-75) y calcula en el navegador el SHA-256 del texto; "Firmar y entrar" → `signAndFinish` (l. 284-359) pide a Freighter `signMessage(payload)` con `payload = "zelena-cla-testnet-v1:" + hash` (`src/lib/cla-signing.ts#claSigningPayload`, l. 13-17).
2. **Llamada al backend:** `POST /api/onboard` con `{ code, wallet, name, isDemo: false, claHash, signature }` (page.tsx l. 324-328). Si responde 409 con `reason: "wallet_registrada"`, el asistente reintenta solo con `POST /api/login` y `{ wallet, claHash, signature }` (l. 337-346).
3. **Ruta y controlador:** `app/api/onboard/route.ts#POST`: límite de 10 intentos por minuto por IP (`rateLimit("onboard:<ip>")`, l. 12), validación con `onboardSchema` (l. 16; `src/lib/validation.ts` l. 31-38: wallet `[A-Z0-9]{10,80}`, nombre de 2 a 40 letras sin palabras reservadas como "founder" o "admin", hash de 64 caracteres) y llamada a `performOnboard` (l. 23). El handler no tiene lógica propia.
4. **Lógica de negocio:** `src/lib/onboard.ts#performOnboard` (l. 70-145), en este orden:
   - el hash recibido debe ser el del `CLA.md` del servidor (l. 74-76; `src/lib/cla.ts#claCanonicalHash`);
   - la firma debe ser de esa wallet (l. 80-82): `src/lib/crypto.ts#verifyWalletSignature` valida la llave `G…` con checksum, exige 64 bytes y prueba cuatro preimágenes del mismo payload (texto plano, su SHA-256, SEP-53 de Freighter y SEP-53 sin hash; l. 18-35 y 70-79). Esto pasa **antes** de tocar la invitación;
   - rol: `founder` si el código es la escotilla `FOUNDER_BOOTSTRAP_CODE` (`src/lib/config.ts#isBootstrapCode`, l. 231-234), si no `contributor` (l. 92-93);
   - en una sola transacción (l. 100-144): si la wallet ya existe, 409 (salvo escotilla sobre una fila con CLA, que la promueve, l. 113-125); consumo atómico del cupo (`src/lib/invites.ts#consumeInvite`, l. 167-213: `uses + 1` con guarda `uses < max_uses` en cohortes, `used_by` en invitaciones personales); alta en `users`, `cla_signatures` y `anchor_queue` (l. 132-141).
5. **Base de datos:** lee `invites` y `users`; escribe `invites` (`used_by` o `uses`), `users` (`role = 'contributor'`, `tier = 'Bronze'`, `cla_signed = 1`, `invited_by` = emisor del código), `cla_signatures` (hash, firma, `anchor_status = 'pending'`) y `anchor_queue` (`kind = 'cla'`, `data_key = cla:v1:<12 primeros de la wallet>`). El worker de anclaje (otra feature) marca después la firma como anclada.
6. **Respuesta y qué hace la pantalla:** 200 `{ ok: true }` y `Set-Cookie: zelena_session=<JWT>` (`src/lib/session.ts#setSessionCookie`, l. 17-26: httpOnly, SameSite=lax, `secure` solo en producción, 24 h; firma HS256 con `SESSION_SECRET` en `src/lib/jwt.ts`, l. 7-17 y 40-46). Claims: `wallet, name, tier, role, isSupervisor, isFounder, claSigned: true, isDemo`. La pantalla hace `router.push("/perfil")` (l. 331). En `/perfil`, el middleware verifica el JWT y que `claSigned` sea verdadero (`middleware.ts`, l. 33-48) y la página lee la sesión con `getSession`.
7. **Casos de falla:**

   | Situación | Respuesta | Qué hace la pantalla |
   | --- | --- | --- |
   | Más de 10 intentos en un minuto desde la misma IP | 429 "Demasiados intentos." | Muestra el error. |
   | Cuerpo inválido (nombre reservado, wallet mal escrita) | 400 "Entrada inválida." (sin detalle) | Muestra el error genérico. |
   | El acuerdo cambió mientras firmaba | 400 `cla_desactualizado` | Muestra el error. |
   | Firma que no corresponde a la wallet | 400 `firma_invalida` (401 en `/api/login`) | Muestra el error; el código **no** se gasta. |
   | Wallet ya registrada | 409 `wallet_registrada` | Reintenta solo con `/api/login`. |
   | Cupos agotados, código vencido o inexistente | 409 `cupos_agotados` / `codigo_expirado` / `codigo_invalido` | Muestra el mensaje y no reintenta. |
   | Wallet sin registro en `/api/login` | 404 `no_registrada` | "Usa un código de invitación." |
   | Freighter sin `signMessage` | No llama al servidor | Pide usar la wallet de prueba (l. 299-306). |
   | Navegador sin almacenamiento (modo privado) | — | La wallet de prueba vive solo en memoria; avisa no cerrar la pestaña (l. 145-149, 578-584). |
   | Falla al escribir en medio del alta | Se revierte todo, incluido el cupo | 400 "No se pudo completar el registro." |

## 4. Elementos del DFD en el código

| Elemento | Tipo | Archivo y función | Notas |
| --- | --- | --- | --- |
| Persona (navegador) | Cliente externo | `app/entrar/page.tsx#Entrar` | Llega desde el botón "Entrar" del menú (`src/components/Nav.tsx#Nav`) o desde un QR con `?code=`. |
| Extensión Freighter | Cliente externo | `app/entrar/page.tsx#connectFreighter` | Se carga con `import("@stellar/freighter-api")`; custodia la llave privada. |
| Microsoft Entra ID | Cliente externo | `app/api/auth/entra-options.ts#entraAuthOptions` | Provider `azure-ad` de NextAuth v4 con id `microsoft-entra-id`; solo scopes OIDC, sin Graph (l. 74). |
| Asistente /entrar | Proceso | `app/entrar/page.tsx#signAndFinish` | También `verifyCode`, `crearWalletDemo`, `elegirWalletDemo`, `usarGuardada`, `descartarGuardada`. Decide entre `/api/onboard` y `/api/login` (l. 322-346). |
| Botón "Continuar con Microsoft" | Proceso | `src/components/EntraSignInButton.tsx#EntraSignInButton` | No se dibuja si `/api/auth/entra/status` no dice `available: true` (l. 66). |
| Botón Salir | Proceso | `src/components/SalirButton.tsx#SalirButton` | Ofrece borrar la wallet de prueba si la sesión es demo. |
| Middleware | Proceso | `middleware.ts#middleware` | Matcher: `/perfil`, `/admin`, `/equipo`, `/clientes` (l. 50-52). Ninguna ruta `/api` pasa por él. |
| POST /api/invite/verify | Proceso | `app/api/invite/verify/route.ts#POST` | 20 por minuto por IP; responde 200 incluso si el código no vale. |
| POST /api/invite/generate | Proceso | `app/api/invite/generate/route.ts#POST` | Usado por `src/components/InviteGenerator.tsx` en `/perfil`; autoriza con `session.claSigned` de la cookie. |
| GET /api/cla | Proceso | `app/api/cla/route.ts#GET` | Devuelve `{ text, hash }`. |
| POST /api/onboard | Proceso | `app/api/onboard/route.ts#POST` | Solo valida forma, limita y llama a `performOnboard`. |
| performOnboard | Proceso | `src/lib/onboard.ts#performOnboard` | Núcleo del alta; sin HTTP ni cookies. |
| POST /api/login | Proceso | `app/api/login/route.ts#POST` | Solo valida forma, limita y llama a `performLogin`. |
| performLogin | Proceso | `src/lib/onboard.ts#performLogin` | No escribe; rol desde la base (l. 207). No mira `status`. |
| Verificación de firma | Proceso | `src/lib/crypto.ts#verifyWalletSignature` | Nunca lanza; acepta 4 preimágenes (`preimagenesAceptadas`). |
| Invitaciones | Proceso | `src/lib/invites.ts#consumeInvite` | También `checkInvite`, `generateInvite` (tope por tier, l. 49-62) y `createCohortInvite`. |
| Sesión | Proceso | `src/lib/session.ts#setSessionCookie` | Con `getSession` y `clearSessionCookie`; el JWT puro vive en `src/lib/jwt.ts#signSession` / `#verifySession` (usable en el middleware). |
| POST /api/logout | Proceso | `app/api/logout/route.ts#POST` | Solo borra la cookie (l. 12). |
| GET /api/auth/entra/status | Proceso | `app/api/auth/entra/status/route.ts#GET` | Público; fuera de producción lista los nombres de variables faltantes. |
| NextAuth | Proceso | `app/api/auth/[...nextauth]/route.ts#handler` | 503 si `entraAuthOptions()` devuelve null (flag apagado o sin configurar). |
| Intercambio Entra → cookie | Proceso | `app/api/auth/entra/exchange/route.ts#GET` | Firma la misma cookie con `claSigned` de la fila y borra las de NextAuth (l. 98-105). |
| entraLogin | Proceso | `src/lib/entra.ts#entraLogin` | `validateEntraToken` (pura) + `resolveEntraLogin` (4 caminos: oid, correo, roster, alta `entra:<oid>`). |
| Puertas por rol | Proceso | `src/lib/authz.ts#adminActor` | Con `equipoActor`, `equipoInternoActor`, `clientActor`, `accesoEquipo`. Leen `users`; la cookie no concede nada. |
| Arranque | Proceso | `src/lib/db.ts#prepararSqlite` | Llama a `seedIfEmpty` (`src/lib/seed.ts`: `retirarInvitacionesDemo`, `seedBootstrapInvite`, `seedCohortInvite`) y a `backfillFounder`. |
| localStorage (wallet de prueba) | Almacén de datos | `app/entrar/page.tsx#crearWalletDemo` | Clave `zelena_demo_wallet` con la llave pública y la **secreta** (l. 143). |
| Cookie zelena_session | Almacén de datos | `src/lib/jwt.ts#SESSION_COOKIE` | JWT HS256, 24 h, httpOnly, SameSite=lax. |
| Contadores de intentos | Almacén de datos | `src/lib/rate-limit.ts#rateLimit` | `Map` en `globalThis`; por instancia; IP de `X-Forwarded-For` (`clientIp`, l. 22-26). |
| App Settings | Almacén de datos | `src/lib/config.ts#bootstrapInviteCode` | También `isEntraEnabled`, `entraSettings`, `FOUNDER_WALLET` (config.ts) y `SESSION_SECRET` (jwt.ts). |
| CLA.md | Almacén de datos | `src/lib/cla.ts#readClaText` | Si no encuentra el archivo devuelve un **texto de reserva** (l. 19). |
| users | Almacén de datos | `src/lib/schema.sql#users` | `role` y `is_supervisor` son ejes independientes; `status` = active/alumni. |
| invites | Almacén de datos | `src/lib/schema.sql#invites` | `max_uses` NULL = un solo uso; no NULL = cohorte. |
| cla_signatures | Almacén de datos | `src/lib/schema.sql#cla_signatures` | Guarda la firma tal cual (ver amenaza 1 de la sección 7). |
| anchor_queue | Almacén de datos | `src/lib/schema.sql#anchor_queue` | La consume el anclaje (otra feature). |
| user_emails | Almacén de datos | `src/lib/schema.sql#user_emails` | Correo corporativo (`primary`) y segundo correo (`recovery`); `UNIQUE(email)`. |

## 5. Flujos de datos

Los flujos con **[sensible]** llevan credenciales, firmas, sesión o datos personales.

| Flujo | De → a | Protocolo | Datos que viajan |
| --- | --- | --- | --- |
| f1 | Persona → Asistente /entrar | UI del navegador | **[sensible]** código de invitación, nombre visible |
| f2 | Asistente → POST /api/invite/verify | HTTPS (JSON) | **[sensible]** `{ code }` (la escotilla también es un código) |
| f3 | /api/invite/verify → invites | SQL | **[sensible]** code → used_by, uses, max_uses, expires_at |
| f4 | Asistente → GET /api/cla | HTTPS (JSON) | texto del CLA y su SHA-256 |
| f5 | /api/cla → CLA.md | Sistema de archivos | texto canónico (o texto de reserva si falta) |
| f6 | Asistente → localStorage | Web Storage | **[sensible]** llave pública y **secreta** de la wallet de prueba |
| f7 | Asistente → Freighter | API de la extensión | **[sensible]** `requestAccess`, `getAddress`, `signMessage(payload)` |
| f8 | Freighter → Asistente | API de la extensión | **[sensible]** llave pública `G…` y firma ed25519 en base64 |
| f9 | Asistente → POST /api/onboard | HTTPS (JSON) | **[sensible]** `{ code, wallet, name, isDemo, claHash, signature }` |
| f10 | /api/onboard → contadores | Memoria del proceso | **[sensible]** `onboard:<IP>` (IP = dato personal) |
| f11 | /api/onboard → performOnboard | Llamada en proceso | **[sensible]** entrada validada con zod |
| f12 | performOnboard → verifyWalletSignature | Llamada en proceso | **[sensible]** wallet, payload, firma |
| f13 | performOnboard → consumeInvite | Llamada en proceso | **[sensible]** code, wallet |
| f14 | consumeInvite → invites | SQL | **[sensible]** UPDATE condicional; devuelve `issuer_wallet` |
| f15 | performOnboard → users | SQL | **[sensible]** wallet, nombre, invitado por, rol, `cla_signed = 1` |
| f16 | performOnboard → cla_signatures | SQL | **[sensible]** wallet, versión, hash, firma |
| f17 | performOnboard → anchor_queue | SQL | `kind = cla`, wallet, `data_key`, hash del CLA |
| f18 | /api/onboard → sesión | Llamada en proceso | **[sensible]** claims de la sesión |
| f19 | App Settings → sesión | Variables de entorno | **[sensible]** `SESSION_SECRET` |
| f20 | Sesión → cookie | HTTPS (Set-Cookie) | **[sensible]** JWT firmado (httpOnly, SameSite=lax, `secure` en producción) |
| f21 | Asistente → POST /api/login | HTTPS (JSON) | **[sensible]** `{ wallet, claHash, signature }` |
| f22 | /api/login → performLogin | Llamada en proceso | **[sensible]** entrada validada |
| f23 | performLogin → verifyWalletSignature | Llamada en proceso | **[sensible]** wallet, payload, firma |
| f24 | performLogin → users | SQL | role, is_supervisor, is_founder, cla_signed, tier, is_demo (solo lectura) |
| f25 | /api/login → sesión | Llamada en proceso | **[sensible]** claims leídos de la base, `claSigned: true` |
| f26 | Cookie → middleware | HTTPS (Cookie) | **[sensible]** JWT en cada petición a /perfil, /admin, /equipo, /clientes |
| f27 | Middleware → Persona | HTTPS (307) | redirección a `/entrar?next=<ruta>` o paso |
| f28 | Puertas por rol → users | SQL | role, is_supervisor, is_founder, status, cla_signed |
| f29 | Persona → POST /api/invite/generate | HTTPS (Cookie) | **[sensible]** cookie de sesión |
| f30 | /api/invite/generate → invites | SQL | **[sensible]** nuevo código `GENESIS-<10 hex>`, emisor, vence a 30 días |
| f31 | Botón Salir → localStorage | Web Storage | **[sensible]** borra `zelena_demo_wallet` |
| f32 | Botón Salir → POST /api/logout | HTTPS | POST sin cuerpo |
| f33 | /api/logout → cookie | HTTPS (Set-Cookie) | **[sensible]** borra `zelena_session` (no revoca el JWT) |
| f34 | Botón Microsoft → /api/auth/entra/status | HTTPS (JSON) | `available`, `enabled`, `configured` |
| f35 | Botón Microsoft → NextAuth | HTTPS (redirección) | `signIn` con `callbackUrl=/api/auth/entra/exchange` |
| f36 | NextAuth ↔ Entra ID | HTTPS (OIDC) | **[sensible]** code, `id_token` con tid, oid, correo y nombre |
| f37 | NextAuth → intercambio | HTTPS (cookie de NextAuth) | **[sensible]** tid, oid, correo, nombre (sin access_token) |
| f38 | Intercambio → entraLogin | Llamada en proceso | **[sensible]** claims + tenant y dominio esperados |
| f39 | entraLogin → users | SQL | **[sensible]** entra_oid, auth_provider, role, is_supervisor, nombre |
| f40 | entraLogin → user_emails | SQL | **[sensible]** correo corporativo como `primary` |
| f41 | Intercambio → cookie | HTTPS (Set-Cookie) | **[sensible]** JWT con `claSigned: false`; borra cookies de NextAuth |
| f42 | App Settings → arranque | Variables de entorno | **[sensible]** FOUNDER_WALLET, FOUNDER_BOOTSTRAP_CODE, SEED_COHORT, SEED_DEMO |
| f43 | Arranque → invites | SQL | **[sensible]** siembra la escotilla (7 días, un uso) y la cohorte; vence GENESIS-0001..0006 en producción |
| f44 | Arranque → users | SQL | `role = 'founder'`, `is_supervisor = 1` para `FOUNDER_WALLET` (nunca degrada) |
| f45 | Sesión → puertas por rol | Llamada en proceso | **[sensible]** claims verificados que cada página o ruta protegida pasa a `adminActor`/`equipoActor`/`equipoInternoActor` |
| f46 | Persona → botón Microsoft | UI del navegador | clic (sin datos) |
| f47 | Persona → botón Salir | UI del navegador | si borrar o no la wallet de prueba |

## 6. Dependencias con otras features

Casi todo depende de esta feature; estas son las dependencias concretas encontradas en el código:

- **Admin** (`docs/features/admin.md`): `/admin` está en `PROTECTED_CLA` del middleware y su puerta es `adminActor`. Un founder que entra por Entra (sin CLA) no abre la página pero sí puede llamar a `/api/admin` (ver hallazgos).
- **Equipo** ([dashboard](dashboard.md), [actividades](actividades.md), [proyectos-y-membresias](proyectos-y-membresias.md); `/equipo/**`, `/api/equipo/**`) y **Telegram** ([telegram](telegram.md); `/api/telegram/vincular`, `/equipo/telegram`): cada página y ruta llama a `equipoActor` o `equipoInternoActor`; `src/components/Nav.tsx` usa `accesoEquipo` para dibujar "Mi día" y "Proyectos".
- **Clientes** (`/clientes/**`, `/api/clientes/grafo`): `clientActor` y `adminActor`.
- **Talento y vinculación del roster** (`src/lib/talento.ts#vincularPrincipal`): mueve `user_emails` y el trabajo de una fila `pending:<slug>` a la wallet real; es el único camino para que alguien que entró por Entra quede con CLA firmado. Las filas `entra:<oid>` (fuera del roster) no tienen ese camino.
- **Anclaje en Stellar** (`src/lib/anchor.ts`, `packages/scripts/anchor-worker.mjs`, `/api/anchor/run`): consume las filas `kind = 'cla'` de `anchor_queue` y actualiza `cla_signatures.anchor_status`. `/api/anchor/run` también usa `adminActor`.
- **Ágora, Academia y gobernanza** (`/api/apply`, `/api/academia/*`, `/api/governance/vote`): autorizan con `session.claSigned` de la cookie, no con la base.
- **Perfil** (`app/perfil/page.tsx`): exige CLA (middleware), muestra las invitaciones emitidas y monta `InviteGenerator`.
- **Ritos** (`src/lib/ritos.ts`): exige `users.cla_signed` para registrar asistencia.
- **Arranque y base de datos** (`src/lib/db.ts`, `src/lib/seed.ts`): siembra y vence invitaciones, siembra el roster `pending:<slug>` (`seedTeam`) y promueve `FOUNDER_WALLET`.
- **Sitio público**: el botón "Entrar" del menú, `/acuerdo` (texto del CLA) y `/privacidad` (enlazado desde el paso 2).

Dependencias inversas anotadas al integrar (la otra ficha ya las tenía; la guía pide anotarlas en las dos):

- **Gamificación y épocas** ([gamificacion-y-epocas.md](gamificacion-y-epocas.md)): la aprobación y la regla B8 usan `equipoActor` y `adminActor` (`src/lib/authz.ts`) e `identidadesDe`, `mismaPersona` y `reglaB8` (`src/lib/identidades.ts`), que leen `roster_links`, el rol founder e `invited_by` de `users`.
- **SLA, recordatorios y avisos** ([sla-recordatorios-y-avisos.md](sla-recordatorios-y-avisos.md)): `/api/avisos` lee la sesión con `getSession` y `/equipo/avisos` usa `equipoActor` como puerta.

## 7. Amenazas relevantes

| Amenaza | Categoría | Elemento | Estado | Justificación |
| --- | --- | --- | --- | --- |
| 1. Reproducir la firma de otra persona para entrar como ella | Suplantación | POST /api/login, performLogin | Pendiente | El login firma un payload **fijo** (`src/lib/cla-signing.ts:16-17`) y ed25519 es determinista: la firma nunca cambia y no hay reto ni nonce (`src/lib/onboard.ts:176-184`). Esa firma queda guardada tal cual en `cla_signatures.signature` (`src/lib/onboard.ts:137`) y el asistente la pinta en pantalla (`app/entrar/page.tsx:308` y `:318`). Quien la vea o lea una copia de la base (respaldo `VACUUM INTO`, Kudu) entra como esa wallet sin la llave. La prueba de caracterización lo fija (paso 9). |
| 2. Firma falsa, alterada o hecha con otra llave | Suplantación | Verificación de firma | Mitigada | `src/lib/crypto.ts:18-35`: valida la llave `G…` con checksum, exige 64 bytes (`:26`) y verifica ed25519 contra la llave declarada; llamada en `src/lib/onboard.ts:80` y `:182`. Cubierto por `src/lib/crypto.ts` tests y el paso 10 de la caracterización. |
| 3. Reusar la firma del CLA en otra red u otro contrato | Suplantación | Verificación de firma | Mitigada | Separador de dominio `zelena-cla-testnet-v1` en el payload (`src/lib/cla-signing.ts:13-17`); test "firma del hash SIN domain separator" en `src/lib/onboard.test.ts`. |
| 4. Alterar la cookie para subir de rol | Manipulación / Elevación | Cookie zelena_session, puertas por rol | Mitigada | JWT HS256 verificado en cada lectura (`src/lib/jwt.ts:48-55`); además `adminActor`/`equipoActor` releen `users.role` y no la cookie (`src/lib/authz.ts:58-84`, `:120-154`). Paso 6 de la caracterización: una cookie firmada que se declara founder sigue sin administrar. |
| 5. Secreto de sesión débil o el de desarrollo en un despliegue | Elevación | App Settings, sesión | Mitigada | Con `NODE_ENV=production` la app no arranca sin `SESSION_SECRET` de ≥ 32 caracteres (`src/lib/jwt.ts:9-13`). Riesgo residual aceptado: un entorno que corra sin `NODE_ENV=production` usa el secreto público de `src/lib/jwt.ts:14`. |
| 6. Robo de la cookie (XSS) o equipo compartido | Suplantación | Cookie zelena_session | Pendiente | `httpOnly` y `secure` en producción (`src/lib/session.ts:20-22`) evitan leerla desde JavaScript, pero el JWT no se puede revocar: `/api/logout` solo borra la cookie del navegador (`app/api/logout/route.ts:12`) y una copia vale hasta 24 h (`src/lib/jwt.ts:44`). Paso 7 de la caracterización. |
| 7. Fuerza bruta de códigos o abuso del alta y del login | Denegación / Suplantación | Contadores de intentos | Pendiente | Hay límite por IP (`app/api/login/route.ts:17`, `app/api/onboard/route.ts:12`, `app/api/invite/verify/route.ts:11`), pero la IP sale del **primer** valor de `X-Forwarded-For`, que manda el cliente (`src/lib/rate-limit.ts:22-24`), y el contador vive en memoria de cada instancia (`:7-8`). Cambiar el encabezado reinicia el límite (paso 12 de la caracterización). |
| 8. Adivinar una invitación personal | Elevación | Invitaciones | Mitigada | 40 bits aleatorios por código (`src/lib/invites.ts:45-47`), un solo uso con consumo atómico (`:195-200`) y vencimiento a 30 días. |
| 9. Código de cohorte público con cientos de cupos | Elevación | Invitaciones, arranque | Aceptada | El código de cohorte (`COHORT_CODE`) está en el repo público (`src/lib/seed.ts:140`) con 400 cupos (`:146`) y solo se siembra con `SEED_COHORT=1` (`:150-152`), decisión registrada del líder (comentario `:134-139`). Solo da `contributor` sin acceso al equipo interno. Ojo: cada reinicio con la variable lleva el vencimiento a hoy + 45 días (`src/lib/invites.ts:96-101`), así que no vence mientras la variable siga puesta. |
| 10. Códigos demo GENESIS publicados en el README | Elevación | Invitaciones, arranque | Mitigada | En producción no se siembran (`src/lib/seed.ts:31-34`) y los que existan sin usar se vencen en cada arranque (`:59-72`). |
| 11. Filtración del código de arranque del founder | Elevación | App Settings, performOnboard | Aceptada | Por diseño es la "llave de root" (`src/lib/onboard.ts:84-93`): vive solo en App Settings, exige 16-40 caracteres (`src/lib/config.ts:220-228`), es de un solo uso y vence a los 7 días (`src/lib/seed.ts:111-128`). Quien lo tenga y una wallet propia se vuelve founder. |
| 12. Sesión de alguien dado de baja (alumni) | Elevación | Puertas por rol, performLogin | Pendiente | `equipoActor` rechaza `status <> 'active'` (`src/lib/authz.ts:136`), pero `adminActor` y `equipoInternoActor` no leen `status` (`:58-73`, `:80-94`; lo admite el comentario de `src/lib/talento.ts:95-99`) y `/api/login` deja entrar a una wallet alumni (`src/lib/onboard.ts:185-203` no lee `status`). |
| 13. Autorizar con un claim viejo de la cookie | Elevación | /api/apply, /api/invite/generate, /api/academia/*, /api/governance/vote | Pendiente | Seis rutas (siete handlers) deciden con `session.claSigned` de la cookie (p. ej. `app/api/invite/generate/route.ts:12`) en vez de releer `users`, contra la regla de `src/lib/jwt.ts:33-34` ("la cookie es una PISTA"). Hoy `cla_signed` no se revierte, por eso el impacto es bajo. |
| 14. Cuenta de otro tenant, invitado B2B o dominio ajeno por Entra | Suplantación | entraLogin, NextAuth | Mitigada | Se compara el `tid` firmado (`src/lib/entra.ts:170-184`), se rechaza `#EXT#` (`:203-213`) y el dominio (`:215-227`); el callback `signIn` corta antes de emitir sesión (`app/api/auth/entra-options.ts:92-100`). Cubierto por `src/lib/entra.test.ts`. |
| 15. Quedarse con la fila del roster de otra persona por coincidencia de nombre | Suplantación | entraLogin | Pendiente | La guarda anti-fusión solo actúa si la fila ya tiene `entra_oid` (`src/lib/entra.ts:501-506`). La **primera** cuenta del tenant cuyo correo o primer nombre coincida con un alias del roster (`rosterMemberForIdentity`, `:323-336`) se vincula a esa fila `pending:<slug>` y hereda su rol y su trabajo. Riesgo acotado al tenant propio. |
| 16. Redirección abierta después del login | Manipulación | NextAuth, asistente | Mitigada | El callback `redirect` solo permite la propia app (`app/api/auth/entra-options.ts:116-118`); el asistente siempre va a `/perfil` (`app/entrar/page.tsx:331`, `:352`). |
| 17. Robo de la llave secreta de la wallet de prueba | Divulgación | localStorage | Aceptada | Es testnet, la cuenta queda `is_demo = 1`, la UI pide confirmar si hay una guardada (`app/entrar/page.tsx:168-179`, `:553-575`) y Salir ofrece borrarla (`src/components/SalirButton.tsx:17-23`). Un XSS en el mismo origen la expondría. |
| 18. Firmar un texto de reserva si falta CLA.md | Manipulación / Repudio | CLA.md, /api/cla | Mitigada | `src/lib/cla.ts:19` devuelve un texto de reserva en vez de fallar (ya pasó el 2026-09-04, según `apps/web/scripts/verificar-paquete.mjs:11`). Se mitiga en el despliegue: el ensayo del paquete exige `CLA.md` con el sha256 firmado (`verificar-paquete.mjs:189-200`). En tiempo de ejecución sigue sin fallar cerrado. |
| 19. Repudio del acuerdo firmado | Repudio | cla_signatures, anchor_queue | Mitigada | Se guarda hash y firma (`src/lib/onboard.ts:136-138`) y se encola la huella para la red de pruebas en la misma transacción (`:139-141`). |
| 20. Sin rastro de quién entró y cuándo | Repudio | performLogin | Pendiente | `performLogin` no escribe nada por diseño (`src/lib/onboard.ts:166-175`); no hay registro de accesos ni de fallos más allá del contador en memoria. |
| 21. Cupo quemado sin alta | Denegación | performOnboard, invites | Mitigada | La firma se verifica antes de consumir (`src/lib/onboard.ts:78-82`) y cupo + alta van en una transacción (`:95-144`); test "si el alta falla DESPUÉS de consumir, el cupo se devuelve" en `src/lib/onboard.test.ts`. |
| 22. Peticiones cruzadas con la cookie del usuario (CSRF) | Manipulación | Cookie zelena_session | Mitigada | `SameSite=lax` (`src/lib/session.ts:21`, exchange `:98-104`): un POST desde otro sitio no lleva la cookie. |

## 8. Prueba de caracterización

Archivo: `apps/web/src/lib/caracterizacion/login-y-sesion.test.ts` (16 casos, pasa). Se corre con:

```bash
cd apps/web && npx vitest run src/lib/caracterizacion/login-y-sesion.test.ts
```

Qué cubre: el flujo principal de punta a punta llamando a los **handlers reales** (`/api/invite/verify`, `/api/cla`, `/api/onboard`, `/api/login`, `/api/logout`, `/api/admin`, `/api/auth/entra/status`) y al `middleware.ts`, contra una base SQLite **temporal en disco** arrancada con `prepararSqlite` (la misma secuencia que producción: schema, migraciones y seed). `next/headers` se reemplaza por un tarro de cookies en memoria y los alias `@/lib/*` apuntan a los módulos reales; no se toca código de la app.

Pasos: (1) validar `GENESIS-0001` sin consumirlo; (2) leer el CLA y recalcular su hash; (3) alta con firma de wallet de prueba: fila `contributor`, cupo consumido, firma y huella encoladas, cookie httpOnly/lax/24 h con sus claims; (4) misma wallet con otro código → 409 sin gastar el código; (5) middleware sin cookie, con cookie y con token alterado; (6) las puertas leen la base: el contribuidor no administra aunque su cookie diga founder, y `/api/admin` responde 403; (7) logout borra la cookie pero el JWT sigue verificando; (8) reingreso por `/api/login` sin escribir en la base; (9) la firma del alta sirve tal cual para entrar otra vez; (10) fallas 401, 404, 400; (11) alta con firma SEP-53 (Freighter); (12) límite de 10 por minuto que se reinicia cambiando `X-Forwarded-For`. Caminos alternos: escotilla del founder (nace founder + supervisor y pasa `/api/admin`), Entra apagado (no se ofrece, no escribe) y encendido (`entra:<oid>` core sin CLA: entra a `/equipo`, no a `/perfil`), y el matcher del middleware.

Los casos 7, 9 y 12 fijan **hallazgos** (amenazas 1, 6 y 7): si alguien los corrige, la prueba fallará a propósito y esta ficha se actualiza en el mismo cambio.

Pruebas existentes que cubren piezas del feature: `src/lib/onboard.test.ts` (orden firma → cupo, escotilla, atomicidad), `src/lib/crypto.test.ts` (ed25519, sha256, SEP-53), `src/lib/invites.test.ts` (topes, cohorte, doble uso), `src/lib/entra.test.ts` (tenant, roster, segundo correo), `src/lib/authz.test.ts` (puertas y tests estáticos por página), `src/lib/sin-gates-por-persona.test.ts` (ningún gate compara `FOUNDER_WALLET` en `app/`).

## 9. Preguntas abiertas

1. ¿Está encendido `AUTH_ENTRA_ENABLED` en producción hoy, y existe el app registration? `docs/DESPLIEGUE-V1.md` lo daba por apagado en la fusión del 2026-09-30. Sin eso, el "entrar con mi correo" no existe para nadie.
2. ¿El founder debe poder abrir `/admin` entrando por Microsoft? Hoy el middleware se lo impide por no tener CLA, aunque `adminActor` sí lo deja pasar y `src/lib/authz.test.ts` (D3-01) da por hecho que "el founder que entra por Entra SÍ administra".
3. ¿Cómo firma el CLA alguien que entró por Entra y no está en el roster (`entra:<oid>`)? El botón dice "El CLA se firma después, cuando llegue tu primer bounty" (`src/components/EntraSignInButton.tsx:87`), pero no hay pantalla para hacerlo y la vinculación del roster solo acepta filas `pending:<slug>`.
4. ¿Se quiere un login con correo personal? Requiere enviar correos (fuera de alcance en v1 según `CLAUDE.md`) y cambiar los tres textos que hoy lo prometen.
5. ¿Se reemplaza la firma fija del login por un reto con nonce de un solo uso? Es el cambio que cierra la amenaza 1.
6. ¿Azure App Service garantiza que el primer valor de `X-Forwarded-For` es la IP real? Si no, el límite de intentos se puede saltar.
7. ¿Qué debe pasar con una cuenta `alumni` que entra por `/api/login`? Hoy entra; solo `equipoActor` la frena.
8. ¿Para qué es el parámetro `?next=` que agrega el middleware? `/entrar` no lo lee y siempre manda a `/perfil`.
