/**
 * Miembros de un proyecto (WP31): sumar o quitar un rol.
 *
 * `{ action: 'agregar' | 'quitar', initiativeId, wallet, rol, vinculo? }`
 *
 * Quién: founder y supervisores (los cuatro roles) y quien estructura el proyecto
 * (solo `ejecuta` y `vende`). Nadie cambia sus propios roles. Sumar a un externo exige
 * que haya firmado el acuerdo de contribución. Las reglas viven en lib/team.ts; aquí
 * solo se valida e invoca, con la puerta `equipoActor` (la base, nunca la cookie).
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { agregarMiembro, miembroSchema, quitarMiembro, TeamError } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para gestionar el proyecto." }, { status: 401 });
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) return NextResponse.json({ error: "No tienes acceso al tablero del equipo." }, { status: 403 });
  if (!rateLimit(`equipo:miembros:${actor.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = miembroSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Entrada inválida." }, { status: 400 });
  }
  const { action, initiativeId, wallet, rol, vinculo } = parsed.data;

  try {
    if (action === "agregar") {
      const id = agregarMiembro(db, actor, { initiativeId, wallet, rol, vinculo });
      return NextResponse.json({ ok: true, id });
    }
    quitarMiembro(db, actor, { initiativeId, wallet, rol });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo actualizar el proyecto." }, { status: 500 });
  }
}
