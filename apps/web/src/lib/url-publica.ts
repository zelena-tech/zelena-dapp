/**
 * URL pública de la app detrás de Azure Front Door (WP13, puerta corporativa).
 *
 * Por qué existe. En App Service la app corre como `node server.js` con
 * `HOSTNAME=0.0.0.0` y `PORT`, y Next arma la URL de cada petición con ESO
 * (`http://0.0.0.0:8080/...`), no con el host que pidió el navegador
 * (`www.zelena.tech`, que llega por Front Door). Las redirecciones del middleware Next
 * las vuelve relativas, pero las de un route handler salen tal cual: un
 * `NextResponse.redirect(req.nextUrl…)` en `/api/auth/entra/exchange` mandaba a la
 * persona a `0.0.0.0:8080` justo después de ponerle la cookie de `www.zelena.tech`.
 *
 * La base es `NEXTAUTH_URL` (la misma que usa NextAuth para la Redirect URI:
 * `https://www.zelena.tech` en producción). Sin ella (desarrollo local), el origen de
 * la petición, que ahí sí es el del navegador.
 *
 * Puro: sin `next/*` ni base de datos, para poder probarlo.
 */

/** Origen (`https://host[:puerto]`) de `NEXTAUTH_URL`, o `null` si falta o no es http(s). */
export function origenPublico(env: { NEXTAUTH_URL?: string } = process.env): string | null {
  const v = (env.NEXTAUTH_URL ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * URL absoluta y PÚBLICA para `ruta` (un camino del propio sitio, con `/` inicial).
 * `origenPeticion` es el de la petición (`req.nextUrl.origin`), solo de respaldo.
 */
export function urlPublica(
  ruta: string,
  origenPeticion: string,
  env: { NEXTAUTH_URL?: string } = process.env
): URL {
  const camino = ruta.startsWith("/") && !ruta.startsWith("//") ? ruta : "/";
  return new URL(camino, origenPublico(env) ?? origenPeticion);
}

/** Cookies que deja NextAuth v4 durante el baile OAuth (con y sin prefijo seguro). */
export const COOKIES_NEXTAUTH: readonly string[] = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.state",
  "__Secure-next-auth.state",
  "next-auth.pkce.code_verifier",
  "__Secure-next-auth.pkce.code_verifier",
  "next-auth.nonce",
  "__Secure-next-auth.nonce",
];

/**
 * Opciones para BORRAR una cookie de NextAuth. Un navegador ignora el borrado de una
 * cookie `__Secure-`/`__Host-` si el `Set-Cookie` no lleva `Secure` (y `__Host-` además
 * exige `Path=/` sin dominio): con un `delete` simple, detrás de https la sesión de
 * NextAuth quedaba viva.
 */
export function opcionesBorrado(nombre: string): {
  path: "/";
  maxAge: 0;
  expires: Date;
  secure: boolean;
  httpOnly: true;
  sameSite: "lax";
} {
  return {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    secure: nombre.startsWith("__Secure-") || nombre.startsWith("__Host-"),
    httpOnly: true,
    sameSite: "lax",
  };
}
