import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { avisoEncuentrosSchema } from "@/lib/validation";
import { MENSAJE_AVISO_CAMBIO, guardarSolicitudConAutorizacion, versionAceptadaEsVigente } from "@/lib/consentimiento";
import { INTERES_ENCUENTROS } from "@/lib/servicios";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Público, como /api/empresas/contacto: quien deja su correo todavía no tiene
// cuenta. Mismo límite por IP, mismo trato al campo trampa y la misma autorización
// de datos obligatoria (Ley 1581, hallazgo A3): sin ella, 400 y nada guardado.
export async function POST(req: NextRequest) {
  if (!rateLimit(`aviso:${clientIp(req.headers)}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Demasiados envíos seguidos. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Revisa los datos del formulario." }, { status: 400 });
  }
  const parsed = avisoEncuentrosSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario." },
      { status: 400 }
    );
  }

  const { nombre, email, ciudad, sitio, aviso } = parsed.data;
  if (sitio) return NextResponse.json({ ok: true });

  if (!versionAceptadaEsVigente(aviso)) {
    return NextResponse.json({ error: MENSAJE_AVISO_CAMBIO }, { status: 409 });
  }

  guardarSolicitudConAutorizacion(
    getDb(),
    { nombre, email, empresa: null, interes: INTERES_ENCUENTROS, mensaje: ciudad ? `Ciudad: ${ciudad}` : null },
    "encuentros"
  );

  return NextResponse.json({ ok: true });
}
