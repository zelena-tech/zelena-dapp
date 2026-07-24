# Zelena Dapp — Instrucciones para Claude Code

Dapp de la Zelena DAO (Milestone 1 "Génesis"). Monorepo Next.js 14 + TypeScript estricto + Tailwind + SQLite (capa aislada para swap a Turso/Postgres). Testnet only: **sin mainnet, sin dinero real, sin secretos en el repo.**

## Comandos

```bash
cd apps/web && npm install && npm run dev   # http://localhost:3000 (DB se crea y siembra sola)
npm test                                     # suite completa — SIEMPRE verde antes de commit
node packages/scripts/anchor-worker.mjs --watch  # worker de anclaje testnet (correr aparte)
```

Login demo: código de invitación `GENESIS-0001` + wallet demo.

## Documentos que gobiernan el trabajo

- `docs/specs/QUEUE.md` — **la cola dinámica de trabajo. Empieza SIEMPRE aquí.**
- `docs/specs/WP*.md` — un spec por work package, con criterios de aceptación binarios.
- `docs/specs/FEEDBACK.md` — feedback de John tras revisar localhost; cada ítem se convierte en mini-spec y se procesa como un WP más.
- `docs/blueprints/` — planos: arquitectura, interacciones, evolución, contratos.
- `docs/architecture.md`, `docs/security-review.md`, `docs/deploy.md` — estado actual.

## Protocolo de loop autónomo (modo nocturno)

1. Lee `docs/specs/QUEUE.md`. Toma el primer WP en estado `ready` (todas sus dependencias `done`).
2. Márcalo `in_progress`. Crea rama `wp/XX-nombre` desde `develop` (nunca trabajes en `main`).
3. Lee su spec completo en `docs/specs/`. Implementa EXACTAMENTE el alcance; el NO-alcance es ley.
4. Corre `npm test`. Rojo → arregla. Si tras 2 intentos serios sigue rojo: revierte a estado limpio, marca el WP `blocked` con una nota de por qué, y pasa al siguiente `ready`.
5. Verde → commit convencional (`feat(wp02): ...`), marca `done` en QUEUE.md con hash del commit.
6. Repite hasta que no queden WPs `ready`. Entonces escribe `docs/specs/NIGHT-REPORT.md`: qué se hizo, qué quedó bloqueado y por qué, decisiones tomadas, qué revisar en localhost.

## Guardrails (no negociables)

- **NUNCA**: tocar `main`, hacer deploy, tocar mainnet, crear/mover fondos, tocar `.env*`, subir secretos, borrar migraciones, `git push --force`.
- WPs marcados `needs_human` requieren algo de John (API keys, cuentas, decisión legal): NO los intentes; déjalos y anótalo en el reporte.
- Cambios de parámetros del sistema SOLO vía genoma versionado (nunca hardcodear valores nuevos en el código). Nada retroactivo sobre épocas cerradas.
- Reglas de producto (doc 16, obligatorias en toda UI): jamás confiscar puntos ganados; calificar entregas, nunca personas (no existe "bajo desempeño"); todo ranking muestra el progreso propio al lado.
- La máquina de estados de proyectos es una función pura única (`lib/state-machine.ts`); los handlers solo la invocan. Reputación y puntos se derivan por SUM() — nunca columnas de saldo mutables.
- No existe ni existirá endpoint de transferencia de puntos en M1.

## Ciclo de feedback con John

John despierta → `npm run dev` → revisa localhost → escribe en `docs/specs/FEEDBACK.md` (formato: `- [ ] página/flujo: qué mejorar`). El siguiente loop: convierte cada ítem en mini-spec (usa el formato de los WP), lo añade a QUEUE.md como `FBxx ready`, y lo procesa con el mismo protocolo. Prioridad: FB > WP.
