/**
 * Alta de una asignación desde la web (WP14 + FB del día 1).
 *
 * Hasta ahora las tareas solo entraban por el importador de CSV o por el bot de
 * Telegram. Si el bot está apagado, no había forma de añadir trabajo durante el día
 * — y una herramienta de gestión donde no puedes anotar lo que acaba de salir en una
 * reunión se abandona en una semana.
 *
 * La autorización de "para quién" vive en `createAssignmentAs` (lib/team.ts), que la
 * resuelve por ROL. Aquí solo se comprueba que quien pide es del equipo interno.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoInternoActor } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAssignmentAs, createAssignmentSchema, TeamError } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para crear trabajo." }, { status: 401 });

  const db = getDb();
  const actor = equipoInternoActor(session, db);
  if (!actor) {
    return NextResponse.json({ error: "El tablero es del equipo interno." }, { status: 403 });
  }
  if (!rateLimit(`equipo:crear:${actor.wallet}:${clientIp(req.headers)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    // Se devuelve el primer mensaje del esquema, que ya está redactado para leerse.
    const primero = parsed.error.issues[0]?.message ?? "Entrada inválida.";
    return NextResponse.json({ error: primero }, { status: 400 });
  }

  try {
    const id = createAssignmentAs(db, actor, parsed.data);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo crear la asignación." }, { status: 500 });
  }
}
