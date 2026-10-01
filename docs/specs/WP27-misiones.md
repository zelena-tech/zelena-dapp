# WP27 · Misiones de comunidad: la biblioteca de bounties internos que paga en reputación

CONTEXTO — La brecha B1 (biblioteca de bounties internos siempre disponible +
primera misión guiada) no está implementada: quien firma el CLA encuentra un Ágora
con cinco bounties pagados y nada más. Pero **el modelo ya existe**: `assignments`
tiene máquina de estados, historial (`assignment_events`), tope de trabajo en
curso (`WIP_MAX = 2`) y autorización pura (`puedeActuar`: nadie aprueba lo suyo).
Y `academia.ts` (líneas 142–164) ya emite puntos con presupuesto acotado y evento
de reputación. Una misión no necesita una tabla nueva: es una asignación de otro
tipo.

Los presupuestos viven en el genoma (WP02). Una clave nueva del genoma es una
**versión nueva** (`genome_versions`), no una mutación: `mutation.ts` solo mueve
escalares existentes ±15 %.

PROBLEMA — No hay forma de contribuir sin un bounty pagado. Los roles que
sostienen la comunidad (anfitrión, relator, mentor, curador, revisor cruzado) no
existen como trabajo. Es el arranque en frío que el doc 9 anticipó.

RESULTADO ESPERADO — `/misiones` lista misiones abiertas por eje; la persona toma
una con un clic (respetando cupos, tier y WIP); otra persona la aprueba; paga en el
eje correspondiente y con puntos de un presupuesto separado. **Nunca en USDC.**

ALCANCE
- **`assignments` += columnas nullable** (vía `COLUMNAS_NUEVAS`): `kind`
  (`'tarea'` por defecto | `'mision'`), `eje`, `reward_points`, `reward_rep`,
  `cupos`, `cupos_tomados`, `min_tier`, `es_primera` 0/1, `rite_id`. **Nada
  cambia para `kind='tarea'`.**
- **`assignment-state.ts`**: acción nueva `tomar` (Backlog → Asignada, a sí
  mismo) permitida solo si `kind='mision'`, `cupos_tomados < cupos`, tier ≥
  `min_tier` y WIP libre. `puedeActuar('tomar')` = cualquier sesión con CLA (no
  requiere supervisión). Test de tabla ampliado.
- **Al `aprobar` una misión**: `points_ledger(bucket='ritos')` con clamp a
  `RITOS_BUDGET` (copiar el patrón de `academia.ts`) + `reputation_events(axis=eje,
  delta=reward_rep, mechanism='misiones')`. Quien aprueba ≠ quien tomó (ya lo
  impone `puedeActuar`).
- **Genoma v2**: `Genome.RITOS_BUDGET` (propuesta: 2.000 pts/época).
  `getActiveGenome` rellena claves faltantes con `0` para que v1 siga parseando;
  `seedGenomeV2` efectiva **desde la época siguiente**, ligada al `decision_log`.
  `periods.ritos_budget` nullable como snapshot.
- **Biblioteca sembrada** (seed, datos demo): anfitrión del sync, relator del demo
  day, mentor de primera misión (Silver), curador de Academia, revisor cruzado
  (Gold), traducción del whitepaper. Una misión `es_primera=1` por eje.
- **`/misiones`** + rail "Tu semana" (misiones en curso / WIP, comunidad esta
  época, ritos asistidos). Flag `MISSIONS_ENABLED`.

NO-ALCANCE — USDC por misiones (jamás: protege la clasificación legal). Ranking de
personas. Misiones de cliente. Cupos dinámicos por algoritmo. El paso de onboarding
que asigna la primera misión (WP28).

ARCHIVOS QUE TOCA — `lib/assignment-state.ts`, `lib/assignments.ts`,
`lib/genome.ts`, `lib/db.ts`, `lib/seed.ts`, `app/misiones/*` y
`app/api/misiones/*` (nuevos). **Comparte `assignments.ts`/`assignment-state.ts`
con WP14/WP17 y `genome.ts` con WP08 → secuencial; no arranca mientras WP14 o
WP17 sigan `in_progress`.**

CRITERIOS DE ACEPTACIÓN
- [ ] `tomar` sobre `kind='tarea'` lanza; sobre misión sin cupos lanza; con WIP
  lleno lanza; con tier insuficiente lanza (tests de tabla).
- [ ] Aprobar misión emite con clamp: presupuesto 100 y dos misiones de 70 → la
  segunda emite 30 y ninguna más (test).
- [ ] Nadie aprueba su propia misión (test, reutiliza `puedeActuar`).
- [ ] Genoma v1 en DB sin `RITOS_BUDGET` → `getActiveGenome().RITOS_BUDGET === 0`
  y las misiones no emiten (test); v2 rige desde la época siguiente, nunca la
  actual (test).
- [ ] Aditivo: solo columnas nullable + una fila en `genome_versions`; la suite
  previa pasa sin cambios.
- [ ] Copys: la misión describe un entregable con criterio de aceptación; se
  califican entregas, nunca personas (doc 16).

OWNER — Fausto (acción `tomar` + emisión + genoma v2) · David (`/misiones`) ·
Vale (curadora de la biblioteca inicial).
TAMAÑO — M · Estimado: 2 días. Depende: WP26 (ritos), WP08 (genoma versionado),
WP14 y WP17 cerrados.
