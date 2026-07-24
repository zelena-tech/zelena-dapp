# WP07 · Motor de épocas — fitness multiobjetivo

CONTEXTO — Doc 16 §3: cada época es una generación. Al cierre se calcula el fitness del genoma activo y se compara con la época anterior: keep o revert. Regla 4: el algoritmo propone, el humano firma.

PROBLEMA — Sin medición sistemática por época no hay selección; sin selección no hay evolución — solo cambios a ciegas.

RESULTADO ESPERADO — Al cerrar una época, el sistema produce un reporte de fitness explicable y una recomendación (mantener genoma / revertir), que el founder firma en el admin.

ALCANCE
- `lib/fitness.ts` (puro, testeable): `computeFitness(epochData) -> {score, components}` con componentes: retención (usuarios con ≥1 acción en las últimas 2 semanas / activos previos — proxy de K3), calidad media de entregas aprobadas, participación en ritos (check-ins), tasa de disputas (negativa). Pesos del fitness viven EN el genoma (meta-parámetros, mutables como todo lo demás).
- Cierre de época en admin: calcula fitness, lo compara con la época anterior, guarda `epoch_fitness (epoch, genome_version, components JSON, score, recommendation)`, muestra recomendación keep/revert con desglose por componente (explicabilidad).
- El founder firma la decisión → entrada en decision log (automática, con el reporte).
- Tests con datos sintéticos: época mejor → keep · época peor → revert · componentes faltantes no rompen (degradación explícita).

NO-ALCANCE — Aplicar mutaciones (WP08). Cambiar el cierre de periodo/merkle existente. Automatizar la decisión (el humano firma siempre).

CRITERIOS DE ACEPTACIÓN
- [ ] Cierre de época produce reporte con score + desglose + recomendación, persistido y visible en admin.
- [ ] La decisión firmada queda en el decision log referenciando el reporte.
- [ ] `lib/fitness.ts` 100% puro (sin IO) con tests de tabla.

OWNER — Dev 1 · AGENTE: implementación + tests sintéticos · HUMANO: valida pesos iniciales del fitness (van al genoma).
TAMAÑO — M · Estimado: 1 día.
