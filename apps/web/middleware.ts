import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/jwt";

/**
 * Gate de acceso. Las páginas de lectura (/, /agora, /academia, /gobernanza,
 * /whitepaper) son públicas. Estas rutas requieren sesión con CLA firmado.
 * La verificación de la firma JWT (jose) corre en el edge.
 */
const PROTECTED = ["/perfil", "/admin"];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const needsAuth = PROTECTED.some((p) => path === p || path.startsWith(p + "/"));
  if (!needsAuth) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session || !session.claSigned) {
    const url = req.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/perfil/:path*", "/admin/:path*"],
};
