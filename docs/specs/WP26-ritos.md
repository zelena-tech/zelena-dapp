# WP26 · Ritos: calendario, check-in con QR y la señal de participación del fitness

CONTEXTO — El calendario ritual (sync semanal, demo day quincenal, retro mensual —
brecha B2) y el proof-of-attendance en tres capas (Reglamento §4) están en los
documentos, no en la app. Lo único que existe es `checkins` (rito 1 del playbook).
Consecuencia medible: `gatherEpochData` en `epochs.ts` **no llena
`checkins`/`expectedCheckins`**, así que el componente `participation` (20 % del
fitness) se degrada en cada reporte con "sin datos de ritos". El motor evolutivo
que ya construimos mide tres de sus cuatro objetivos.

Corrección de registro: la columna `mechanism` (invitaciones|academia|ritos|…)
vive en `latent_audits`, **no** en `reputation_events`. Hoy la fuente de un evento
de reputación solo se distingue por el texto de `ref`.

`anchor_queue.kind` ya contempla `cla | merkle_root | decision`; el worker maneja
las dos primeras.

PROBLEMA — La comunidad no tiene ritmo visible ni asistencia registrada. Las
comunidades sobreviven por ritual, no por reglamento — y hoy el ritual no existe
como dato.

RESULTADO ESPERADO — `/ritos` muestra la semana, el próximo rito y los anteriores.
Al llegar, la persona escanea un QR (+2 comunidad); al cierre responde un quiz
corto (+4). Cada rito cerrado ancla su hash. El reporte de fitness deja de decir
"sin datos de ritos".

ALCANCE
- **Tablas nuevas**: `rites (id, kind sync|demo|retro, starts_at, duration_min,
  host_wallet, recorder_wallet, state Planned|Open|Closed, hash, anchor_tx_id,
  decision_log_id)`, `rite_checkins (id, rite_id, wallet, layer 1|2, created_at,
  UNIQUE(rite_id, wallet, layer))`, `rite_presentations (rite_id, project_id,
  kind avance|cierre, minutes)`.
- **`reputation_events.mechanism TEXT` nullable** (vía `COLUMNAS_NUEVAS`). Los
  ritos escriben `axis='comunidad'`, `mechanism='ritos'`, `ref='Rito <slug>'`.
  Lo existente queda con `mechanism = NULL`; nada se reescribe.
- **QR capa 1**: token = `hmacHex(RITES_SECRET, rite_id + ':' + floor(now/90 s))`
  (reusa `crypto.hmacHex`). El servidor acepta el bucket actual y el anterior,
  liga el check-in a la wallet de la sesión y escribe una fila por capa.
- **Quiz capa 2**: reusa el patrón de `academia_quiz` (3 preguntas por rito,
  aprobar 2 de 3; las respuestas correctas nunca viajan al cliente).
- **Cierre del rito**: `hash = sha256(JSON canónico de asistentes +
  presentaciones)` → `anchor_queue(kind='rite')` y entrada en `decision_log`.
  Worker: rama `rite` que marca `rites.anchor_tx_id`.
- **Fitness**: `gatherEpochData` llena `checkins = COUNT(rite_checkins capa 1 en
  la época)` y `expectedCheckins = usuarios activos × ritos cerrados en la época`.
- **Vista `/ritos`** (toda sesión con CLA): semana, próximo rito con QR (solo lo ve
  el anfitrión), presentaciones, anteriores con asistentes y hash. Rail "Tu
  asistencia" como progreso propio.
- **Cadencia** en config (`RITES_CADENCE`), **no** como gen todavía:
  `mutation.ts` solo muta escalares numéricos. Dejar nota en el plano 03.
- Anfitrión y relator se asignan desde admin en este WP; en WP27 pasan a ser
  misiones. Flag `RITES_ENABLED`.

NO-ALCANCE — Capa 3 (badge/NFT en Soroban, plano 02). Calendario externo /
Microsoft Graph (fase automatizar). Cadencia como gen del genoma. Misiones (WP27).

ARCHIVOS QUE TOCA — `schema.sql` (+3 tablas), `lib/db.ts` (`COLUMNAS_NUEVAS`),
`lib/rites.ts` (nuevo), `lib/epochs.ts`, `packages/scripts/anchor-worker.mjs`,
`app/ritos/*` y `app/api/ritos/*` (nuevos). **Comparte `epochs.ts` con WP29 y el
worker con WP30 → secuencial con ellos.**

CRITERIOS DE ACEPTACIÓN
- [ ] Token de dos buckets atrás → rechazado; token válido → 1 fila capa 1; un
  segundo escaneo no duplica (UNIQUE) (tests).
- [ ] El check-in escribe `reputation_events(comunidad, +2, mechanism='ritos')`
  en la época actual (test).
- [ ] Cerrar un rito produce un hash determinista (mismo input → mismo hash) y
  encola `kind='rite'`; el worker lo ancla en testnet (test con mock de Horizon).
- [ ] `computeAndStoreEpochFitness` con ≥ 1 rito cerrado devuelve el componente
  `participation` con `value !== null` (test) — el reporte ya no se degrada.
- [ ] Aditivo: tres tablas nuevas + una columna nullable; la suite previa pasa sin
  cambios; `mechanism` de las filas existentes sigue `NULL`.
- [ ] Copys: la asistencia se muestra como progreso propio; no hay ranking de
  personas (doc 16).

OWNER — Fausto (`rites.ts` + QR + worker) · David (`/ritos`) · Vale (define los
tres ritos y cierra el primero) · John (`RITES_SECRET` por gestor de secretos).
TAMAÑO — M · Estimado: 1–2 días. Depende: WP14 (checkins), WP07 (fitness).
