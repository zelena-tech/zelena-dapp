import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { onboardSchema } from "@/lib/validation";
import { setSessionCookie } from "@/lib/session";
import { performOnboard, OnboardError } from "@/lib/onboard";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`onboard:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = onboardSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

  const db = getDb();
  let result;
  try {
    // Verifica firma ANTES de consumir la invitación (ver lib/onboard.ts).
    result = performOnboard(db, parsed.data);
  } catch (e) {
    if (e instanceof OnboardError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo completar el registro." }, { status: 400 });
  }

  await setSessionCookie({
    wallet: result.wallet,
    name: result.name,
    tier: result.tier,
    isFounder: false,
    claSigned: true,
    isDemo: result.isDemo,
  });
  return NextResponse.json({ ok: true });
}
