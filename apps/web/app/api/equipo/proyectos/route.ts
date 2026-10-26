/**
 * Proyectos (WP31 · iniciativa = proyecto).
 *
 *  - POST: crear (founder o supervisor) → `{ ok, id, slug }`.
 *  - PATCH: editar nombre, horizonte o descripción (founder, supervisor o quien
 *    estructura el proyecto); el cliente asociado, solo founder o supervisor. El
 *    `slug` nunca cambia: es la dirección del tablero.
 *
 * El handler solo valida e invoca: las reglas viven en lib/team.ts. La puerta es
 * `equipoActor` (lee la base, nunca la cookie).
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { crearProyecto, crearProyectoSchema, editarProyecto, editarProyectoSchema, TeamError } from "@/lib/team";

export const dynamic = "force-dynamic";

async function puerta(req: NextRequest) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Entra para gestionar proyectos." }, { status: 401 }) };
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) {
    return { error: NextResponse.json({ error: "No tienes acceso al tablero del equipo." }, { status: 403 }) };
  }
  if (!rateLimit(`equipo:proyectos:${actor.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return { error: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }) };
  }
  return { db, actor };
}

function primerError(issues: Array<{ message: string }>): string {
  return issues[0]?.message ?? "Entrada inválida.";
}

export async function POST(req: NextRequest) {
  const p = await puerta(req);
  if ("error" in p) return p.error;
  const body = await req.json().catch(() => null);
  const parsed = crearProyectoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: primerError(parsed.error.issues) }, { status: 400 });
  try {
    const row = crearProyecto(p.db, p.actor, parsed.data);
    return NextResponse.json({ ok: true, id: row.id, slug: row.slug });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo crear el proyecto." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const p = await puerta(req);
  if ("error" in p) return p.error;
  const body = await req.json().catch(() => null);
  const parsed = editarProyectoSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: primerError(parsed.error.issues) }, { status: 400 });
  try {
    const row = editarProyecto(p.db, p.actor, parsed.data);
    return NextResponse.json({ ok: true, id: row.id, slug: row.slug });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo editar el proyecto." }, { status: 500 });
  }
}
