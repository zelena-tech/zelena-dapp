/**
 * Payload canónico que firma la wallet al aceptar el CLA.
 *
 * Módulo PURO (sin IO, sin `node:*`) para poder importarse tanto desde el
 * cliente (`app/entrar/page.tsx`, que firma) como desde el servidor
 * (`lib/onboard.ts` + `lib/crypto.ts`, que verifican). Cliente y servidor DEBEN
 * construir exactamente el mismo string, o la verificación ed25519 fallará.
 *
 * El domain separator ata la firma a una red/contexto concreto: la misma firma
 * NO es válida en otra red ni para otro contrato que también pidiera firmar el
 * hash del CLA (protección anti-replay documentada en security-review.md §7).
 */
export const CLA_DOMAIN_SEPARATOR = "zelena-cla-testnet-v1";

/** Payload firmado = domain separator + hash del CLA. */
export function claSigningPayload(claHash: string): string {
  return `${CLA_DOMAIN_SEPARATOR}:${claHash}`;
}
