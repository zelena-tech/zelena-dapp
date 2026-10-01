# Guía de despliegue — de cero a hacerle seguimiento a las tareas

Tres rutas, en orden de fricción. **La ruta A no necesita ninguna credencial y te deja haciendo seguimiento real hoy mismo.** Las otras dos se pueden hacer después, sin rehacer nada.

| Ruta | Qué consigues | Necesitas | Tiempo |
|---|---|---|---|
| **A** | Tu backlog real en el tablero, en tu máquina | nada | ~20 min |
| **B** | URL interna en Azure para los 6 | suscripción Azure | ~2–3 h |
| **C** | Login con @zelena.tech + bot de Telegram | Entra + BotFather + API key | ~1 h |

---

## Ruta A · Empezar a hacer seguimiento HOY (sin credenciales)

### A1. Base limpia

Desde la fusión del 2026-09-30 la app **migra** su base SQLite al arrancar (respaldo `VACUUM INTO` + `COLUMNAS_NUEVAS` en `lib/db.ts`), así que una base vieja ya no falla. En tu máquina la base sigue siendo desechable si quieres empezar de cero (en producción **nunca** se borra):

```bash
rm -f apps/web/data/zelena.db apps/web/data/zelena.db-shm apps/web/data/zelena.db-wal
```

### A2. Instalar y arrancar

```bash
npm install && npm run dev
```

La base se crea y se siembra sola: época Génesis, genoma v1, los 6 del equipo con su principal `pending:<slug>`, y —solo fuera de producción— las 6 invitaciones `GENESIS-000x`.

### A3. Validar tu CSV antes de escribir nada

```bash
node packages/scripts/import-tareas.mjs --dry-run "C:/Users/Omnia/Desktop/DAO/Zelena_Tareas_Import.csv"
```

`--dry-run` valida y reporta **sin escribir**. El importador **rechaza** valores desconocidos de `Status`, `Priority`, `Horizonte` y `Assignee` en vez de adivinar, así que revisa que no haya filas rechazadas.

⚠️ Hoy `Assignee` se resuelve contra los 6 nombres del roster **que están en código**. Si tu CSV trae a alguien más, esas filas se rechazan — eso lo arregla **WP32** (ver `workflow-v1.2.md`).

### A4. Importar de verdad

```bash
node packages/scripts/import-tareas.mjs "C:/Users/Omnia/Desktop/DAO/Zelena_Tareas_Import.csv"
```

Es **idempotente**: reimportar no duplica, y **no pisa el `status`** de una asignación que el equipo ya movió en la app (solo actualiza título, descripción, prioridad, criterio y responsable).

### A5. Usarlo

Entra en `http://localhost:3000` con `GENESIS-0001` + "Usar wallet de prueba".

- **`/equipo/hoy`** — tus asignaciones del día, acciones de un click, bloquear con motivo obligatorio, check-in diario.
- **`/equipo/proyectos`** — por iniciativa, filtrable por horizonte.
- **`/equipo/dashboard`** — bloqueos primero, bandeja "esperando una decisión tuya", carga por persona, salud de ritos, digest del día exportable.

> **Sabelo antes de que te confunda:** tus tareas del CSV cuelgan de `pending:john`, pero la sesión de invitación usa la wallet demo — así que **`/equipo/hoy` te puede salir vacío mientras el tablero está lleno**. Es el hallazgo D3-04 y lo arregla **WP37**. Mientras tanto, mira `/equipo/proyectos` y el dashboard, que sí muestran todo.

### A6. Lo que no vas a tener en la ruta A

Login corporativo (ruta C), bot (ruta C), y acceso para los otros 5 desde sus máquinas (ruta B).

---

## Ruta B · URL interna en Azure

### B0. Antes de exponer nada — no es opcional

