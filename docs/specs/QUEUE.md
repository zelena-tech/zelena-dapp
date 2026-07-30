# QUEUE — Cola dinámica de trabajo

Protocolo: tomar el primer `ready` cuyas dependencias estén `done`. Estados: `ready` · `in_progress` · `done` · `blocked` (técnico, con nota) · `needs_human` (falta algo de John) · `blocked_external` (gate legal/comercial).

Los ítems `FBxx` (feedback de John, ver FEEDBACK.md) tienen prioridad sobre los WP.

| ID | Work package | Estado | Depende de | Rama | Nota |
|---|---|---|---|---|---|
| WP00 | Limpieza + baseline verde | done | — | wp/00-limpieza | ✅ 4524dff · tag v0.1-genesis · develop |
| WP01 | Verificación criptográfica de firma | done | WP00 | wp/01-firma | ✅ ed25519 + domain separator; H1/H3 cerrados |
| WP02 | Genoma v1 (config → DB versionada) | done | WP00 | wp/02-genoma | ✅ genome_versions + getActiveGenome; consumidores migrados |
| WP03 | Capa DB lista para Turso/Postgres | done | WP00 | wp/03-db | ✅ driver libSQL síncrono + tests archivo local; credenciales Turso remoto = John |
| WP04 | Identidad Privy | needs_human | WP01 | wp/04-privy | Requiere PRIVY_APP_ID/SECRET de John. Scaffolding detrás de flag sí es ejecutable |
| WP05 | Deploy público + worker | needs_human | WP01, WP03 | — | Vercel/VPS login = John |
| WP06 | Repo público + CLA-bot | needs_human | WP00 | — | Org GitHub = John |
| WP07 | Motor de épocas (fitness) | done | WP02 | wp/07-fitness | ✅ fitness puro + epoch_fitness + cierre/firma en admin |
| WP08 | Mutación por época (admin) | done | WP07 | wp/08-mutacion | ✅ proponer/revertir ≤2 genes ≤15% + anuncio + guard + linaje |
| WP09 | Reglas conductuales UI | done | WP00 | wp/09-ui-conductual | ✅ bloque "Tu progreso" + test anti-confiscación + copys |
| WP10 | Nómina Modo A+ | blocked_external | WP05 | wp/10-nomina | Gate: consulta legal/tributaria. UI + schema sí ejecutables detrás de flag |
| WP11 | Simulador ABM | done | WP02 | wp/11-sim | ✅ motor puro + CLI + reporte A/B/emisión/Gini |
| WP12 | Auditoría funciones latentes | done | WP09 | wp/12-auditoria | ✅ latent_audits + registro público gobernanza + form admin + link a mutación |
| **WP13** | **Login SSO Entra ID (@zelena.tech)** | needs_human | WP00 | wp/13-entra | ✅ scaffolding COMPLETO y testeado tras flag `AUTH_ENTRA_ENABLED` (NextAuth v4 + mock). Solo falta encender: credenciales Entra = John (paso A1) |
| **WP14** | **Módulo equipo (proyectos + asignaciones)** | done | WP00 | wp/14-equipo | ✅ modelo + máquina pura + importador CSV + `/equipo/hoy` + `/equipo/proyectos` + check-in |
| **WP15** | **Dashboard de seguimiento** | done | WP14 | wp/15-dashboard | ✅ bloqueos primero + bandeja `needs_founder` + carga + salud de ritos + digest exportable |
| **WP16** | **Despliegue en Azure (reemplaza WP05)** | needs_human | WP03, WP13 | wp/16-azure | ✅ driver **`mssql`/Azure SQL** + dialecto T-SQL + puente síncrono, testeados sin Azure. Suscripción, recursos y suite contra la instancia real = John (paso 6) |
| **WP17** | **Entornos por cliente (backlog + marca + inventario)** | v1.1 | WP14 | wp/17-clientes | Congelado hasta cumplir los criterios de uso de v1. CERO secretos almacenados |
| **WP18** | **Capa OKR (objetivos y resultados clave)** | v1.1 | WP15 | wp/18-okr | Congelado hasta cumplir los criterios de uso de v1 |
| **WP19** | **Asistente personal de Telegram para John (backlog agent)** | needs_human | WP14 | wp/19-telegram | ✅ scaffolding COMPLETO y testeado tras flag `TELEGRAM_ENABLED` (5 herramientas, borradores con confirmación, polling). Falta bot token + ANTHROPIC_API_KEY = John (paso A3). Audio: falta decidir proveedor de transcripción |

