/**
 * Mensaje que firma la wallet para ENTRAR (reingreso por reto, hallazgo de la
 * verificación final).
 *
 * Módulo PURO (sin IO, sin `node:*`): lo importan el cliente (`app/entrar/page.tsx`,
 * que firma) y el servidor (`lib/onboard.ts`, que verifica). Los dos deben construir
 * exactamente el mismo texto.
 *
 * Por qué un mensaje distinto del CLA. Antes `/api/login` aceptaba la firma del
 * acuerdo de contribución (`zelena-cla-testnet-v1:<hash>`), que es SIEMPRE la misma
 * y además se guarda en `cla_signatures`: quien la capturara (o leyera una copia de
 * la base) entraba para siempre. Ahora se firma un reto de un solo uso que emite el
 * servidor. El separador de dominio es otro (`zelena-login-…` frente a `zelena-cla-…`),
 * así que una firma del CLA nunca vale como firma de entrada, ni al revés.
 */
export const LOGIN_DOMAIN_SEPARATOR = "zelena-login-testnet-v1";

/**
 * Forma del reto: 32 bytes aleatorios en base64url sin relleno (43 caracteres). Se
 * valida antes de tocar el almacén para no gastar trabajo en basura.
 */
export const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;

/** Mensaje firmado = separador de dominio + reto. */
export function loginSigningPayload(nonce: string): string {
  return `${LOGIN_DOMAIN_SEPARATOR}:${nonce}`;
}
