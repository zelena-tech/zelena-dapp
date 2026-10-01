/**
 * `/api/avisos` — la bandeja propia (WP31-C1).
 *  - GET: los avisos de la persona (todas sus identidades) y cuántos no ha leído.
 *  - POST `{ ids?: number[] }`: marca como leídos los suyos (todos si no hay `ids`).
 *
 * Quién: cualquier sesión con fila activa en `users` (se lee la base, nunca los claims
 * de la cookie). Cada persona ve y marca SOLO lo suyo; no existe "cuándo leyó".
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, type DB } from "@/lib/db";
import { getSession } from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { avisosDe, contarNoLeidos, marcarLeidos } from "@/lib/avisos";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

const marcarSchema = z.object({
  ids: z.array(z.number().int().positive()).max(500).optional(),
});

/** Quien tiene sesión y una fila activa en `users`; si no, null. */
function personaActiva(db: DB, wallet: string | undefined): string | null {
  if (typeof wallet !== "string" || !wallet) return null;
  const r = db.prepare(`SELECT status FROM users WHERE wallet = ?`).get(wallet) as { status: string } | undefined;
  return r && r.status === "active" ? wallet : null;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para ver tus avisos." }, { status: 401 });
  if (!rateLimit(`avisos:get:${session.wallet}:${clientIp(req.headers)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const db = getDb();
  const wallet = personaActiva(db, session.wallet);
  if (!wallet) return NextResponse.json({ error: "Tu cuenta no tiene avisos." }, { status: 403 });

  const avisos = avisosDe(db, wallet).map((a) => ({
    id: a.id,
    tipo: a.tipo,
    texto: a.texto,
    assignmentId: a.assignment_id,
    leido: a.is_leido === 1,
  }));
  return NextResponse.json({ avisos, noLeidos: contarNoLeidos(db, wallet) }, { headers: SIN_CACHE });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para marcar tus avisos." }, { status: 401 });
  if (!rateLimit(`avisos:post:${session.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const db = getDb();
  const wallet = personaActiva(db, session.wallet);
  if (!wallet) return NextResponse.json({ error: "Tu cuenta no tiene avisos." }, { status: 403 });

  const raw = await req.json().catch(() => ({}));
  const parsed = marcarSchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Los avisos a marcar no son válidos." }, { status: 400 });

  const marcados = marcarLeidos(db, wallet, parsed.data.ids);
  return NextResponse.json({ ok: true, marcados, noLeidos: contarNoLeidos(db, wallet) }, { headers: SIN_CACHE });
}
