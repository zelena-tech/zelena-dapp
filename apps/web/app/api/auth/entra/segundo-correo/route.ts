/**
 * WP13 · Segundo correo personal (doc 15 §2).
 *
 * Obligatorio para el core, pero NO bloquea el trabajo diario. Por eso vive en su
 * propio endpoint y no en el login — la persona entra, ve su día, y vincula el correo
 * cuando puede. Es un correo de CONTACTO: ningún login lo lee.
 *
 * Con la puerta de Microsoft apagada (`AUTH_ENTRA_ENABLED`) no se pide: el banner
 * habla del acceso corporativo, y ese acceso no se ofrece.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { corporateDomain, isEntraEnabled } from "@/lib/config";
import { hasRecoveryEmail, linkRecoveryEmail, listUserEmails, payoutBlockers } from "@/lib/entra";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ email: z.string().min(3).max(120) });

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const db = getDb();
  return NextResponse.json({
    needsRecoveryEmail: isEntraEnabled() && !hasRecoveryEmail(db, session.wallet),
    emails: listUserEmails(db, session.wallet),
    payoutBlockers: payoutBlockers(db, session.wallet),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const ip = clientIp(req.headers);
  if (!rateLimit(`segundo-correo:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });

  // Solo se puede vincular un correo AL PROPIO registro: el wallet sale de la
  // cookie firmada, nunca del body.
  const result = linkRecoveryEmail(getDb(), session.wallet, parsed.data.email, corporateDomain());
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
  return NextResponse.json({ ok: true, email: result.email });
}
