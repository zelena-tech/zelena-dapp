import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { leadSchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Público: quien escribe es un prospecto sin cuenta ni wallet. Por eso el
// límite va por IP y no por sesión. Cinco envíos cada diez minutos alcanzan de
// sobra para una persona y cortan un script.
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

  const { nombre, email, empresa, interes, mensaje, sitio } = parsed.data;

  // Campo trampa lleno: es un bot. Respondemos ok para no darle una señal que
  // le sirva para ajustar, y no guardamos nada.
  if (sitio) return NextResponse.json({ ok: true });

  getDb()
    .prepare(`INSERT INTO leads (nombre, email, empresa, interes, mensaje) VALUES (?, ?, ?, ?, ?)`)
    .run(nombre, email, empresa || null, interes, mensaje || null);

  return NextResponse.json({ ok: true });
}
