/**
 * Motor de fitness multiobjetivo — Doc 16 §3: cada época es una generación. Al
 * cierre se mide el fitness del genoma activo y se compara con la época anterior
 * (keep o revert). Regla 4: el algoritmo PROPONE, el humano FIRMA.
 *
 * 100% PURO (sin IO): recibe datos ya agregados y devuelve score + desglose
 * explicable. Cualquier componente sin datos se excluye con degradación
 * explícita (no rompe): el score se renormaliza por los pesos aplicables.
 *
 * Los pesos son META-parámetros y viven en el genoma (mutables como todo lo
 * demás, WP02). Aquí solo hay defaults de respaldo.
 */

export interface FitnessWeights {
  retention: number;
  quality: number;
  participation: number;
  disputes: number;
}

export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
  retention: 0.35,
  quality: 0.35,
  participation: 0.2,
  disputes: 0.1,
};

/**
 * Datos crudos de una época, ya agregados. Cualquier campo puede faltar
 * (undefined): su componente se excluye del score, con nota explícita.
 */
export interface EpochData {
  activeUsersPrev?: number; // base de usuarios activos (época previa)
  retainedUsers?: number; // de esos, con ≥1 acción en las últimas 2 semanas (proxy K3)
  deliveryQuality?: number[]; // calidad [0..1] de cada entrega aprobada
  checkins?: number; // asistencia a ritos
  expectedCheckins?: number; // base para normalizar participación
  disputes?: number; // nº de disputas
  totalDeliveries?: number; // base para la tasa de disputas
}

export type FitnessKey = "retention" | "quality" | "participation" | "disputes";

export interface FitnessComponent {
  key: FitnessKey;
  label: string;
  value: number | null; // [0..1], o null si no hay datos para este componente
  weight: number;
  contribution: number; // value*weight (0 si null)
  note?: string;
}

export interface FitnessResult {
  score: number; // [0..1] — suma ponderada renormalizada por los pesos aplicables
  components: FitnessComponent[];
  applicableWeight: number; // suma de pesos de los componentes con datos
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function computeFitness(data: EpochData, weights: FitnessWeights = DEFAULT_FITNESS_WEIGHTS): FitnessResult {
  const w = { ...DEFAULT_FITNESS_WEIGHTS, ...weights };
  const comps: FitnessComponent[] = [];

  const add = (key: FitnessKey, label: string, weight: number, value: number | null, note?: string) =>
    comps.push({ key, label, value, weight, contribution: value === null ? 0 : value * weight, note });

  // Retención (proxy K3): retenidos / activos previos.
  if (typeof data.retainedUsers === "number" && typeof data.activeUsersPrev === "number" && data.activeUsersPrev > 0) {
    add("retention", "Retención (K3)", w.retention, clamp01(data.retainedUsers / data.activeUsersPrev));
  } else {
    add("retention", "Retención (K3)", w.retention, null, "sin base de usuarios previa");
  }

  // Calidad media de las entregas aprobadas.
  if (Array.isArray(data.deliveryQuality) && data.deliveryQuality.length > 0) {
    const mean = data.deliveryQuality.reduce((a, b) => a + clamp01(b), 0) / data.deliveryQuality.length;
    add("quality", "Calidad media de entregas", w.quality, mean);
  } else {
    add("quality", "Calidad media de entregas", w.quality, null, "sin entregas aprobadas");
  }

  // Participación en ritos (check-ins).
  if (typeof data.checkins === "number" && typeof data.expectedCheckins === "number" && data.expectedCheckins > 0) {
    add("participation", "Participación en ritos", w.participation, clamp01(data.checkins / data.expectedCheckins));
  } else {
    add("participation", "Participación en ritos", w.participation, null, "sin datos de ritos");
  }

  // Tasa de disputas — NEGATIVA: menos disputas = mejor (se reporta como "ausencia").
  if (typeof data.disputes === "number" && typeof data.totalDeliveries === "number" && data.totalDeliveries > 0) {
    add("disputes", "Ausencia de disputas", w.disputes, 1 - clamp01(data.disputes / data.totalDeliveries));
  } else {
    add("disputes", "Ausencia de disputas", w.disputes, null, "sin datos de disputas");
  }

  const applicableWeight = comps.filter((c) => c.value !== null).reduce((a, c) => a + c.weight, 0);
  const score = applicableWeight > 0 ? comps.reduce((a, c) => a + c.contribution, 0) / applicableWeight : 0;
  return { score, components: comps, applicableWeight };
}

export type Recommendation = "keep" | "revert";

/**
 * El algoritmo propone; el humano firma (regla 4). Sin época anterior con la que
 * comparar (primera época) la recomendación es mantener: no hay base para revertir.
 */
export function recommend(current: number, previous: number | null): Recommendation {
  if (previous === null || previous === undefined) return "keep";
  return current >= previous ? "keep" : "revert";
}
