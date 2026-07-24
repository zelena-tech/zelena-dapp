import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { startReading } from "@/lib/academia";
import { academiaStartSchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.claSigned) {
    return NextResponse.json({ error: "Debes entrar y firmar el CLA." }, { status: 401 });
  }
  if (!rateLimit(`aca-start:${session.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = academiaStartSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  try {
    const r = startReading(getDb(), session.wallet, parsed.data.contentId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
