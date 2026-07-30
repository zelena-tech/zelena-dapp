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
import { AFTER_LOGIN_PATH, bridgeFromToken, LOGIN_PATH } from "../../entra-options";

export const dynamic = "force-dynamic";

/** Cookies que usa NextAuth v4 según el esquema (http/https). Se limpian ambas. */
const NEXTAUTH_COOKIES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
];

function backToLogin(req: NextRequest, reason: string, message?: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = "";
  url.searchParams.set("error", reason);
  if (message) url.searchParams.set("motivo", message);
  const res = NextResponse.redirect(url);
  for (const name of NEXTAUTH_COOKIES) res.cookies.delete(name);
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

  const url = req.nextUrl.clone();
  url.pathname = AFTER_LOGIN_PATH;
  url.search = "";
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
  for (const name of NEXTAUTH_COOKIES) res.cookies.delete(name);
  return res;
}
