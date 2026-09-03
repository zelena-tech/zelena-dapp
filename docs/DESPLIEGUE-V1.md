# Despliegue v1 "Organizar" — checklist

Release v1 (núcleo congelado) = WP13 (login Entra) + WP14 (módulo equipo) + WP15 (dashboard) + WP16 (Azure) + WP19 (asistente Telegram de John). WP17/WP18 = v1.1, tras los criterios de uso de QUEUE.md.
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

**Entregar al equipo (por gestor de secretos, nunca por chat):** `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`.

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
- Ambos van a `apps/web/.env.local` (local) y a App Settings (Azure). En local el bot corre en modo polling — no necesita URL pública.

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
> scaffolding de WP13 con mock, driver Postgres de WP16 y scaffolding de WP19.
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
| Migración SQLite→Azure SQL rompe algo | La capa `lib/db.ts` aísla; la suite (77 tests) corre contra Azure SQL antes de desplegar. Foco en las diferencias de dialecto ya listadas en WP16 (fechas, JSON, paginación) y en el test de carrera del consumo de invitaciones. Nada de datos reales que perder aún. |
| El equipo no adopta la herramienta | Riesgo #1 y es social, no técnico. Mitigación: importar el trabajo REAL (no ejemplos), check-in de 30 segundos, y John lo usa primero. Si en 2 semanas los check-ins bajan del 50%, el problema es el diseño, no la gente. |
| Rate limit con múltiples instancias | v1 corre en una instancia. Documentado en WP16; si se escala, mover a Redis. |
| Se cuela alcance de "automatizar" | Graph, notificaciones y correos NO están en v1. El NO-alcance de cada spec es ley. |
