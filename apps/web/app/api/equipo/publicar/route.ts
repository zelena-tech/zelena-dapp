/**
 * Publicar una entrega en el Ágora (WP31-C2, spec §5.C.4 y §7).
 *
 *  - POST `publicarSchema` → `{ ok, projectId }`. Founder o supervisor.
 *
 * El handler solo valida e invoca: las reglas viven en lib/agora-publicar.ts. La puerta
 * es `equipoActor` (lee la base, nunca la cookie) más `puedeVerTodoElEquipo`.
 * Nunca toca dinero real: los pagos del Ágora corren en la red de pruebas.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { puedeVerTodoElEquipo } from "@/lib/roles";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { TeamError } from "@/lib/team";
import { COPY_PUBLICAR, publicarEnAgora, publicarSchema } from "@/lib/agora-publicar";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para publicar en el Ágora." }, { status: 401 });
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) return NextResponse.json({ error: "No tienes acceso al tablero del equipo." }, { status: 403 });
  if (!puedeVerTodoElEquipo({ role: actor.role, isSupervisor: actor.isSupervisor })) {
    return NextResponse.json({ error: COPY_PUBLICAR.sinPermiso }, { status: 403 });
  }
  if (!rateLimit(`equipo:publicar:${actor.wallet}:${clientIp(req.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = publicarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Entrada inválida." }, { status: 400 });
  }
  try {
    const { projectId } = publicarEnAgora(db, actor, parsed.data);
    return NextResponse.json({ ok: true, projectId });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo publicar en el Ágora." }, { status: 500 });
  }
}
