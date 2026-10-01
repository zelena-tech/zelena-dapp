/**
 * WP14 · Crear una asignación desde la interfaz.
 *
 * Por qué existe: `createAssignment` estaba implementada y probada desde hacía
 * semanas, pero NINGUNA pantalla la llamaba — el tablero solo podía poblarse
 * desde la semilla. Sin esta ruta el seguimiento de tareas no existe en la
 * práctica, por buena que sea la máquina de estados que hay debajo.
 *
 * El handler no decide reglas: valida la sesión, comprueba que quien pide
 * supervisa, y delega en la lógica pura (ver CLAUDE.md).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createAssignment, actorDesdeWallet, AssignmentError, PRIORITIES, SIZES } from "@/lib/assignments";
import { FOUNDER_WALLET } from "@/lib/config";

export const dynamic = "force-dynamic";

const esquema = z.object({
  title: z.string().trim().min(3, "El título necesita al menos 3 caracteres.").max(160),
  description: z.string().trim().max(2000).optional(),
  clientId: z.number().int().positive().nullable().optional(),
  initiativeId: z.number().int().positive().nullable().optional(),
  ownerWallet: z.string().trim().min(10).max(80).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  size: z.enum(SIZES).optional(),
  // Fecha límite en el mismo formato que guarda la columna: YYYY-MM-DD.
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha límite debe ser YYYY-MM-DD.")
    .nullable()
    .optional(),
  acceptanceCriteria: z.string().trim().max(2000).nullable().optional(),
  specUrl: z.string().trim().url("El enlace debe ser una URL.").max(400).nullable().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const db = getDb();
  const actor = actorDesdeWallet(db, session.wallet, session.wallet === FOUNDER_WALLET);
  if (!actor.isFounder && !actor.isSupervisor) {
    return NextResponse.json({ error: "Crear trabajo requiere rol de supervisión." }, { status: 403 });
  }

  const cuerpo = await req.json().catch(() => null);
  const parsed = esquema.safeParse(cuerpo);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Entrada inválida." }, { status: 400 });
  }

  try {
    const id = createAssignment(db, { ...parsed.data, createdBy: session.wallet });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof AssignmentError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: "No se pudo crear la asignación." }, { status: 400 });
  }
}
