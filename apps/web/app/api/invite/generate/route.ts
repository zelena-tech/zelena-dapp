import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generateInvite, InviteCapError } from "@/lib/invites";
import { getUser } from "@/lib/repo";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.claSigned) {
    return NextResponse.json({ error: "Debes entrar y firmar el CLA." }, { status: 401 });
  }
  if (!rateLimit(`invite-gen:${session.wallet}:${clientIp(req.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const user = getUser(session.wallet);
  const tier = user?.tier ?? "Bronze";
  try {
    const code = generateInvite(getDb(), session.wallet, tier);
    return NextResponse.json({ ok: true, code });
  } catch (e) {
    if (e instanceof InviteCapError) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: "No se pudo generar la invitación." }, { status: 400 });
  }
}
