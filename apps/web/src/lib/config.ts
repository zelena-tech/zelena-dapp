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

// ---------------------------------------------------------------------------
// Puerta corporativa: Microsoft Entra ID (WP13)
// ---------------------------------------------------------------------------
// Todas estas funciones leen `process.env` EN CADA LLAMADA, a propósito:
//  - permiten testear el flag encendido y apagado sin recargar módulos;
//  - evitan que el build congele un valor (el flag se enciende en Azure App
//    Settings sin recompilar, que es justo el flujo del paso 4 de DESPLIEGUE-V1).
// Aquí NO se lee ningún secreto fuera de `process.env` ni se escribe en disco.

/** Dominio corporativo de Zelena. Configurable para no hardcodear el tenant en tests. */
export function corporateDomain(): string {
  return (process.env.ZELENA_CORPORATE_DOMAIN ?? "zelena.tech").trim().toLowerCase();
}

/**
 * Feature flag de la puerta corporativa. APAGADO por defecto: mientras John no
 * cree el app registration (paso A1) el flujo de invitación + wallet es el único
 * camino y no cambia en nada.
 */
export function isEntraEnabled(): boolean {
  const v = (process.env.AUTH_ENTRA_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface EntraSettings {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

/** Variables que faltan para poder encender el flag (para diagnóstico, sin valores). */
export function entraMissingVars(): string[] {
  const missing: string[] = [];
  if (!process.env.AZURE_AD_CLIENT_ID) missing.push("AZURE_AD_CLIENT_ID");
  if (!process.env.AZURE_AD_CLIENT_SECRET) missing.push("AZURE_AD_CLIENT_SECRET");
  if (!process.env.AZURE_AD_TENANT_ID) missing.push("AZURE_AD_TENANT_ID");
  if (!process.env.NEXTAUTH_SECRET) missing.push("NEXTAUTH_SECRET");
  return missing;
}

/** Credenciales de Entra, o `null` si falta alguna. Nunca se registran en logs. */
export function entraSettings(): EntraSettings | null {
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  const tenantId = process.env.AZURE_AD_TENANT_ID;
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

/** Estado de la puerta corporativa para la UI y el diagnóstico. Sin secretos. */
export function entraStatus(): { enabled: boolean; configured: boolean; missing: string[] } {
  const missing = entraMissingVars();
  return { enabled: isEntraEnabled(), configured: missing.length === 0, missing };
}

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
