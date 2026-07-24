# WP02 · Genoma v1 — parámetros del sistema como configuración versionada

CONTEXTO — Doc 16 §3: en Zelena evolucionan las reglas, no las personas. Hoy los parámetros evolutivos viven hardcodeados en `lib/config.ts` (EPOCH_BUDGET, ACADEMIA_*, TIER_INVITE_CAPS, etc.). Para que el sistema pueda mutar por época con registro de linaje, deben vivir en DB versionada.

PROBLEMA — Cambiar un parámetro hoy = cambiar código y redesplegar, sin registro de qué cambió, cuándo, por qué ni con qué resultado. Sin eso no hay motor evolutivo.

RESULTADO ESPERADO — Un objeto `genome` versionado en DB; la app lee SIEMPRE el genoma activo; cada cambio es una nueva versión ligada a una entrada del decision log; nada aplica retroactivamente.

ALCANCE
- Tabla `genome_versions` en `schema.sql`: `id, version, params (JSON), effective_from_epoch, decision_log_id, created_at`. Append-only.
- `lib/genome.ts`: `getActiveGenome(epoch?)` tipado (interfaz `Genome` con todos los parámetros actuales de config.ts: EPOCH_BUDGET, ACADEMIA_BUDGET, ACADEMIA_DAILY_CAP, ACADEMIA_DIMINISHING, ACADEMIA_VOTE_WEIGHT, TIER_INVITE_CAPS, CLA_VERSION queda fuera — es legal, no evolutivo). Cache simple por request.
- Seed: insertar genoma v1 con los valores actuales, ligado a una entrada nueva del decision log ("Genoma v1 publicado").
- Migrar TODOS los consumidores de esas constantes a `getActiveGenome()`. `config.ts` conserva solo lo no-evolutivo (FOUNDER_WALLET, CLA_VERSION, ejes de reputación).
- Tests: lectura del genoma activo · una versión nueva con `effective_from_epoch` futuro no afecta la época en curso · los valores v1 equivalen exactamente a las constantes previas (test de regresión).

NO-ALCANCE — UI de mutación (WP08). Cálculo de fitness (WP07). Cambiar ningún valor: v1 = valores actuales exactos.

CRITERIOS DE ACEPTACIÓN
- [ ] Ninguna referencia directa a las constantes evolutivas fuera de `lib/genome.ts`.
- [ ] Insertar genoma v2 con efecto en época futura no cambia el comportamiento de la época actual (test).
- [ ] Decision log muestra la publicación del genoma v1. Suite verde.

OWNER — Dev 1 · AGENTE: migración + tipos + tests · HUMANO: valida la interfaz `Genome` (es el contrato del motor evolutivo).
TAMAÑO — M · Estimado: medio día.
