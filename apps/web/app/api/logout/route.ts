import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { esDemoSegunBase } from "@/lib/salir";

export const dynamic = "force-dynamic";

/**
 * Cerrar sesión. Existía `clearSessionCookie` pero nada la llamaba: sin esta
 * ruta, quien entraba en un teléfono prestado o en un computador del laboratorio
 * dejaba la sesión abierta hasta 24 horas y no tenía forma de salir.
 *
 * Antes de cerrar, lee de la BASE si la cuenta que sale es de demostración y lo
 * responde (`{ ok, esDemo, wallet }`): `SalirButton` solo borra la llave del navegador
 * con esa confirmación (lib/salir.ts). La cookie no sirve para eso: conserva `isDemo`
 * hasta 24 h aunque la cuenta ya sea real. Si la base no responde, `esDemo` es false y
 * la llave se queda; la sesión se cierra igual.
 */
export async function POST() {
  const session = await getSession();
  let esDemo = false;
  if (session) {
    try {
      esDemo = esDemoSegunBase(getDb(), session.wallet);
    } catch (e) {
      console.error("[logout] cuenta de demostración", e);
    }
  }
  clearSessionCookie();
  return NextResponse.json({ ok: true, esDemo, wallet: session?.wallet ?? null });
}
