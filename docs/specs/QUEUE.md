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
| **WP13** | **Login SSO Entra ID (@zelena.tech)** | ready | WP00 | wp/13-entra | Scaffolding + tests con mock ejecutables ya; credenciales Entra = John |
| **WP14** | **Módulo equipo (proyectos + asignaciones)** | ready | WP00 | wp/14-equipo | Ejecutable ya; roles finos tras WP13 |
| **WP15** | **Dashboard de seguimiento** | ready | WP14 | wp/15-dashboard | |
| **WP16** | **Despliegue en Azure (reemplaza WP05)** | needs_human | WP03, WP13 | wp/16-azure | Driver Postgres ejecutable ya; suscripción y recursos = John |
| **FB01** | **Renombre FMS → WMS en documentación** | done | — | wp/20-client-graph | ✅ 10 ocurrencias en blueprints 06/07, WP16, WP17 y whitepaper |
| **WP17** | **Entornos por cliente (backlog + marca + inventario)** | in_progress | WP14 | wp/20-client-graph | **DESCONGELADO 2026-08-16 por decisión de John.** Modelo + RBAC + inventario listos y probados; la pestaña Backlog espera a WP14 |
| **WP20** | **Grafo de operación del cliente (read model desde zelena-ops)** | in_progress | WP17 | wp/20-client-graph | Importador idempotente + consultas + tests verdes. Fuente de verdad: repo PRIVADO zelena-ops |
| **WP18** | **Capa OKR (objetivos y resultados clave)** | v1.1 | WP15 | wp/18-okr | Congelado hasta cumplir los criterios de uso de v1 |
| **WP19** | **Asistente personal de Telegram para John (backlog agent)** | needs_human | WP14 | wp/19-telegram | Bot token (@BotFather) + ANTHROPIC_API_KEY = John. v1 = solo John |

> ## Release v1 "Organizar" — NÚCLEO CONGELADO
>
> **v1 = WP13 + WP14 + WP15 + WP16 + WP19 + WP17 + WP20.** WP18 sigue en v1.1.
>
> **Cambio de alcance (John, 2026-08-16):** WP17 se descongela y entra WP20. Motivo: el conocimiento de cliente disperso es el riesgo más caro de la operación hoy, y la dependencia de proveedores externos de Odoo no se cierra sin él. **Consecuencia aceptada: los criterios de USO de abajo se cumplirán más tarde de lo previsto.** Se deja constancia porque contradice la regla de núcleo congelado — es una excepción explícita, no silenciosa (misma disciplina que la salvaguarda 4 de WP08).
>
> Los criterios de USO siguen vigentes y siguen siendo el gate de WP18:
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

**Regla de seguridad transversal (WP17/WP20):** ningún campo de la base de datos almacena secretos, contraseñas ni tokens de clientes. El inventario guarda dónde vive la credencial y quién responde por ella, nunca su valor. **La verificación ya no es manual:** `auditSchemaForSecretColumns()` falla el build si aparece una columna sospechosa, `addCredential()` rechaza escrituras que parezcan secretos, y el importador de WP20 aborta si un nodo trae uno.

**Frontera repo público / repo privado (crítica, WP06 + WP20):** el repositorio de la dapp será público (WP06, CLA-bot). El repositorio **`zelena-ops` es y seguirá siendo PRIVADO**: contiene procesos, estructura contable y el mapa de credenciales de clientes reales. Nunca se fusionan. El CI del repo público debe fallar si aparece una ruta `clientes/` o un `grafo.json`. El seed de la dapp solo lleva datos de demostración — jamás datos de un cliente real.

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
- 2026-08-16 · FB01 · renombre FMS → WMS en documentación (wp/20-client-graph)
- 2026-08-16 · WP17+WP20 · entornos por cliente + grafo de operación: esquema, `clients.ts`, `client-graph.ts`, `assignments.ts`, `identity.ts`, vistas `/clientes` y `/equipo` (wp/20-client-graph) · 59 tests nuevos verdes, tsc strict limpio
- 2026-07-24 · review-fixes · fixes de la verificación adversarial: WP03 fail-loud en Turso remoto + mkdir local; WP09 "eje que más creció" real por época (reputation_events.period_id) + empty state Academia (wp/review-fixes) · test 77/77, build+lint OK
