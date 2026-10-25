import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";
// Ruta relativa (no "@/"): vitest importa este archivo y no resuelve los alias.
import { CABECERA_IDIOMA, esRutaLanding } from "./src/lib/menu";

/**
 * Gate de acceso. Las páginas de lectura (/, /manifiesto, /metodo, /agora,
 * /academia, /gobernanza) son públicas.
 * La verificación de la firma JWT (jose) corre en el edge.
 *
 *  - PROTECTED_CLA: sesión CON CLA firmado (candado de PI: cobrar y firmar).
 *  - PROTECTED_SESSION: solo sesión. `/equipo` (WP14) entra aquí porque el core
 *    team entra por Entra (WP13) y firma el CLA DESPUÉS del login — exigir
 *    claSigned aquí dejaría al equipo fuera de su propio tablero. Las páginas ya
 *    redirigen por su cuenta; esto es la segunda capa.
 *
 * WP13 confirma esta frontera y NO la mueve: el alta por Entra emite la MISMA cookie
 * `zelena_session` con `claSigned: false`, así que quien entra por la puerta
 * corporativa llega a `/equipo/hoy` (solo sesión) y sigue necesitando firmar el CLA
 * para `/perfil` y `/admin`. El CLA es requisito para cobrar, no para entrar.
 *
 * `/api/auth/**` (NextAuth + intercambio de sesión) queda FUERA del matcher a
 * propósito: es el camino por el que se OBTIENE la sesión; protegerlo con la sesión
 * sería un bucle.
 */
const PROTECTED_CLA = ["/perfil", "/admin"];
// `/clientes` (WP17/WP20) también: la puerta real es su layout (equipo interno +
// `client_members`); esto es la segunda capa.
const PROTECTED_SESSION = ["/equipo", "/clientes"];

function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // La landing en inglés: el layout raíz pone `<html lang="en">` con esta cabecera.
  // No mira sesión: estas rutas son públicas.
  if (esRutaLanding(path)) {
    const cabeceras = new Headers(req.headers);
    cabeceras.set(CABECERA_IDIOMA, "en");
    return NextResponse.next({ request: { headers: cabeceras } });
  }
  const needsCla = matches(path, PROTECTED_CLA);
  const needsSession = needsCla || matches(path, PROTECTED_SESSION);
  if (!needsSession) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session || (needsCla && !session.claSigned)) {
    const url = req.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// "/" y "/comunidad" (RUTAS_LANDING) entran solo para el idioma del documento; la ruta
// exacta, sin lo que cuelga de ellas.
export const config = {
  matcher: ["/perfil/:path*", "/admin/:path*", "/equipo/:path*", "/clientes/:path*", "/", "/comunidad"],
};