1. **Parchear Next.** `npm audit` reporta 21 vulnerabilidades (2 critical, 16 high) sobre `next@14.2.15`. Subir a la última 14.2.x parcheada y correr la suite. Es **WP33** y es lo primero.
2. **Confirmar que el seed de demo no abre producción.** `demoInvitesAllowed()` solo evita *sembrar* los `GENESIS-000x` con `NODE_ENV=production`; no anulaba los que ya existían, y la base de producción tiene los seis sin usar. Desde el 2026-09-30 cada arranque de producción **vence** los `GENESIS-0001…0006` que sigan sin usar (solo esos seis: las invitaciones reales de `/admin` usan el mismo prefijo). Compruébalo en el log del primer arranque (`[seed] … GENESIS-000x vencidas`). **No pongas `SEED_DEMO=1`** en el App Service: esos códigos están publicados. El código de cohorte `ESPECIALIZACION-2026` sigue vivo en prod (400 cupos, 7 usados, vence el 2026-11-10); cerrarlo es decisión tuya (ver `DESPLIEGUE-V1.md`, "Invitaciones vivas en producción").
3. **Verificar el dialecto contra la instancia real.** Nadie ha ejecutado el T-SQL generado contra Azure SQL. Es **WP36**: hasta que exista ese comando, el despliegue es un primer contacto, no una verificación.
4. **Acceso del founder y paquete.** Antes del primer arranque del código nuevo, haz las comprobaciones de `DESPLIEGUE-V1.md`, "Acceso del founder" (que `FOUNDER_WALLET` sea tu wallet real, registrada y con llave Stellar válida, o tener listo `FOUNDER_BOOTSTRAP_CODE`) y "Paquete del despliegue" (`node scripts/verificar-paquete.mjs` en Kudu). Sin lo primero nadie entra a `/admin`: en la base de producción el único founder es la wallet demo, con la que nadie puede firmar. Sin lo segundo la app arranca con otro Next, sin `next-auth` o sin el whitepaper.

### B1. Recursos (~30 min)

- Resource group `rg-zelena-workspace`
- **App Service** Linux, Node 20, plan **B1 o superior** (el free tier duerme la app)
- **Azure SQL Database**, tier Basic (~5 USD/mes) o General Purpose Serverless con auto-pausa
- Regla de firewall **"Allow Azure services"** o private endpoint. **Nunca** 0.0.0.0
- Activar **managed identity** en el App Service y darle acceso a la base → sin contraseña de DB en la configuración
- Backups: la retención automática viene activada; confirma ≥7 días

### B2. App Settings

Todas las variables están documentadas en [`docs/deploy.md`](deploy.md) — nunca en `.env*`. Las mínimas para arrancar:

| Variable | Valor |
|---|---|
| `AZURE_SQL_SERVER` | `zelena-sql.database.windows.net` |
| `AZURE_SQL_DATABASE` | `zelena` |
| `SESSION_SECRET` | 32+ bytes aleatorios (**la app no arranca sin él**) |
| `FOUNDER_WALLET` | tu wallet real, ya registrada: **en cada arranque** su fila queda `founder` (los gates leen `users.role`, no la variable). Si te registras después, reinicia la app |
| `FOUNDER_BOOTSTRAP_CODE` | opcional, secreto de 16–40 caracteres: entrar con él y tu wallet (nueva o ya registrada) te deja `founder`. Un solo uso, vence a los 7 días |
| `STELLAR_NETWORK` | `testnet` — **nunca** mainnet en v1 |
| `NODE_ENV` | `production` |

Deja `AUTH_ENTRA_ENABLED` y `TELEGRAM_ENABLED` **apagados** hasta la ruta C.

### B3. Migrar el esquema

En una base nueva no hay nada que hacer: el arranque aplica el esquema traducido a T-SQL. **Si la base ya existía**, las columnas nuevas requieren `ALTER TABLE` explícito (no hay migraciones).

### B4. Smoke test

Entrar → `/equipo/hoy` → cambiar el estado de una asignación → el dashboard refleja el cambio → reiniciar el App Service y comprobar que **los datos persisten**.

### B5. Worker de anclaje

⚠️ `packages/scripts/anchor-worker.mjs` **abre SQLite directamente**, sin pasar por `lib/db.ts`: tal cual **no leerá la cola de Azure SQL**. Desplegarlo como WebJob no basta; hay que migrarlo a la capa de datos o darle su propio cliente `mssql`. Con la cuenta de **testnet**, jamás llaves de mainnet.

### B6. Costo

~20–25 USD/mes (App Service B1 ~13 · Azure SQL Basic ~5 · Blob ~1 · Claude API ~2–5). Confirma en la calculadora de Azure con tu región y tier exactos.

**Límite conocido:** el rate limiting es en memoria por proceso — solo es un control real con **una** instancia. Si escalas a más, hay que mover a Redis.

---

## Ruta C · Encender el login corporativo y el bot

