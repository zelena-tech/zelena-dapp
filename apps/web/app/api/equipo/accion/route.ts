/**
 * WP14 · Acciones sobre asignaciones y check-in diario.
 * El handler NO decide transiciones: valida sesión, delega en la lógica pura
 * y traduce los errores. Toda la regla vive en assignment-state.ts.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { applyAction, upsertCheckin, actorDesdeWallet, AssignmentError } from "@/lib/assignments";
import {
  InvalidAssignmentTransitionError,
  AssignmentPermissionError,
  ASSIGNMENT_ACTIONS,
} from "@/lib/assignment-state";
import { FOUNDER_WALLET } from "@/lib/config";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });

  const db = getDb();

  if (body.action === "checkin") {
    const day = String(body.day ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
    }
    upsertCheckin(db, {
      wallet: session.wallet,
      day,
      done: String(body.done ?? ""),
      doing: String(body.doing ?? ""),
      blocked: body.blocked ? String(body.blocked) : undefined,
    });
    return NextResponse.json({ ok: true });
  }

  const action = String(body.action ?? "");
  if (!(ASSIGNMENT_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  }
  const assignmentId = Number(body.assignmentId);
  if (!Number.isInteger(assignmentId)) {
    return NextResponse.json({ error: "Asignación inválida." }, { status: 400 });
  }

  try {
    const r = applyAction(db, {
      assignmentId,
      action: action as never,
      actor: actorDesdeWallet(db, session.wallet, session.wallet === FOUNDER_WALLET),
      toWallet: body.toWallet ? String(body.toWallet) : undefined,
      reason: body.reason ? String(body.reason) : undefined,
    });
    return NextResponse.json({ ok: true, status: r.status });
  } catch (e) {
    // 403 y no 400: no es que la petición esté mal formada, es que no tiene derecho.
    if (e instanceof AssignmentPermissionError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof InvalidAssignmentTransitionError || e instanceof AssignmentError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
