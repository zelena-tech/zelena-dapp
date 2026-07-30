# Metodología de desarrollo — Harness · Loop · Graph

La forma en que se construye este repo. No es teoría: cada capa nombra artefactos que ya existen aquí, y los ejemplos de fallo son **fallos reales de este proyecto**, con su commit.

> **El modelo mental: entorno → retroalimentación → flujo.**
>
> - **Harness engineering** construye la maquinaria alrededor del modelo.
> - **Loop engineering** diseña el ciclo de trabajo-y-evidencia que se repite.
> - **Graph engineering** hace explícita la topología: nodos, ramas, uniones, transiciones de estado y ciclos controlados.
>
> Ninguna sustituye a otra. Se anidan: **el grafo corre dentro del harness; los loops viven dentro de los nodos del grafo; el harness provee el estado, las herramientas y los evaluadores que esos loops necesitan.**

---

## Regla de oro: diagnostica la capa antes de arreglar

Cuando algo falla, la pregunta no es "¿qué prompt mejoro?" sino **¿de qué capa es este fallo?** Elegir mal la capa es gastar esfuerzo donde no está el problema.

| Síntoma | Capa | Arreglo típico |
|---|---|---|
| El agente no puede acceder a un dato o herramienta con seguridad | **Harness** | Contrato de la herramienta, permisos, sandbox, inyección de contexto |
| El agente pierde el progreso entre sesiones | **Harness** | Estado durable, checkpoints, artefacto de progreso |
| El primer intento queda cerca pero no es confiable | **Loop** | Grader externo, tests deterministas, feedback y reintento acotado |
| El agente sigue trabajando después del éxito, o se detiene sin prueba | **Loop** | Estados terminales por EVIDENCIA y regla de parada por presupuesto |
| Varios especialistas deben correr en orden controlado | **Graph** | Nodos, aristas, condiciones de ruteo y uniones explícitas |
| Los fallos son difíciles de localizar en un proceso multi-paso | **Graph + Harness** | Trazas con estado alineadas a los nodos del grafo |
| El flujo cambia demasiado seguido para un diagrama fijo | **Harness más simple** | Deja el control al modelo; retrasa formalizar el grafo |

---

## Capa 1 · Harness — el entorno

Quita el modelo del diagrama. Todo lo que queda es harness.

| Componente | Qué es en Zelena |
|---|---|
| **Política / contexto** | `CLAUDE.md` (se lee primero en cada sesión), los specs `docs/specs/WP*.md`, los planos `docs/blueprints/` |
| **Superficies de acción** | `npm run dev`, `npx vitest run`, `tsc --noEmit`, `next lint`, `next build`, `packages/scripts/import-tareas.mjs`, `sim/`, `anchor-worker.mjs`, `telegram-bot.mjs` |
| **Persistencia** | historia de git · `QUEUE.md` (artefacto de progreso) · `NIGHT-REPORT.md` (traspaso entre sesiones) · `FEEDBACK.md` (canal del humano) · tabla `decision_log` (auditoría dentro del producto) |
| **Control de ejecución** | worktrees aislados por WP · **máximo 2 WPs por ola** · presupuesto de sesión |
| **Seguridad y gobernanza** | la lista de guardrails de `CLAUDE.md` · estados `needs_human` / `blocked_external` · prohibición de `main`, `.env*`, mainnet y fondos |
| **Observabilidad** | `NIGHT-REPORT.md` · `journal.jsonl` de cada run de grafo · registro de cierres de `QUEUE.md` |

**Cuándo trabajar en esta capa:** el agente carece de una capacidad, no puede volver a un estado limpio, pierde estado, accede a demasiado, no es auditable, o se comporta distinto entre entornos.

### Fallos de harness que tuvimos (reales)

- **El worktree arrancó en la base equivocada.** Dos agentes empezaron en el baseline pelado de `main` en vez de `develop`; lo detectaron solos y se rebasearon. *Arreglo de harness:* el nodo `preflight` del grafo ahora verifica la base antes de dejar trabajar a nadie.
- **No usé el checkpoint que ya tenía.** El verificador de D3 murió por límite de sesión y perdí su trabajo, aunque `resumeFromRunId` existía. *Arreglo:* reanudar es la primera respuesta a un nodo muerto, no re-lanzar desde cero.
- **Dos agentes se cayeron escribiendo JSON gigante** de una sola vez. *Arreglo de harness:* el troceado es parte del contrato de la tarea, no una reacción improvisada al fallo.

---

## Capa 2 · Loop — la retroalimentación

Un prompt dice qué hacer *durante* la llamada. Un loop define qué hace el sistema **después**: cómo observa el resultado, qué feedback devuelve, si continúa, cómo persiste el progreso y cuándo para.

