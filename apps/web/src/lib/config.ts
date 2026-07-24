// Constantes de la fase Génesis (Milestone 1). Valores en decision log.

function founderWallet(): string {
  const w = process.env.FOUNDER_WALLET;
  const building = process.env.NEXT_PHASE === "phase-production-build";
  if (!w && process.env.NODE_ENV === "production" && !building) {
    // El fallback demo en producción permitiria suplantar al founder (hallazgo Alta #2).
    throw new Error("FOUNDER_WALLET ausente. Configúralo antes de desplegar.");
  }
  return w ?? "GA7ZELENAFOUNDERDEMOWALLET000000000000000000000000000AAA";
}
export const FOUNDER_WALLET = founderWallet();

export const EPOCH_BUDGET = 100_000; // puntos ZWORK totales de la época
export const ACADEMIA_BUDGET = 5_000; // presupuesto separado de Academia

export const CLA_VERSION = 1;

export const TIER_INVITE_CAPS: Record<string, number> = {
  Bronze: 2,
  Silver: 5,
  Gold: 10,
};

export const REPUTATION_AXES = [
  "ejecucion",
  "investigacion",
  "comunidad",
  "gobernanza",
] as const;
export type Axis = (typeof REPUTATION_AXES)[number];

export const AXIS_LABEL: Record<Axis, string> = {
  ejecucion: "Ejecución",
  investigacion: "Investigación / Contenido",
  comunidad: "Comunidad",
  gobernanza: "Gobernanza",
};

// Academia: cap diario de contenidos con puntos y rendimientos decrecientes.
export const ACADEMIA_DAILY_CAP = 3;
export const ACADEMIA_DIMINISHING = [1, 0.75, 0.5]; // 1º, 2º, 3º del día
// Los puntos de Academia pesan la mitad para futuros votos.
export const ACADEMIA_VOTE_WEIGHT = 0.5;
