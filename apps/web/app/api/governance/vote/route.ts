import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { voteSchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.claSigned) {
    return NextResponse.json({ error: "Debes entrar y firmar el CLA para votar." }, { status: 401 });
  }
  if (!rateLimit(`vote:${session.wallet}:${clientIp(req.headers)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  const { proposalId, choice } = parsed.data;

  const db = getDb();
  const prop = db.prepare(`SELECT id, status FROM proposals WHERE id = ?`).get(proposalId) as
    | { id: number; status: string }
    | undefined;
  if (!prop) return NextResponse.json({ error: "Propuesta no encontrada." }, { status: 404 });
  if (prop.status !== "open") return NextResponse.json({ error: "La votación está cerrada." }, { status: 409 });

  try {
    db.prepare(`INSERT INTO votes (proposal_id, wallet, choice) VALUES (?, ?, ?)`).run(
      proposalId,
      session.wallet,
      choice
    );
  } catch {
    return NextResponse.json({ error: "Ya votaste en esta propuesta." }, { status: 409 });
  }
  // Registro de reputación en gobernanza por participar.
  db.prepare(
    `INSERT INTO reputation_events (wallet, axis, delta, ref) VALUES (?, 'gobernanza', 2, 'Voto en propuesta')`
  ).run(session.wallet);
  return NextResponse.json({ ok: true });
}
