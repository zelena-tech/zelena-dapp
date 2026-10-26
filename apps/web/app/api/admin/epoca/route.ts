/**
 * Épocas desde /admin (WP31-D corte 2, spec §5.B.5 y §7). Solo el founder.
 *
 *  - GET  → `EstadoCierreEpoca`: qué época está abierta y qué falta para cerrarla.
 *  - POST → `{ action: 'cerrar', justificacion, nombreSiguiente? }`: cierra la época
 *           actual y abre la siguiente en UNA operación (`cerrarYAbrirEpoca`): raíz
 *           Merkle de lo emitido, encolada en `anchor_queue` (kind `merkle_root`) para
 *           anclarla en la red de pruebas, acta en el decision log y época nueva con
 *           los presupuestos de su genoma.
 *         · `{ action: 'abrir', justificacion, nombre? }`: abre una época solo si no
 *           hay ninguna abierta (`abrirEpoca`).
 *
 * La puerta es el ROL leído de la base (`adminActor`), nunca la cookie. Las reglas
 * (precondiciones, justificación, nombre) viven en `lib/epocas.ts`; aquí solo se
 * valida la forma, se limita la tasa y se traduce `EpocaError` a su estado y su copy.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { adminActor } from "@/lib/authz";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { EpocaError, SOLO_FOUNDER, abrirEpoca, cerrarYAbrirEpoca, estadoCierreEpoca } from "@/lib/epocas";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function responder(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

// La longitud mínima de la justificación y la máxima del nombre las decide
// `epocas.ts` (con su copy); aquí solo se corta lo absurdo.
const accionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cerrar"),
    justificacion: z.string().max(2000),
    nombreSiguiente: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("abrir"),
    justificacion: z.string().max(2000),
    nombre: z.string().max(200).optional(),
  }),
]);

export async function GET() {
  const session = await getSession();
  if (!session) return responder({ error: "Entra para administrar." }, 401);
  const db = getDb();
  if (!adminActor(session, db)) return responder({ error: SOLO_FOUNDER }, 403);
  return responder({ ok: true, ...estadoCierreEpoca(db) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return responder({ error: "Entra para administrar." }, 401);
  if (!rateLimit(`admin:epoca:${session.wallet}:${clientIp(req.headers)}`, 10, 60_000)) {
    return responder({ error: "Demasiadas solicitudes. Espera un momento." }, 429);
  }

  const db = getDb();
  const actor = adminActor(session, db);
  if (!actor) return responder({ error: SOLO_FOUNDER }, 403);

  const parsed = accionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return responder({ error: "Entrada inválida." }, 400);
  const a = parsed.data;

  try {
    if (a.action === "cerrar") {
      const r = cerrarYAbrirEpoca(db, actor, { justificacion: a.justificacion, nombreSiguiente: a.nombreSiguiente });
      return responder({ ok: true, ...r });
    }
    const r = abrirEpoca(db, actor, { justificacion: a.justificacion, nombre: a.nombre });
    return responder({ ok: true, ...r });
  } catch (e) {
    if (e instanceof EpocaError) return responder({ error: e.message, faltantes: e.faltantes }, e.status);
    console.error("[admin] épocas", e);
    return responder({ error: "No se pudo completar la operación. No se cambió nada." }, 500);
  }
}
