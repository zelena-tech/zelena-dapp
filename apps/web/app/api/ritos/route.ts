/**
 * Gestión de una sesión de rito (WP31-D): preparar y asignar (founder o
 * supervisor); abrir y cerrar (además, quien presenta esa sesión).
 *
 * La autorización la hace `lib/ritos.ts` con el actor leído de la BASE
 * (`actorDeRitos`), nunca de la cookie. Respuestas sin caché: el estado de un rito
 * cambia minuto a minuto.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { RitoError, abrirRito, actorDeRitos, asignarRolesRito, cerrarRito, prepararRito } from "@/lib/ritos";
import { RITE_KINDS } from "@/lib/ritos-labels";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function responder(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const sesion = z.number().int().positive();
const persona = z.union([z.string().trim().min(1).max(120), z.null()]).optional();

const accionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preparar"),
    kind: z.enum(RITE_KINDS),
    scheduledFor: z.string().trim().min(10).max(40),
    lugar: z.string().max(200).nullable().optional(),
    joinUrl: z.string().max(600).nullable().optional(),
  }),
  z.object({ action: z.literal("asignar"), sessionId: sesion, hostWallet: persona, recorderWallet: persona }),
  z.object({ action: z.literal("abrir"), sessionId: sesion }),
  z.object({
    action: z.literal("cerrar"),
    sessionId: sesion,
    summary: z.string().max(1200).optional(),
    notesUrl: z.string().max(600).optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return responder({ error: "Entra para gestionar un rito." }, 401);
  if (!rateLimit(`ritos:gestion:${session.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return responder({ error: "Demasiadas solicitudes. Espera un momento." }, 429);
  }

  const db = getDb();
  const actor = actorDeRitos(db, session.wallet);
  if (!actor) return responder({ error: "Tu cuenta no puede gestionar ritos." }, 403);

  const parsed = accionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return responder({ error: "Entrada inválida." }, 400);
  const a = parsed.data;

  try {
    const row =
      a.action === "preparar"
        ? prepararRito(db, actor, { kind: a.kind, scheduledFor: a.scheduledFor, lugar: a.lugar, joinUrl: a.joinUrl })
        : a.action === "asignar"
        ? asignarRolesRito(db, actor, { sessionId: a.sessionId, hostWallet: a.hostWallet, recorderWallet: a.recorderWallet })
        : a.action === "abrir"
        ? abrirRito(db, actor, a.sessionId)
        : cerrarRito(db, actor, { sessionId: a.sessionId, summary: a.summary, notesUrl: a.notesUrl });
    // Solo lo que la UI necesita: ni wallets ni la lista de asistentes.
    return responder({ ok: true, id: row.id, state: row.state });
  } catch (e) {
    if (e instanceof RitoError) return responder({ error: e.message }, e.status);
    console.error("[ritos] gestión", e);
    return responder({ error: "No se pudo completar la acción." }, 500);
  }
}
