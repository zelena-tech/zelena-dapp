/**
 * Acciones sobre una asignación (WP14 + WP31).
 *
 *  - POST: acciones de un click (tomar, empezar, a revisión, aprobar, pedir ajustes,
 *    bloquear con motivo OBLIGATORIO y desbloquear).
 *  - PATCH: editar o reasignar (`EditarAsignacionInput`): el dueño cambia el contexto;
 *    quien planifica el proyecto, el resto. Una entrega en revisión no se reasigna ni
 *    se replanifica (409).
 *
 * El handler solo valida e invoca: la autorización (cuatro ojos, permisos por
 * proyecto) y el cálculo del estado viven en lib/team.ts + lib/team-state-machine.ts.
 * La puerta es `equipoActor`, que lee la base: NUNCA los claims de la cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import {
  applyAssignmentAction,
  assignmentActionSchema,
  editarAsignacion,
  editarAsignacionSchema,
  TeamError,
} from "@/lib/team";
import { BlockReasonRequiredError, InvalidTeamTransitionError } from "@/lib/team-state-machine";

export const dynamic = "force-dynamic";

function errorDe(e: unknown, porDefecto: string): NextResponse {
  if (e instanceof BlockReasonRequiredError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof InvalidTeamTransitionError) return NextResponse.json({ error: e.message }, { status: 409 });
  if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: porDefecto }, { status: 500 });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Entra para mover tus asignaciones." }, { status: 401 });
  }
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) return NextResponse.json({ error: "No tienes acceso al tablero del equipo." }, { status: 403 });
  if (!rateLimit(`equipo:accion:${actor.wallet}:${clientIp(req.headers)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = assignmentActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

  try {
    const row = applyAssignmentAction(db, {
      assignmentId: parsed.data.assignmentId,
      action: parsed.data.action,
      reason: parsed.data.reason ?? null,
      actor,
    });
    return NextResponse.json({ ok: true, status: row.status, blockedReason: row.blocked_reason });
  } catch (e) {
    return errorDe(e, "No se pudo actualizar la asignación.");
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para editar tus entregas." }, { status: 401 });
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) return NextResponse.json({ error: "No tienes acceso al tablero del equipo." }, { status: 403 });
  if (!rateLimit(`equipo:editar:${actor.wallet}:${clientIp(req.headers)}`, 60, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = editarAsignacionSchema.safeParse(body);
  if (!parsed.success) {
    const primero = parsed.error.issues[0]?.message ?? "Entrada inválida.";
    return NextResponse.json({ error: primero }, { status: 400 });
  }

  try {
    const row = editarAsignacion(db, actor, parsed.data);
    return NextResponse.json({ ok: true, status: row.status, ownerWallet: row.owner_wallet });
  } catch (e) {
    return errorDe(e, "No se pudo editar la entrega.");
  }
}