> ## Release v1 "Organizar" — NÚCLEO CONGELADO
>
> **v1 = WP13 + WP14 + WP15 + WP16 + WP19. Nada más.** WP17 y WP18 son v1.1 y solo se descongelan cuando v1 cumpla sus criterios de USO (no de features):
>
> 1. El 100% de las tareas nuevas de John entran por el sistema (bot o web), cero por WhatsApp/cabeza.
> 2. ≥10 asignaciones reales cerradas contra criterios de aceptación.
> 3. El dashboard reemplazó ≥2 reuniones de estado por semana.
> 4. Los 5 del equipo hicieron login y tienen asignaciones reales.
>
> **Estrategia de interfaz:** el equipo trabaja en el tablero web con login Entra; Telegram es el asistente personal de John (captura por cliente/proyecto, backlog conversacional, 3 focos del día). Una sola fuente de verdad.
>
> **Frontera con Odoo (decisión de John):** facturación, cotizaciones y contabilidad viven en Odoo, FUERA de la dapp — información sensible no se toca ni se replica. La dapp solo guarda presupuesto por proyecto y el registro verificable de pagos (WP10). Integración por referencia, si algún día, nunca por copia.
>
> **Gate de bonificaciones (decisión de John tras crítica):** NO se construye módulo de bonos. El equipo interno corre el sistema de puntos y épocas YA construido (ZWORK + fitness + cierres) — eso ES el piloto manual de Harmony que exige la auditoría. Dinero real sobre scores: solo tras 3 épocas cerradas + calibración + gate legal (WP10). Los WPs de comunidad (WP04 Privy, WP06 repo público, WP10 nómina) siguen en cola pero NO bloquean v1: primero organizar, luego automatizar, al final descentralizar.
>
> WP05 (Vercel/Turso) queda **superseded** por WP16. El driver libSQL de WP03 se conserva para desarrollo local.

## Orden sugerido para el primer loop nocturno

WP00 → WP01 → WP02 → WP09 → WP07 → WP11 → WP03 → WP08 → WP12 → scaffolding de WP04/WP10 detrás de flags → NIGHT-REPORT.md

## Orden sugerido para el loop del release v1 (núcleo congelado)

WP14 (modelo + importador CSV + /equipo/hoy) → WP15 (dashboard + digest) → WP13 scaffolding con mock de Entra → driver Azure SQL (`mssql`) de WP16 → WP19 scaffolding (polling + herramientas con mock) → al llegar credenciales de John: WP13 real + WP16 despliegue + WP19 bot real

**Motor de base de datos (decisión de John):** producción = **Azure SQL Database** (driver `mssql`), más económica y coherente con el stack Microsoft; con managed identity, sin contraseña de DB en configuración. Desarrollo local sigue con SQLite. El driver libSQL de WP03 se conserva pero no se usa en producción.

**Regla de seguridad transversal (WP17):** ningún campo de la base de datos almacena secretos, contraseñas ni tokens de clientes. El inventario guarda dónde vive la credencial y quién responde por ella, nunca su valor. Verificación obligatoria en el PR.

## Owners humanos del release v1 (roster real — plano 07)

| WP | Owner humano | Apoyo |
|---|---|---|
| WP13 Entra SSO | Fausto | John (secretos) |
| WP14 Módulo equipo | Fausto (backend) | David (UI) |
| WP15 Dashboard | David | Vale (define qué se mide) |
| WP16 Azure | Fausto | John (suscripción) |
| WP17 Entornos cliente | Fausto (modelo/RBAC) + David (UI) | Juan (dueño del inventario de credenciales) |
| WP18 OKRs | Vale (dueña del ciclo) | David (UI), John (define OKRs) |
| Gate de calidad de todos | Vale | — |

## Registro de cierres

(El loop añade aquí una línea por WP cerrado: fecha · WP · commit · tests)

