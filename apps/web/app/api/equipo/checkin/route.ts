/**
 * Check-in diario async (rito 1): hecho / haciendo / bloqueado. Uno por persona por
 * día, editable el mismo día — el candado real es UNIQUE(wallet, day) en el esquema.
 *
 * No se registra hora de envío ni nada parecido a presencia: el seguimiento es por
 * objetivos, no por horas (NO-alcance explícito de WP19 y regla del doc 16).
 *
 * WP31: el check-in es del equipo interno (alcance `equipo`). Quien trabaja por
 * proyecto no lo ve ni lo envía: no se mide jornada.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { checkinSchema, TeamError, upsertCheckin } from "@/lib/team";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Entra para registrar tu check-in." }, { status: 401 });
  }
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor || actor.alcance !== "equipo") {
    return NextResponse.json({ error: "El check-in diario es del equipo interno." }, { status: 403 });
  }
  if (!rateLimit(`equipo:checkin:${actor.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = checkinSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

  try {
    const row = upsertCheckin(db, actor.wallet, parsed.data);
    return NextResponse.json({ ok: true, day: row.day });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo guardar el check-in." }, { status: 500 });
  }
}
