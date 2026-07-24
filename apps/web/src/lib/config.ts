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

// CLA_VERSION es legal, no evolutivo: NO va en el genoma (WP02).
export const CLA_VERSION = 1;

// NOTA (WP02): los parámetros EVOLUTIVOS del sistema (EPOCH_BUDGET, ACADEMIA_*,
// TIER_INVITE_CAPS) ya NO viven aquí. Son configuración versionada en DB: léelos
// SIEMPRE vía getActiveGenome() de lib/genome.ts. Nunca hardcodees valores nuevos.

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
