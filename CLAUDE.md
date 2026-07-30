# Zelena Dapp — Instrucciones para Claude Code

Dapp de la Zelena DAO (Milestone 1 "Génesis"). Monorepo Next.js 14 + TypeScript estricto + Tailwind. Base de datos: **SQLite en desarrollo local, Azure SQL Database en producción** (driver `mssql`, autenticación por managed identity) — todo detrás de la capa aislada `lib/db.ts`. Testnet only: **sin mainnet, sin dinero real, sin secretos en el repo.**

## Comandos

```bash
cd apps/web && npm install && npm run dev   # http://localhost:3000 (DB se crea y siembra sola)
npm test                                     # suite completa — SIEMPRE verde antes de commit
node packages/scripts/anchor-worker.mjs --watch  # worker de anclaje testnet (correr aparte)
```

Login demo: código de invitación `GENESIS-0001` + wallet demo.

## Fase actual: v1 "Organizar" — NÚCLEO CONGELADO (WP13, WP14, WP15, WP16, WP19)

Orden estratégico: **organizar → automatizar → descentralizar.** v1 = login Entra (@zelena.tech) + módulo equipo + dashboard + despliegue Azure + asistente personal de Telegram para John. **WP17 y WP18 están congelados (v1.1)**: solo se descongelan cuando se cumplan los criterios de USO definidos en QUEUE.md. Los WPs de comunidad/DAO (WP04, WP06, WP10) tampoco son v1. Checklist: `docs/DESPLIEGUE-V1.md`. Identidad dual y fases: `docs/blueprints/05-identidad-y-fases.md`.

Nada de la fase "automatizar" entra en v1: sin Microsoft Graph, sin envío de correos/Teams, sin notificaciones. Lo financiero (facturación, cotizaciones, contabilidad) vive en Odoo, FUERA de esta app — nunca se replica aquí. El NO-alcance de cada spec es ley.

## Ejecución con subagentes

Dentro de una misma ola, los WPs que no comparten archivos pueden ejecutarse con subagentes en paralelo (uno por WP, cada uno en su rama `wp/XX`). Consulta el grafo de dependencias en `docs/workflow-v1.1.md`: WP2/WP7 comparten `rules.ts`/`genome.ts` → secuenciales; WP14-backend, WP13-scaffold y WP16-driver no se tocan entre sí → paralelos. Tras cada ola: merge ordenado a `develop`, suite completa verde antes de la siguiente.

## Nota técnica del bot de Telegram (WP19)

En desarrollo local el bot corre en modo **polling** (`getUpdates`) — no requiere URL pública. El webhook con secret token se activa solo al desplegar en Azure. Sin `TELEGRAM_BOT_TOKEN`/`ANTHROPIC_API_KEY` en el entorno, el scaffolding se construye y testea con mocks detrás del flag `TELEGRAM_ENABLED=false`.

## Documentos que gobiernan el trabajo

- `docs/specs/QUEUE.md` — **la cola dinámica de trabajo. Empieza SIEMPRE aquí.**
- `docs/specs/WP*.md` — un spec por work package, con criterios de aceptación binarios.
- `docs/specs/FEEDBACK.md` — feedback de John tras revisar localhost; cada ítem se convierte en mini-spec y se procesa como un WP más.
- `docs/blueprints/` — planos: arquitectura, interacciones, evolución, contratos.
- `docs/architecture.md`, `docs/security-review.md`, `docs/deploy.md` — estado actual.

## Metodología de desarrollo — LEE ESTO ANTES DE ORQUESTAR

**`docs/METODOLOGIA.md` gobierna cómo se construye este repo:** tres capas, **harness → loop → graph** (entorno → retroalimentación → flujo). Ninguna sustituye a otra; se anidan.

Reglas operativas que salen de ahí y son obligatorias:

