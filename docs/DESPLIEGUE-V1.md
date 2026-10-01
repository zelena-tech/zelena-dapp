# Despliegue v1 "Organizar" — checklist

Release v1 = WP13 (login Entra) + WP14 (módulo equipo) + WP15 (dashboard) + WP16 (Azure) + WP19 (asistente Telegram de John) + WP17 (entornos por cliente) + WP20 (grafo de operación). WP17 y WP20 los descongeló John el 2026-08-16; WP18 sigue en v1.1, tras los criterios de uso de QUEUE.md.
Objetivo: el equipo abre la app con su correo @zelena.tech y ve sus asignaciones del día; John captura y prioriza desde Telegram; el dashboard responde sin preguntar.

---

## PARTE A · Lo que solo puede hacer John (bloquea el despliegue)

### A1. Entra ID — registro de la aplicación (~20 min)
En [portal.azure.com](https://portal.azure.com) → Microsoft Entra ID → App registrations → New registration:

- **Name:** Zelena Workspace
- **Supported account types:** *Accounts in this organizational directory only (single tenant)*
- **Redirect URI:** Web → `http://localhost:3000/api/auth/callback/microsoft-entra-id` (añadir la de producción después del A2)
- Tras crear: copiar **Application (client) ID** y **Directory (tenant) ID**
- Certificates & secrets → New client secret → copiar el **Value** (se muestra una sola vez)
- API permissions: `User.Read` (delegado) basta para v1 — no hace falta consentimiento de admin adicional si eres admin del tenant
- Generar además un **`NEXTAUTH_SECRET`** propio (32+ bytes aleatorios, distinto de `SESSION_SECRET`) y anotar el **`NEXTAUTH_URL`** (la URL pública de la app). Sin esos dos, la puerta corporativa no arranca aunque tengas las credenciales de Entra.

**Entregar al equipo (por gestor de secretos, nunca por chat):** `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, y `AUTH_ENTRA_ENABLED=1` para encender.

### A2. Azure — recursos (~30 min, o delegar a Dev 2 con permisos)
- Resource group `rg-zelena-workspace`
- **App Service** (Linux, Node 20, plan B1 o superior; el free tier duerme la app)
- **Azure SQL Database** — tier Basic para empezar (o General Purpose Serverless con auto-pausa si prefieres que duerma fuera de horario). Backups automáticos vienen activados por defecto.
- Regla de firewall "Allow Azure services" (o private endpoint). **Nunca** abrir a 0.0.0.0.
- Recomendado: activar **managed identity** en el App Service y darle acceso a la base → sin contraseña de DB en la configuración.
- Añadir la URL pública como Redirect URI en el registro de A1

### A3. Bot de Telegram + API key (~5 min)
- En Telegram: **@BotFather** → `/newbot` → nombre y usuario del bot → copiar el **token**.
- En [console.anthropic.com](https://console.anthropic.com): crear **ANTHROPIC_API_KEY**.
- Generar además un **`TELEGRAM_WEBHOOK_SECRET`** (cadena aleatoria). Es obligatorio **también en local**: el script de polling hace de puente al mismo handler del webhook, que rechaza cualquier request sin él.
- Los tres van a `apps/web/.env.local` (local) y a App Settings (Azure), más `TELEGRAM_ENABLED=1` para encender. En local el bot corre en modo polling — no necesita URL pública.

### A4. Decisiones (5 min)
- ¿Quién es supervisor además de John? (ve el dashboard completo; sugerido: Vale)
- Lista de los 6 correos @zelena.tech que entran en v1 (incluidas Vale y Angela)
- ¿Alguien del equipo no tiene correo corporativo? → entra por la puerta de comunidad

### A5. En paralelo, no bloquea
- Consulta legal/tributaria de nómina en USDC (gate de WP10 — la persigue Juan)
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
| 4. Encender WP13 y WP19, probar login y bot en local (polling) | Fausto / John | pasos 1 y 3 |
| 5. Crear recursos Azure (A2) | John / Fausto | — |
| 6. Desplegar, migrar schema, activar webhook, smoke test | Fausto | pasos 4 y 5 |
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
2. `applyMigrations`: `ALTER TABLE ADD COLUMN` para `users.role/is_supervisor/entra_oid/auth_provider`
   e `invites.max_uses/uses`, solo si faltan.
3. Aparta las tablas legado del equipo (`_legado_*`), crea las de v1 con `schema.sql`, copia las
   filas con el mapeo de valores (prioridad, horizonte, acciones) conservando los ids y borra las
   `_legado_*`. Un valor desconocido **aborta** sin cambios.
4. Siembra (roster, iniciativas, escotilla y, solo con `SEED_COHORT=1`, el código de cohorte) y
   promueve a `founder` la fila `is_founder=1` o `wallet = FOUNDER_WALLET` (el gate de antes queda
   como **dato** de la base, no como regla de código).

Es idempotente: el segundo arranque no hace nada. En **desarrollo local** la base
(`apps/web/data/zelena.db`) sigue siendo desechable si quieres empezar de cero, pero ya no hace
falta borrarla para arrancar tras una ola.

Con la app arrancada una vez (`npm run dev`) para que cree y siembre la base, importa:

```bash
node packages/scripts/import-tareas.mjs --dry-run "C:/Users/Omnia/Desktop/DAO/Zelena_Tareas_Import.csv"
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

- App Service Linux (`zelena-dao`, Node 22) con **SQLite** (`node:sqlite`) en `/home/data/zelena.db`,
  fuera de `wwwroot`, para que un despliegue no la pise. Azure SQL (`mssql`) está implementado pero
  **no** es la base de producción.
- Fijar **`DATABASE_DRIVER=sqlite`** en App Settings antes de desplegar: v1 cambia sola a Azure SQL
  (una base vacía) si ve `AZURE_SQL_SERVER` o `AZURE_SQL_CONNECTION_STRING`, y con eso la app
  "perdería" los datos cambiándose de base.
- `DATABASE_FILE=/home/data/zelena.db`, `SESSION_SECRET` (≥32 caracteres), `FOUNDER_WALLET` (la wallet
  real de John: la migración la promueve a `founder`). `SEED_COHORT=1` solo si se quiere mantener
  vivo el código de cohorte `ESPECIALIZACION-2026`.
- **Arranque probado hoy:** `apps/web/start-azure.sh` (`node node_modules/next/dist/bin/next start`
  sobre `.next` + `node_modules`). Se conserva.
- **Build standalone (siguiente paso):** se compila en **Linux** (GitHub Actions, `npm ci` real, sin
  symlinks) con `NEXT_STANDALONE=1 npm --workspace apps/web run build`. Solo con esa variable
  `next.config.mjs` activa `output: "standalone"`; `outputFileTracingIncludes` mete en el paquete
  `apps/web/src/lib/schema.sql`, los `.mjs` del worker de BD, `CLA.md` (raíz y `apps/web`) y
  `docs/whitepaper.md`. Copiar `apps/web/.next/static` a `.next/standalone/apps/web/.next/static`
  y arrancar con `node apps/web/server.js` (`PORT`, `HOSTNAME=0.0.0.0`). Sin `CLA.md` en el paquete
  la app firma el texto de reserva (pasó el 2026-09-04: dos firmas con `cla_hash = 54aecc56…`).
- **Antes de cada despliegue que cambie el esquema:** por SSH de Kudu,
  `node -e "new (require('node:sqlite').DatabaseSync)('/home/data/zelena.db').exec(\"VACUUM INTO '/home/data/zelena-pre-fusion-AAAAMMDD.db'\")"`,
  bajar esa copia y ensayar el arranque sobre ella.
- **Después:** el log de arranque muestra las migraciones y la ruta del respaldo; `GET /api/cla`
  devuelve el hash `03293c93…`; John entra a `/admin`.
- **Rollback:** volver al paquete anterior **y** restaurar `/home/data/zelena-pre-fusion-*.db`. Sin
  restaurar la base, el código viejo arranca pero su módulo equipo no puede escribir.

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
| Consentimiento de admin en Entra se traba | John es admin del tenant; `User.Read` no requiere permisos elevados. Si se traba: flag apagado y v1 arranca con la puerta de invitación mientras se resuelve. |
| Migración SQLite→Azure SQL rompe algo | La capa `lib/db.ts` aísla y el traductor de dialecto tiene 38 tests. **Ojo (hallazgo D3-03): correr la suite completa contra Azure SQL NO es posible hoy** — los tests abren SQLite `:memory:` hardcodeado. Escribir ese harness es **WP36** y es prerequisito de confiar en la instancia. Foco en las diferencias ya listadas en WP16 (fechas, JSON, paginación) y en el test de carrera del consumo de invitaciones. Azure SQL aún no tiene datos reales; la SQLite de producción sí (ver "Producción real hoy"). |
| El equipo no adopta la herramienta | Riesgo #1 y es social, no técnico. Mitigación: importar el trabajo REAL (no ejemplos), check-in de 30 segundos, y John lo usa primero. Si en 2 semanas los check-ins bajan del 50%, el problema es el diseño, no la gente. |
| Rate limit con múltiples instancias | v1 corre en una instancia. Documentado en WP16; si se escala, mover a Redis. |
| Se cuela alcance de "automatizar" | Graph y correos NO están en v1. La única notificación en alcance son los **recordatorios de SLA por Telegram** (pedido de John, 2026-09-30, decisión registrada en CLAUDE.md). El NO-alcance de cada spec es ley. |
