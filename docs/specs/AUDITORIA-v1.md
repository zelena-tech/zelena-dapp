# AUDITORÍA del release v1 — 2026-07-30

Método: 4 dimensiones auditadas en paralelo por agentes independientes sobre el código real (solo lectura), cada hallazgo con evidencia `archivo:línea`, y una pasada de **verificación adversarial** que intenta refutarlos abriendo los archivos citados.

**27 hallazgos: 5 alta · 16 media · 6 baja. Los 27 verificados, ninguno refutado** (uno con severidad corregida).

Sobre cómo se verificó cada bloque, porque la diferencia importa:

- **D1, D2 y D4 (20 hallazgos):** verificación **adversarial independiente** — un agente distinto del que auditó, con contexto separado y consigna de refutar, abriendo cada archivo citado.
- **D3 (7 hallazgos):** su verificador murió dos veces (primero por límite de sesión, luego por límite de gasto de la organización). **Los verifiqué yo mismo, ejecutando comandos** contra el repo. Es verificación real y reproducible, pero **más débil que la adversarial**: quien verifica es quien escribió el reporte. Los comandos quedan abajo para que cualquiera los repita.

Al verificar a mano los de severidad alta **encontré un tercer agujero que el reporte no traía** (ver A-03).

| Dimensión | Pregunta | Hallazgos | Verificación |
|---|---|---|---|
| D1 | ¿Está el sistema acoplado a personas en vez de a roles? | 9 | adversarial |
| D2 | ¿Qué pasa si mañana llega María, o si Vale se va? | 5 | adversarial |
| D3 | ¿Qué bloquea de verdad desplegar hoy? | 7 | directa (comandos) |
| D4 | ¿Qué tan lejos está el bot de WhatsApp? | 6 | adversarial |

---

## La respuesta corta a la pregunta de John

**El principio estaba bien declarado y mal sostenido.** El código tiene la forma correcta —`role` e `is_supervisor` son columnas de `users`, y la visibilidad pasa por una única función `puedeVerTodoElEquipo`— pero la **autoridad** sobre quién es quién vive en código, en dos sitios:

1. `TEAM_ROSTER`, una constante de `roles.ts` con los 6 nombres, alias y flags, que **el arranque re-impone sobre la base en cada `npm run dev`**. Un `UPDATE` manual para hacer supervisora a María se revierte al reiniciar.
2. `FOUNDER_WALLET`, una variable de entorno con la wallet de **una persona**, usada como gate de administración.

Consecuencia: dar de alta a María "funciona" (entra por Entra como `core`), pero **no puede recibir trabajo del importador, ni ser supervisora, ni aparecer en el prompt del bot** sin un PR. Y quitarle la supervisión a Vale cuando salga tampoco es una operación de datos.

Ya arreglado hoy (commit `298b441`): el gate por rol. Lo demás está planificado en `docs/workflow-v1.2.md` como **WP20**.

---

## A · Severidad alta

### A-01 · `TEAM_ROSTER` es código y el arranque lo re-impone sobre la base
`D1-01`, `D2-01` — confirmado · esfuerzo M · **pendiente (WP20)**

- [roles.ts:52](../../apps/web/src/lib/roles.ts:52) — `export const TEAM_ROSTER: readonly RosterMember[] = [`
- [team.ts:200](../../apps/web/src/lib/team.ts:200) — `UPDATE users SET role = ?, is_supervisor = ? WHERE wallet = ?`
- [seed.ts:27](../../apps/web/src/lib/seed.ts:27) — `seedTeam(db)` corre en **cada** arranque

`seedTeamRoster` no es un seed: es una reconciliación que sobreescribe `role` e `is_supervisor` de las 6 filas con lo que diga la constante. Cambiar un rol exige PR + deploy.

**Remedio:** el roster pasa a ser dato (`users` + columnas `slug`, `aliases`, `domain`), `TEAM_ROSTER` queda como seed inicial *insert-if-missing* (nunca `UPDATE` de filas existentes), y aparece un panel "Equipo" en `/admin`.

### A-02 · El gate de administración era por persona, no por rol
`D1-02`, `D2-02`, `D3-01` — confirmado · esfuerzo S · **✅ ARREGLADO hoy (`298b441`)**

- [admin/page.tsx:23](../../apps/web/app/admin/page.tsx:23) — era `if (session.wallet !== FOUNDER_WALLET) redirect("/perfil")`

Bug latente que detonaba al encender WP13: el founder entrando por Entra llega con `pending:john`, que nunca iguala `FOUNDER_WALLET` → perdía su propio panel de admin y la capacidad de dar de alta el bot. Además hacía imposible un segundo administrador sin deploy.

