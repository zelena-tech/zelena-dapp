import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FOUNDER_WALLET } from "@/lib/config";
import { anclarPendientes, contarPendientes } from "@/lib/anchor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dispara una pasada de anclaje en testnet. Dos formas de autorizarla:
 *  - sesión del fundador (botón en /admin), o
 *  - cabecera `x-anchor-secret` con el valor de ANCHOR_RUN_SECRET (para un cron
 *    externo, sin necesidad de sesión).
 *
 * Sin esta ruta la cola de anclaje nunca se procesaba en el despliegue.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  const secretoEsperado = process.env.ANCHOR_RUN_SECRET;
  const recibido = req.headers.get("x-anchor-secret");
  if (secretoEsperado && recibido && recibido === secretoEsperado) return true;
  const session = await getSession();
  return session?.wallet === FOUNDER_WALLET;
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