- **Diagnostica la capa antes de arreglar.** ¿Falta una capacidad, se perdió estado? → harness. ¿El resultado no es confiable, o para sin prueba? → loop. ¿Hace falta orden, paralelismo o compuertas? → graph. Elegir mal la capa es gastar esfuerzo donde no está el problema.
- **No se hace loop sobre la confianza, se hace sobre la evidencia.** "El agente dice que terminó" no es condición de parada. La evidencia es: `npx vitest run` + `npx tsc --noEmit` + `npx next lint` (+ `next build` al integrar) **y** los criterios de aceptación del spec.
- **Máximo 2 WPs por ola**, en worktrees aislados y con **archivos propios disjuntos**. Cuatro agentes de golpe agotaron el presupuesto de sesión el 30-jul y mataron a un verificador.
- **El verificador adversarial no es el implementador**: contexto separado y prompt de refutación.
- **Nunca un recorte silencioso.** Si se omite una fase por presupuesto, se reporta.
- **Si un nodo muere, se REANUDA** (`resumeFromRunId`), no se relanza desde cero.

Para correr una ola usa el grafo ejecutable, no re-derives las olas a mano:

```
Workflow({ name: "ola", args: { ola: "1", base: "<rama>", wps: [
  { id: "WP21", rama: "wp/21-hardening", spec: "docs/specs/...", archivos: ["..."] }
] } })
```

Sus guardas abortan solo (0 tokens) si la base está roja, si hay más de 2 WPs, o si dos WPs comparten archivos. La topología de las olas vive en `docs/workflow-v1.2.md`.

## Protocolo de loop autónomo (modo nocturno)

El loop **L1** de `docs/METODOLOGIA.md`. Sus siete partes, explícitas:

1. **Disparador:** lee `docs/specs/QUEUE.md` y toma el primer WP `ready` con todas sus dependencias `done`. (Los `FBxx` de John tienen prioridad sobre los WP.)
2. **Estado:** márcalo `in_progress`. Rama `wp/XX-nombre` desde `develop` (nunca trabajes en `main`).
3. **Objetivo:** lee su spec completo en `docs/specs/`. Implementa EXACTAMENTE el alcance; el NO-alcance es ley. El objetivo son sus **criterios de aceptación binarios**, no "que quede bien".
4. **Evidencia:** `npm test` desde `apps/web` (más `tsc` y `lint`). **Feedback:** la salida del test, no una impresión.
5. **Parada:** rojo → arregla; **tope de 2 intentos serios**; si sigue rojo, revierte a estado limpio, marca el WP `blocked` con el motivo real y pasa al siguiente `ready`. Verde **y criterios cumplidos** → commit convencional (`feat(wp02): ...`) y `done` en QUEUE.md con el hash.
6. **Escalamiento:** lo que necesita a John es `needs_human` / `blocked_external` — no lo intentes.
7. **Cierre:** cuando no queden WPs `ready`, escribe el reporte en `docs/specs/`: qué se hizo, qué quedó bloqueado y por qué, decisiones a ratificar, y qué revisar en localhost. **Un hueco declarado es aceptable; uno oculto no.**

## Guardrails (no negociables)

- **NUNCA**: tocar `main`, hacer deploy, tocar mainnet, crear/mover fondos, tocar `.env*`, subir secretos, borrar migraciones, `git push --force`.
- WPs marcados `needs_human` requieren algo de John (API keys, cuentas, decisión legal): NO los intentes; déjalos y anótalo en el reporte.
- Cambios de parámetros del sistema SOLO vía genoma versionado (nunca hardcodear valores nuevos en el código). Nada retroactivo sobre épocas cerradas.
- Reglas de producto (doc 16, obligatorias en toda UI): jamás confiscar puntos ganados; calificar entregas, nunca personas (no existe "bajo desempeño"); todo ranking muestra el progreso propio al lado.
- La máquina de estados de proyectos es una función pura única (`lib/state-machine.ts`); los handlers solo la invocan. Reputación y puntos se derivan por SUM() — nunca columnas de saldo mutables.
- No existe ni existirá endpoint de transferencia de puntos en M1.

## Ciclo de feedback con John

John despierta → `npm run dev` → revisa localhost → escribe en `docs/specs/FEEDBACK.md` (formato: `- [ ] página/flujo: qué mejorar`). El siguiente loop: convierte cada ítem en mini-spec (usa el formato de los WP), lo añade a QUEUE.md como `FBxx ready`, y lo procesa con el mismo protocolo. Prioridad: FB > WP.
