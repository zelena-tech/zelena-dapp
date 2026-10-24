/**
 * WP13 · EL INTERCAMBIO: sesión de Entra → cookie JWT interna.
 *
 * Este endpoint es el corazón del requisito "el callback intercambia la sesión de
 * Entra por la cookie JWT interna existente — la sesión interna NO cambia de
 * formato". Lo que hace, en orden:
 *
 *   1. lee el JWT que NextAuth acabó de emitir (claims de Entra puenteados);
 *   2. los valida con lib/entra.ts (restricción de tenant incluida);
 *   3. resuelve la fila del registro SIN mutar ninguna PK;
 *   4. firma la MISMA cookie `zelena_session` que emite /api/onboard;
 *   5. borra la sesión de NextAuth (una sola sesión viva en la app);
 *   6. redirige al tablero del día.
 *
 * No se guarda el access_token de Entra en ningún sitio: la app no llama a Graph
 * (NO-ALCANCE) y guardar un token que no se usa solo es superficie de ataque.
 */
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getDb } from "@/lib/db";
import { corporateDomain, entraSettings, isEntraEnabled } from "@/lib/config";
import { entraLogin, EntraLinkError } from "@/lib/entra";
import { signSession, SESSION_COOKIE } from "@/lib/jwt";
import { COOKIES_NEXTAUTH, opcionesBorrado, urlPublica } from "@/lib/url-publica";
import { AFTER_LOGIN_PATH, bridgeFromToken, LOGIN_PATH } from "../../entra-options";

export const dynamic = "force-dynamic";

/**
 * Borra las cookies de NextAuth (sesión efímera, CSRF, state, PKCE…). Con el `Secure`
 * que exigen los prefijos `__Secure-`/`__Host-`: sin él, detrás de https el navegador
 * ignora el borrado (ver lib/url-publica.ts).
 */
function borrarCookiesNextAuth(res: NextResponse): void {
  for (const name of COOKIES_NEXTAUTH) res.cookies.set(name, "", opcionesBorrado(name));
}

/**
 * Redirecciones con la URL PÚBLICA (`NEXTAUTH_URL`), nunca con `req.nextUrl`: detrás de
 * Azure Front Door, `req.nextUrl` es el host interno del contenedor (`0.0.0.0:8080`).
 */
function backToLogin(req: NextRequest, reason: string, message?: string): NextResponse {
  const url = urlPublica(LOGIN_PATH, req.nextUrl.origin);
  url.searchParams.set("error", reason);
  if (message) url.searchParams.set("motivo", message);
  const res = NextResponse.redirect(url);
  borrarCookiesNextAuth(res);
  return res;
}

export async function GET(req: NextRequest) {
  const settings = entraSettings();
  if (!isEntraEnabled() || !settings) {
    return backToLogin(req, "flag_disabled");
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return backToLogin(req, "not_configured");

  const token = await getToken({ req, secret }).catch(() => null);
  const claims = bridgeFromToken(token);

  let result;
  try {
    result = entraLogin(getDb(), claims, {
      enabled: true,
      tenantId: settings.tenantId,
      corporateDomain: corporateDomain(),
    });
  } catch (e) {
    if (e instanceof EntraLinkError) return backToLogin(req, e.reason, e.message);
    return backToLogin(req, "no_token");
  }

  if (!result.ok) return backToLogin(req, result.reason, result.message);

  const { login } = result;
  // MISMO formato de sesión que el flujo de invitación (lib/jwt.ts SessionData).
  // `role`/`isSupervisor` son los campos opcionales que ya introdujo WP14: no se
  // añade ningún campo nuevo, así que ninguna cookie previa deja de ser válida.
  const jwt = await signSession({
    wallet: login.wallet,
    name: login.name,
    tier: login.tier,
    isFounder: login.role === "founder",
    claSigned: login.claSigned,
    isDemo: login.isDemo,
    role: login.role,
    isSupervisor: login.isSupervisor,
  });

  const url = urlPublica(AFTER_LOGIN_PATH, req.nextUrl.origin);
  // El banner del segundo correo lo decide el servidor leyendo la base; esto es solo
  // para que la primera pantalla tras el alta lo señale sin esperar otra vuelta.
  if (login.needsRecoveryEmail) url.searchParams.set("segundo_correo", "pendiente");

  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  borrarCookiesNextAuth(res);
  return res;
}
