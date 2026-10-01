import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { timingSafeEqual } from "node:crypto";
import { adminActor } from "@/lib/authz";
import { anclarPendientes, contarPendientes } from "@/lib/anchor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dispara una pasada de anclaje en testnet. Dos formas de autorizarla:
 *  - sesión con rol founder leído de la base (botón en /admin), o
 *  - cabecera `x-anchor-secret` con el valor de ANCHOR_RUN_SECRET (para un cron
 *    externo, sin necesidad de sesión).
 *
 * Sin esta ruta la cola de anclaje nunca se procesaba en el despliegue.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  const secretoEsperado = process.env.ANCHOR_RUN_SECRET;
  const recibido = req.headers.get("x-anchor-secret");
  if (secretoEsperado && recibido && igualEnTiempoConstante(recibido, secretoEsperado)) return true;
  const session = await getSession();
  return adminActor(session, getDb()) !== null;
}

function igualEnTiempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return NextResponse.json({ pendientes: contarPendientes(getDb()) });
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    const limite = Number(new URL(req.url).searchParams.get("limite") ?? 8);
    const res = await anclarPendientes(getDb(), Math.min(Math.max(limite, 1), 20));
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String((e as { message?: string })?.message ?? e) }, { status: 500 });
  }
}
