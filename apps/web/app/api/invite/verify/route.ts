import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { checkInvite } from "@/lib/invites";
import { inviteVerifySchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`invite-verify:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera un momento." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = inviteVerifySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

  const check = checkInvite(getDb(), parsed.data.code);
  if (check.ok) return NextResponse.json({ ok: true });
  const msg =
    check.reason === "used" ? "Este código ya fue usado." : check.reason === "expired" ? "Este código expiró." : "Código no válido.";
  return NextResponse.json({ ok: false, error: msg }, { status: 200 });
}
