/**
 * Código de asistencia vigente de una sesión (WP31-D). Solo para quien presenta
 * (anfitrión, founder o supervisor). `Cache-Control: no-store`: el código rota y
 * ningún intermediario debe guardarlo. Devuelve el conteo, nunca la lista.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { RitoError, actorDeRitos, codigoActual } from "@/lib/ritos";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function responder(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return responder({ error: "Entra para ver el código." }, 401);
  // El componente refresca cada 15 s; esto deja holgura sin permitir un barrido.
  if (!rateLimit(`ritos:codigo:${session.wallet}`, 30, 60_000)) {
    return responder({ error: "Demasiadas solicitudes. Espera un momento." }, 429);
  }

  const id = Number(req.nextUrl.searchParams.get("sesion"));
  if (!Number.isInteger(id) || id <= 0) return responder({ error: "Falta el rito." }, 400);

  const db = getDb();
  const actor = actorDeRitos(db, session.wallet);
  if (!actor) return responder({ error: "El código lo ve quien presenta el rito." }, 403);

  try {
    const { codigo, expiraEnS, asistentes } = codigoActual(db, actor, id);
    return responder({ codigo, expiraEnS, asistentes });
  } catch (e) {
    if (e instanceof RitoError) return responder({ error: e.message }, e.status);
    console.error("[ritos] código", e);
    return responder({ error: "No se pudo traer el código." }, 500);
  }
}
