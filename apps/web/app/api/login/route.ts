import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loginSchema } from "@/lib/validation";
import { setSessionCookie } from "@/lib/session";
import { performLogin, OnboardError } from "@/lib/onboard";
import { FOUNDER_WALLET } from "@/lib/config";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Reingreso de una wallet ya registrada. La autenticación es la firma ed25519
 * sobre el payload del CLA; no consume invitación ni escribe en la base.
 * El handler solo invoca a lib/onboard.performLogin (ver CLAUDE.md).
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`login:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

  let result;
  try {
    result = performLogin(getDb(), parsed.data);
  } catch (e) {
    if (e instanceof OnboardError)
      return NextResponse.json({ error: e.message, reason: e.reason }, { status: e.status });
    return NextResponse.json({ error: "No se pudo iniciar sesión." }, { status: 400 });
  }

  await setSessionCookie({
    wallet: result.wallet,
    name: result.name,
    tier: result.tier,
    isFounder: result.wallet === FOUNDER_WALLET,
    claSigned: true,
    isDemo: result.isDemo,
  });
  return NextResponse.json({ ok: true, returning: true });
}
