# WP29 · Disputas: rama transversal del proyecto, caso del guardián y resolución aditiva del hito

CONTEXTO — El Reglamento §1 define el embudo: primera instancia ante un guardián
(o panel M-de-N si el impacto es alto) con plazo de 10 días hábiles; segunda
instancia por votación con umbral crítico 66 %. En código no existe nada de esto.
`gatherEpochData` hardcodea `disputes = 0` con el comentario "no hay mecanismo de
disputas todavía", así que el componente "ausencia de disputas" del fitness mide
sobre cero datos. Ya existen las piezas para construirlo bien: `users.invited_by`
(para la regla B8), `proposals` (segunda instancia), `decision_log` (rastro con
hash) y el patrón `Bloqueada` de `assignment-state.ts` (rama transversal que
vuelve al estado previo leído del historial, no adivinado).

PROBLEMA — Una disputa hoy congela el proyecto entero, se resuelve por WhatsApp y
no deja rastro. Y el pago parcial de un hito no tiene cómo representarse sin
editar el monto original.

RESULTADO ESPERADO — `Disputed` como rama transversal que congela **solo el hito
disputado**. Un caso con evidencia, un guardián sorteado sin conflicto de interés,
tres salidas, justificación obligatoria y hash en el decision log. El fitness mide
disputas reales.

ALCANCE
- **Máquina de estados**: `Disputed` transversal — `disputar` desde `Delivered` o
  `Scored` (motivo ≥ 10 caracteres); `resolver` vuelve al estado previo leído de
  `project_events` (tabla nueva con el patrón exacto de `assignment_events`).
  Sin saltos. Test de tabla.
- **Tablas nuevas**: `disputes (id, project_id, milestone_id, opened_by,
  opened_at, deadline_at, guardian_wallet, instance 1|2, state
  Open|Resolved|Escalated, outcome aprobar|dividir|devolver, justification,
  decision_log_id)`, `dispute_events (id, dispute_id, actor_wallet, kind, body,
  created_at)`, `project_events (id, project_id, from_state, to_state, action,
  actor_wallet, reason, created_at)`.
- **`milestones` += nullable** (`COLUMNAS_NUEVAS`): `frozen` 0/1,
  `approved_amount_usd`, `approved_by`, `approved_at`. WP23 también declara
  `approved_by/approved_at`: **mismo nombre y misma migración idempotente**,
  quien llegue primero la crea.
- **Sorteo del guardián** (regla pura): entre `tier='Gold'`, excluyendo a las
  partes y a quien invitó a cualquiera de ellas (`users.invited_by`, regla B8).
  Sin elegible → `instance = 2` directo.
- **Plazo**: 10 días hábiles lunes–viernes desde la apertura. Vencido sin decisión
  → `Escalated` y se crea una `proposal` con umbral 66 %.
- **Resolución `dividir`**: **nunca edita `amount_usd`**. Escribe
  `approved_amount_usd` en el hito disputado y crea un hito nuevo por el
  remanente. `approveMilestone` respeta `approved_amount_usd` cuando existe.
  `devolver` reescribe el criterio de aceptación en `dispute_events` y libera el
  hito a `En curso`; `aprobar` libera el monto completo.
- **Fitness**: `gatherEpochData` llena `disputes = COUNT(disputes abiertas en la
  época)`. Desaparece el hardcode.
- **Vista** `/gobernanza/disputas/[id]`: la ven el guardián sorteado y las partes;
  nadie más ve montos. La decisión escribe `decision_log` con hash y alimenta el
  eje de gobernanza del guardián.
- Flag `DISPUTES_ENABLED`.

NO-ALCANCE — Escrow u on-chain (plano 04, M2). Calendario de feriados. Automatizar
la segunda instancia más allá de crear la propuesta. Disputas sobre asignaciones
internas (`assignments`).

ARCHIVOS QUE TOCA — `lib/state-machine.ts`, `lib/admin.ts` (`approveMilestone`),
`lib/epochs.ts`, `lib/disputes.ts` (nuevo), `schema.sql`, `lib/db.ts`,
`app/gobernanza/disputas/*` (nuevo). **Comparte `state-machine.ts` con WP23/WP25
y `epochs.ts` con WP26 → secuencial con ellos.**

CRITERIOS DE ACEPTACIÓN
- [ ] `disputar` desde `Delivered` → `Disputed`; `resolver` vuelve a `Delivered`
  (estado previo real, leído del historial); `disputar` desde `Open` lanza (tests).
- [ ] Solo el hito disputado queda `frozen = 1`; los demás se aprueban con
  normalidad (test).
- [ ] El sorteo excluye a las partes y a su invitador; sin elegible → instancia 2
  (tests con `invited_by`).
- [ ] `dividir` al 50 % de un hito de $700: `approved_amount_usd = 350`, hito
  nuevo de $350, y la suma de hitos del proyecto no cambia (test).
- [ ] Vencimiento del plazo → `Escalated` + `proposal` con umbral 66 % (test con
  reloj inyectado).
- [ ] Justificación < 10 caracteres → error; toda resolución escribe
  `decision_log` con hash (test).
- [ ] Fitness: 1 disputa sobre 10 entregas → componente disputes = 0,9 (test).
- [ ] Aditivo: **cero `UPDATE` de `amount_usd`, cero `DELETE`**; tablas y columnas
  nuevas únicamente.

OWNER — Fausto (máquina + `disputes.ts`) · Vale (guardiana seed: valida el flujo
completo) · John (nombra los guardianes seed) · Juan (implicación de pagos
parciales en retención en la fuente).
TAMAÑO — L · Estimado: 2 días. Depende: WP25, WP26.
