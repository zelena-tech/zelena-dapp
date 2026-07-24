import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { heartbeat } from "@/lib/academia";
import { academiaHeartbeatSchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.claSigned) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  // Un heartbeat cada 15s → limitamos a ~6/min con margen.
  if (!rateLimit(`aca-beat:${session.wallet}:${clientIp(req.headers)}`, 12, 60_000)) {
    return NextResponse.json({ error: "Demasiados heartbeats." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = academiaHeartbeatSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  try {
    const r = heartbeat(getDb(), session.wallet, parsed.data.token);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
