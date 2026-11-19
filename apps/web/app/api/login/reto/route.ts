import { NextRequest, NextResponse } from "next/server";
import { almacenRetos } from "@/lib/login-reto";
import { sitioDeEntrada } from "@/lib/onboard";
import { loginSigningPayload } from "@/lib/login-signing";
import { loginRetoSchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };

/**
 * `GET` o `POST /api/login/reto` — emite un reto de entrada de un solo uso (lib/login-reto.ts).
 *
 * Responde `{ nonce, sitio, mensaje, expiraEn }`: la wallet firma `mensaje`
 * (`zelena-login-testnet-v1:<sitio>:<nonce>`, con el sitio para que la persona vea en su
 * wallet dónde entra) y lo manda a `POST /api/login` con el `nonce`.
 * Con `POST { wallet }` el reto queda atado a esa wallet. El reto no se guarda en claro
 * (solo su sha256), caduca en minutos y se gasta en el primer intento.
 *
 * No toca la base ni da información de nadie: un reto se le da a cualquiera, y solo
 * sirve a quien tenga la llave privada de una wallet registrada.
 */
function emitir(req: NextRequest, wallet: string | null): NextResponse {
  if (!rateLimit(`login-reto:${clientIp(req.headers)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos." }, { status: 429, headers: SIN_CACHE });
  }
  const reto = almacenRetos().emitir(wallet);
  const sitio = sitioDeEntrada();
  return NextResponse.json(
    {
      nonce: reto.nonce,
      sitio,
      mensaje: loginSigningPayload(sitio, reto.nonce),
      expiraEn: new Date(reto.expiraEn).toISOString(),
    },
    { headers: SIN_CACHE }
  );
}

export async function GET(req: NextRequest) {
  return emitir(req, null);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = loginRetoSchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400, headers: SIN_CACHE });
  return emitir(req, parsed.data.wallet ?? null);
}
