import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { leadSchema } from "@/lib/validation";
import { MENSAJE_AVISO_CAMBIO, guardarSolicitudConAutorizacion, versionAceptadaEsVigente } from "@/lib/consentimiento";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Público: quien escribe es un prospecto sin cuenta ni wallet. Por eso el
// límite va por IP y no por sesión. Cinco envíos cada diez minutos alcanzan de
// sobra para una persona y cortan un script.
//
// Ley 1581 (hallazgo A3): sin `acepto: true` el esquema responde 400 y no se guarda
// nada; con ella, la solicitud y la prueba de la autorización (versión y huella del
// aviso, fecha UTC) se guardan juntas en `leads` + `lead_consents`.
export async function POST(req: NextRequest) {
  if (!rateLimit(`lead:${clientIp(req.headers)}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { error: "Demasiados envíos seguidos. Intenta de nuevo en unos minutos." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  // Sin esto, zod responde en ingles y con sus mensajes internos.
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Revisa los datos del formulario." }, { status: 400 });
  }
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revisa los datos del formulario." },
      { status: 400 }
    );
  }

  const { nombre, email, empresa, interes, mensaje, sitio, aviso } = parsed.data;

  // Campo trampa lleno: es un bot. Respondemos ok para no darle una señal que
  // le sirva para ajustar, y no guardamos nada.
  if (sitio) return NextResponse.json({ ok: true });

  // La página se cargó con otra versión del aviso: lo aceptado no es lo vigente.
  if (!versionAceptadaEsVigente(aviso)) {
    return NextResponse.json({ error: MENSAJE_AVISO_CAMBIO }, { status: 409 });
  }

  guardarSolicitudConAutorizacion(
    getDb(),
    { nombre, email, empresa: empresa || null, interes, mensaje: mensaje || null },
    "empresas/contacto"
  );

  return NextResponse.json({ ok: true });
}
