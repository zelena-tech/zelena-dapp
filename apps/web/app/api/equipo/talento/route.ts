/**
 * `POST /api/equipo/talento` (WP31-A2, spec §7) — cambios de talento del founder:
 *   { action: 'rol', wallet, role }                   core ↔ contributor
 *   { action: 'supervisor', wallet, isSupervisor }    dar / quitar supervisión
 *   { action: 'vincular', slug, wallet, simular?, conservarSellado? }
 *                                                     fila del roster → cuenta real
 *
 * Puerta propia (el layout no es la puerta): `adminActor` lee el rol de la base,
 * nunca de la cookie, y `cuentaActiva` exige que la cuenta siga activa (`adminActor`
 * no mira el estado). Las reglas (nunca sobre sí mismo ni sobre un founder, la fila de
 * otra persona nunca a una cuenta del founder, 409 si alguien perdería el acceso a sus
 * piezas, historia sellada…) viven en `lib/talento.ts`; aquí solo se valida, se
 * autoriza y se invoca. Ante historia sellada la respuesta dice `historiaSellada:
 * true`, para que la UI ofrezca vincular sin mover lo ya cerrado.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { adminActor } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { TeamError } from "@/lib/team";
import {
  HISTORIA_SELLADA,
  cambiarRol,
  cambiarSupervisor,
  cuentaActiva,
  describirVinculo,
  talentoAccionSchema,
  vincularPrincipal,
} from "@/lib/talento";

export const dynamic = "force-dynamic";

/** Estado HTTP de un error de reglas (`TeamError`), o null si es otro error. */
function estadoDe(e: unknown): number | null {
  if (e instanceof TeamError) return e.status;
  if (e && typeof e === "object" && (e as { name?: string }).name === "TeamError") {
    const s = (e as { status?: unknown }).status;
    return typeof s === "number" ? s : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para gestionar el talento." }, { status: 401 });

  const db = getDb();
  const actor = adminActor(session, db);
  if (!actor || !cuentaActiva(db, actor.wallet)) {
    return NextResponse.json(
      { error: "Los cambios de rol, supervisión y vínculo los hace el founder." },
      { status: 403 }
    );
  }
  if (!rateLimit(`equipo:talento:${actor.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = talentoAccionSchema.safeParse(body);
  if (!parsed.success) {
    const primero = parsed.error.issues[0]?.message ?? "Entrada inválida.";
    return NextResponse.json({ error: primero }, { status: 400 });
  }

  try {
    const a = parsed.data;
    if (a.action === "rol") {
      cambiarRol(db, actor, { wallet: a.wallet, role: a.role });
      return NextResponse.json({ ok: true });
    }
    if (a.action === "supervisor") {
      cambiarSupervisor(db, actor, { wallet: a.wallet, isSupervisor: a.isSupervisor });
      return NextResponse.json({ ok: true });
    }
    const r = vincularPrincipal(db, actor, {
      slug: a.slug,
      wallet: a.wallet,
      simular: a.simular,
      conservarSellado: a.conservarSellado,
    });
    return NextResponse.json({ ok: true, ...r, resumen: describirVinculo(r) });
  } catch (e) {
    const status = estadoDe(e);
    if (status !== null) {
      const mensaje = (e as Error).message;
      return NextResponse.json(
        mensaje === HISTORIA_SELLADA ? { error: mensaje, historiaSellada: true } : { error: mensaje },
        { status }
      );
    }
    return NextResponse.json({ error: "No se pudo guardar el cambio." }, { status: 500 });
  }
}