- 2026-07-24 · WP00 · baseline `4524dff` (main, tag v0.1-genesis, rama develop) · npm install OK, test 20/20, build OK
- 2026-07-24 · WP01 · verificación ed25519 + domain separator (wp/01-firma) · test 31/31, build OK
- 2026-07-24 · WP02 · genoma versionado en DB + migración de consumidores (wp/02-genoma) · test 37/37, build OK
- 2026-07-24 · WP09 · progreso propio + test anti-confiscación + copys de entrega (wp/09-ui-conductual) · test 40/40, build OK
- 2026-07-24 · WP07 · motor de fitness puro + persistencia + cierre/firma en admin (wp/07-fitness) · test 52/52, build OK
- 2026-07-24 · WP11 · simulador ABM puro + CLI (packages/scripts/sim) (wp/11-sim) · test 57/57, build OK
- 2026-07-24 · WP03 · driver libSQL/Turso síncrono + tests archivo local + deploy.md (wp/03-db) · test 61/61, build OK
- 2026-07-24 · WP08 · mutación por época (proponer/revertir/no-cambios + anuncio + guard + linaje) (wp/08-mutacion) · test 71/71, build OK
- 2026-07-24 · WP12 · auditoría de funciones latentes + registro público en gobernanza (wp/12-auditoria) · test 75/75, build OK
- 2026-07-24 · review-fixes · fixes de la verificación adversarial: WP03 fail-loud en Turso remoto + mkdir local; WP09 "eje que más creció" real por época (reputation_events.period_id) + empty state Academia (wp/review-fixes) · test 77/77, build+lint OK

### Release v1 "Organizar" — loop del 2026-07-30

- 2026-07-30 · docs-v1 · specs WP13–WP19, planos 05/06/07 y DESPLIEGUE-V1.md traídos al repo (estaban sin versionar en el checkout principal) `8a0c7b1`
- 2026-07-30 · WP14 · módulo equipo: iniciativas, asignaciones, máquina de estados PURA, importador CSV idempotente, `/equipo/hoy`, `/equipo/proyectos`, check-in diario (wp/14-equipo) `cb49bc7` · test 154/154, build+lint OK
- 2026-07-30 · WP16 · driver `mssql`/Azure SQL + dialecto T-SQL + puente síncrono (worker_threads + Atomics.wait) probado contra backend async falso (wp/16-azure) `b8328b2` · test 131/131, build+lint OK
- 2026-07-30 · integración ola 1 · frontera roster/cohorte en `cohortStats()` (la home contaba los 6 `pending:*` como cohorte), `/equipo` añadido al middleware como PROTECTED_SESSION, lockfile sincronizado `16f0113` · test 211/211
- 2026-07-30 · WP15 · dashboard: bloqueos primero con días derivados de `assignment_events`, bandeja `needs_founder`, carga por persona (repartir, no rankear), salud de ritos, métricas de época, digest diario exportable (wp/15-dashboard) `fc6975c` · test 242/242, build+lint OK
- 2026-07-30 · WP13 · scaffolding de login Entra tras flag `AUTH_ENTRA_ENABLED`: NextAuth v4, validación de `tid`, `user_emails`, vinculación al roster SIN mutar la PK, banner de segundo correo (wp/13-entra) `fb722d1` · test 249/249, build+lint OK
- 2026-07-30 · integración ola 2 · **bug cruzado**: `sql-dialect.ts` descartaba en silencio la cláusula `WHERE` de un `CREATE INDEX` (un índice parcial de SQLite salía sin filtro y un UNIQUE nullable habría roto en Azure SQL al segundo usuario). Corregido + 3 tests; la unicidad de `entra_oid` vuelve al esquema como índice parcial único; banner montado en todo `/equipo` `18728ce` · test 283/283, build+lint OK
- 2026-07-30 · WP19 · scaffolding del asistente de Telegram tras flag `TELEGRAM_ENABLED`: 5 herramientas cerradas, borradores con Confirmar/Editar/Descartar (nada se crea sin confirmar), `telegram_links` con código hasheado, webhook con secret en tiempo constante, log `bot_actions` en admin, hora de los 3 focos en el GENOMA (wp/19-telegram) `fe45bc1` · test 381/381, build+lint OK
