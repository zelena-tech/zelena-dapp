import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { adminActor } from "@/lib/authz";
import { anchorRunSecret } from "@/lib/config";
import { anclarPendientes, autorizarAnclaje, contarPendientes } from "@/lib/anchor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dispara una pasada de anclaje en testnet. Dos formas de autorizarla:
 *  - sesión con rol founder leído de la base, o
 *  - cabecera `x-anchor-secret` con el valor de ANCHOR_RUN_SECRET (32 caracteres o más).
 *    La manda el workflow programado `.github/workflows/anclaje.yml` cada 15 minutos, así
 *    que las firmas del acuerdo, las raíces de cada época y las huellas de los ritos se
 *    anclan solas. La comparación es en tiempo constante (`autorizarAnclaje`).
 *
 * Sin esta ruta la cola de anclaje nunca se procesaba en el despliegue.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  if (autorizarAnclaje(req.headers.get("x-anchor-secret"), anchorRunSecret()) === "ok") return true;
  const session = await getSession();
  return adminActor(session, getDb()) !== null;
}

export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return NextResponse.json({ pendientes: contarPendientes(getDb()) });
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    // `?limite=` entero de 1 a 20; cualquier otra cosa, 8 (antes `?limite=abc` daba 500).
    const pedido = Number(new URL(req.url).searchParams.get("limite") ?? 8);
    const limite = Number.isInteger(pedido) ? Math.min(Math.max(pedido, 1), 20) : 8;
    // Tope de intentos y reserva de filas en lib/anchor.ts: dos corridas a la vez no anclan dos veces.
    const res = await anclarPendientes(getDb(), limite);
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: String((e as { message?: string })?.message ?? e) }, { status: 500 });
  }
}
