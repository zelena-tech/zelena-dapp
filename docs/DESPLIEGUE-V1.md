# Despliegue v1 "Organizar" — checklist

Release v1 = WP13 (login Entra) + WP14 (módulo equipo) + WP15 (dashboard) + WP16 (Azure) + WP19 (asistente Telegram de John) + WP17 (entornos por cliente) + WP20 (grafo de operación). WP17 y WP20 los descongeló John el 2026-08-16; WP18 sigue en v1.1, tras los criterios de uso de QUEUE.md.
Objetivo: el equipo abre la app con su correo @zelena.tech y ve sus asignaciones del día; John captura y prioriza desde Telegram; el dashboard responde sin preguntar.

---

## PARTE A · Lo que solo puede hacer John (bloquea el despliegue)

### A1. Entra ID — registro de la aplicación y encendido del login con Microsoft (~30 min)

**1. Registrar la aplicación** en el tenant de **zelena.tech**: [portal.azure.com](https://portal.azure.com)
(con una cuenta administradora de ese tenant) → Microsoft Entra ID → App registrations → New registration:

- **Name:** Zelena Workspace
- **Supported account types:** *Accounts in this organizational directory only (single tenant)*. La app
  además compara el `tid` del token con `AZURE_AD_TENANT_ID` y rechaza invitados B2B (`#EXT#`).
- **Redirect URI:** plataforma **Web** → `https://www.zelena.tech/api/auth/callback/microsoft-entra-id`
  (exacta: `microsoft-entra-id` es el id del provider en el código). Para probar en local, añadir también
  `http://localhost:3000/api/auth/callback/microsoft-entra-id` en Authentication → Web → Redirect URIs.
- **Authentication:** no hace falta *implicit grant* ni *ID tokens* del flujo implícito: la app usa el
  flujo de código con secreto de cliente.
- **Overview:** copiar **Application (client) ID** (`AZURE_AD_CLIENT_ID`) y **Directory (tenant) ID**
  (`AZURE_AD_TENANT_ID`).
- **Certificates & secrets** → New client secret → copiar el **Value** (`AZURE_AD_CLIENT_SECRET`; se muestra
  una sola vez). Anotar su fecha de vencimiento: al vencer, el login con Microsoft deja de funcionar
  hasta poner uno nuevo.
- **API permissions:** Microsoft Graph → *Delegated* → `openid`, `profile` y `email` (son los únicos scopes
  que pide la app: no llama a Graph). Como administrador del tenant, *Grant admin consent*. El
  `User.Read` que el portal añade por defecto no se usa y se puede quitar.

**2. App Settings de la app de producción** (por gestor de secretos, nunca por chat ni en el repo):

| Variable | Valor |
|---|---|
| `AUTH_ENTRA_ENABLED` | `1` (encender); vacío o `0` lo apaga sin desplegar |
| `AZURE_AD_CLIENT_ID` | Application (client) ID |
| `AZURE_AD_CLIENT_SECRET` | el Value del secreto de cliente |
| `AZURE_AD_TENANT_ID` | Directory (tenant) ID de zelena.tech |
| `NEXTAUTH_SECRET` | 32+ bytes aleatorios, distinto de `SESSION_SECRET` (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `NEXTAUTH_URL` | `https://www.zelena.tech` (sin barra ni ruta al final) |
| `ZELENA_CORPORATE_DOMAIN` | `zelena.tech` |

**Detrás de Azure Front Door:** `NEXTAUTH_URL` es obligatorio y debe ser el host público. NextAuth arma
con él la Redirect URI y el nombre seguro de sus cookies, y el intercambio
(`/api/auth/entra/exchange`) redirige con él a `/equipo/hoy` o a `/entrar`: en App Service la app ve
su host interno (`0.0.0.0:8080`), así que sin esa variable la redirección sacaría a la persona del
sitio. Front Door no necesita reglas especiales (reenvía las cookies tal cual).

**3. Antes de que alguien entre con Microsoft:** la app reconoce a cada persona SOLO por su cuenta de
Microsoft ya vinculada (`oid`) o por su **correo exacto ya vinculado**; nunca por su nombre ni por un
correo parecido. Por eso el founder, entrando con su wallet (Freighter), va a `/equipo/talento` →
**Entrar con Microsoft** y escribe el correo @zelena.tech de cada fila: primero el suyo en su propia
fila (la de una cuenta founder solo la vincula su dueño) y luego el de cada persona del equipo en su
fila del roster. Quien entre con Microsoft sin correo vinculado recibe una cuenta propia nueva
(`entra:<oid>`, rol `core`), nunca la fila de otra persona ni la del founder.

**4. Comprobar:** `GET https://www.zelena.tech/api/auth/entra/status` responde `available: true`; el
founder entra con "Continuar con Microsoft" y llega a `/equipo/hoy` con su rol; una cuenta del tenant
sin correo vinculado entra como `core` con una fila nueva. Para apagar: `AUTH_ENTRA_ENABLED=0`.

### A2. Azure — recursos (~30 min, o delegar a Dev 2 con permisos)
- Resource group (su nombre vive en la configuración de Azure, no en el repo)
- **App Service** (Linux, Node 20, plan B1 o superior; el free tier duerme la app)
- **Azure SQL Database** — tier Basic para empezar (o General Purpose Serverless con auto-pausa si prefieres que duerma fuera de horario). Backups automáticos vienen activados por defecto.
- Regla de firewall "Allow Azure services" (o private endpoint). **Nunca** abrir a 0.0.0.0.
- Recomendado: activar **managed identity** en el App Service y darle acceso a la base → sin contraseña de DB en la configuración.
- Añadir la URL pública como Redirect URI en el registro de A1
- **Obligatorio con Azure Front Door delante: App Service solo acepta tráfico de NUESTRO Front Door.**
  El límite de intentos (`clientIp`, `src/lib/rate-limit.ts`) cuenta por la IP que escribe Front Door
  en `X-Azure-ClientIP`. Si se le puede hablar directo a App Service (`<app>.azurewebsites.net`), el
  cliente pone en esa cabecera lo que quiera y el límite desaparece. Dos cosas, las dos:
  1. **Restricción de acceso.** Front Door → Overview → copiar el **Front Door ID** (un GUID). App
     Service → Networking → Access restriction → sitio principal → Add rule: *Allow*, prioridad 100,
     tipo **Service Tag** `AzureFrontDoor.Backend`, filtro de cabecera HTTP **`X-Azure-FDID`** = ese
     ID; *Unmatched rule action*: **Deny**. La etiqueta sola no basta: deja pasar el Front Door de
     cualquiera; la cabecera lo ata al nuestro. El sitio `scm` (Kudu) conserva sus propias reglas (no
     marcar "usar las reglas del sitio principal": por ahí van el despliegue y el SSH). Por CLI:
     `az webapp config access-restriction add -g <grupo> -n <app> --rule-name front-door --action Allow --priority 100 --service-tag AzureFrontDoor.Backend --http-header x-azure-fdid=<FRONT_DOOR_ID>`.
  2. **App Setting `AZURE_FRONT_DOOR_ID`** = el mismo ID. La app solo cree `X-Azure-ClientIP` si la
     petición trae `X-Azure-FDID` igual a ese valor; si no, usa el último valor de `X-Forwarded-For`
     (el del frontal de App Service). Sin la variable, detrás de Front Door ese valor es la IP del
     borde y el límite agruparía a quienes la comparten: el log de la app lo avisa una vez, con la
     primera petición que llega por Front Door (`[rate-limit] … AZURE_FRONT_DOOR_ID no está configurada`).

  **Comprobar:** `curl -s -o /dev/null -w "%{http_code}" https://<app>.azurewebsites.net/` responde
  **403**; `https://www.zelena.tech/` responde 200; y 25 peticiones seguidas a
  `https://www.zelena.tech/api/login/reto` con `X-Azure-ClientIP` distinta en cada una terminan en
  **429** a partir de la 21. Sin Front Door delante no hace falta nada de esto.

### A3. Bot de Telegram + API key (~5 min)
- En Telegram: **@BotFather** → `/newbot` → nombre y usuario del bot → copiar el **token**.
- En [console.anthropic.com](https://console.anthropic.com): crear **ANTHROPIC_API_KEY**.
- Generar además un **`TELEGRAM_WEBHOOK_SECRET`** (cadena aleatoria). Es obligatorio **también en local**: el script de polling hace de puente al mismo handler del webhook, que rechaza cualquier request sin él.
- Los tres van a `apps/web/.env.local` (local) y a App Settings (Azure), más `TELEGRAM_ENABLED=1` para encender. En local el bot corre en modo polling — no necesita URL pública.

### A4. Decisiones (5 min)
- ¿Quién es supervisor además de John? (ve el dashboard completo; sugerido: Operaciones)
- Lista de los 6 correos @zelena.tech que entran en v1 (incluidas Operaciones y Contenido)
- ¿Alguien del equipo no tiene correo corporativo? → entra por la puerta de comunidad

### A5. En paralelo, no bloquea
- Consulta legal/tributaria de nómina en USDC (gate de WP10 — la persigue Finanzas)
- Cuenta de Privy (gate de WP04, fase descentralizar)
- Org GitHub (gate de WP06, fase descentralizar)

---

## PARTE B · Lo que el equipo/agente puede hacer ya (sin esperar a John)

Todo esto es ejecutable esta noche con el loop de `CLAUDE.md` (subagentes en paralelo donde los WPs no comparten archivos):

1. **WP14 completo** — modelo, importador del CSV, `/equipo/hoy`, `/equipo/proyectos`, check-in diario.
2. **WP15 completo** — dashboard, bloqueos primero, bandeja "esperando a John", digest del día.
3. **WP13 scaffolding** — NextAuth + provider Entra + esquema `entra_oid`/`role`, con mock en tests y flag `AUTH_ENTRA_ENABLED=false`. Al llegar los secretos, solo se encienden.
4. **WP16 parcial** — driver `mssql` (Azure SQL) detrás de `lib/db.ts` + `schema.sql` en dialecto T-SQL + suite verde. Desarrollo local sigue con SQLite; el driver de Azure SQL se prueba contra la instancia real en el paso 6.
5. **WP19 scaffolding** — webhook/polling + las 5 herramientas con mock de Claude + `telegram_links`, detrás de `TELEGRAM_ENABLED=false`. Con token y API key, se enciende y se prueba en polling local.

**Prompt de lanzamiento (terminal, desde la raíz del repo):**

```
claude
> Lee CLAUDE.md y procesa el release v1 según el orden de QUEUE.md: WP14, WP15,
> scaffolding de WP13 con mock, driver Azure SQL (`mssql`) de WP16 y scaffolding de WP19.
> Usa subagentes en paralelo donde los WPs no compartan archivos.
> Al terminar escribe docs/specs/NIGHT-REPORT.md.
```

**Ciclo de iteración de mañana:** `npm run dev` → localhost:3000 → lo que no te guste va a `docs/specs/FEEDBACK.md` (`- [ ] página: qué mejorar`) → relanzar el loop: los FBxx tienen prioridad sobre todo.

---

## PARTE C · Secuencia del despliegue

| Paso | Quién | Depende de |
|---|---|---|
| 1. Loop nocturno: WP14 → WP15 → WP13 scaffold → WP16 driver Azure SQL → WP19 scaffold | Agente (subagentes en paralelo) | nada |
| 2. Revisión en localhost + FEEDBACK.md + relanzar loop | John | paso 1 |
| 3. Secretos: Entra (A1) + bot y API key (A3) | John | — |
| 4. Encender WP13 y WP19, probar login y bot en local (polling) | Plataforma / John | pasos 1 y 3 |
| 5. Crear recursos Azure (A2) | John / Plataforma | — |
| 6. Desplegar, migrar schema, activar webhook, smoke test | Plataforma | pasos 4 y 5 |
| 7. Alta de los 6 + importar el CSV real | John | paso 6 |
| 8. Primer check-in diario de todos | Equipo | paso 7 |

### Comandos reales del paso 7 (importar el CSV)

> ⚠️ **En producción NUNCA se borra la base.** `/home/data/zelena.db` tiene firmas reales del
> CLA ancladas en testnet, invitaciones consumidas, reputación y puntos: borrarla es perder
> historia que no se puede reconstruir. Una base que no arranca se **restaura** desde su
> respaldo (ver "Producción real hoy"), nunca se recrea.

La app **sí migra** su base al arrancar (ruta SQLite de `lib/db.ts`), en este orden:

1. Si hay algo que migrar (falta una columna de `COLUMNAS_NUEVAS` o el módulo equipo tiene la
   forma legado de la línea desplegada), hace un **respaldo automático**
   `VACUUM INTO '<base>.pre-fusion-<fechaISO>.db'` junto a la base. Si el respaldo falla,
   **no migra** y el arranque falla con un mensaje claro.
2. `applyMigrations`: `ALTER TABLE ADD COLUMN` para `users.role/is_supervisor/entra_oid/auth_provider`,
   `invites.max_uses/uses`, `projects.draft/origin` y `anchor_queue.claimed_at`, solo si faltan.
3. Aparta las tablas legado del equipo (`_legado_*`), crea las de v1 con `schema.sql`, copia las
   filas con el mapeo de valores (prioridad, horizonte, acciones) conservando los ids y borra las
   `_legado_*`. Un valor desconocido **aborta** sin cambios.
4. Siembra (roster, iniciativas, escotilla y, solo con `SEED_COHORT=1`, el código de cohorte), vence
   en producción las invitaciones demo `GENESIS-0001…0006` que sigan sin usar, y promueve a `founder`
   la fila `is_founder=1` o `wallet = FOUNDER_WALLET` (el gate de antes queda como **dato** de la base,
   no como regla de código). Este paso corre en **cada** arranque, no solo en el que migra: ver
   "Acceso del founder".
5. Migraciones de datos, cada una en su propio `try/catch` (si una falla, el arranque sigue y se
   reintenta en el siguiente), idempotentes y sin borrar nada:
   - **Borradores del Ágora** (decisión del founder, 2026-10-21): los proyectos sembrados pasan a
     borrador (`projects.draft = 1`, `origin = 'seed'`). Se reconocen por su origen, no por su nombre:
     sin entrega del tablero enlazada, con un hito `ord = 0` (el seed numera desde 0; el puente del
     Ágora, desde 1) y con supervisor `is_founder = 1`. No se ven en `/agora` (la ficha da 404), ni en
     las cifras de la landing, ni reciben aplicaciones. El founder los publica desde `/admin` →
     Proyectos → **Publicar**, y un proyecto publicado no vuelve a borrador al reiniciar.
   - **Decisiones reemplazadas** (decisión del founder, 2026-10-21): registra en
     `decision_replacements` (solo inserción) que la decisión histórica de las etiquetas viejas la
     reemplaza "Las etiquetas de proyecto pasan a Cliente y Comunidad". `/gobernanza` y `/comunidad`
     muestran solo la vigente, sin el texto original; el original sigue intacto en `decision_log`, con
     su huella, y el founder lo ve completo en `/admin` → Decisiones reemplazadas.
   - **Cuentas con la wallet del navegador** (decisión del founder, 2026-10-21): desde ahora
     `is_demo` lo decide el servidor por el código (solo los `GENESIS-0001…0006` de demostración dan
     cuenta de demostración). La migración pasa a reales (`is_demo` 1 → 0, nunca al revés) las cuentas
     ya registradas así si cumplen las cuatro: `is_founder = 0`; firmaron el acuerdo con una firma
     que no es del seed (`seed-sig-…`); su wallet es una llave Stellar válida (las wallets del seed
     son marcadores con la suma de verificación inválida); y no consumieron un código de
     demostración. Deja una fila `cuenta_real` en `talent_events` (actor `migracion`) por cuenta.

Es idempotente: el segundo arranque no cambia nada. En **desarrollo local** la base
(`apps/web/data/zelena.db`) sigue siendo desechable si quieres empezar de cero, pero ya no hace
falta borrarla para arrancar tras una ola.

Con la app arrancada una vez (`npm run dev`) para que cree y siembre la base, importa:

```bash
node packages/scripts/import-tareas.mjs --dry-run "<ruta>/tareas.csv"
```

`--dry-run` valida y reporta sin escribir: revisa que no haya filas rechazadas (el
importador **rechaza** valores desconocidos de Status/Priority/Horizonte/Assignee en vez
de adivinar). Cuando el reporte esté limpio, corre el mismo comando sin `--dry-run`. Es
**idempotente**: reimportar no duplica, y **no pisa el `status`** de una asignación que
el equipo ya movió en la app — solo actualiza título, descripción, prioridad, criterio y
responsable.

La ruta Azure SQL (`mssql`) **no migra** todavía: una base Azure SQL nueva se crea completa con
`schema.sql` traducido; una ya existente requeriría `ALTER TABLE` explícito. Hoy no aplica (ver abajo).

### Producción real hoy: SQLite en `/home/data/zelena.db` (Azure SQL todavía no)

- App Service Linux (Node 22) con **SQLite** (`node:sqlite`) en `/home/data/zelena.db`,
  fuera de `wwwroot`, para que un despliegue no la pise. Azure SQL (`mssql`) está implementado pero
  **no** es la base de producción.
- Fijar **`DATABASE_DRIVER=sqlite`** en App Settings antes de desplegar: v1 cambia sola a Azure SQL
  (una base vacía) si ve `AZURE_SQL_SERVER` o `AZURE_SQL_CONNECTION_STRING`, y con eso la app
  "perdería" los datos cambiándose de base.
- `DATABASE_FILE=/home/data/zelena.db`, `SESSION_SECRET` (≥32 caracteres), `FOUNDER_WALLET` (la wallet
  real de John **ya registrada**: cada arranque la promueve a `founder`; ver "Acceso del founder", que
  se comprueba ANTES de desplegar). `SEED_COHORT=1` solo si se quiere sembrar o alargar el código de
  cohorte `ESPECIALIZACION-2026` (ver "Invitaciones vivas en producción").
- Con Azure Front Door delante: **restricción de acceso** de App Service (`AzureFrontDoor.Backend` +
  `X-Azure-FDID`) y **`AZURE_FRONT_DOOR_ID`** en App Settings (A2, obligatorio): sin ellas, el límite
  de intentos se esquiva hablándole directo a App Service.
- **Arranque probado hoy:** `apps/web/start-azure.sh` (`node node_modules/next/dist/bin/next start`
  sobre `.next` + `node_modules`). Se conserva; ahora verifica el paquete antes de arrancar (ver
  "Paquete del despliegue").
- **Build standalone (siguiente paso):** se compila en **Linux** (GitHub Actions, `npm ci` real, sin
  symlinks) con `NEXT_STANDALONE=1 npm --workspace apps/web run build`. Solo con esa variable
  `next.config.mjs` activa `output: "standalone"`; `outputFileTracingIncludes` mete en el paquete
  `apps/web/src/lib/schema.sql`, los `.mjs` del worker de BD y `CLA.md` (raíz y `apps/web`).
  `docs/whitepaper.md` ya no va: el sitio no lo sirve (`/whitepaper` redirige con 308 a `/manifiesto`).
  Copiar `apps/web/.next/static` a `.next/standalone/apps/web/.next/static`
  (y `apps/web/public` a `.next/standalone/apps/web/public`) y arrancar con `node apps/web/server.js`
  (`PORT`, `HOSTNAME=0.0.0.0`). Sin `CLA.md` en el paquete la app firma el texto de reserva (ya pasó
  una vez en producción).
- **Antes de cada despliegue que cambie el esquema:** por SSH de Kudu,
  `node -e "new (require('node:sqlite').DatabaseSync)('/home/data/zelena.db').exec(\"VACUUM INTO '/home/data/zelena-pre-fusion-AAAAMMDD.db'\")"`,
  bajar esa copia y ensayar el arranque sobre ella **con el mismo `FOUNDER_WALLET` de App Settings**.
- **Después:** el log de arranque muestra las migraciones y la ruta del respaldo, `[db] founder: …`
  **sin avisos** y, la primera vez, `[seed] 6 invitación(es) demo GENESIS-000x vencidas`; `GET /api/cla`
  devuelve el hash `03293c93…`; John entra a `/admin` **firmando con su wallet** (`/entrar` → "Ya
  estoy registrado"), no con una cookie de prueba.
- **Rollback:** volver al paquete anterior **y** restaurar `/home/data/zelena-pre-fusion-*.db`. Sin
  restaurar la base, el código viejo arranca pero su módulo equipo no puede escribir.

### Acceso del founder (comprobar ANTES del despliegue)

En la línea desplegada bastaba `session.wallet === FOUNDER_WALLET` (o `is_supervisor=1`). En v1
`/admin` lo decide `users.role` (`lib/authz.ts`): entra quien tiene una fila `founder`. Si la única
fila `founder` de la base es la wallet demo del seed, que **no es una llave Stellar válida** (nadie
puede firmar con ella), y la fila del founder en el roster (`pending:<slug>`) solo entra por Entra,
que está apagado, **nadie entra a `/admin`**. Dos caminos dejan `founder` a una wallet real:

- **`FOUNDER_WALLET`, en cada arranque.** La fila con esa wallet pasa a `role='founder'`,
  `is_supervisor=1`. Solo promueve, nunca degrada. Si la wallet se registra **después** del
  despliegue (con la cohorte o una invitación nace `contributor`), basta con **reiniciar la app**.
- **La escotilla `FOUNDER_BOOTSTRAP_CODE`** (App Setting secreto, 16–40 caracteres; se compara en
  mayúsculas porque `/entrar` las fuerza). Entrar en `/entrar?code=<código>` con la wallet de John la
  deja `founder`, **sea nueva o ya registrada**, por el camino del código y no por "Ya estoy
  registrado". Un solo uso; vence a los 7 días de sembrarse. Si venció o ya se usó, poner un valor
  nuevo y reiniciar.

Pasos:

1. Leer (sin cambiar nada) el valor de `FOUNDER_WALLET` en App Settings de la app de producción.
2. Sobre la copia fresca de Kudu (la del `VACUUM INTO` de arriba), en solo lectura. Antes de migrar
   la tabla todavía no tiene `role`, así que no se pide:
   ```bash
   node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log(db.prepare('SELECT wallet, display_name, is_founder, is_supervisor, cla_signed FROM users WHERE wallet = ?').get(process.argv[2]) ?? 'NO HAY FILA')" zelena-pre-fusion-AAAAMMDD.db '<FOUNDER_WALLET>'
   node -e "console.log(require('@stellar/stellar-sdk').StrKey.isValidEd25519PublicKey(process.argv[1]))" '<FOUNDER_WALLET>'
   ```
   (el segundo, desde una carpeta con `node_modules`, p. ej. `apps/web` o `/home/site/wwwroot`).
3. Decidir:
   - **Hay fila, `cla_signed=1`, la llave es válida y es la wallet de John en Freighter:** el arranque
     la promueve. Repetir el ensayo con ese valor y comprobar `/admin` con una **firma real** por
     `/api/login`.
   - **No hay fila, la llave no es válida o no es de John:** antes del primer arranque, o fijar
     `FOUNDER_WALLET` a la wallet real de John ya registrada (la consulta del paso 2 dice cuáles
     filas tienen llave válida; ese detalle de producción no se copia al repo), o tener listo
     `FOUNDER_BOOTSTRAP_CODE` para que John entre con él y su wallet. **Nunca** con el código de cohorte: da `contributor` y obliga a reiniciar.
4. En el log del primer arranque, `[db] founder: …`. Sin avisos = al menos un founder puede firmar.
   Con `no tiene fila en users` o `ninguna fila founder tiene una llave Stellar válida`, todavía nadie
   entra a `/admin` por firma: volver al paso 3.
5. Último recurso, por Kudu y **después** del respaldo:
   `UPDATE users SET role = 'founder', is_supervisor = 1 WHERE wallet = '<wallet de John>'` (la app
   lo lee en la siguiente petición, sin reiniciar).

Cambiar `FOUNDER_WALLET` más adelante promueve la nueva y **no** le quita el rol a la anterior.
Retirar un founder es una decisión explícita: `UPDATE users SET role = 'contributor', is_supervisor = 0
WHERE wallet = '<wallet>'` por Kudu tras el respaldo, hasta que WP32 lo lleve a `/admin`. La línea
desplegada también dejaba entrar a `/admin` a las filas con `is_supervisor=1`; v1 lo quita a
propósito (los supervisores supervisan, no administran). Antes de desplegar, comprobar en la copia
que ninguna fila depende de `is_supervisor=1` para administrar.

### Invitaciones vivas en producción

- **`GENESIS-0001…0006`** son predecibles y están publicadas (CLAUDE.md, `docs/deploy.md`). Si una
  base las tiene **sin usar**, cualquiera se daría de alta con ellas. Ahora cada arranque con `NODE_ENV=production` (sin `SEED_DEMO=1`) las
  **vence** (`expires_at` = ahora; no se borran). Solo esos seis códigos exactos: las invitaciones
  reales de `/admin` usan el mismo prefijo `GENESIS-`, así que un `LIKE 'GENESIS-%'` las vencería
  también. Equivalente manual por Kudu, tras el respaldo:
  `UPDATE invites SET expires_at = datetime('now') WHERE code IN ('GENESIS-0001','GENESIS-0002','GENESIS-0003','GENESIS-0004','GENESIS-0005','GENESIS-0006') AND used_by IS NULL`.
- **`ESPECIALIZACION-2026`** (cohorte; se conserva por decisión del líder) puede seguir **abierta**:
  sus cupos, usos y vencimiento se consultan en la base, no se copian aquí. Sin `SEED_COHORT=1` no se siembra
  ni se le alarga el plazo, pero la fila que ya existe sigue valiendo: quien tenga el código se da de
  alta como `contributor`. Con `SEED_COHORT=1`, cada arranque lleva el vencimiento a hoy + 45 días.
  Cerrarla es decisión de John: `UPDATE invites SET expires_at = datetime('now') WHERE code = 'ESPECIALIZACION-2026'`.

### Paquete del despliegue

- **No repetir el paquete de la última vez** (zip de `apps/web` sin `node_modules`, OneDeploy sin
  limpiar, reutilizando el `node_modules` que Oryx construyó en prod con `next 14.2.15`). v1 pide
  `next ^14.2.35` y añade `next-auth` (y los opcionales `mssql` y `@azure/identity`): la `.next` nueva
  correría sobre otro Next y sin `next-auth`. (Ese zip además tomaba `docs/whitepaper.md` de
  `apps/web/docs/`; desde la versión que quitó el whitepaper del sitio ya no hace falta.)
- **Opción A (la elegida):** build standalone en Linux (ver arriba). Lleva su propio `node_modules`
  trazado. Copiar también `apps/web/scripts/verificar-paquete.mjs` a
  `.next/standalone/apps/web/scripts/` para poder verificarlo.
- **Opción B (el `next start` de hoy):** `node_modules` construido **en Linux** desde el
  `package-lock.json` de la **raíz** (`npm ci`, p. ej. en GitHub Actions; nunca desde Windows, por los
  binarios nativos), o forzar la build de Oryx con `SCM_DO_BUILD_DURING_DEPLOYMENT=true` (ojo: Oryx
  instala desde `apps/web/package.json` sin el lockfile de la raíz, así que las versiones no quedan
  fijadas). En `/home/site/wwwroot` deben quedar: `.next/` (sin `cache/`), `public/`, `package.json`,
  `next.config.mjs`, `start-azure.sh`, `scripts/verificar-paquete.mjs`, `CLA.md` junto a
  `package.json` (es `apps/web/CLA.md`), `src/lib/schema.sql`, `src/lib/*.mjs` y `node_modules/`.
- **Comprobar en Kudu ANTES de arrancar:** `cd /home/site/wwwroot && node scripts/verificar-paquete.mjs`
  (en standalone, `node apps/web/scripts/verificar-paquete.mjs apps/web`). Tiene que terminar en
  `listo para arrancar.` Revisa que `node_modules/next` esté en esa carpeta y sea ≥ 14.2.35 (porque
  `start-azure.sh` lo ejecuta desde ahí), `next-auth` y el resto de dependencias en su rango, el
  sha256 del CLA y `schema.sql`. `start-azure.sh` corre la misma verificación y **no
  arranca** si falla; `ZELENA_OMITIR_VERIFICACION=1` la salta, solo para una emergencia consciente.

**Definición de "v1 desplegada":** los 6 entran con su correo, ven sus asignaciones y hacen check-in; John captura tareas desde Telegram y recibe sus 3 focos del día; el dashboard responde sin preguntar.

**Definición de "v1 exitosa" (descongelar v1.1 — se mide con ~2 semanas de USO, no de código):** los 4 criterios de QUEUE.md — 100% de tareas nuevas de John por el sistema, ≥10 asignaciones cerradas contra criterios, ≥2 reuniones de estado reemplazadas, los 5 con asignaciones reales.

---

## PARTE D · Costos estimados (mensual, USD)

| Recurso | Estimado |
|---|---|
| App Service B1 | ~13 |
| **Azure SQL Basic** | **~5** |
| Blob Storage (evidencia, WP19 fase B) | ~1 |
| Entra ID (incluido en M365) | 0 |
| Testnet Stellar | 0 |
| API de Claude para el bot (uso personal de John) | ~2–5 |
| **Total** | **~20–25** |

Cifras de referencia para presupuestar; confirmar en la calculadora de Azure con la región y el tier exactos antes de crear los recursos. Azure SQL Serverless con auto-pausa puede bajar más el costo si la app solo se usa en horario laboral.

---

## PARTE E · Riesgos

| Riesgo | Respuesta |
|---|---|
| Consentimiento de admin en Entra se traba | John es admin del tenant; `openid`, `profile` y `email` no requieren permisos elevados. Si se traba: flag apagado y v1 arranca con la puerta de invitación mientras se resuelve. |
| Migración SQLite→Azure SQL rompe algo | La capa `lib/db.ts` aísla y el traductor de dialecto tiene 38 tests. **Ojo (hallazgo D3-03): correr la suite completa contra Azure SQL NO es posible hoy** — los tests abren SQLite `:memory:` hardcodeado. Escribir ese harness es **WP36** y es prerequisito de confiar en la instancia. Foco en las diferencias ya listadas en WP16 (fechas, JSON, paginación) y en el test de carrera del consumo de invitaciones. Azure SQL aún no tiene datos reales; la SQLite de producción sí (ver "Producción real hoy"). |
| El equipo no adopta la herramienta | Riesgo #1 y es social, no técnico. Mitigación: importar el trabajo REAL (no ejemplos), check-in de 30 segundos, y John lo usa primero. Si en 2 semanas los check-ins bajan del 50%, el problema es el diseño, no la gente. |
| Rate limit con múltiples instancias | v1 corre en una instancia. Documentado en WP16; si se escala, mover a Redis. |
| Retos de entrada con múltiples instancias | El reingreso por wallet es por reto de un solo uso (`/api/login/reto` → firma → `/api/login`) y los retos viven **en memoria** (`lib/login-reto.ts`, solo su sha256, 5 min). Con una instancia basta; con dos, el reto que emite una no lo conoce la otra y el login fallaría a ratos. Antes de escalar, pasarlos a una tabla (`nonce_hash`, `wallet`, `expires_at`, `used_at`). Un reinicio solo obliga a pedir otro reto. |
| Sesiones abiertas con la firma vieja | Hasta esta versión `/api/login` aceptaba la firma fija del CLA, que está en `cla_signatures` (y en las copias de la base). Las cookies ya emitidas siguen vivas hasta su caducidad (24 h). Para cortarlas todas al desplegar, rotar `SESSION_SECRET` en App Settings (todos vuelven a entrar, ahora por reto). |
| Se cuela alcance de "automatizar" | Graph y correos NO están en v1. La única notificación en alcance son los **recordatorios de SLA por Telegram** (pedido de John, 2026-09-30, decisión registrada en CLAUDE.md). El NO-alcance de cada spec es ley. |
