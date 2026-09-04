import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Cerrar sesión. Existía `clearSessionCookie` pero nada la llamaba: sin esta
 * ruta, quien entraba en un teléfono prestado o en un computador del laboratorio
 * dejaba la sesión abierta hasta 24 horas y no tenía forma de salir.
 */
export async function POST() {
  clearSessionCookie();
  return NextResponse.json({ ok: true });
}
