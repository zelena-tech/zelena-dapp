/**
 * WP13 · Estado de la puerta corporativa, para que /entrar sepa si dibujar el botón
 * "Continuar con Microsoft". Público y SIN secretos: solo booleanos y, fuera de
 * producción, los NOMBRES de las variables que faltan (nunca sus valores).
 */
import { NextResponse } from "next/server";
import { entraStatus } from "@/lib/config";
import { ENTRA_PROVIDER_ID } from "@/lib/entra";

export const dynamic = "force-dynamic";

export async function GET() {
  const { enabled, configured, missing } = entraStatus();
  return NextResponse.json({
    provider: ENTRA_PROVIDER_ID,
    // La puerta se ofrece solo si está encendida Y configurada: un botón que lleva
    // a un 503 es peor que no tener botón.
    available: enabled && configured,
    enabled,
    configured,
    ...(process.env.NODE_ENV === "production" ? {} : { missing }),
  });
}