**Arreglado:** nuevo [authz.ts](../../apps/web/src/lib/authz.ts) con la regla por rol resuelta contra `users`. Aplicado en `/admin`, `/api/admin`, `/api/telegram/vincular` y el nav.

### A-03 · El backlog interno completo era visible para cualquier sesión
**Hallazgo propio, no estaba en el reporte** · esfuerzo S · **✅ ARREGLADO hoy (`298b441`)**

- [proyectos/page.tsx:25](../../apps/web/app/equipo/proyectos/page.tsx:25) — solo `if (!session) redirect("/entrar")`
- [team.ts:403](../../apps/web/src/lib/team.ts:403) — `assignmentsByInitiative` devuelve **todas** las asignaciones, sin filtrar por actor

Apareció al verificar a mano D3-02. El criterio 2 de WP14 ("cada miembro ve SOLO sus asignaciones") se implementó **solo para `/equipo/hoy`**; `/equipo/proyectos` quedó abierto. Cualquier contribuidor de la cohorte Génesis podía leer títulos, responsables y motivos de bloqueo del equipo interno. Es un hueco de criterio de aceptación de anoche, no de la auditoría.

**Arreglado:** nueva regla `esEquipoInterno` + gate único en [equipo/layout.tsx](../../apps/web/app/equipo/layout.tsx).

### A-04 · Los códigos `GENESIS-000x` se sembraban en producción
`D3-02` — *sin verificación adversarial; verificado a mano* · esfuerzo S · **✅ ARREGLADO hoy (`298b441`)**

- [seed.ts:54](../../apps/web/src/lib/seed.ts:54) — 6 invitaciones predecibles, **publicadas en README y CLAUDE.md**

Con una URL pública, cualquiera con el enlace y un código sin usar se creaba cuenta. Combinado con A-03, leía el backlog completo.

**Arreglado:** `demoInvitesAllowed()` los excluye de producción salvo `SEED_DEMO=1`.

> **Extra encontrado al escribir los tests:** `actorFromSession` cae a los claims de la cookie cuando no hay fila en `users`, así que una sesión sin registro podía autoasignarse un rol. Los gates de `authz.ts` usan un actor **estricto** que exige la fila. No se tocó `actorFromSession` (para pintar UI la caída es inofensiva).

---

## B · Severidad media

### Acoplamiento a personas (D1)

| ID | Hallazgo | Esf. |
|---|---|---|
| D1-03 | El importador CSV rechaza cualquier `Assignee` que no esté en la constante: un 7º miembro no puede recibir trabajo importado sin PR ([team-import.ts:194](../../apps/web/src/lib/team-import.ts:194)). *Severidad corregida de alta a media por el verificador: el fallo es explícito y hay workaround.* | M |
| D1-04 | El bot lleva los 6 nombres cableados en el system prompt y en el schema de la herramienta ([bot-agent.ts:99](../../apps/web/src/lib/bot-agent.ts:99)); el modelo tiene instrucción de ignorar a cualquier otra persona. Generarlos desde `listTeamMembers(db)`. | S |
| D1-05 | La identidad Entra→roster se deduce por **nombre de pila y alias en código** ([entra.ts:324](../../apps/web/src/lib/entra.ts:324)): una homónima nueva puede heredar la fila —y la supervisión— de alguien del roster si esa persona aún no vinculó su cuenta. Remedio: columna `expected_email` explícita. | M |
| D1-06 | No existe UI de administración de roles: dar o quitar `is_supervisor` es SQL a mano, y para los 6 del roster ni eso persiste (ver A-01). | M |
| D1-07 | El founder existe **dos veces** con dos mecanismos distintos (wallet demo por env var + `pending:john` por roster) y el código puentea entre ambos a mano ([seed.ts:44](../../apps/web/src/lib/seed.ts:44)). | M |

### Ciclo de vida de una persona (D2)

| ID | Hallazgo | Esf. |
|---|---|---|
| D2-03 | **La baja no existe como operación de producto**: marcar `alumni` es SQLite a mano. | M |
| D2-04 | `listTeamMembers` no filtra `status`, así que una Vale `alumni` **sigue contando para siempre** en el denominador de la salud de ritos y en la carga por persona ([team.ts:719](../../apps/web/src/lib/team.ts:719)). Un `AND status='active'` arregla las dos vistas. | S |
| D2-05 | El trabajo en vuelo de quien se va **queda huérfano**: no existe reasignación de responsable en la web, ni en la máquina de estados, ni en el bot. | M |

