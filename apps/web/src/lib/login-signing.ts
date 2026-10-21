/**
 * Mensaje que firma la wallet para ENTRAR (reingreso por reto, hallazgo de la
 * verificación final).
 *
 * Módulo PURO (sin IO, sin `node:*`, sin `process.env`): lo importan el cliente
 * (`app/entrar/page.tsx`, que firma) y el servidor (`lib/onboard.ts`, que verifica). Los
 * dos deben construir exactamente el mismo texto.
 *
 * Por qué un mensaje distinto del CLA. Antes `/api/login` aceptaba la firma del
 * acuerdo de contribución (`zelena-cla-testnet-v1:<hash>`), que es SIEMPRE la misma
 * y además se guarda en `cla_signatures`: quien la capturara (o leyera una copia de
 * la base) entraba para siempre. Ahora se firma un reto de un solo uso que emite el
 * servidor. El separador de dominio es otro (`zelena-login-…` frente a `zelena-cla-…`),
 * así que una firma del CLA nunca vale como firma de entrada, ni al revés.
 *
 * El mensaje NOMBRA EL SITIO (decisión del founder, 2026-10-21):
 * `zelena-login-testnet-v1:www.zelena.tech:<reto>`. Así la persona ve en Freighter dónde
 * está entrando antes de aprobar la firma. El sitio es el host de `SITE_URL` (el mismo de
 * los metadatos del layout) o, sin él, `www.zelena.tech`; el servidor lo manda junto al
 * reto y el cliente arma el mensaje con este módulo, nunca firma un texto libre.
 */
export const LOGIN_DOMAIN_SEPARATOR = "zelena-login-testnet-v1";

/** Sitio del mensaje de entrada cuando `SITE_URL` no está configurado. */
export const SITIO_ENTRADA_DEFAULT = "www.zelena.tech";

/** Un host (con puerto opcional) en minúsculas: lo único que se acepta como sitio. */
export const SITIO_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/;

/**
 * Forma del reto: 32 bytes aleatorios en base64url sin relleno (43 caracteres). Se
 * valida antes de tocar el almacén para no gastar trabajo en basura.
 */
export const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;

/** Host de `siteUrl` (p. ej. el valor de `SITE_URL`), o el sitio por defecto si falta o no es http(s). */
export function sitioDesdeUrl(siteUrl: string | undefined | null): string {
  const v = (siteUrl ?? "").trim();
  if (!v) return SITIO_ENTRADA_DEFAULT;
  try {
    const u = new URL(v);
    const host = u.host.toLowerCase();
    return (u.protocol === "https:" || u.protocol === "http:") && SITIO_RE.test(host) ? host : SITIO_ENTRADA_DEFAULT;
  } catch {
    return SITIO_ENTRADA_DEFAULT;
  }
}

/** Mensaje firmado = separador de dominio + sitio + reto. */
export function loginSigningPayload(sitio: string, nonce: string): string {
  return `${LOGIN_DOMAIN_SEPARATOR}:${sitio}:${nonce}`;
}