### Anatomía obligatoria de un loop aquí

Todo loop de este repo declara sus siete partes. Si una falta, el loop no está diseñado:

| Parte | Regla |
|---|---|
| **Disparador** | qué inicia otro ciclo |
| **Objetivo** | un estado concreto a alcanzar — nunca "seguir mejorando" |
| **Estado y memoria** | qué necesita el siguiente ciclo sin repetir todo |
| **Política de acción** | qué puede cambiar, llamar, delegar o gastar |
| **Evidencia** | tests, validación de esquema, diffs, métricas o revisión humana |
| **Feedback** | descripción compacta y accionable de por qué falló la evidencia |
| **Parada** | éxito, límite de presupuesto, timeout, error irrecuperable o escalamiento humano |

> **No se hace loop sobre la confianza. Se hace loop sobre la evidencia.** "El agente dice que terminó" no es condición de parada. "La suite está verde, `tsc` limpio, `lint` limpio, `next build` verde y los criterios de aceptación del spec cumplidos" sí lo es.

### Los loops de este proyecto

**L1 · Loop de WP** (el principal, definido en `CLAUDE.md`)
Disparador: WP `ready` con dependencias `done`. Objetivo: criterios de aceptación binarios cumplidos. Evidencia: `vitest` + `tsc` + `lint` + `build`. Feedback: la salida del test. **Parada:** verde y criterios cumplidos → commit; o **2 intentos serios** en rojo → revertir, marcar `blocked` con nota, seguir con el siguiente. Escalamiento: `needs_human`.

**L2 · Loop de verificación adversarial**
Disparador: un WP cerrado. Objetivo: **refutar** cada hallazgo o criterio declarado. Evidencia: abrir el archivo citado y comprobar línea y cita. Parada: veredicto `confirmado | refutado | parcial` por ítem. *Regla:* el verificador **no es el mismo agente** que implementó — contexto separado, prompt de refutación.

**L3 · Loop de feedback con John**
Disparador: John revisa localhost. Estado: `FEEDBACK.md`. Objetivo: cada ítem convertido en mini-spec `FBxx`. Parada: `FEEDBACK.md` vacío. **Prioridad: FB > WP.**

**L4 · Loop del producto** (el sistema evolutivo que la dapp *es*)
Época → `fitness` → recomendación → **firma humana** → mutación → auditoría de funciones latentes → época siguiente. Es loop engineering aplicado al producto, no al desarrollo: el algoritmo propone, el humano firma.

### Fallos de loop que tuvimos (reales)

- **Sin regla de parada por presupuesto.** Lancé 8 agentes de auditoría más 2 de grafo (~1,5M tokens) sin tope; se agotó la sesión y murió un verificador. *Arreglo:* el grafo ahora consulta el presupuesto y **omite y reporta** en vez de morir a media fase.
- **Lo que sí funcionó:** WP16 casi entrega un driver `mssql` que *finge* ser síncrono. Lo que lo evitó fue exigir un **grader determinista** — un backend asíncrono falso inyectado en el worker — en vez de aceptar "el agente dice que el puente funciona". Evidencia, no confianza.

---

## Capa 3 · Graph — el flujo

No solo *qué* hace el agente, sino **qué componente tiene permiso de correr después**. Nodos = pasos; aristas = transiciones permitidas (secuencia, ramas condicionales, fan-out paralelo, uniones, ciclos, interrupciones humanas).

⚠️ **Graph engineering ≠ knowledge graph.** Aquí el grafo representa **control y transiciones de estado**, no entidades y relaciones de datos. (El `graphify-out/` de este repo es un knowledge graph — otra cosa, y con otro propósito: calcular radio de impacto antes de un refactor.)

### Lo que se decide en esta capa

- **Fronteras de nodo:** qué trabajo es función determinista, qué es llamada al modelo, qué es agente especialista y qué es **revisión humana**.
- **Esquema de estado:** qué lee y escribe cada nodo; cómo se fusionan escrituras paralelas.
- **Condiciones de ruteo:** qué evidencia manda el trabajo adelante, atrás, al lado o a escalamiento.
- **Concurrencia:** qué corre en paralelo, qué debe unirse, qué recursos hay que coordinar.
- **Ciclos y salidas:** dónde es legal reintentar, cuántas veces, y qué hace seguro el ciclo.
- **Durabilidad:** dónde hay checkpoints y cómo se reanuda tras una interrupción.

### El grafo de este repo

La topología vive en **`docs/workflow-v1.2.md`** (WPs como nodos, dependencias de archivos como aristas, orden topológico → olas). Su versión **ejecutable** es **`.claude/workflows/ola.mjs`**:

