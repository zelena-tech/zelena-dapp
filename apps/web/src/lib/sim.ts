/**
 * Simulador ABM de la economía de puntos — Doc 16 salvaguarda 3 (Axelrod): las
 * mutaciones grandes se prueban primero in silico. Corre un genoma contra épocas
 * sintéticas con agentes de distintas estrategias y reporta emisión, concentración
 * de reputación (Gini) y vectores de farming.
 *
 * 100% PURO (sin DB, sin IO): reusa el genoma (params) y las reglas puras del core.
 * Determinista (sin RNG) para reportes reproducibles y tests estables.
 *
 * NO es un oráculo de comportamiento real (Cilliers): es una heurística de diseño.
 * La calibración con datos reales llega tras las primeras épocas (no existen aún).
 */
// Imports con extensión .ts explícita: el mismo motor se ejecuta bajo vitest, se
// type-checkea en el build de Next, y se importa desde el CLI con `node` (que hace
// type-stripping nativo pero exige extensión). genome.ts es type-only en runtime,
// así que no arrastra la capa de DB. Reuso puro del genoma y las reglas.
import { GENOME_V1, type Genome } from "./genome.ts";
import { withinEpochBudget } from "./rules.ts";

export type Strategy =
  | "cooperador"
  | "minimo-viable"
  | "farmer-academia"
  | "oportunista"
  | "inactivo-que-vuelve";

export const STRATEGIES: Strategy[] = [
  "cooperador",
  "minimo-viable",
  "farmer-academia",
  "oportunista",
  "inactivo-que-vuelve",
];

// Demanda de puntos de ejecución por agente activo y época, según estrategia.
const EXEC_DEMAND: Record<Strategy, number> = {
  cooperador: 20_000,
  "minimo-viable": 8_000,
  "farmer-academia": 2_000,
  oportunista: 15_000,
  "inactivo-que-vuelve": 5_000,
};

// Demanda de puntos de Academia por agente activo y época (el farmer la maximiza).
const ACADEMIA_DEMAND: Record<Strategy, number> = {
  cooperador: 300,
  "minimo-viable": 0,
  "farmer-academia": 4_000,
  oportunista: 0,
  "inactivo-que-vuelve": 0,
};

// Techo de seguridad de emisión por época: ninguna época de Génesis debería emitir
// más que esto. Heurística de diseño del simulador (no es un parámetro del sistema).
export const SANE_EMISSION_CEILING = 150_000;

// El oportunista abandona si su payoff cae por debajo de este umbral.
const OPPORTUNIST_THRESHOLD = 5_000;

export interface SimConfig {
  genome: Genome;
  epochs: number;
  population: number;
  mix?: Partial<Record<Strategy, number>>; // proporciones relativas; default: uniforme
}

interface Agent {
  id: number;
  strategy: Strategy;
  reputation: number;
  points: number;
  active: boolean;
  lastPayoff: number;
}

export interface StrategyStats {
  agents: number;
  points: number;
  reputation: number;
  retention: number; // fracción activa al final
}

export interface SimReport {
  epochs: number;
  population: number;
  pointsEmitted: number;
  pointsPerEpoch: number;
  emissionAlert: boolean; // emisión media por época sobre el techo de seguridad
  gini: number; // desigualdad de reputación [0..1]
  farmerCapturePct: number; // % de puntos capturados por farmers de Academia
  byStrategy: Record<Strategy, StrategyStats>;
}

function buildPopulation(population: number, mix?: Partial<Record<Strategy, number>>): Agent[] {
  const weights = STRATEGIES.map((s) => (mix && typeof mix[s] === "number" ? (mix[s] as number) : 1));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const counts = STRATEGIES.map((_, i) => Math.round((weights[i] / totalW) * population));
  // Ajusta redondeo para que sumen exactamente population.
  let diff = population - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % STRATEGIES.length) {
    if (diff > 0) { counts[i]++; diff--; } else if (counts[i] > 0) { counts[i]--; diff++; }
  }
  const agents: Agent[] = [];
  let id = 0;
  STRATEGIES.forEach((s, i) => {
    for (let k = 0; k < counts[i]; k++) {
      agents.push({ id: id++, strategy: s, reputation: 0, points: 0, active: true, lastPayoff: OPPORTUNIST_THRESHOLD });
    }
  });
  return agents;
}

