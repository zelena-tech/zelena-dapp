# Plano 07 · Topología del equipo (6 personas + agentes) y decisión de herramientas

## 1. La decisión de herramientas

Pregunta de John: ¿Azure DevOps con cada proyecto? **Respuesta: no.** Tres casas para el trabajo (repo + dapp + Boards) fragmentan; Azure DevOps es ALM enterprise para una escala que no existe aún; y lo decisivo: si el backlog vive fuera de la dapp, la reputación y la DAO se quedan sin datos. El tracker interno es el piloto de Harmony — usarlo es validar el producto.

| Capa | Herramienta | Por qué |
|---|---|---|
| Código, PRs, CI/CD | **GitHub** (org de la SAS) | Ya decidido en WP06 (CLA-bot, branch protection). Claude Code opera nativamente ahí. Actions = pipelines. |
| Runtime e identidad | **Azure** (App Service, **Azure SQL**, Entra ID, Key Vault) | Tenant que ya pagas; Azure SQL es más económica y con managed identity elimina la contraseña de DB; WP13/WP16. |
| Gestión del trabajo | **La dapp** (`/equipo`, `/clientes`, `/okr`) | Tickets, cargas, backlog por proyecto y por cliente. Alimenta reputación → DAO. WP14–WP18. |
| Puente temporal | GitHub Projects (gratis) | Solo si hace falta tablero HOY mientras v1 aterriza. Se importa por CSV y se apaga. |
| Repos por cliente | GitHub repos privados (patrón SAS, uno por cliente) | Mismo modelo que las instancias dedicadas del WMS. |
| Facturación, cotizaciones, contabilidad | **Odoo** (fuera de la dapp) | Decisión de John: lo financiero sensible no se toca ni se replica. La dapp solo guarda presupuesto por proyecto y el registro de pagos (WP10). Además: Zelena implementa Odoo — usarlo internamente es conocer mejor lo que vende. |

**Actualización (decisión de John):** el equipo trabaja en el tablero web con su login (@zelena.tech): asignaciones del día, check-in y proyectos. Telegram (WP19) es el asistente personal de John — captura de tareas y pendientes por cliente/proyecto desde reuniones, gestión conversacional de su backlog y sus 3 focos del día. Una sola fuente de verdad: lo que el bot crea aparece en la web al instante. Extender el bot al equipo (check-ins por Telegram) queda como v2 opcional, solo si el hábito web muestra fricción con datos de 2+ semanas.

Regla anti-fragmentación: **una pieza de trabajo vive en UN solo lugar.** Código → issue/PR de GitHub. Todo lo demás (tickets, pendientes, contenido, finanzas, procesos) → asignación en la dapp. Si un ticket requiere código, la asignación enlaza al PR (campo `spec_url`), no se duplica.

## 2. Topología: un equipo vertical, seis orquestadores

Plano 06: con este tamaño eres UN equipo vertical — la ventaja es no tener silos que romper. Cada persona es dueña de un dominio de punta a punta y editora de su stack de agentes.

| Quién | Dominio (dueño de punta a punta) | Su stack de agentes | WPs de v1 |
|---|---|---|---|
| **John** | Visión, clientes, portafolio, gates de inversión y visual | Cowork + skill `delegar` (volcado→spec), monitoreo competitivo programado | Gates `needs_founder` · secretos Entra/Azure · OKRs del trimestre (con Vale) |
| **Vale** (procesos y mejora continua) | **Dueña del sistema operativo**: QUEUE, calidad de specs, ritos, épocas y mutaciones, retro, auditoría de funciones latentes, OKRs | Claude para redactar/afinar specs; skill-creator para volver skills los procesos repetibles; verificación adversarial de entregas | WP18 (dueña del ciclo) · WP12 (auditorías) · gate de calidad de TODOS los WPs (hereda el rol QA) |
| **Juan** (FinOps, contratos, pagos) | Control financiero, contratos + anclaje de hashes, nómina, costos por cliente, gate legal | Agentes de análisis en xlsx, digest financiero programado, seguimiento de gasto de nube | WP10 (nómina, tras gate legal que él persigue) · inventario de credenciales de WP17 (dueño del registro) · costos v2 |
| **David** (BI, front-end, vibecoder, asistente de John) | Todo lo que se VE: dashboard, vistas, analítica, experiencia de uso | Claude Code para front (vibecoding sobre specs), agentes de análisis de datos para BI | WP15 (dashboard) · UI de WP14/WP17/WP18 · módulo analítica WMS |
| **Fausto** (DevOps, backend, arquitectura, integraciones) | Todo lo que SOSTIENE: backend, DB, auth, deploy, CI/CD, contratos Soroban en M2 | Claude Code para backend + loop nocturno (CLAUDE.md), agentes para tests e infra | WP13 (Entra) · WP14 backend · WP16 (Azure) · WP17 modelo/RBAC · CI de WP06 |
| **Angela** (contenido) | Comunicación: redes, copies, whitepaper, y **contenido de Academia** (la vía de puntos por aprendizaje ya construida en la dapp) | Agentes de contenido con la voz de marca (skill zelena), digest semanal "qué contar de lo que hicimos" programado | Contenido de `/academia` · comunicación del lanzamiento de Génesis |

**Regla de auditoría (playbook):** el agente propone, el humano firma. Cada dominio tiene UN nombre responsable; los agentes multiplican el volumen, nunca la responsabilidad.

## 3. Cargas de trabajo y priorización (cómo se gestiona en la dapp)

- **Prioridad**: la fija el dueño del dominio dentro de su cola; entre dominios, el weekly gate. John solo arbitra conflictos marcados `needs_founder`.
- **Carga visible, no punitiva**: el dashboard (WP15) muestra abiertas/en curso por persona para detectar sobrecarga — regla doc 16: se miden entregas y cargas, jamás "rendimiento de personas".
- **WIP personal**: máximo 2 asignaciones `en curso` por persona (el resto espera en `asignada`). El multitasking es el impuesto invisible; el límite lo cobra explícito.
- **Tickets**: un ticket (soporte WMS, pedido de cliente, bug) = una asignación con `client_id` + prioridad. Sin sistema aparte de tickets: mismo modelo, misma cola, mismo dashboard (NO-alcance: no es un helpdesk público con SLA en v1).
- **Vale es la dueña de que esto se cumpla** — su primer proyecto al entrar es operar y afinar el sistema, no aprenderlo de lejos.

## 4. Onboarding de Vale (su primera semana ES el sistema)

1. Día 1: lee playbook + docs 15/16 + este plano. Recorre la dapp local.
2. Día 2–3: audita los specs WP14–WP18 con ojos frescos (¿criterios realmente binarios?). Propone mejoras como FBxx.
3. Día 4: toma la dueñez de QUEUE.md y del calendario de ritos (daily async, weekly gate, época).
4. Día 5: borrador de OKRs del trimestre con John (WP18) — con baseline medido, no inventado.

## 5. Identidades para v1 (WP13)

Los 6 con correo @zelena.tech en Entra (incluye a Vale y Angela desde el día 1) + segundo correo personal obligatorio (continuidad del progreso — plano 05). Roles: John `founder`; Vale, Juan, David, Fausto, Angela `core`. Supervisores del dashboard: John + Vale.
