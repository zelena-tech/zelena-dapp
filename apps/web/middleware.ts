import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";

/**
 * Gate de acceso. Las páginas de lectura (/, /agora, /academia, /gobernanza,
 * /whitepaper) son públicas.
 * La verificación de la firma JWT (jose) corre en el edge.
 *
 *  - PROTECTED_CLA: sesión CON CLA firmado (candado de PI: cobrar y firmar).
 *  - PROTECTED_SESSION: solo sesión. `/equipo` (WP14) entra aquí porque el core
 *    team entra por Entra (WP13) y firma el CLA DESPUÉS del login — exigir
 *    claSigned aquí dejaría al equipo fuera de su propio tablero. Las páginas ya
 *    redirigen por su cuenta; esto es la segunda capa.
 */
const PROTECTED_CLA = ["/perfil", "/admin"];
const PROTECTED_SESSION = ["/equipo"];

function matches(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/"));
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
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

export const config = {
  matcher: ["/perfil/:path*", "/admin/:path*", "/equipo/:path*"],
};
