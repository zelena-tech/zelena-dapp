/**
 * WP20 · Importación del grafo de operación de un cliente.
 *
 * Recibe el grafo.json que produce `construir_grafo.py` del repositorio
 * PRIVADO zelena-ops y reconstruye la proyección de solo lectura.
 * Solo el founder puede importar: es la operación que cambia lo que todo el
 * equipo cree que sabe de un cliente.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getClientForActor, type Actor } from "@/lib/clients";
import { importGraph, GraphImportError, type GraphJson } from "@/lib/client-graph";
import { FOUNDER_WALLET } from "@/lib/config";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (session.wallet !== FOUNDER_WALLET) {
    return NextResponse.json({ error: "Solo el founder importa grafos." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { slug?: string; grafo?: GraphJson } | null;
  if (!body?.slug || !body.grafo) {
    return NextResponse.json({ error: "Faltan 'slug' y 'grafo'." }, { status: 400 });
  }

  const actor: Actor = { wallet: session.wallet, isFounder: true };
  const cliente = getClientForActor(getDb(), body.slug, actor);
  if (!cliente) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  try {
    const r = importGraph(getDb(), cliente.id, body.grafo, session.wallet);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof GraphImportError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
}
