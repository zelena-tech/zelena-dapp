/**
 * Registrar asistencia a un rito con el código rotativo (WP31-D).
 *
 * Límites (spec §5.D): 10 intentos por minuto por persona y 20 códigos fallidos por
 * (rito, persona); pasado eso, 429 con el copy de §8.4. Las reglas (rito abierto y
 * en su ventana, una vez por persona, sin cuentas demo ni `pending:`, acuerdo
 * firmado, sync solo del equipo) viven en `lib/ritos.ts`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import {
  COPY_ASISTENCIA,
  LIMITES_ASISTENCIA,
  RitoError,
  anotarFallo,
  demasiadosFallos,
  registrarAsistencia,
} from "@/lib/ritos";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function responder(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const asistirSchema = z.object({
  sessionId: z.number().int().positive(),
  codigo: z.string().max(32),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return responder({ error: COPY_ASISTENCIA.sinSesion }, 401);
  if (!rateLimit(`ritos:asistir:${session.wallet}`, LIMITES_ASISTENCIA.intentosPorMinuto, 60_000)) {
    return responder({ error: COPY_ASISTENCIA.demasiados }, 429);
  }

  const parsed = asistirSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return responder({ error: "Entrada inválida." }, 400);
  const { sessionId, codigo } = parsed.data;
  if (demasiadosFallos(sessionId, session.wallet)) return responder({ error: COPY_ASISTENCIA.demasiados }, 429);

  try {
    const r = registrarAsistencia(getDb(), session.wallet, { sessionId, codigo });
    return responder({
      ok: true,
      ...r,
      mensaje: r.yaEstaba ? COPY_ASISTENCIA.yaEstaba : COPY_ASISTENCIA.exito,
    });
  } catch (e) {
    if (e instanceof RitoError) {
      if (e.motivo === "codigo") anotarFallo(sessionId, session.wallet);
      return responder({ error: e.message }, e.status);
    }
    console.error("[ritos] asistencia", e);
    return responder({ error: "No se pudo registrar la asistencia." }, 500);
  }
}
