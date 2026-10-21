# Auditoría del sistema por features

Fecha: 2026-10-21 · Commit de referencia: `0e07d8f` · Rama: `docs/auditoria-features` · Método: "Guía para documentar el sistema por features" (14 de octubre de 2026)

Este reporte sirve para **organizar** el sistema antes de sacar la nueva versión. Junta lo que encontraron los siete documentadores en las 16 fichas y el Paso 0 (`docs/features/`), lo deja sin repetidos y lo convierte en tres cosas: lo que hay que arreglar antes de publicar, cómo ordenar el repo y el plan semanal del QA.

Las fichas son la fuente del detalle: cada hallazgo de aquí apunta a su evidencia (`archivo:línea`) y a la ficha donde está explicado. El repo es público: este documento no nombra clientes, personas, correos, secretos ni datos de producción.

## Contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [¿Por qué me pide wallet? ¿Puedo entrar con Freighter o con mi correo?](#2-por-qué-me-pide-wallet-puedo-entrar-con-freighter-o-con-mi-correo)
3. [Mapa del sistema](#3-mapa-del-sistema)
4. [Hallazgos consolidados](#4-hallazgos-consolidados)
5. [Propuesta de organización](#5-propuesta-de-organización)
6. [Retiro del whitepaper: lista para la rama paralela](#6-retiro-del-whitepaper-lista-para-la-rama-paralela)
7. [Plan de las próximas sesiones del QA](#7-plan-de-las-próximas-sesiones-del-qa)
8. [Decisiones que necesita John](#8-decisiones-que-necesita-john)
9. [Cómo se verificó esta auditoría](#9-cómo-se-verificó-esta-auditoría)

## 1. Resumen ejecutivo

### Qué hay

Una sola aplicación Next.js 14 (`apps/web`) con **31 pantallas, 37 endpoints, 65 módulos de lógica en `src/lib/` y 45 componentes**, sobre SQLite en Azure App Service y la red de pruebas de Stellar. Se partió en **16 features** más el esqueleto común:

- **Puertas:** login y sesión (wallet + firma del acuerdo; Microsoft Entra detrás de un interruptor), admin del founder.
- **Trabajo del equipo:** actividades (Mi día, entregas, cuatro ojos), proyectos y membresías, dashboard, talento e importador, clientes y grafo.
- **Puntos y reglas:** gamificación y épocas, genoma y gobernanza, Ágora e hitos, Academia.
- **Canales y tiempos:** SLA, recordatorios y avisos; Telegram; ritos y comunidad.
- **Afuera:** anclaje en Stellar testnet y sitio público con formularios.

Cada feature tiene ficha, DFD (fuente JSON, `.tm7` para Microsoft Threat Modeling Tool e imagen `.svg`) y prueba de caracterización. En total: **17 DFD con 433 elementos y 652 flujos**, todos atados a un archivo y una función que existen; **236 amenazas** con estado (126 mitigadas, 45 aceptadas y 65 pendientes); y **167 pruebas de caracterización** en verde, además de las 1.200 que ya existían.

### Lo que está bien

- La autorización se decide con el rol leído de la base en cada acción, no con la cookie ni con la wallet de una persona (`src/lib/authz.ts`, `src/lib/roles.ts`), y un test estático lo vigila en las pantallas.
- Puntos y reputación salen de sumar tablas de solo inserción (`points_ledger`, `reputation_events`); no hay saldos que se puedan pisar.
- Los secretos viven en el servidor (App Settings), el código del rito y los vínculos de Telegram se guardan con hash, y el anclaje solo toca testnet.
- La base tiene migraciones con respaldo previo (`VACUUM INTO`) y la base de producción nunca se borra.

### Qué sobra, qué está duplicado y qué está muerto

- **Muerto:** el worker de anclaje (`packages/scripts/anchor-worker.mjs`) está truncado y no corre; el gen `ACADEMIA_VOTE_WEIGHT` se anuncia pero nadie lo usa; los "focos del día" programados solo existen en un script local; `GET /api/avisos`, cuatro funciones de `bot-store.ts`, `repo.getApplications`, dos banderas fijas en `true`, el script `contracts:build` y la variable `STELLAR_NETWORK` no tienen uso.
- **Duplicado:** dos módulos de épocas con casi el mismo nombre (`epochs.ts` y `epocas.ts`), dos reglas B8, dos políticas de tope de puntos, dos caminos para crear entregas, tres formas de resolver quién es el actor, tres comparaciones en tiempo constante, cuatro copias de la lista de genes mutables y tres documentos de despliegue que se contradicen.
- **Sobra en documentación:** 13 specs históricas ya cumplidas (WP00 a WP12), reportes nocturnos y colas de trabajo viejas, mezclados con las specs vivas.

El detalle y la propuesta están en la [sección 5](#5-propuesta-de-organización).

### Riesgos principales

Los diez hallazgos de severidad alta, en una línea cada uno (detalle en la [sección 4](#4-hallazgos-consolidados)):

| ID | Riesgo |
| --- | --- |
| A1 | Quien vea una firma de alta (captura, log, copia de la base) puede entrar para siempre como esa wallet, también como founder. |
| A2 | El quiz de la Academia se aprueba sin leer, y da puntos y reputación. |
| A3 | No queda prueba de la autorización de datos personales de los formularios, aunque `/privacidad` la promete (Ley 1581). |
| A4 | Nada ancla en producción: las firmas, las raíces de época y las huellas de ritos se quedan pendientes, aunque la pantalla dice que se guardan en la red de pruebas. |
| A5 | Los puntos por hitos no tienen cuatro ojos ni rastro de quién los aprobó. |
| A6 | La regla B8 del Ágora es un control por persona (`FOUNDER_WALLET`) y distinto de la regla del equipo. |
| A7 | Los parámetros nuevos del genoma (puntos por tarea, SLA, ritos, insignias) cambian con el código, incluso para épocas pasadas. |
| A8 | El repo público todavía nombra a un cliente real y a personas del equipo. |
| A9 | Los recordatorios por SLA nunca corren: el workflow no está en la rama por defecto de GitHub. |
| A10 | Retirar el whitepaper sin tocar el arranque deja a producción sin poder arrancar. |

### Qué falta para sacar la versión

Propuesta; John decide qué entra.

**Bloquean la publicación** (arreglos chicos o decisiones):

1. **A10.** Que la rama que retira el whitepaper cambie todo lo de la [sección 6](#6-retiro-del-whitepaper-lista-para-la-rama-paralela) y que el workflow `paquete-azure` (con su ensayo de arranque) quede en verde.
2. **M1 y la [sección 2](#2-por-qué-me-pide-wallet-puedo-entrar-con-freighter-o-con-mi-correo).** Quitar los textos que prometen entrar con correo personal y con passkeys, y decidir si se enciende Microsoft Entra para el equipo.
3. **A8.** Sacar del repo público el nombre del cliente, los nombres del equipo en el prompt del bot y el detalle de producción de `DESPLIEGUE-V1.md`.
4. **A3.** Guardar la autorización de datos con cada solicitud (o dejar de prometer la prueba en `/privacidad`).
5. **A2.** Cerrar el quiz de la Academia (o apagar sus puntos hasta cerrarlo).
6. **A4 y A9.** Poner a correr el anclaje y los recordatorios, o quitar de las pantallas lo que prometen.
7. **M25.** Que los pull requests corran `tsc` y las pruebas, para que todo lo de arriba quede protegido.

**Antes de abrir el acceso a más personas:** A1 (reto de un solo uso en el login), A5 y A6 (cuatro ojos y B8 en hitos), A7 (genoma congelado), M3 (una sola puerta de autorización), M4 (límite de intentos), M5 (acuerdo que falla cerrado) y M10 (época abierta).

**Después:** el resto, al ritmo del plan del QA ([sección 7](#7-plan-de-las-próximas-sesiones-del-qa)).

## 2. ¿Por qué me pide wallet? ¿Puedo entrar con Freighter o con mi correo?

**Respuesta corta: sí puedes entrar con Freighter, y es el camino que funciona hoy. Con correo, solo con la cuenta corporativa de Microsoft y solo si se enciende Entra, que hoy está apagado. Con un correo personal no se puede.**

**Por qué pide wallet.** En la app, la cuenta de una persona de la comunidad *es* su wallet: `users.wallet` es la llave primaria de la tabla de personas (`apps/web/src/lib/schema.sql`) y lo único que prueba que eres tú es la firma del acuerdo de contribución (CLA) hecha con esa wallet (`src/lib/onboard.ts#performOnboard` y `#performLogin`, verificadas en `src/lib/crypto.ts#verifyWalletSignature`). No hay contraseñas ni códigos por correo: sin una llave que firme, la app no tiene con qué reconocerte.

| Camino | ¿Funciona hoy? | Qué necesitas | Notas |
| --- | --- | --- | --- |
| **Freighter** (wallet de Stellar en el navegador) | **Sí** | Freighter instalado y desbloqueado. La primera vez, un código de invitación; después, el botón "Ya estoy registrado — entrar con mi wallet". | Para entrar **como founder**, la llave pública de tu Freighter tiene que estar en `FOUNDER_WALLET` (cada arranque la promueve, `src/lib/db.ts#backfillFounder`) o usar una sola vez `FOUNDER_BOOTSTRAP_CODE`. |
| Wallet de prueba del navegador | Sí | Código de invitación. | Queda marcada como demo: no cuenta en cifras públicas ni se puede vincular al equipo. No sirve para el founder. |
| **Correo corporativo de Microsoft** (Entra ID) | **Solo si se enciende** | `AUTH_ENTRA_ENABLED` más las credenciales del app registration en App Settings; cuenta del dominio corporativo. | Con el interruptor apagado el botón ni se dibuja (`src/components/EntraSignInButton.tsx:66`). Quien entra así no firma el acuerdo: llega a `/equipo/hoy`, pero `/perfil` y `/admin` lo devuelven a `/entrar` hasta que su fila del roster se vincule a su wallet en `/equipo/talento` (hallazgo M2). |
| **Correo personal** (Gmail u otro) | **No** | No existe. | No hay ruta, enlace mágico ni contraseña. Aun así, tres textos lo prometen y `/empresas` promete passkeys (hallazgo M1). |

**Qué recomiendo:**

- **Tú, hoy:** Freighter con tu llave en `FOUNDER_WALLET`. Es la única puerta que abre `/admin` sin pasos extra.
- **Equipo interno:** encender Entra (checklist en `docs/DESPLIEGUE-V1.md`) y vincular cada fila del roster a su wallet cuando la persona necesite cobrar o firmar.
- **Externos por proyecto:** wallet (Freighter) por ahora. Que entren con su correo sería una puerta nueva (enlace mágico o código de un solo uso) que **envía correos**, y el envío de correos está fuera del alcance de v1 (`CLAUDE.md`). Es una decisión tuya, no un arreglo.
- **Antes de abrir a más gente:** cambiar la firma fija del login por un reto de un solo uso (hallazgo A1).

La explicación completa, con el recorrido de cada puerta, está al inicio de [`docs/features/login-y-sesion.md`](../features/login-y-sesion.md).

## 3. Mapa del sistema

### El recorrido completo en un párrafo

Un visitante llega al sitio público (manifiesto, método, empresas, encuentros) y puede dejar sus datos en un formulario. Para entrar, en `/entrar` usa un código de invitación, conecta Freighter y firma el acuerdo; la app crea su fila en `users`, le pone una cookie de sesión y deja la firma en una cola para anclarla en Stellar testnet. Si es del equipo, trabaja en `/equipo/hoy`: toma entregas, las mueve por la máquina de estados y otra persona las revisa (cuatro ojos). Al aprobar, se emiten puntos y reputación dentro del tope de la época; las entregas también se pueden publicar en el Ágora como proyectos con hitos. Los plazos (SLA) generan avisos y recordatorios por Telegram. El founder, desde `/admin`, aprueba hitos, ajusta el genoma y cierra la época, que deja una raíz Merkle para anclar. Los ritos (con código rotativo) y la Academia también dan reputación y puntos.

### Las 16 features

| # | Feature | Qué hace | Prueba | Amenazas (M / A / P) | Hallazgos principales |
| --- | --- | --- | --- | --- | --- |
| 0 | [Esqueleto](../features/00-esqueleto.md) | Arranque, carpetas, sesión, base, servicios externos, logs y pruebas | No aplica | No aplica | M25, M26, B18, B19, B20 |
| 1 | [Login y sesión](../features/login-y-sesion.md) | Invitación, wallet, firma del acuerdo, cookie, Entra y puertas por rol | 16 | 12 / 3 / 7 | A1, M1, M2, M3, M4, M5, B1, B2, B3 |
| 2 | [Dashboard](../features/dashboard.md) | Vista de founder y supervisión: bloqueos, carga, digest | 7 | 8 / 3 / 2 | M8, M10, M15, M17, B5 |
| 3 | [Actividades](../features/actividades.md) | Mi día, entregas, máquina de estados, check-in, cuatro ojos | 9 | 9 / 2 / 2 | M8, M9, B4, B6 |
| 4 | [Ágora y hitos](../features/agora-y-hitos.md) | Publicar, aplicar, asignar y aprobar hitos | 4 | 7 / 4 / 5 | A5, A6, M6, M11, M22, B17 |
| 5 | [Gamificación y épocas](../features/gamificacion-y-epocas.md) | Emisión de puntos, tope, insignias, cierre con raíz Merkle | 8 | 10 / 3 / 3 | A6, M10, M11, M12, B7 |
| 6 | [Anclaje en Stellar](../features/anclaje-stellar.md) | Cola de anclaje, `manageData` en testnet, pruebas públicas | 6 | 2 / 6 / 5 | A4, M23, M26, B14 |
| 7 | [Proyectos y membresías](../features/proyectos-y-membresias.md) | Iniciativas, roles por proyecto, tablero | 8 | 8 / 2 / 3 | M16, B5 |
| 8 | [Ritos y comunidad](../features/ritos-y-comunidad.md) | Código rotativo, asistencia, `/comunidad`, aviso de encuentros | 8 | 8 / 2 / 4 | A3, M20, M21 |
| 9 | [SLA, recordatorios y avisos](../features/sla-recordatorios-y-avisos.md) | Plazos, motor de recordatorios, bandeja | 12 | 8 / 3 / 3 | A9, M18, M26, B13 |
| 10 | [Talento e importador](../features/talento-e-importador.md) | Directorio, roles, vinculación del roster, CSV | 7 | 10 / 3 / 1 | M9, M15, B3, B6, B9 |
| 11 | [Clientes y grafo](../features/clientes-y-grafo.md) | Entornos por cliente, grafo importado, inventario de accesos | 5 | 6 / 4 / 3 | A8, M24, B15 |
| 12 | [Telegram](../features/telegram.md) | Vinculación, webhook, comandos y focos | 12 | 8 / 3 / 4 | A8, M9, M19, M20, B12 |
| 13 | [Genoma y gobernanza](../features/genoma-y-gobernanza.md) | Genoma versionado, mutaciones, fitness, votos, decision log | 7 | 7 / 2 / 5 | A7, M13, M14, B8 |
| 14 | [Admin](../features/admin.md) | `/admin` y `/api/admin` | 19 | 7 / 2 / 7 | A5, A6, M3, M6, M7, B10 |
| 15 | [Academia](../features/academia.md) | Lectura con tiempo mínimo, quiz y puntos | 13 | 7 / 3 / 6 | A2, M2, M8, M14, M20, B10, B11 |
| 16 | [Sitio público y formularios](../features/sitio-publico-y-formularios.md) | Landing, manifiesto, empresas, contacto, encuentros, legales, menú | 26 | 9 / 0 / 5 | A3, A10, M1, M20, M27, B16 |

M / A / P = amenazas Mitigadas, Aceptadas y Pendientes de la sección 7 de cada ficha.

## 4. Hallazgos consolidados

Los siete documentadores reportaron 148 hallazgos. Al juntar los repetidos (por ejemplo, el límite de intentos lo reportaron cuatro y el retiro del whitepaper, cinco) quedan **58: 10 de severidad alta, 27 media y 21 baja**.

Severidad: **alta** = riesgo de seguridad, legal o de datos, o bloquea la publicación; **media** = una regla de negocio, una promesa o un permiso que no se cumple; **baja** = confusión, duplicado o limpieza. Las rutas son relativas a `apps/web/` salvo que empiecen por `docs/`, `packages/` o `.github/`.

### Alta

| ID | Feature | Hallazgo | Evidencia | Propuesta |
| --- | --- | --- | --- | --- |
| A1 | Login y sesión | El login no usa reto: siempre se firma el mismo texto (separador + hash del CLA) y ed25519 es determinista, así que la firma del alta sirve para entrar para siempre. Esa firma se guarda en la base y `/entrar` la muestra en pantalla. | `src/lib/cla-signing.ts:16-17`; `src/lib/onboard.ts:137`, `:176-184`; `app/entrar/page.tsx:308`, `:318`; caso 9 de `caracterizacion/login-y-sesion.test.ts` | `/api/login` emite un nonce de un solo uso con vencimiento corto y la wallet firma `zelena-login-testnet-v1:<nonce>`; la firma del CLA queda solo como prueba del acuerdo. Quitar de la pantalla el detalle con la firma. |
| A2 | Academia | El quiz se aprueba sin leer: acepta la misma pregunta tres veces o preguntas que no se sirvieron, y una lectura reprobada se recalifica con el mismo token. El GET del quiz no tiene límite. | `src/lib/validation.ts:75`; `src/lib/academia.ts:49-73`, `:105-115`; `app/api/academia/quiz/route.ts:11-25`; casos HALLAZGO de `caracterizacion/academia.test.ts` | Guardar los 3 ids servidos en `reading_sessions`, exigir exactamente esos y distintos, rechazar si la lectura ya se calificó y limitar el GET. |
| A3 | Sitio público, Ritos | La autorización de datos personales (Ley 1581) de `/empresas/contacto` y `/encuentros` solo existe en el navegador: la API no la recibe ni la guarda y `leads` no tiene dónde. `/privacidad` promete que se puede pedir prueba de esa autorización. | `src/components/ContactoForm.tsx:24-28`; `src/components/AvisoEncuentrosForm.tsx:111-127`; `src/lib/validation.ts:122-141`; `src/lib/schema.sql:721-730`; `app/privacidad/page.tsx:118` | Enviar y exigir `acepto: true` con la versión del aviso y guardar fecha y versión en `leads` (columnas nuevas vía `COLUMNAS_NUEVAS`). Toca una tabla de producción: decisión de John. |
| A4 | Anclaje, Ritos, Gamificación | Nada ancla en producción. El worker está truncado y no parsea (ya lo estaba en el commit base `4524dff`), `/admin` no tiene el botón que cita la ruta y no hay cron. Firmas, raíces de época y huellas de ritos quedan `pending`, mientras la pantalla dice "Guardamos la huella del acuerdo en la red de pruebas". | `node --check packages/scripts/anchor-worker.mjs` → `SyntaxError` (l. 136); `app/api/anchor/run/route.ts:11-17`; ningún componente llama a `/api/anchor/run`; `src/lib/ritos.ts:515-517` | Elegir el disparador: botón "Anclar ahora" en `/admin` con el conteo de pendientes, o workflow programado con `ANCHOR_RUN_SECRET` en la rama por defecto. Borrar el worker o reescribirlo sobre `src/lib/anchor.ts`. Revisar cuántas filas `pending` hay en producción. |
| A5 | Ágora, Admin | Los puntos por hitos no tienen cuatro ojos ni rastro: `/api/admin` no pasa el actor, el founder puede asignarse su propia aplicación y aprobar sus hitos, y ninguna tabla guarda quién aprobó ni quién hizo cada acción de administración. | `app/api/admin/route.ts:51-112`; `src/lib/admin.ts:9-34`, `:58-106`; `src/lib/schema.sql:188-195` | Pasar el actor a cada operación, rechazar si quien aprueba y quien ejecuta son la misma persona (`mismaPersona`) y registrar el autor (columna vía `COLUMNAS_NUEVAS` o log de solo inserción). |
| A6 | Ágora, Gamificación, Admin | La aprobación de hitos usa un control por persona (`FOUNDER_WALLET`, excepción "Stage 0") y otra regla B8 (`violatesB8`: solo la invitación directa de una wallet) en vez de la regla única `reglaB8` por identidades y rol. El test que prohíbe controles por persona no revisa `src/lib`. | `src/lib/admin.ts:5`, `:76-82`; `src/lib/rules.ts:7-10`; `src/lib/identidades.ts:113-141`; `src/lib/sin-gates-por-persona.test.ts:42` | `reglaB8` + `mismaPersona` en `approveMilestone`, quitar `FOUNDER_WALLET` de `admin.ts` y extender el test estático a `src/lib` (salvo `seed`, `db` y `config`). Confirmar si Stage 0 sigue vigente. |
| A7 | Genoma | Los parámetros de WP31 (`TASK_POINTS`, `TASK_REP`, `ON_TIME_BONUS_PCT`, `SLA_*`, `REMINDER_*`, `RITES_CADENCE`, `BADGE_GOALS`) no se pueden mutar por gobernanza y la versión guardada no los trae: rigen los valores del código. Cambiar el código cambia la época en curso y la lectura de las pasadas, sin acta. Choca con "solo vía genoma versionado, nada retroactivo". | `src/lib/mutation.ts:22`; `src/lib/genome.ts:131-189`, `:207-209`, `:229-248`, `:309-312`; paso 1 de `caracterizacion/genoma-y-gobernanza.test.ts` | Guardar una versión completa congelada (o la foto del genoma al cerrar cada época) y que `getActiveGenome` no complete con los valores vivos del código. Decidir qué claves de WP31 se pueden mutar. |
| A8 | Repo público (Clientes, Telegram, Sitio, Admin) | El repo público todavía nombra a un cliente real y a una persona (constantes y expectativas de una prueba, un comentario del esquema), la siembra demo usa un nombre de la lista vetada (se ve en `/agora` de un entorno nuevo), el prompt del bot enumera por nombre al equipo y un documento de despliegue cita prefijos de wallets y nombres de filas de producción. Aquí no se repiten. | `src/lib/client-graph.test.ts:19-54`; `src/lib/schema.sql:413`; `src/lib/__fixtures__/schema-58ee2fd.sql:370`; `src/lib/seed.ts:304-358`, `:450-452`; `src/lib/bot-agent.ts:99`, `:109`; `docs/DESPLIEGUE-V1.md:195-197` | Nombres ficticios y fixture sintético; roster del bot desde la base; detalle de producción a un documento privado; añadir `seed.ts` al barrido de nombres; correr `ZELENA_BARRIDO_NOMBRES=1 npx vitest run src/lib/contenido-publico.test.ts`. Valorar limpiar el historial. |
| A9 | SLA y recordatorios | Los recordatorios programados no corren. GitHub solo dispara `schedule` desde la rama por defecto, que es `develop`, y ahí no está `recordatorios.yml`. Confirmado con la API de GitHub el 2026-10-21: `develop` solo trae `ci.yml` y Actions no tiene registrado un workflow de recordatorios. | `.github/workflows/recordatorios.yml`; spec WP31 §4.C.6 (pide `main`); `src/lib/menu.ts:105-107` (no hay `main`) | Llevar `recordatorios.yml` a `develop` con `CRON_SECRET` en GitHub Secrets y en App Settings, simular con `?simular=1`, encender `SLA_REMINDERS_ENABLED` y revisar las corridas en Actions. Corregir la spec. |
| A10 | Sitio público (retiro del whitepaper) | Quitar `docs/whitepaper.md` deja a producción sin arrancar: `verificar-paquete.mjs` lo exige y los dos scripts de arranque se niegan a seguir sin él. El ensayo del paquete y el smoke esperan `/whitepaper` en 200 (con la redirección será 308), y pruebas, enlaces y comentarios lo citan. | `scripts/verificar-paquete.mjs:204-214`; `start-azure.sh:7-19`; `start-standalone.sh:13-19`; `next.config.mjs:39`, `:47`; `.github/workflows/paquete-azure.yml:90` | La rama del retiro cambia todo lo de la [sección 6](#6-retiro-del-whitepaper-lista-para-la-rama-paralela) en el mismo PR y corre `paquete-azure` antes de desplegar. |

### Media

| ID | Feature | Hallazgo | Evidencia | Propuesta |
| --- | --- | --- | --- | --- |
| M1 | Login, Sitio | Textos que prometen puertas inexistentes: tres textos ofrecen entrar con correo personal y `/empresas` promete passkeys (Face ID o huella). | `src/lib/entra.ts:545-546`; `src/components/EntraSignInButton.tsx:22-23`; `src/lib/schema.sql:53`; `app/empresas/page.tsx:46` | Corregir los textos (cambio de copy, sin lógica). |
| M2 | Login, Academia | Entrar por Entra sin estar en el roster es un camino muerto: la fila `entra:<oid>` nace sin acuerdo y no hay pantalla para firmarlo (la vinculación solo acepta filas `pending:<slug>`). No abre `/perfil` ni `/admin`, recibe 401 en la Academia aunque el lector le ofrece "Comenzar lectura" y no puede cobrar. El botón promete "El CLA se firma después". | `src/lib/entra.ts:425-443`, `:632-641`; `src/components/EntraSignInButton.tsx:87`; `middleware.ts:24`; `app/academia/[slug]/page.tsx:47-53`; `app/api/academia/start/route.ts:12` | Pantalla "firmar el acuerdo" que vincule una wallet al principal existente, o decidir que el equipo no necesita acuerdo y cambiar textos. Pasar `claSigned` al lector. |
| M3 | Login, Admin, Genoma, SLA | Autorización dispersa. Hay tres resolvedores de actor (`actorEstricto`, `equipoActor` y `actorFromSession`, que cae a la cookie). `adminActor`, `equipoInternoActor` y `/api/login` no miran `status`, así que una cuenta dada de baja entra y administra. Siete handlers autorizan con el `claSigned` de la cookie (una baja vota). El middleware exige acuerdo en la página `/admin` pero no en `/api/admin`, y `/api/avisos` usa otra puerta que su página. | `src/lib/authz.ts:58-94`, `:120`, `:136`; `src/lib/team.ts:1109-1133`; `src/lib/onboard.ts:185-203`; `app/api/apply/route.ts:11`; `app/api/governance/vote/route.ts:12`; `app/api/invite/generate/route.ts:12`; `middleware.ts:24`, `:41`, `:50-52`; `app/api/avisos/route.ts:25-29` | Una sola función de actor estricto (fila existente, `status='active'`, acuerdo cuando aplique) usada por todas las puertas, por `performLogin` y por las rutas que hoy leen la cookie. Una regla para el founder sin acuerdo, igual en página y API (ajustar `authz.test.ts` D3-01). |
| M4 | Transversal | El límite de intentos se evade y crece sin tope: la IP sale del primer valor de `X-Forwarded-For`, que manda el cliente, y el mapa en memoria nunca se poda (y es por instancia). Afecta login, alta, invitaciones, formularios, Academia, cron y webhook. | `src/lib/rate-limit.ts:7-8`, `:22-24`; caso 12 de `caracterizacion/login-y-sesion.test.ts`; `docs/security-review.md:28` (H7) | Tomar la IP que agrega el front de Azure, podar las entradas vencidas y limitar también por wallet en las rutas con sesión. |
| M5 | Login | Si falta `CLA.md` en el paquete, el servidor sirve y acepta firmas sobre un texto de reserva. Ya pasó el 2026-09-04, con dos altas. | `src/lib/cla.ts:19`; `scripts/verificar-paquete.mjs:11`, `:189-200` | Fallar cerrado: `/api/cla` y `/api/onboard` responden 503 si no está `CLA.md` o su sha256 no es el firmado. |
| M6 | Ágora, Admin | `approveApplication` no exige aplicación pendiente ni proyecto abierto: cambia al ejecutor en silencio y deja dos aplicaciones aprobadas (las demás nunca se rechazan). "Avanzar" lleva un proyecto de `Open` a `Assigned` sin ejecutor, con la etiqueta en inglés. `rejectApplication` responde ok con ids inexistentes. | `src/lib/admin.ts:9-51`; `src/lib/state-machine.ts:45-57`; `app/admin/page.tsx:404`; casos de `caracterizacion/admin.test.ts` y `caracterizacion/agora-y-hitos.test.ts` | Asignar solo desde una aplicación pendiente sobre un proyecto abierto y marcar las demás como no seleccionadas; `advanceState` desde `Open` exige ejecutor; validar al rechazar; usar `ESTADO_PROYECTO_LABEL`. |
| M7 | Admin | Acciones irreversibles con un clic: aprobar un hito emite puntos que no se quitan; firmar el fitness y cerrar la época, igual. | `src/components/AdminAction.tsx:24-44`; `app/admin/page.tsx:147-158`, `:414-422` | Diálogo de confirmación con el monto o el efecto. |
| M8 | Actividades, Dashboard, Gamificación, Academia, Genoma, Telegram | El "día" sale del reloj del servidor (UTC en Azure) y no de `BUSINESS_TZ` (America/Bogota): check-in, `assignment_events.day`, digest, encabezado del dashboard, tope diario de la Academia y fecha de las actas de mutación y fitness. De 19:00 a 24:00 de Bogotá todo cae en el día siguiente; el tablero y el importador sí usan la zona del negocio. | `src/lib/team.ts:105-110`, `:431`, `:749`, `:987`, `:2025`; `app/equipo/dashboard/page.tsx:126`; `app/api/equipo/digest/route.ts:37`; `src/lib/academia.ts:16-17`; `src/lib/mutation.ts:142`, `:166`; `src/lib/epochs.ts:144`; `packages/scripts/telegram-bot.mjs:192-203`; `src/lib/zona-horaria.ts:5-8` | Reemplazar `today()`, `weekStart()` y equivalentes por `diaLocal(now, BUSINESS_TZ)`. Decidir si se migran los días ya guardados (con respaldo `VACUUM INTO`). |
| M9 | Actividades, Talento, Telegram | Escrituras que se saltan la lógica central del tablero: el bot y el importador crean piezas con `createAssignment` (sin evento `crear`, sin `validarDestino` ni `clienteDeLaPieza`); el importador crea proyectos con `upsertInitiative` (sin evento ni validación); "Sube la prioridad" del bot hace un `UPDATE` directo, sin evento ni reglas de planificación. | `src/lib/bot-tools.ts:747-768`, `:907-919`; `src/lib/team-import.ts:547-555`; `src/lib/team.ts:279-295`, `:387-455` | Un solo camino de escritura en `team.ts` (`createAssignmentAs`, `crearProyecto` y una función de prioridad) que registre eventos y aplique permisos; el importador deja un evento `importar` por pieza. |
| M10 | Gamificación, Dashboard | Ninguna emisión comprueba que la época esté abierta: `currentEpoch` devuelve el último periodo sin mirar su estado, así que tareas, hitos, votos, Academia y ritos pueden escribir en una época cerrada o anclada y cambiar su raíz Merkle. El dashboard llega a mostrar "abierta desde… · estado Closed". | `src/lib/genome.ts:218-221`; `src/lib/gamificacion.ts:129`; `src/lib/epocas.ts:251-260`; `src/lib/dashboard.ts:244-249` | Que `currentEpoch` devuelva solo la época `Open` o que la emisión falle con 409 si no hay; prueba nueva. |
| M11 | Gamificación, Ágora | Dos políticas de tope sobre el mismo presupuesto: las tareas recortan al remanente; los hitos se rechazan enteros y la comprobación queda fuera de la transacción. En hitos, `1 USD = 1 punto` y la reputación `max(1, round(points/10))` están fijos en el código y el `ref` es texto libre. | `src/lib/admin.ts:84-104`; `src/lib/gamificacion.ts:156`; `src/lib/rules.ts:126-128` | Emitir los hitos con la misma función que las tareas (ref `milestone:<id>`, mismo tope, parámetros en el genoma). |
| M12 | Gamificación, Genoma | El fitness de la época no mide la época: cuenta usuarios de siempre, la retención es "últimos 14 días desde hoy" y las entregas son solo hitos del Ágora (ignora el tablero). La calidad no tiene datos. La recomendación mantener o revertir no está fundada. | `src/lib/epochs.ts:39-76` | Filtrar por `period_id` o por las fechas de la época e incluir las entregas aprobadas del tablero. |
| M13 | Genoma, Gamificación | "Firmar: revertir genoma" solo escribe el acta y marca la firma: el genoma no cambia, aunque el decision log diga "revertir". Además cada cierre deja dos actas "Cierre de época" y recalcular tras firmar vuelve a pedir la firma. | `src/lib/epochs.ts:88-153`; `src/lib/epocas.ts:234-240`; `app/admin/page.tsx:108`, `:145-158` | Que firmar "revertir" ejecute `revertToVersion` (o cambiar el texto); renombrar el acta de la firma; bloquear el recálculo de una época firmada. |
| M14 | Genoma, Academia | La votación es fachada: solo el seed crea propuestas, nada las cierra ni aplica el umbral; cada voto da +2 de reputación fijo en el código, fuera de transacción, y cualquier error se responde "Ya votaste". El formulario se muestra a quien no firmó. El gen `ACADEMIA_VOTE_WEIGHT`, que el banner anuncia, no lo usa nadie. | `src/lib/seed.ts:415-421`; `app/api/governance/vote/route.ts:12`, `:30-43`; `app/gobernanza/page.tsx:79-83`; `src/lib/genome.ts:30`, `:121`; `src/components/MutationBanner.tsx:16` | Completar la votación (crear, cerrar y aplicar el umbral) o retirarla de `/gobernanza`; retirar el gen o implementar el peso; voto y reputación en una transacción. |
| M15 | Talento, Dashboard | Las piezas "Hecho" importadas como historia toman `closed_at` = momento de la importación, y el dashboard las cuenta como cerradas esta semana y esta época. | `src/lib/team.ts:361`, `:659-661`; `src/lib/team-import.ts:569-571`; `src/lib/dashboard.ts:257` | `closed_at` en NULL para la historia o tomarlo de una columna del CSV. |
| M16 | Proyectos | Una supervisora puede asociar un proyecto a un cliente donde no participa, o quitárselo (y entonces lo ve todo el equipo interno). Con las piezas la regla es más estricta. | `src/lib/team.ts:1500-1505`, `:1521`, `:1569-1578` frente a `:483-485` | Exigir `participaEnCliente` sobre el cliente nuevo y el anterior para quien no es founder (la spec §4.A.6 solo dice "founder o supervisor": confirmar). |
| M17 | Dashboard | El dashboard no tiene enlace (solo se abre escribiendo la URL) y su carga por persona no muestra a los externos que trabajan por proyecto: su trabajo cae en "fuera del roster". | `src/lib/menu.ts:55-58`, `:84-102`; `src/lib/team.ts:1157`; `src/lib/dashboard.ts:390`, `:415-421` | Enlace en el menú para founder y supervisión (como Talento) y filas para externos con membresía activa. |
| M18 | SLA | Dos huecos del motor de recordatorios: la guarda de arranque se mueve mientras `reminders_sent` está vacía (lo que vence en ese lapso pierde sus escalas para siempre), y una P1 sin responsable en Backlog sale "Vencida" pero no avisa a nadie. | `src/lib/recordatorios-db.ts:157-164`, `:478`; `src/lib/recordatorios.ts:205-208`, `:227`; `src/lib/sla.ts:348-354` | Guardar el instante de activación como dato explícito; escalar la P1 en Backlog a supervisión o al founder (o no pintar el plazo). |
| M19 | Telegram | Los "focos del día" programados solo existen en el puente de polling local: en producción nadie los envía. El script usa la hora del servidor y `DAILY_FOCUS_HOUR = 7` cae fuera del horario hábil. En la app quedan copias muertas de esa lógica. | `packages/scripts/telegram-bot.mjs:101-115`, `:192-203`; `src/lib/bot-tools.ts:843-851`; `src/lib/genome.ts:124` | Enviarlos desde la corrida del cron con la hora del genoma, o retirar la promesa y el código. |
| M20 | Privacidad (Sitio, Telegram, Academia, Ritos, Actividades, Admin) | `/privacidad` no coincide con lo que pasa: no nombra a Telegram, Anthropic ni YouTube como destinos; dice que en Stellar solo queda la huella del acuerdo (también se anclan huellas de ritos); dice que no se miden horas, pero la Academia guarda tiempos de lectura por wallet y el check-in guarda la hora; ofrece suprimir datos, pero `leads` no tiene plazo ni forma de borrarse. | `app/privacidad/page.tsx:17-34`, `:113-120`; `src/lib/recordatorios.ts:321`, `:344`; `src/lib/bot-agent.ts:147`, `:243-252`; `src/lib/schema.sql:306-316`, `:555-556`, `:721-730`; `app/academia/[slug]/page.tsx:33-38` | Reescribir `/privacidad` con los encargados y destinos (Telegram, Anthropic, Stellar testnet, YouTube) y lo que se guarda; definir retención y supresión de `leads` y `bot_actions`, con acciones en `/admin`. |
| M21 | Ritos | Cualquier anfitrión publica al cerrar un resumen libre (1.000 caracteres y un enlace) que queda público, permanente y con hash en el acta, sin revisión. Además, la participación esperada del fitness cuenta a quien no puede asistir. | `src/lib/ritos.ts:240-244`, `:466-467`, `:495-505`, `:997-1024` | Que el founder o supervisión confirme el resumen antes del acta (o dejar el texto libre fuera del acta); contar solo a quien puede asistir. |
| M22 | Ágora | El Ágora promete más de lo que hace: el texto dice que cada hito aprobado "se paga", pero solo se emiten puntos; un supervisor publica pero solo el founder revisa, aunque el formulario dice "El supervisor la revisará"; y la pieza interna publicada se queda en Backlog aunque el proyecto avance. | `app/agora/[id]/page.tsx:45-56`; `src/lib/admin.ts:84-104`; `src/lib/authz.ts:41-43`; `src/components/ApplyForm.tsx:27`; `src/lib/agora-publicar.ts:311`, `:327-333` | Ajustar textos (puntos ZWORK; el pago real va por fuera contra el hito), decidir quién aprueba en el Ágora y sincronizar o sacar del tablero la pieza publicada. |
| M23 | Anclaje | La cola de anclaje no es confiable: no tiene estado final ni espera entre reintentos (ocho filas rotas bloquean todo); no reserva la fila antes de enviar (dos pasadas anclan dos veces); marca como ancladas todas las versiones del acuerdo de una wallet; y lo anclado (el hash del CLA, igual para todos, con una clave de 12 caracteres de la wallet) no permite verificar la firma. | `src/lib/anchor.ts:74-113`; `src/lib/onboard.ts:139-141`; `src/lib/schema.sql:93`; `app/perfil/page.tsx:235`; `docs/specs/WP30-integridad-anclaje.md` | Implementar WP30: estado `processing` antes de enviar, `failed` tras N intentos con espera, actualizar por id de firma, clave sin recorte y payload `sha256(wallet|versión|firma)`. |
| M24 | Clientes | Clientes no tiene administración: no hay pantalla ni ruta para crear clientes, miembros, marca o credenciales, ni para importar el grafo (en producción, solo con SQL o un POST manual). `importGraph` no valida campos (un JSON mal formado da 500 sin detalle) y su suite se salta entera sin el fixture privado. | `src/lib/clients.ts`; `app/api/clientes/grafo/route.ts:41`; `src/lib/client-graph.ts:112-138`; `src/lib/client-graph.test.ts:21-25` | Panel mínimo de clientes para el founder (o un script versionado), esquema zod con 422 y la suite sobre un grafo sintético. |
| M25 | Esqueleto (CI) | Los pull requests no corren las pruebas: `ci.yml` solo hace lint y build, con Node 20 (producción usa 22). `tsc` y `vitest` solo corren en `paquete-azure.yml`, que no se dispara en PR. El job `cla-check` es un `echo`. | `.github/workflows/ci.yml:1-21`; `.github/workflows/paquete-azure.yml:9-12`, `:37-41` | Añadir `npx tsc --noEmit -p .` y `npm test` con Node 22 a `ci.yml`. |
| M26 | Esqueleto, SLA, Anclaje | La configuración del despliegue no está documentada: `.env.example` no trae la mayoría de variables (Entra, Telegram, Anthropic, `CRON_SECRET`, `SLA_REMINDERS_ENABLED`, `RITES_SECRET`, `ANCHOR_RUN_SECRET`, `FOUNDER_BOOTSTRAP_CODE`…) y sí trae `STELLAR_NETWORK`, que nadie lee. `deploy.md` describe mal `ZELENA_APP_URL` y dice que `SERVICE_ACCOUNT_SECRET` no vive en el servidor web, cuando sí. | `apps/web/.env.example`; `docs/deploy.md:98`, `:158`, `:194`, `:341-345`; `src/lib/config.ts:266-271`; `src/lib/anchor.ts:10-16`, `:50` | Completar `.env.example` solo con nombres y comentarios (tabla de la sección 4 de `00-esqueleto.md`) y corregir `deploy.md`. |
| M27 | Sitio | La landing dice "contamos solo lo real", pero "proyectos abiertos" incluye los proyectos demo. `/admin` mezcla solicitudes comerciales y avisos de encuentros en una consulta de 100 filas (100 avisos esconden todas las solicitudes) y nadie recibe aviso de una solicitud nueva. | `src/lib/prueba-en-vivo.ts:24`; `app/admin/page.tsx:63-76` | Excluir lo sembrado (o cambiar el texto); dos consultas con su propio límite y conteo de no atendidas. Un aviso saliente necesita decisión de John. |

### Baja

| ID | Feature | Hallazgo | Evidencia | Propuesta |
| --- | --- | --- | --- | --- |
| B1 | Login | Cerrar sesión no revoca el JWT (una copia vale 24 h) y el `?next=` que agrega el middleware no lo lee nadie. | `app/api/logout/route.ts:12`; `src/lib/jwt.ts:44`; `middleware.ts:44`; `app/entrar/page.tsx:80-95` | Documentarlo o añadir `session_version`; usar `next` validado o quitarlo. |
| B2 | Login | El código de cohorte (`COHORT_CODE`) renueva su vencimiento a hoy + 45 días en cada reinicio con `SEED_COHORT=1`, así que no vence; cerrarlo, ampliarlo o cambiar la lista de founders es SQL a mano. | `src/lib/seed.ts:140-170`; `src/lib/invites.ts:96-101` | Fecha de cierre en App Settings y control en `/admin`. |
| B3 | Login, Talento | La vinculación de Entra al roster por coincidencia de nombre puede dar la fila de una persona a otra cuenta del tenant, y `identidadesDe` trata a todas las filas founder como una sola persona (un segundo administrador quedaría fusionado). | `src/lib/entra.ts:323-336`, `:501-506`; `src/lib/identidades.ts:79-89` | Vincular solo por correo exacto o con confirmación; reconocer al founder por un vínculo explícito. |
| B4 | Actividades | Desalineaciones menores: POST de asignación responde 403 con motivo donde PATCH responde 404 (deja enumerar ids); el alta acepta un `specUrl` que no es http(s), la edición no; `/equipo/hoy` no deja planificar al rol `estructura`, el servidor sí; "Tus asignaciones" no suma las identidades del founder. | `src/lib/team.ts:512-518`, `:728-730`, `:1059-1098`, `:1820-1826`, `:1873`, `:2065`; `app/equipo/hoy/page.tsx:260-261` | 404 cuando no ve la pieza; reutilizar `esEnlaceSeguro`; `permisosDe` por proyecto en `/equipo/hoy`; filtrar con `identidadesDe`. |
| B5 | Dashboard, Proyectos | Visibilidad fina: el digest no filtra los check-ins que mencionan un cliente; una pieza con cliente dentro de un proyecto interno la ve todo el equipo; el filtro "Responsable" pone wallets en el HTML y la URL; la vista de acceso denegado responde 200. | `src/lib/digest.ts:88`; `src/lib/team.ts:573-581`, `:1737`; `src/components/TeamBoard.tsx:212`; `app/equipo/dashboard/page.tsx:105`, `:112` | Decidir si manda el cliente o el proyecto; id opaco en el filtro; documentar el 200. |
| B6 | Actividades, Talento | `assignment_events` y `checkins` se declaran de solo inserción pero nada lo impone, y `vincularPrincipal` los reescribe. El check-in guarda la hora aunque su ruta promete lo contrario. | `src/lib/schema.sql:530-532`, `:555-556`; `src/lib/talento.ts:609-627`; `app/api/equipo/checkin/route.ts:5-6` | Documentar la excepción o añadir triggers; decidir si se guarda la hora. |
| B7 | Gamificación | Detalles de épocas: la insignia "A tiempo" se recalcula con el SLA actual; `insertarPeriodo` lee el genoma de `n + 1` aunque el id lo da el AUTOINCREMENT; la raíz Merkle anclada no se puede verificar desde fuera (no se publican las hojas ni hay prefijos de dominio). | `src/lib/gamificacion.ts:297-303`; `src/lib/epocas.ts:120-157`, `:191-197`, `:241`; `src/lib/crypto.ts:90-103` | Guardar `aTiempo` al aprobar; id explícito; publicar las hojas y prefijar hojas y nodos. |
| B8 | Genoma | El decision log tiene dos convenciones de hash y de fecha, sus actas no se anclan y un UPDATE cambia título y hash sin rastro. La lista de genes mutables está cuatro veces, la de mecanismos de auditoría dos (sin validar en el servidor) y los pesos del fitness, repetidos; el panel dice "1 gen" donde la regla permite 2. | `src/lib/seed.ts:402`; `src/lib/mutation.ts:22`, `:102-106`; `app/admin/page.tsx:57`; `src/components/GenomeMutationPanel.tsx:5`, `:71`; `src/lib/audits.ts:10-17`, `:45-47`; `src/lib/fitness.ts:21-26` | Una función `insertarDecision` común y una sola constante por lista. |
| B9 | Talento | El roster como dato está a medias: `TEAM_ROSTER` sigue en el código, se siembra en cada arranque y repone founder y supervisión. La CLI `import-tareas` tiene un dry-run que no anticipa la importación real, reimplementa la capa de datos y firma todo como `cli`. | `src/lib/roles.ts:53`; `src/lib/team.ts:229-248`; `packages/scripts/import-tareas.mjs:78-174` | Plan para retirar el roster del código; dry-run en transacción revertida y `--actor` obligatorio. |
| B10 | Admin, Academia | Errores internos al cliente y estilos distintos: `/api/admin` responde 403 sin sesión, devuelve el mensaje crudo de cualquier excepción y no limita intentos (su vecina `/api/admin/epoca` sí); las rutas de Academia también devuelven el mensaje crudo. Publicar o despublicar contenido no deja rastro. | `app/api/admin/route.ts:22`, `:114-115`; `app/api/admin/epoca/route.ts:50-81`; `app/api/academia/*/route.ts`; `src/lib/admin.ts:108-112` | Mensajes genéricos (con log en el servidor), 401/403 coherentes, mismo límite y bitácora. |
| B11 | Academia | Un contenido despublicado sigue abriendo por enlace directo, y hay textos fijos que deberían salir del genoma ("75 %/50 %", "aprueba 2 de 3"). | `src/lib/repo.ts:199-202`, `:219-221`; `app/academia/page.tsx:39`, `:69`; `src/components/Reader.tsx:165`; `src/lib/academia.ts:112`, `:138` | `notFound()` si está despublicado; pintar desde el genoma. |
| B12 | Telegram | El webhook no descarta un `update_id` repetido (un reenvío duplica respuesta y log). La vinculación emite códigos con el bot apagado y `/admin` y `/equipo/telegram` deciden "encendido" de forma distinta. El texto del bot le dice a todo el equipo que "solo John escribe". | `src/lib/telegram.ts:111`, `:327-328`, `:344`; `app/api/telegram/vincular/route.ts:27-60`; `app/equipo/telegram/page.tsx:46`; `app/admin/page.tsx:239` | Guardar los últimos `update_id`; 409 o 503 si el bot no está encendido y configurado; textos neutros ("el founder"). |
| B13 | SLA | El cron corre de 07:00 a 18:59 de Bogotá y el horario hábil es de 08:00 a 18:00 (8 de 48 corridas no hacen nada); un 500 no se registra. | `.github/workflows/recordatorios.yml:4`; `src/lib/genome.ts:137-138`; `app/api/cron/recordatorios/route.ts:44-46` | Cron `*/15 13-22 * * 1-5` y log del error en el servidor. |
| B14 | Anclaje | `?limite=abc` da 500 después de cargar la cuenta en Horizon. El seed demo encola una fila `pending` en cualquier entorno y `is_demo` lo declara el navegador. | `app/api/anchor/run/route.ts:41-42`; `src/lib/seed.ts:200-214`; `src/lib/validation.ts:35` | Valor por defecto si no es entero; proteger el seed demo con `demoInvitesAllowed` y derivar `is_demo` en el servidor. |
| B15 | Clientes | La participación en un cliente está implementada dos veces (una con identidades y otra sin ellas); `credentialAccessLog` e `impactOf` no tienen pantalla; el escaneo de secretos del importador no revisa todos los campos; `graph_imports` se escribe fuera de la transacción; `file_url` de marca no valida el esquema. | `src/lib/clients.ts:101-122`, `:351-358`; `src/lib/team.ts:1301-1306`; `src/lib/client-graph.ts:117`, `:205-227`, `:354`; `app/clientes/[slug]/page.tsx:358`, `:369-370` | Una sola función de participación con `identidadesDe`; ampliar el escaneo; aceptar solo http(s) en `file_url`. |
| B16 | Sitio | Si la base no responde, la landing se cae (`cifrasEnVivo` sin try/catch); `revalidate = 3600` en `/encuentros` no hace nada; publicar un encuentro exige desplegar código; la marca aparece como "ZELENA" y como "Zelena". | `app/page.tsx:28`; `app/encuentros/page.tsx:12`; `src/lib/encuentros.ts:20`; `app/layout.tsx:18`, `:27` | try/catch; borrar la línea; decidir si los encuentros salen de la base; unificar la marca. |
| B17 | Ágora | Lógica fuera de `src/lib`: "aplicar" hace SQL dentro de `/api/apply`, `/admin` lista aplicaciones con SQL propio (`repo.getApplications` está muerto) y las funciones de `admin.ts` usan `getDb()` global. Quedan textos "bounty" y el formulario de aplicar se muestra sin acuerdo firmado (401 al enviar). | `app/api/apply/route.ts:22-38`; `app/admin/page.tsx:35-48`; `src/lib/repo.ts:154`; `src/lib/admin.ts:9-51`; `app/agora/[id]/page.tsx:142-152` | Mover a `src/lib/agora.ts` con `db` inyectable; cambiar textos y mostrar "firma el acuerdo". |
| B18 | Esqueleto | Documentación y comentarios que orientan mal: la primera línea de `CLAUDE.md` dice Azure SQL en producción (es SQLite); `contracts:build` apunta a `packages/contracts`, que no existe; hay comentarios obsoletos sobre el login, los tipos de anclaje y un "botón en /admin". | `CLAUDE.md:3`; `package.json` (script `contracts:build`); `src/lib/config.ts:200-205`; `src/lib/schema.sql:101`; `app/api/anchor/run/route.ts:11-17` | Corregir los textos. |
| B19 | Infraestructura de pruebas | `vitest.config.ts` no declara el alias `@/`, por eso las pruebas de caracterización redirigen cada alias con `vi.mock`. | `vitest.config.ts`; `tsconfig.json` | `resolve.alias { '@': path.resolve(__dirname, 'src') }` y simplificar los mocks. |
| B20 | Herramienta DFD | Los 17 `.tm7` pasan las comprobaciones del generador, pero nadie los ha abierto en Microsoft Threat Modeling Tool 4.3 (solo Windows); los interactores (`StencilRectangle`) y las fronteras de borde (`BorderBoundary`) no se compararon byte a byte con la herramienta. | `docs/dfd/README.md` (Limitaciones) | Que el QA abra `docs/dfd/00-sistema.tm7` en la semana 1 y anote el resultado. |
| B21 | Varias | Código duplicado o muerto que no cambia comportamiento: copias en `dashboard.ts`, tres comparaciones en tiempo constante (la de `/api/anchor/run` filtra el largo del secreto), funciones de hora repetidas, `slugVinculado` con sentidos opuestos, banderas fijas, columnas sin uso. | Lista completa en la [sección 5](#5-propuesta-de-organización) | Limpieza en PR chicos, con las pruebas de caracterización como red. |

## 5. Propuesta de organización

Regla para todo lo de esta sección: **primero M25** (que los pull requests corran las pruebas). Después, cada cambio va en un PR chico; si una fusión cambia comportamiento, la prueba de caracterización del feature falla y se decide a propósito.

### 5.1 Documentación (`docs/`)

Hoy hay 13 archivos sueltos en `docs/`, 37 en `docs/specs/` y 7 en `docs/blueprints/`, con specs cumplidas mezcladas con las vivas y tres documentos de despliegue que se contradicen. Propuesta:

```text
docs/
├── README.md              índice nuevo: qué leer primero y dónde está cada cosa
├── features/  dfd/        auditoría viva: fichas, DFD y generador
├── auditoria/             reportes fechados (este)
├── producto/              METODOLOGIA.md, architecture.md
├── operacion/             despliegue.md (fusión de deploy.md, GUIA-DESPLIEGUE.md y la parte
│                          pública de DESPLIEGUE-V1.md), security-review.md
├── specs/                 solo specs vigentes (WP13 a WP31) y decisions-pending.md
│   └── archivo/           WP00 a WP12, NIGHT-REPORT*.md, QUEUE*.md, AUDITORIA-v1.md,
│                          FEEDBACK.md, workflow-v1.1.md, workflow-v1.2.md
└── blueprints/            01 a 07 (04-contratos marcado "no existe")
```

- `whitepaper.md` sale con la rama del retiro ([sección 6](#6-retiro-del-whitepaper-lista-para-la-rama-paralela)).
- Cada spec vigente lleva en su primera línea su estado: **Hecha**, **Parcial** o **Futura**. Candidatas a "Futura": WP04 (Privy, sin código), WP10 (nómina, bloqueada por lo legal), WP21 (v2 congelada) y WP30 (integridad del anclaje, sin implementar). WP27 (misiones) y WP29 (disputas) tienen código parcial: revisar.
- El detalle de producción (wallets, filas reales, invitaciones vivas) sale de `DESPLIEGUE-V1.md` a un documento privado (hallazgo A8).
- **Cuidado al mover:** `src/lib/contenido-publico.test.ts` busca por prefijo `docs/specs/WP06`, `WP10`, `WP19`, `WP21`, `WP23`, `docs/blueprints/01`, `02`, `04`, `07` y `docs/whitepaper.md`; hay que actualizarlo en el mismo PR. También hay enlaces desde `CLAUDE.md` y comentarios del código (por ejemplo `src/lib/cla-signing.ts` cita `security-review.md`): buscar con `git grep` antes de mover.

### 5.2 Código: módulos a fusionar

| Fusionar | En | Por qué |
| --- | --- | --- |
| `src/lib/epochs.ts` (fitness y firma) y `src/lib/epocas.ts` (cierre y apertura) | `epocas.ts` | Mismo concepto, nombres casi iguales y dos actas por cierre (M13, B7). |
| `actorEstricto`, `adminActor`, `equipoActor`, `equipoInternoActor`, `clientActor` (`authz.ts`) y `actorFromSession` (`team.ts`) | `authz.ts`, con un actor estricto único | Tres resolvedores con reglas distintas (M3). |
| `approveMilestone` (`admin.ts`) y `emitirPorAprobacion` (`gamificacion.ts`) | `gamificacion.ts` | Dos topes y parámetros fijos en el código (M11). |
| `violatesB8` (`rules.ts`) y `reglaB8` (`identidades.ts`) | `identidades.ts` | Dos reglas B8 (A6). |
| `today()`, `weekStart()` (`team.ts`), `hhmmLocal` (`recordatorios.ts`), `horaMinutoLocal` (`sla.ts`) | `zona-horaria.ts` | Día en UTC frente a día del negocio (M8). |
| `constantTimeEquals` (`telegram.ts`), la de `ritos-codigo.ts` y la de `app/api/anchor/run/route.ts` | `crypto.ts` | Tres copias; la de anclaje filtra el largo del secreto. |
| Opciones de la cookie en `session.ts` y en `app/api/auth/entra/exchange/route.ts` | `SESSION_COOKIE_OPTIONS` en `session.ts` | Duplicado. |
| Lista de genes mutables (`mutation.ts`, `app/admin/page.tsx`, `GenomeMutationPanel.tsx`, `MutationBanner.tsx`) | Una constante con etiqueta en `mutation.ts` | Cuatro copias (B8). |
| `accessLevelFor` y `listClientsFor` (`clients.ts`) y `participaEnCliente` (`team.ts`) | Una función con `identidadesDe` | Dos reglas de participación (B15). |
| `faltaMembresiaEn` (`team-import.ts`) y `esMiembroDe` (`team.ts`) | `esMiembroDe` exportada | Duplicado sin identidades. |
| `src/lib/anchor.ts` y `packages/scripts/anchor-worker.mjs` | `anchor.ts` | El worker está roto y duplica la lógica (A4). |
| `realTeamMembers`, `founderInbox`, `epochStartDay`, `OPEN_LIST` (`dashboard.ts`) | Lo que ya existe en `team.ts` y `epochSnapshot` | Copias. |
| SQL de `/api/apply` y de `/admin` | `src/lib/agora.ts` y `src/lib/admin.ts` con `db` inyectable | Lógica fuera de `src/lib` (B17), contra la regla del repo. |
| Traducción de `TeamError` en las rutas de talento (también por `name`), asignación e importar (por el texto del mensaje) | Un único traductor de errores y un error tipado para el CSV | Tres criterios distintos para el mismo error. |
| Topes de `/api/ritos` (ruta: lugar 200, resumen 1.200, enlaces 600) y de `ritos.ts` (120, 1.000 y 500) | Constantes exportadas por `ritos.ts` | La ruta deja pasar valores que la lógica rechaza con otro mensaje. |

**Dividir:** `src/lib/team.ts` tiene 2.099 líneas y mezcla tablero, proyectos, membresías, roster y check-ins. Propuesta: carpeta `src/lib/team/` con `asignaciones.ts`, `proyectos.ts`, `membresias.ts`, `roster.ts` y `checkins.ts`, dejando `team.ts` como fachada que reexporta, para no tocar todos los imports de golpe.

**Ordenar `src/lib/` por feature** (65 módulos planos) es deseable, pero solo después de lo anterior y de a un feature por PR, porque cambia cientos de imports `@/lib/...`.

### 5.3 Código muerto a borrar

Confirmar con `git grep` en el mismo PR antes de borrar.

- `packages/scripts/anchor-worker.mjs` y los scripts npm `anchor` y `anchor:watch`, si se elige `/api/anchor/run` como único camino (A4).
- `bot-store.ts`: `authorizedLinkCount`, `pendingDrafts`, `listNotes`, `countBotActions` (solo las usan pruebas); `getUpdates` de `telegram.ts`.
- `debeEnviarFocos` y `horaDeLosFocos` de `bot-tools.ts`, si los focos no se programan (M19).
- `GET /api/avisos` y `contarNoLeidos`, o usarlos en un contador del menú.
- `repo.getApplications`.
- Las banderas `PUBLICAR_DISPONIBLE` y `AVISOS_EN_MENU` (fijas en `true`) y su prueba.
- El script `contracts:build` y `STELLAR_NETWORK` de `.env.example`.
- `revalidate = 3600` de `/encuentros`.
- El gen `ACADEMIA_VOTE_WEIGHT` de `NUMERIC_GENES`, si no se implementa (sin tocar épocas cerradas).
- **No borrar sin migración** las columnas sin uso (`academia_content.axis`, `academia_quiz.pool`, `periods.academia_budget`, `leads.estado`): documentarlas o usarlas.
- **Decisión de John:** el driver de Azure SQL (`db-mssql.ts`, `db-mssql-backend.mjs`, `db-sync-bridge.ts`, `sql-dialect.ts` y sus pruebas). Producción corre en SQLite; mantenerlo tiene costo.

### 5.4 Nombres

| Hoy | Propuesta | Por qué |
| --- | --- | --- |
| `epochs.ts` y `epocas.ts` | `epocas.ts` | Se confunden. |
| `riteHealth` ("salud de ritos") | `saludCheckins`, o cambiar su fuente a `rite_attendance` | Cuenta check-ins, no asistencia a ritos. |
| `slugVinculado` en `talento.ts` (slug → wallet) y en `identidades.ts` (wallet → slug) | `walletDelSlug` y `slugDeLaWallet` | Mismo nombre, sentidos opuestos. |
| Acta "Cierre de época N: mantener genoma" de la firma del fitness | "Decisión de genoma de la época N" | El cierre real es otra acta (M13). |
| `ORDEN_ROLES_PROYECTO` | `ROLES_PROYECTO` | Ya se fusionó. |
| Botón "Avanzar → assign" | `ESTADO_PROYECTO_LABEL` | Sale en inglés (M6). |
| "bounty" en textos | "proyecto" | Pedido de la spec U9. |
| `leads` (comerciales y avisos de encuentros juntos) | Dos listas en `/admin` y, si se decide, dos tablas | Una tapa a la otra (M27). |
| "ZELENA" y "Zelena" en los títulos | Una sola forma | Marca inconsistente (B16). |
| Encuentros en código (`src/lib/encuentros.ts`) y ritos de comunidad en la base | Un solo modelo editable desde `/admin` | Publicar un encuentro exige desplegar. |

## 6. Retiro del whitepaper: lista para la rama paralela

Decisión del founder: quitar el whitepaper y dejar solo el manifiesto. Las fichas documentan el sitio como si `/whitepaper` ya redirigiera a `/manifiesto` (308), y la prueba `caracterizacion/sitio-publico-y-formularios.test.ts` acepta los dos estados: si la redirección existe, exige que sea 308 a `/manifiesto`.

La rama que lo retira tiene que tocar, en el mismo PR (hallazgo A10):

- [ ] `app/whitepaper/page.tsx`: borrar, y añadir la redirección permanente `/whitepaper` → `/manifiesto` en `next.config.mjs`.
- [ ] `scripts/verificar-paquete.mjs:204-214`: quitar la exigencia de `docs/whitepaper.md` (hoy, sin él, **producción no arranca**), y su prueba `src/lib/verificar-paquete.test.ts:57-124`, `:191`.
- [ ] `next.config.mjs:39`, `:47`: sacar `docs/whitepaper.md` de `ARCHIVOS_DE_RUNTIME`.
- [ ] `start-azure.sh:10`: la referencia al archivo.
- [ ] `.github/workflows/paquete-azure.yml:90`: el ensayo espera `/whitepaper` en 200; pasarlo a la lista de 308.
- [ ] `packages/scripts/smoke-wp31.sh:33`, `:37`: pide `/whitepaper` en 200.
- [ ] `src/lib/menu.ts:119` (enlace del pie) y `src/lib/menu.test.ts:172-173`.
- [ ] `app/metodo/page.tsx:98-101` (enlace "Leer el whitepaper").
- [ ] `src/lib/contenido-publico.test.ts:58`, `:82-96`, `:608`, `:622`, `:757` (leen el archivo).
- [ ] Comentarios que citan el whitepaper como fuente: `app/manifiesto/page.tsx:10`, `src/lib/encuentros.ts:22` y `middleware.ts:5-6`.
- [ ] Revisar que el manifiesto cubra lo que el whitepaper explicaba y que nada enlace a `docs/whitepaper.md` (`git grep -n whitepaper`).
- [ ] Antes de desplegar, correr el workflow `paquete-azure` completo (incluye el ensayo de arranque).

## 7. Plan de las próximas sesiones del QA

Ritmo de la guía: **un feature por semana**, una sesión de trabajo con Claude y una revisión corta con John al final. Los borradores ya existen, así que cada semana el QA no parte de cero: valida, corrige y aprende.

**Cada sesión:**

1. Dibujar el DFD del feature desde lo que conoce como usuario, **antes** de abrir la ficha.
2. Compararlo con `docs/dfd/<feature>.svg` y con la ficha; ubicar en el repo pantalla, endpoint y función de la acción de la sección 3.
3. Explicarle el flujo a Claude con sus palabras (pegando el árbol y los archivos del feature); Claude corrige y completa.
4. Corregir la ficha y el JSON donde el código contradiga lo escrito, y regenerar: `python docs/dfd/generar_tm7.py docs/dfd/<feature>.json --estricto` y `--mermaid` para la sección 2.
5. Hacer el ejercicio del nivel que toca y correr `cd apps/web && npx vitest run src/lib/caracterizacion/<feature>.test.ts`.
6. Revisión con John: leer juntos la sección 9 (preguntas abiertas) y decidir. Marcar el criterio 6 ("leída por otra persona") en [`docs/features/README.md`](../features/README.md).

| Semana | Lunes | Feature | Ejercicio | Decisiones para la revisión con John |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-26 | Paso 0: esqueleto | Nivel 1: explicar el DFD nivel 0 sin mirar. Abrir `docs/dfd/00-sistema.tm7` en Microsoft Threat Modeling Tool y anotar el resultado en `docs/dfd/README.md` (B20). | Qué arranque usa el App Service; logs; si Entra y Telegram están encendidos. |
| 2 | 2026-11-02 | Login y sesión | Nivel 1: explicar alta y reingreso con wallet, y la puerta de Entra. | Entra sí o no; correo personal; reto en el login (A1); founder sin acuerdo (M3). |
| 3 | 2026-11-09 | Dashboard | Nivel 2: añadir un caso a `caracterizacion/dashboard.test.ts` (por ejemplo, un bloqueo nuevo aparece en el siguiente render). | Enlace en el menú y externos en la carga (M17); día del negocio (M8). |
| 4 | 2026-11-16 | Actividades | Nivel 2: añadir un caso a `caracterizacion/actividades.test.ts` (tomar, enviar a revisión y aprobar con cuatro ojos). | Un solo camino de escritura (M9). |
| 5 | 2026-11-23 | Ágora y hitos | Nivel 3: traducir la etiqueta "Avanzar → assign" (M6) y confirmar que la prueba sigue pasando. | Cuatro ojos en hitos (A5); B8 (A6); puntos frente a pagos (M22). |
| 6 | 2026-11-30 | Gamificación y épocas | Nivel 3: renombrar el acta de la firma del fitness (M13) y confirmar la prueba. | Época abierta (M10); un solo tope (M11); qué mide el fitness (M12). |
| 7 | 2026-12-07 | Anclaje en Stellar | Nivel 3: que `?limite=abc` use el valor por defecto (B14), con su caso de prueba. | Disparador del anclaje (A4); WP30 (M23). |
| 8 | 2026-12-14 | Proyectos y membresías | Nivel 3: corregir el comentario del filtro "Responsable" (B5). | Cliente de un proyecto (M16); manda el cliente o el proyecto (B5). |
| 9 | 2026-12-21 | Ritos y comunidad | Nivel 4: reproducir en local que la participación esperada cuenta a quien no puede asistir (M21). | Revisión del resumen del rito (M21); encuentros como datos. |
| 10 | 2026-12-28 | SLA, recordatorios y avisos | Nivel 4: reproducir la P1 en Backlog que no avisa a nadie (M18). | Workflow en `develop` y encendido de los recordatorios (A9). |
| 11 | 2027-01-04 | Talento e importador | Nivel 4: reproducir que la historia importada cuenta como cerrada esta semana (M15). | Retirar el roster del código (B9); más de un founder (B3). |
| 12 | 2027-01-11 | Clientes y grafo | Nivel 4: reproducir el 500 de `importGraph` con un JSON mal formado (M24). | Alta de clientes en producción (M24); limpieza de nombres (A8). |
| 13 | 2027-01-18 | Telegram | Nivel 4: reproducir el `update_id` repetido (B12). | Focos del día (M19); prompt y textos del bot (A8). |
| 14 | 2027-01-25 | Genoma y gobernanza | Nivel 4: reproducir que "revertir" no revierte (M13). | Genoma congelado (A7); votación (M14). |
| 15 | 2027-02-01 | Admin | Nivel 4: reproducir la reasignación silenciosa de `approveApplication` (M6). | Autor de cada acción (A5); confirmaciones (M7). |
| 16 | 2027-02-08 | Academia | Nivel 4: reproducir el quiz aprobado sin leer (A2). | Academia sin wallet (M2); textos desde el genoma (B11). |
| 17 | 2027-02-15 | Sitio público y formularios | Nivel 4: enviar un lead por la API sin la casilla de autorización (A3). | Privacidad (M20); marca (B16). |

Notas del plan:

- Las semanas del 21 y el 28 de diciembre pueden correrse si hay vacaciones; el orden no cambia.
- Los arreglos que bloquean la versión ([sección 1](#qué-falta-para-sacar-la-versión)) **no esperan** este calendario. Cuando alguien arregla un hallazgo, actualiza en el mismo PR el caso "HALLAZGO" de la prueba de caracterización y la ficha; si el QA llega después a ese feature, el ejercicio de nivel 4 se hace sobre el commit anterior al arreglo.
- Nivel 1 = explicar el flujo sin mirar; nivel 2 = escribir un caso de caracterización; nivel 3 = un cambio trivial con la prueba en verde; nivel 4 = reproducir en local una falla real.

## 8. Decisiones que necesita John

Las fichas dejan unas 90 preguntas abiertas en su sección 9. Estas son las que deciden algo para la versión, agrupadas:

**Acceso**

1. ¿Se enciende Microsoft Entra en producción para el equipo interno? Sin eso, "entrar con mi correo" no existe para nadie.
2. ¿Los externos deben poder entrar con correo? Implica enviar correos (fuera de v1).
3. ¿El founder que entra por Microsoft debe poder administrar sin haber firmado? Hoy la página dice que no y la API dice que sí.
4. ¿Se cambia la firma fija del login por un reto de un solo uso (A1)?

**Producción**

5. ¿Qué arranque usa hoy el App Service (`start-azure.sh` o el paquete standalone)? ¿Hay logs guardados y por cuánto tiempo?
6. ¿Quién dispara el anclaje y cada cuánto (A4)? ¿Cuántas filas `pending` hay hoy en `anchor_queue`?
7. ¿Se lleva `recordatorios.yml` a `develop` y se encienden los recordatorios (A9)?

**Reglas de puntos y épocas**

8. ¿El "día" del equipo es el de Bogotá (M8)? ¿Se migran los días ya guardados?
9. ¿Se congela una versión completa del genoma y qué claves de WP31 se pueden mutar (A7)?
10. ¿Sigue vigente la excepción B8 "Stage 0" y quién aprueba en el Ágora (A6, M22)?
11. ¿Qué hace "Firmar: revertir genoma" (M13)? ¿La votación sigue o se retira (M14)?
12. Si no hay época abierta, ¿se bloquean las emisiones (M10)?

**Datos personales**

13. ¿Se guarda la prueba de autorización con cada solicitud (A3)? ¿Cuánto tiempo se conservan `leads` y `bot_actions` (M20)?
14. ¿El resumen del rito lo revisa alguien antes de quedar en el acta pública (M21)?

**Repo y organización**

15. ¿Se limpia el historial del repo por los nombres reales (A8)?
16. ¿Habrá más de un founder o administrador (B3)? ¿Cuándo sale el roster del código (B9)?
17. ¿Se mantiene el driver de Azure SQL (sección 5.3)?
18. ¿"ZELENA" o "Zelena"?

## 9. Cómo se verificó esta auditoría

Todo se corrió el 2026-10-21 sobre el commit `0e07d8f`, en la rama `docs/auditoria-features`.

| Comprobación | Comando | Resultado |
| --- | --- | --- |
| DFD generados y validados | `python docs/dfd/generar_tm7.py --todos --estricto` | 17 generados (`.tm7` y `.svg`), 0 errores y 5 avisos aceptados (abajo). Pasan las 8 comprobaciones del generador en cada uno. |
| Cada elemento existe en el código | Script con `grep -F` por cada `archivo#símbolo` de los JSON | 433 elementos y 628 símbolos, ninguno falta. Los 652 flujos apuntan a elementos existentes. |
| Mermaid de la ficha = JSON | Comparación de cada bloque con `generar_tm7.py --mermaid` | 17 de 17 iguales (8 fichas se regeneraron en esta integración). |
| Secciones de la plantilla | Encabezados `## 1.` a `## 9.` de cada ficha | 16 de 16 completas; cada elemento y cada flujo del DFD aparece en las secciones 4 y 5. |
| Amenazas con estado | Columna "Estado" de la sección 7 | 236 amenazas: 126 mitigadas, 45 aceptadas y 65 pendientes. Ninguna `AutoGenerated`. |
| Dependencias simétricas | Matriz de la sección 6 de las 16 fichas | Se añadieron 23 dependencias inversas que faltaban; ahora si A anota a B, B anota a A. |
| Repo público | Las dos listas de huellas del repo (`contenido-publico.test.ts` y `sitio-publico.test.ts`) aplicadas a todo lo nuevo; búsqueda de correos, llaves y tokens | 0 nombres vetados o privados. Los correos son de dominio `.test`, las wallets son sintéticas y no hay secretos. El código de cohorte se cita por su nombre de constante. |
| Tipos | `cd apps/web && npx tsc --noEmit -p .` | Sin errores. |
| Pruebas de caracterización | `cd apps/web && npx vitest run src/lib/caracterizacion` | 16 archivos y 167 pruebas en verde. |
| Suite completa | `cd apps/web && npx vitest run` | 77 archivos y 1.367 pruebas en verde; 1 archivo y 15 pruebas omitidos: las 13 de `client-graph.test.ts`, sin su fixture privado (M24), y 2 que dependen de variables de entorno con la lista privada de nombres. Es la línea base de 1.200 más las 167 nuevas. Incluye el barrido de `docs/` por nombres vetados de `contenido-publico.test.ts`. |
| Rama por defecto | `gh api repos/zelena-tech/zelena-dapp` y su carpeta de workflows | `develop`, que solo trae `ci.yml` (A9). |
| Worker de anclaje | `node --check packages/scripts/anchor-worker.mjs` | `SyntaxError: Unexpected end of input` (A4). |

**Avisos del generador que se aceptan.** Cinco flujos unen dos actores sin un proceso en medio: `academia` f10 (el navegador carga el video directo de YouTube), `ritos-y-comunidad` f10 (el anfitrión muestra el código en pantalla o en persona), `sitio-publico-y-formularios` f12 (el visitante abre la transacción en el explorador público), y `telegram` f7 y f25 (la persona y los servidores de Telegram). Son pasos reales que ocurren fuera del sistema: la herramienta no genera amenazas para ellos, y por eso la sección 7 de cada ficha las analiza a mano (por ejemplo, la IP que recibe YouTube en Academia, "registrar asistencia sin estar" en ritos y "vincular la cuenta de otra persona adivinando un código" en Telegram). El detalle está en `docs/dfd/README.md`.

**Pendiente de verificación manual:** abrir los `.tm7` en Microsoft Threat Modeling Tool 4.3 (B20) y el criterio 6 de cada ficha (que otra persona la lea), que es el trabajo del plan de la sección 7.
