/**
 * Acciones de un click sobre una asignación (WP14): empezar, a revisión, aprobar,
 * bloquear (con motivo OBLIGATORIO) y desbloquear.
 *
 * El handler solo invoca: la autorización y el cálculo del estado viven en
 * lib/team.ts + lib/team-state-machine.ts (función pura). Aquí no hay reglas.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { actorFromSession, applyAssignmentAction, assignmentActionSchema, TeamError } from "@/lib/team";
import { BlockReasonRequiredError, InvalidTeamTransitionError } from "@/lib/team-state-machine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Entra para mover tus asignaciones." }, { status: 401 });
  }
  if (!rateLimit(`equipo:accion:${session.wallet}:${clientIp(req.headers)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = assignmentActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

  const db = getDb();
  const actor = actorFromSession(db, session);
  try {
    const row = applyAssignmentAction(db, {
      assignmentId: parsed.data.assignmentId,
      action: parsed.data.action,
      reason: parsed.data.reason ?? null,
      actor,
    });
    return NextResponse.json({ ok: true, status: row.status, blockedReason: row.blocked_reason });
  } catch (e) {
    if (e instanceof BlockReasonRequiredError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof InvalidTeamTransitionError) return NextResponse.json({ error: e.message }, { status: 409 });
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo actualizar la asignación." }, { status: 500 });
  }
}
