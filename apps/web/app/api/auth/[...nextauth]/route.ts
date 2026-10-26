/**
 * WP13 · Handler de NextAuth (App Router de Next 14).
 *
 * CRITERIO 4 — con `AUTH_ENTRA_ENABLED` apagado (el default) NextAuth no se
 * inicializa: la ruta responde 503 y el flujo de invitación + wallet es el único
 * camino, exactamente como antes de WP13. La construcción es PEREZOSA (dentro del
 * handler, no en el módulo) para que ni el build ni un import accidental levanten
 * un provider sin credenciales.
 */
import { NextRequest, NextResponse } from "next/server";
import NextAuth from "next-auth";
import { entraAuthOptions } from "../entra-options";
import { entraStatus } from "@/lib/config";

export const dynamic = "force-dynamic";

function disabled(): NextResponse {
  const { enabled } = entraStatus();
  return NextResponse.json(
    {
      error: enabled
        ? "El acceso con Microsoft está encendido pero falta configuración en este entorno."
        : "El acceso con Microsoft no está activo. Entra con tu código de invitación.",
    },
    { status: 503 }
  );
}

async function handler(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  const options = entraAuthOptions();
  if (!options) return disabled();
  // La firma de NextAuth v4 en App Router: (req, ctx) → Response.
  return NextAuth(options)(req as never, ctx as never) as Promise<Response>;
}

export { handler as GET, handler as POST };
