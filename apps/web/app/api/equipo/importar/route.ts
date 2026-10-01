/**
 * `POST /api/equipo/importar` (WP31-A2, spec §4.A.9 y §7) — importar el backlog
 * pegando o subiendo el CSV desde `/equipo/talento#importar`.
 *
 * Cuerpo `{ csv }` (≤ 500 KB) → `ImportSummary`. Founder o supervisor: puerta
 * propia con `equipoInternoActor` (rol leído de la base) + `puedeVerTodoElEquipo`.
 * `importTasks` resuelve cada Assignee por datos y NO emite puntos ni reputación.
 * El backlog real entra por aquí, nunca por archivos versionados (repo público).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoInternoActor } from "@/lib/authz";
import { puedeVerTodoElEquipo } from "@/lib/roles";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { TeamError } from "@/lib/team";
import { importTasks } from "@/lib/team-import";

export const dynamic = "force-dynamic";

const MAX_BYTES = 500 * 1024;

const importarSchema = z.object({
  csv: z.string().refine((s) => s.trim().length > 0, "Pega el CSV o sube el archivo."),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para importar trabajo." }, { status: 401 });

  const db = getDb();
  const actor = equipoInternoActor(session, db);
  if (!actor || !puedeVerTodoElEquipo({ role: actor.role, isSupervisor: actor.isSupervisor })) {
    return NextResponse.json({ error: "Importar es del founder y los supervisores." }, { status: 403 });
  }
  if (!rateLimit(`equipo:importar:${actor.wallet}:${clientIp(req.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > MAX_BYTES * 2) {
    return NextResponse.json({ error: "El CSV pasa de 500 KB: pártelo en dos." }, { status: 413 });
  }

  const body = await req.json().catch(() => null);
  const parsed = importarSchema.safeParse(body);
  if (!parsed.success) {
    const primero = parsed.error.issues[0]?.message ?? "Entrada inválida.";
    return NextResponse.json({ error: primero }, { status: 400 });
  }
  if (new TextEncoder().encode(parsed.data.csv).length > MAX_BYTES) {
    return NextResponse.json({ error: "El CSV pasa de 500 KB: pártelo en dos." }, { status: 413 });
  }

  try {
    const summary = importTasks(db, parsed.data.csv, actor.wallet);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    // Cabecera incompleta o CSV vacío: errores de forma, se explican tal cual.
    if (e instanceof Error && /^(Falta la columna|El CSV está vacío)/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "No se pudo importar el CSV." }, { status: 500 });
  }
}