### Despliegue (D3 — verificado con comandos, todos confirmados)

| ID | Hallazgo | Esf. |
|---|---|---|
| D3-03 | El criterio de aceptación de WP16 "suite verde contra Azure SQL" **no es ejecutable**: los tests abren SQLite `:memory:` hardcodeado. Lo que el NIGHT-REPORT llamó "falta correrlo" es en realidad "falta escribir cómo correrlo". | M |
| D3-04 | John duplicado: sus tareas del CSV viven en `pending:john` pero su sesión de invitación es otra wallet → **su `/equipo/hoy` sale vacío** y sus check-ins no cuentan para la salud de ritos. | M |
| D3-05 | `next@14.2.15` con advisories. **Corregido y matizado al ejecutarlo — ver abajo.** | S |

#### Corrección de D3-05 (el remedio original estaba mal)

El hallazgo decía "21 vulnerabilidades (2 critical, 16 high), subir a la última 14.2.x, esfuerzo S". Los números eran correctos pero el remedio y la lectura del riesgo no. Al intentar aplicarlo:

- **19 de las 21 son `devDependencies`** (toolchain de eslint, y vitest/vite). **No se despliegan.** La exposición real de producción era **2: una `critical` en `next` y una `high` en `postcss`** — `npm audit --omit=dev` lo confirma.
- **La `critical` de `next` SÍ se cerró** con el bump a `next@14.2.35`. ✅ **Aplicado**, suite 392/392 verde, `tsc`/`lint`/`build` limpios.
- **Lo que queda: 2 `high` de `postcss` vendorizado DENTRO de Next** (`node_modules/next/node_modules/postcss`). `npm` solo ofrece arreglarlas con `next@16.2.12`, que es un salto de **dos versiones mayores**, no un parche. Son de la tubería de CSS **en tiempo de build**, alimentada por nuestro propio código fuente, no por entrada de un atacante.

**Conclusión honesta:** la parte urgente está cerrada. Migrar a Next 16 es un WP aparte con riesgo real de ruptura, y **no bloquea exponer una URL interna**. Lo que sí conviene es decidirlo antes de abrir la app a gente de fuera.

Esto es exactamente lo que un verificador adversarial independiente habría encontrado, y lo encontré solo porque intenté aplicar el remedio. Confirmar un número no es confirmar un diagnóstico.

**Comandos de verificación (reproducibles):**

```bash
# D3-03 — 18 de 29 archivos de test abren openDb(":memory:") hardcodeado, y las
# únicas menciones a AZURE_SQL/DATABASE_DRIVER prueban resolveDriver() como función
# pura: ningún test se conecta al motor real.
grep -rln 'openDb(":memory:")' apps/web/src/lib/*.test.ts | wc -l

# D3-05 — 21 vulnerabilidades: {"moderate":3,"high":16,"critical":2}
cd apps/web && npm audit

# D3-04 — dos filas con role='founder': FOUNDER_WALLET y pending:john
# (lo fija el test `authz.test.ts` → "el founder que entra por Entra SÍ administra")

# D3-06 — 3 de 4 variables ausentes del checklist
grep -c NEXTAUTH_SECRET docs/DESPLIEGUE-V1.md   # 0

# D3-07 — "Postgres" como motor de producción
grep -n Postgres docs/specs/WP16-deploy-azure.md
```

### Canal WhatsApp (D4)

| ID | Hallazgo | Esf. |
|---|---|---|
| D4-01 | La capa de negocio importa tipos y copys de Telegram: `BotReply` lleva un teclado de Telegram ([bot-tools.ts:70](../../apps/web/src/lib/bot-tools.ts:70)). Extraer un tipo neutro `ReplyAction`. | S |
| D4-02 | El orquestador está escrito contra el update y el transporte de Telegram: **no existe puerto de canal** ([bot-agent.ts:207](../../apps/web/src/lib/bot-agent.ts:207)). | M |
| D4-03 | Identidad monocanal y autorización binaria: `telegram_links` sin columna de canal y escritura todo-o-nada con un único escritor global ([schema.sql:453](../../apps/web/src/lib/schema.sql:453)). Los líderes de cliente necesitan **scopes**, no el permiso completo. | L |
| D4-04 | Ni "crear ticket de bug" ni "preguntas sobre el sistema" caben limpio en las 5 herramientas actuales. | M |
| D4-05 | **No existe infraestructura de notificaciones salientes.** El único envío proactivo (los 3 focos) vive en el script de polling, con estado en memoria y sintetizando un update falso ([telegram-bot.mjs:145](../../packages/scripts/telegram-bot.mjs:145)). | L |

