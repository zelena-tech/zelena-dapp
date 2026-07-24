# WP11 · Simulador ABM de la economía de puntos

CONTEXTO — Doc 16 salvaguarda 3: con pocas generaciones reales, las mutaciones grandes se prueban primero in silico (Axelrod: torneos de agentes). El simulador corre un genoma contra épocas sintéticas con agentes-contribuidores de distintas estrategias.

RESULTADO ESPERADO — `packages/scripts/sim`: simular N épocas con una población de agentes contra un genoma dado y reportar emisión de puntos, concentración de reputación y vectores de farming.

ALCANCE
- Motor de simulación (TypeScript puro, sin DB): agentes con estrategias parametrizadas — `cooperador` (entrega a tiempo, calidad alta), `mínimo-viable` (justo lo suficiente), `farmer-academia` (maximiza puntos de Academia), `oportunista` (abandona si el payoff baja), `inactivo-que-vuelve`. Población y mezcla configurables.
- Cada época sintética: los agentes toman bounties/academia según su estrategia; se aplican las reglas reales (reusar `lib/rules.ts`, `lib/genome.ts` — importables puros; presupuesto de época, rendimientos decrecientes, caps).
- Reporte por corrida: puntos emitidos vs presupuesto, Gini de reputación, % de puntos capturados por farmers, retención simulada por estrategia, y comparación entre dos genomas (A/B).
- CLI: `node sim --genome v1 --epochs 1000 --pop 25` → reporte en consola + JSON.

NO-ALCANCE — Predicción de comportamiento real (es heurística de diseño, no oráculo — Cilliers). UI. Calibración con datos reales (no existen aún; se calibra tras 3 épocas reales).

CRITERIOS DE ACEPTACIÓN
- [ ] 1.000 épocas con 25 agentes en <1 min.
- [ ] El reporte A/B muestra diferencias explicables entre dos genomas (test con genomas artificialmente distintos).
- [ ] Un genoma con presupuesto infinito dispara la alerta de emisión (sanity check).

OWNER — Dev 1 + John (diseño de estrategias de agentes) · TAMAÑO — M · Estimado: 1 día. Depende: WP02.