function gini(values: number[]): number {
  const xs = values.filter((v) => v >= 0);
  const n = xs.length;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (n === 0 || sum === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * sorted[i];
  return cum / (n * sum);
}

export function simulate(cfg: SimConfig): SimReport {
  const { genome, epochs } = cfg;
  const agents = buildPopulation(cfg.population, cfg.mix);
  let pointsEmitted = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    // "inactivo-que-vuelve": activo en épocas pares, inactivo en impares.
    for (const a of agents) {
      if (a.strategy === "inactivo-que-vuelve") a.active = epoch % 2 === 0;
    }

    // --- Ejecución: emisión con techo de presupuesto de época (escasez real) ---
    let execRemaining = genome.EPOCH_BUDGET;
    let execEmittedThisEpoch = 0;
    for (const a of agents) {
      if (!a.active) continue;
      const demand = EXEC_DEMAND[a.strategy];
      if (demand <= 0) continue;
      const pay = Math.max(0, Math.min(demand, execRemaining));
      // La regla pura de presupuesto gobierna la emisión (reuso del core).
      if (pay > 0 && withinEpochBudget(execEmittedThisEpoch, pay, genome.EPOCH_BUDGET)) {
        a.points += pay;
        a.reputation += pay / 100;
        a.lastPayoff = pay;
        execRemaining -= pay;
        execEmittedThisEpoch += pay;
        pointsEmitted += pay;
      } else {
        a.lastPayoff = 0;
      }
    }

    // --- Academia: presupuesto separado, con rendimientos decrecientes ---
    let acadRemaining = genome.ACADEMIA_BUDGET;
    const diminishingFactor = genome.ACADEMIA_DIMINISHING.slice(0, genome.ACADEMIA_DAILY_CAP).reduce((a, b) => a + b, 0) /
      Math.max(1, genome.ACADEMIA_DAILY_CAP);
    for (const a of agents) {
      if (!a.active) continue;
      const rawDemand = ACADEMIA_DEMAND[a.strategy];
      if (rawDemand <= 0) continue;
      const demand = rawDemand * diminishingFactor; // rendimientos decrecientes del genoma
      const pay = Math.max(0, Math.min(demand, acadRemaining));
      if (pay > 0) {
        a.points += pay;
        a.reputation += (pay / 200) * genome.ACADEMIA_VOTE_WEIGHT;
        acadRemaining -= pay;
        pointsEmitted += pay;
      }
    }

    // --- Retención: el oportunista abandona si su payoff cayó bajo el umbral ---
    for (const a of agents) {
      if (a.strategy === "oportunista" && a.active && a.lastPayoff < OPPORTUNIST_THRESHOLD) {
        a.active = false; // se va y no vuelve
      }
    }
  }

  // --- Métricas ---
  const totalPoints = agents.reduce((s, a) => s + a.points, 0);
  const farmerPoints = agents.filter((a) => a.strategy === "farmer-academia").reduce((s, a) => s + a.points, 0);
  const byStrategy = {} as Record<Strategy, StrategyStats>;
  for (const s of STRATEGIES) {
    const group = agents.filter((a) => a.strategy === s);
    const activeEnd =
      s === "inactivo-que-vuelve"
        ? group.filter((a) => (epochs - 1) % 2 === 0).length // estado en la última época
        : group.filter((a) => a.active).length;
    byStrategy[s] = {
      agents: group.length,
      points: group.reduce((x, a) => x + a.points, 0),
      reputation: group.reduce((x, a) => x + a.reputation, 0),
      retention: group.length ? activeEnd / group.length : 0,
    };
  }

  const pointsPerEpoch = epochs > 0 ? pointsEmitted / epochs : 0;
  return {
    epochs,
    population: agents.length,
    pointsEmitted,
    pointsPerEpoch,
    emissionAlert: pointsPerEpoch > SANE_EMISSION_CEILING,
    gini: gini(agents.map((a) => a.reputation)),
    farmerCapturePct: totalPoints > 0 ? farmerPoints / totalPoints : 0,
    byStrategy,
  };
}

export interface ABResult {
  a: SimReport;
  b: SimReport;
  deltas: {
    pointsEmitted: number;
    gini: number;
    farmerCapturePct: number;
  };
}

/** Compara dos genomas bajo la misma población/épocas (A/B in silico). */
export function compareGenomes(a: Genome, b: Genome, base: Omit<SimConfig, "genome">): ABResult {
  const ra = simulate({ ...base, genome: a });
  const rb = simulate({ ...base, genome: b });
  return {
    a: ra,
    b: rb,
    deltas: {
      pointsEmitted: rb.pointsEmitted - ra.pointsEmitted,
      gini: rb.gini - ra.gini,
      farmerCapturePct: rb.farmerCapturePct - ra.farmerCapturePct,
    },
  };
}

/** Presets de genoma para el CLI. v1 = genoma canónico de lib/genome.ts. */
export function genomePreset(name: string): Genome {
  if (name === "v1") return GENOME_V1;
  throw new Error(`Genoma desconocido: ${name} (disponibles: v1)`);
}