---

## C · Severidad baja

| ID | Hallazgo | Esf. |
|---|---|---|
| D1-08 | El "dominio" de cada persona solo existe en la constante y se pinta en `/equipo/hoy`: un 7º miembro sale sin dominio. | S |
| D1-09 | El dashboard dice "esperando una decisión **tuya**" también cuando quien mira es una supervisora que no es el founder. | S |
| D3-06 | Los checklists A1/A3 de `DESPLIEGUE-V1.md` **omiten env vars que WP13/WP19 exigen** para encenderse: `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_ENTRA_ENABLED`, y `TELEGRAM_WEBHOOK_SECRET` también en local. | S |
| D3-07 | El spec de WP16 sigue diciendo "Postgres"; `DESPLIEGUE-V1.md` arrastra "driver Postgres" y "77 tests". | S |
| D4-06 | El script de polling ya duplica protocolo y consultas fuera de la lib: patrón que un segundo canal multiplicaría. | S |

---

## D · Sobre el sueño del bot de WhatsApp

Tres cosas que conviene tener claras antes de ilusionarse con la fecha:

1. **Choca con la gobernanza de v1, no con el código.** Los avisos proactivos son notificaciones = fase "automatizar", que `CLAUDE.md` excluye explícitamente de v1. No es un impedimento técnico: es una decisión tuya sobre el orden.
2. **WhatsApp cobra la fricción que Telegram no.** La Cloud API de Meta exige verificación de negocio, número dedicado, y —lo decisivo para tu caso— **los mensajes proactivos fuera de la ventana de 24 h van con plantilla pre-aprobada por Meta**. El "Hola, ya está lista, recarga" *es* un mensaje proactivo: es una plantilla, con su aprobación y su costo por conversación. *(Conviene confirmar tarifas y tiempos actuales contra la documentación vigente de Meta antes de presupuestar.)*
3. **Lo que falta no es el canal, es el dispatcher.** El bot está razonablemente separado en su capa de herramientas, pero **no hay tabla de notificaciones ni disparador** (D4-05). Ese es el trabajo real; el transporte de WhatsApp es la parte fácil.

Y una consecuencia de diseño que sí importa: los líderes de cliente **no pueden tener el permiso de escritura actual**, que es binario y global. Necesitan *scopes* (`leer`, `crear_ticket`) y clasificación por cliente, que depende de **WP17 — congelado**. Está estructurado como **WP23** en `docs/workflow-v1.2.md`.

---

## E · Lo que la auditoría confirmó que está bien

Para que el reporte no exagere:

- La máquina de estados del equipo es **pura** y su matriz completa (6×6) está testeada; el bot no puede saltarse estados (avanza un tramo legal por vez).
- El límite de 5 herramientas del bot es **estructural** (tabla de despacho congelada), no una promesa en un comentario; hay test que rechaza herramientas inventadas.
- **Nada se crea sin confirmación**: `confirmDraft` es el único camino de escritura del bot.
- El código de alta de Telegram se guarda **hasheado**; ningún token se persiste.
- Los ledgers siguen append-only y todo se deriva por `SUM()`; no hay endpoint de transferencia de puntos.
- Los copys de las tres vistas nuevas pasan tests de vocabulario prohibido (doc 16: se califican entregas, nunca personas).
- WP13 **no muta la PK de `users`**: vincula. La integridad referencial de las asignaciones está intacta.

---

## F · Limitaciones de esta auditoría

- **D3 no tiene verificación adversarial *independiente*.** Sus 7 hallazgos están confirmados con comandos reproducibles (arriba), pero el que verificó es el mismo que reportó. Un agente adversarial podría encontrar que alguna interpretación es más benigna de lo que digo. Su verificador murió dos veces: primero por límite de sesión, después por límite de gasto de la organización — y esa segunda vez ya no era un problema de orquestación sino de cuota.
- Nadie ejecutó el sistema contra **Azure SQL real**, ni el login real de Entra, ni el bot real. Todo lo de esas tres superficies es análisis estático más los dobles de prueba.
- El grafo de conocimiento (`graphify-out/`) tiene **cohesión baja (0,05–0,20)**: sus 60 comunidades son un mapa de calor útil para navegar, no una taxonomía de módulos. Y su chequeo de salud reporta 216 aristas con extremo colgante, casi seguro por IDs de la extracción semántica que no coinciden con los del AST.