```
preflight ──[baseline verde]──▶ implementar[] ──▶ integrar ──[suite+tsc+lint+build verde]──▶ verificar[] ──▶ reportar
     │                          (paralelo,              │                                    (paralelo,
     └──[rojo]──▶ ABORTAR       worktrees               └──[rojo]──▶ ABORTAR sin verificar    1 por WP)
                                aislados)
```

Guardas reales, no decorativas:
- `preflight` rojo → **aborta**. Nadie implementa sobre una base roja.
- `integrar` rojo → **aborta antes de verificar**. Verificar criterios sobre código que no compila es teatro.
- Presupuesto bajo → **omite `verificar` y lo dice en el reporte**. Nunca un recorte silencioso.

**Cuándo vale la ceremonia del grafo:** ramas con significado, trabajo paralelo, aprobaciones, rutas de recuperación, varios especialistas. **Cuándo no:** "dale a un agente tres herramientas y déjalo trabajar". Un grafo mejora la depuración pero también puede **congelar supuestos demasiado pronto**.

### Fallos de grafo que tuvimos (reales)

- **El grafo era un diagrama, no un artefacto.** `workflow-v1.2.md` es Mermaid para que lo lea un humano; yo re-derivaba las olas a mano en cada invocación. *Arreglo:* `ola.mjs`.
- **Faltaba el nodo guarda.** Que la verificación de D3 muriera debió **bloquear** la síntesis que dependía de ella; en cambio escribí la auditoría con 7 hallazgos sin confirmar y lo marqué a mano en un párrafo. *Arreglo:* la arista `verificar → reportar` lleva condición, y lo no verificado se marca por construcción.
- **Lo que sí funcionó:** correr WP13 y WP16 como nodos paralelos sobre el mismo repo hizo que **WP13 encontrara un bug dentro del código de WP16** (el `WHERE` de `CREATE INDEX` descartado en silencio). El paralelismo no es solo velocidad: **es detección**.

---

## Los errores caros, y los que cometimos

| Error clásico | ¿Lo cometimos? |
|---|---|
| Construir el grafo antes de entender el trabajo | **No.** Formalizamos `ola.mjs` después de 3 olas reales de trazas — el orden correcto |
| Dejar que el mismo modelo escriba y califique sin salvaguardas | **No.** L2 usa verificador con contexto separado y prompt de refutación; y los graders principales son deterministas (vitest) |
| Usar "sigue intentando" como especificación de loop | **No.** L1 tiene tope de 2 intentos y estado `blocked` |
| Tratar el harness como un vertedero | **Parcialmente sí.** Corrí graphify sin necesitarlo para la decisión: más herramienta, no mejor resultado |
| Culpar al modelo de fallos de orquestación | **No**, pero por poco: el verificador muerto era mi fallo de durabilidad, no del modelo |
| **Sin regla de presupuesto** | **Sí.** El fallo central de la sesión del 30-jul |

### Y una honestidad necesaria

**No todo fallo es de arquitectura de agentes.** El bug más grave que encontramos —el gate de admin comparando `session.wallet !== FOUNDER_WALLET`, que le habría quitado a John su propio panel— es un **error de diseño de producto**. Ningún harness, loop ni grafo lo habría atrapado. Lo atrapó una auditoría con un principio explícito ("roles, no personas") y evidencia `archivo:línea`. Las tres capas hacen el proceso confiable; **no piensan por ti**.

---

## Checklist antes de dar por buena una iteración

**Harness** — ¿Las herramientas son estrechas, documentadas y observables? ¿El estado es durable? ¿Los permisos son de mínimo privilegio? ¿Se puede pausar, inspeccionar y reanudar un run?

**Loop** — ¿Qué evidencia prueba el éxito? ¿Qué feedback se devuelve al fallar? ¿Cuántos reintentos? ¿Qué pasa cuando se agota el presupuesto?

**Graph** — ¿Qué caminos deben ser deterministas? ¿Qué puede correr en paralelo? ¿Qué estado se comparte? ¿Dónde están las compuertas humanas y las rutas de recuperación?

**Evaluación** — ¿Se pueden reproducir trazas reales y atribuir una mejora a un cambio concreto, en vez de a la intuición?

**Operación** — ¿Se vigilan costo, latencia, tasa de fallo, tasa de intervención y éxito por tarea?

---

## Cómo recordarlo

El **harness** hace que el modelo pueda operar. El **loop** hace que el trabajo sea iterativo, verificable y reanudable. El **grafo** hace explícito y controlable un camino de ejecución complejo.

Un grafo bien dibujado no sirve si el harness perdió el estado. El mejor harness desperdicia dinero si no hay evidencia ni regla de parada. Y los loops más cuidados son inoperables si las ramas, el paralelismo y las aprobaciones viven en código ad-hoc.
