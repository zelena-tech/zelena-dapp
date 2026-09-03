# WP16 · Despliegue en Azure (reemplaza a WP05 para v1)

CONTEXTO — Decisión de John: Azure, coherente con el tenant de Microsoft (Entra ID) y con el WMS que ya corre ahí. El equipo ya tiene el know-how.

RESULTADO ESPERADO — v1 en una URL interna estable, con Postgres gestionado, secretos fuera del repo y el worker de anclaje corriendo.

ALCANCE
- **Azure App Service (Node 20)** para `apps/web` (Next.js en modo standalone). Alternativa si el equipo prefiere contenedor: Azure Container Apps — decisión de Dev 2, documentada como ADR.
- **Azure SQL Database** (decisión explícita de John: más económica y coherente con el stack Microsoft). Tier de entrada: Basic DTU, o General Purpose Serverless con auto-pausa si se prefiere que duerma fuera de horario. WP03 dejó la capa lista para libSQL/Turso; aquí se añade el driver **`mssql`** detrás de la misma interfaz de `lib/db.ts` (no tocar lógica de negocio).
- **Migración de `schema.sql` a dialecto T-SQL** — los puntos concretos a resolver:
  - `INTEGER PRIMARY KEY AUTOINCREMENT` → `INT IDENTITY(1,1) PRIMARY KEY`
  - `TEXT` → `NVARCHAR(n)` o `NVARCHAR(MAX)`; `REAL` → `DECIMAL`/`FLOAT`
  - Booleanos 0/1 → `BIT`
  - `CURRENT_TIMESTAMP` → `SYSUTCDATETIME()`; `strftime` → `FORMAT`/`CONVERT`
  - `LIMIT n` → `TOP n` u `OFFSET ... FETCH NEXT`
  - `ON CONFLICT` / `INSERT OR IGNORE` → `MERGE` o patrón `IF NOT EXISTS`
  - `RETURNING` → cláusula `OUTPUT`
  - Campos JSON (params del genoma) → `NVARCHAR(MAX)` con `ISJSON` como CHECK y `JSON_VALUE` para leer
  - **Consumo atómico de invitaciones** (V5, superficie crítica): mantener la garantía con `UPDATE ... WITH (UPDLOCK, ROWLOCK) WHERE used_by IS NULL` dentro de transacción. El test de carrera existente debe seguir pasando.
  - Las derivaciones por `SUM()` (reputación y puntos) funcionan igual — no hay columnas de saldo que migrar.
- **Autenticación a la DB por managed identity** (recomendado): el App Service se autentica contra Azure SQL con su identidad administrada, sin contraseña en App Settings. Fallback a cadena de conexión con usuario/clave si la identidad administrada complica el desarrollo local (en local se sigue usando SQLite).
- **Secretos**: Azure Key Vault o App Settings — `SESSION_SECRET`, `FOUNDER_WALLET`, `AZURE_AD_*`, `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, y `DATABASE_URL` solo si no se usa managed identity. Producción no arranca sin ellos (ya implementado).
- **Red**: regla de firewall para "Allow Azure services" o private endpoint; nunca abierto a 0.0.0.0.
- **Rate limiting**: App Service no es serverless efímero, así que el in-memory actual funciona con una sola instancia. Si se escala a >1 instancia: mover a Redis/Postgres. Documentar el límite.
- **Worker de anclaje**: WebJob de App Service o container job, con la cuenta de servicio de testnet. Nunca llaves de mainnet ahí.
- **Backups**: retención automática de Postgres activada (7 días mínimo).
- Smoke test post-deploy: login Entra → /equipo/hoy → cambiar estado de una asignación → dashboard refleja el cambio.

NO-ALCANCE — Dominio final + certificado (puede ser *.azurewebsites.net en v1). CI/CD completo con GitHub Actions (siguiente iteración, tras WP06). Alta disponibilidad, escalado automático. Mainnet. Migrar el desarrollo local a Azure SQL (en local se sigue con SQLite: rápido, sin costo, sin red).

CRITERIOS DE ACEPTACIÓN
- [ ] URL accesible con login Entra funcionando y datos persistentes tras reinicio.
- [ ] Suite completa verde contra Azure SQL (driver `mssql`), incluido el test de carrera del consumo de invitaciones.
- [ ] Ningún test roto por diferencias de dialecto (fechas, JSON, paginación).
- [ ] Ningún secreto en el repo; app no arranca sin ellos (verificado a propósito).
- [ ] Worker anclando en testnet desde Azure; un hash real verificable en el explorador.
- [ ] Costo mensual estimado documentado en `docs/deploy.md`.

OWNER — Dev 2 + John (suscripción y permisos) · TAMAÑO — L · Estimado: 1–1,5 días.
Depende: WP03 (capa DB), WP13 (para probar login en el smoke test).
