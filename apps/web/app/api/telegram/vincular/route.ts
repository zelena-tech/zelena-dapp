/**
 * Alta de Telegram (WP19): la dapp genera el código de un solo uso y la persona lo
 * envía al bot como `/start CODIGO`.
 *
 * Solo el founder puede pedirlo, porque v1 es su asistente personal. El código se
 * devuelve UNA vez en la respuesta y la base solo guarda su hash.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FOUNDER_WALLET, telegramStatus } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { BotStoreError, founderTeamWallet, issueLinkCode, linkForWallet, unlinkTelegram } from "@/lib/bot-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para vincular Telegram." }, { status: 401 });
  if (session.wallet !== FOUNDER_WALLET) {
    return NextResponse.json({ error: "El asistente de Telegram es del founder en v1." }, { status: 403 });
  }
  if (!rateLimit(`telegram:vincular:${session.wallet}:${clientIp(req.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const db = getDb();
  // El vínculo cuelga de la identidad de EQUIPO del founder (su fila del roster),
  // que es donde vive su trabajo, no de la wallet con la que abrió sesión.
  const wallet = founderTeamWallet(db, session.wallet);

  try {
    if (body?.action === "desvincular") {
      unlinkTelegram(db, wallet);
      return NextResponse.json({ ok: true, linked: false });
    }
    const emitido = issueLinkCode(db, wallet);
    return NextResponse.json({
      ok: true,
      // Se muestra una sola vez: no vuelve a estar disponible en ninguna consulta.
      code: emitido.code,
      expiresAt: emitido.expiresAt,
      willAuthorizeWrite: emitido.willAuthorizeWrite,
      status: telegramStatus(),
    });
  } catch (e) {
    if (e instanceof BotStoreError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo generar el código." }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para ver el estado." }, { status: 401 });
  if (session.wallet !== FOUNDER_WALLET) {
    return NextResponse.json({ error: "El asistente de Telegram es del founder en v1." }, { status: 403 });
  }
  const db = getDb();
  const link = linkForWallet(db, founderTeamWallet(db, session.wallet));
  return NextResponse.json({
    ok: true,
    linked: !!link?.telegram_user_id,
    linkedAt: link?.linked_at ?? null,
    canWrite: link?.is_authorized === 1,
    status: telegramStatus(),
  });
}
