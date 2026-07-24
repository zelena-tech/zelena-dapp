import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { applySchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.claSigned) {
    return NextResponse.json({ error: "Debes entrar y firmar el CLA." }, { status: 401 });
  }
  if (!rateLimit(`apply:${session.wallet}:${clientIp(req.headers)}`, 15, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = applySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  const { projectId, approach, timeline } = parsed.data;

  const db = getDb();
  const project = db.prepare(`SELECT id, state FROM projects WHERE id = ?`).get(projectId) as
    | { id: number; state: string }
    | undefined;
  if (!project) return NextResponse.json({ error: "Proyecto no encontrado." }, { status: 404 });
  if (project.state !== "Open") {
    return NextResponse.json({ error: "Este bounty ya no recibe aplicaciones." }, { status: 409 });
  }

  try {
    db.prepare(
      `INSERT INTO applications (project_id, wallet, approach, timeline) VALUES (?, ?, ?, ?)`
    ).run(projectId, session.wallet, approach, timeline);
  } catch {
    return NextResponse.json({ error: "Ya aplicaste a este bounty." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