### C1. Entra ID (~20 min)

En portal.azure.com → Microsoft Entra ID → App registrations → New registration:

- **Name:** Zelena Workspace
- **Account types:** *Accounts in this organizational directory only (single tenant)*
- **Redirect URI (Web):** `<tu URL>/api/auth/callback/microsoft-entra-id` — coincide **exactamente** con lo que expone el código
- Copiar **Application (client) ID** y **Directory (tenant) ID**
- Certificates & secrets → New client secret → copiar el **Value** (se muestra una sola vez)
- API permissions: `User.Read` delegado basta

App Settings a añadir:

| Variable | Para qué |
|---|---|
| `AUTH_ENTRA_ENABLED` | `1` para encender |
| `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` / `AZURE_AD_TENANT_ID` | del registro |
| `NEXTAUTH_SECRET` | 32+ bytes aleatorios, **distinto** de `SESSION_SECRET` |
| `NEXTAUTH_URL` | la URL pública; si no coincide con la Redirect URI, Entra rechaza el login |

*(Las cuatro últimas faltaban en el checklist original — hallazgo D3-06.)*

**Qué esperar la primera vez:** el `tid` del token se valida contra tu tenant, así que un correo de otro tenant se rechaza con mensaje claro. Los 6 del roster se **vinculan** a su fila existente (`pending:<slug>`) en vez de crear una nueva, así que su trabajo del CSV los sigue. Quien no esté en el roster entra como `core` con principal `entra:<oid>`.

### C2. Bot de Telegram (~5 min)

- @BotFather → `/newbot` → copiar el **token**
- console.anthropic.com → crear `ANTHROPIC_API_KEY`

| Variable | Nota |
|---|---|
| `TELEGRAM_ENABLED` | `1` para encender |
| `TELEGRAM_BOT_TOKEN` | de BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | obligatorio **también en local** (el script de polling hace de puente al mismo handler) |
| `ANTHROPIC_API_KEY` | clasificación de mensajes |

Alta: en `/admin` → panel del bot → genera un código de un solo uso → envíaselo al bot como `/start CODIGO`. El código se guarda **hasheado**; se muestra una sola vez.

En local el bot corre en **polling** (no necesita URL pública):

```bash
node packages/scripts/telegram-bot.mjs
```

⚠️ **El audio todavía no funciona.** La API de Claude no transcribe audio y no hay proveedor decidido. La costura está construida y mockeada; un audio real recibe una respuesta honesta ("todavía no puedo convertir audio a texto"). Falta tu decisión de proveedor — y con ella, si el audio de tus reuniones sale del entorno de la DAO.

---

## Secuencia recomendada

| # | Paso | Quién | Depende de |
|---|---|---|---|
| 1 | **Ruta A** — importar el CSV y usar el tablero hoy | John | nada |
| 2 | Escribir lo que no te guste en `docs/specs/FEEDBACK.md` | John | 1 |
| 3 | **WP33** (parchear Next + docs) y **WP32** (roster como datos) | agente | nada |
| 4 | **Ruta B** — Azure, con B0 hecho | Fausto + John | 3 |
| 5 | **WP36** — verificación real contra Azure SQL | Fausto | 4 |
| 6 | **Ruta C** — encender Entra y el bot | Fausto + John | 4 |
| 7 | Alta de los 6 + primer check-in de todos | equipo | 6 |

**Los `FBxx` de tu feedback tienen prioridad sobre todo**, incluidos los WPs de arriba.

---

## Qué es "v1 exitosa"

Se mide con ~2 semanas de **uso**, no de código (`QUEUE.md`):

1. El 100% de tus tareas nuevas entran por el sistema — cero por WhatsApp o por cabeza.
2. ≥10 asignaciones reales cerradas contra criterios de aceptación.
3. El dashboard reemplazó ≥2 reuniones de estado por semana.
4. Los 5 del equipo hicieron login y tienen asignaciones reales.

Solo al cumplirse se descongela **WP18** (OKRs). **WP17** (entornos por cliente) ya se descongeló por decisión tuya del 2026-08-16 y entra en v1 con WP20 (grafo de operación); con WP17 se habilita el camino al bot de WhatsApp (**WP35**). Los IDs de v1.2 se renumeraron en la fusión del 2026-09-30 (WP20→WP32 … WP26→WP38; ver `docs/specs/QUEUE.md`).
