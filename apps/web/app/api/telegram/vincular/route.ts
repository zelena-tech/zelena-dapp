/**
 * Alta de Telegram (WP19, ampliada en WP31-C2): la dapp genera el código de un solo
 * uso y la persona lo envía al bot como `/start CODIGO`.
 *
 * Desde WP31-C2 lo pide cualquiera que entra a `/equipo` (`equipoActor`, leído de la
 * base): así recibe por Telegram el resumen de sus entregas y lo urgente. Cada quien
 * emite SU código: el founder, para su identidad de equipo (`walletParaVinculo` →
 * `founderTeamWallet`); el resto, para su propia wallet. La escritura por Telegram
 * sigue siendo solo del founder (`canAuthorizeWrite`, sin cambios): el resto queda en
 * lectura.
 *
 * El código se devuelve UNA vez en la respuesta y la base solo guarda su hash.
 * Ni el envío ni la vinculación exigen `ANTHROPIC_API_KEY`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { telegramStatus } from "@/lib/config";
import { equipoActor } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { BotStoreError, issueLinkCode, linkForWallet, unlinkTelegram, walletParaVinculo } from "@/lib/bot-store";

export const dynamic = "force-dynamic";

const SIN_ACCESO = "Telegram se vincula desde el equipo: entra a un proyecto para activarlo.";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Entra para vincular Telegram." }, { status: 401 });
  const db = getDb();
  // Gate por la base, nunca por la cookie: equipo interno o quien trabaja por proyecto.
  const actor = equipoActor(session, db);
  if (!actor) return NextResponse.json({ error: SIN_ACCESO }, { status: 403 });
  if (!rateLimit(`telegram:vincular:${actor.wallet}:${clientIp(req.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  // Cada quien vincula SU cuenta. El founder, la de equipo (donde vive su trabajo).
  const wallet = walletParaVinculo(db, actor.wallet);

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
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) return NextResponse.json({ error: SIN_ACCESO }, { status: 403 });
  const link = linkForWallet(db, walletParaVinculo(db, actor.wallet));
  return NextResponse.json({
    ok: true,
    linked: !!link?.telegram_user_id,
    linkedAt: link?.linked_at ?? null,
    canWrite: link?.is_authorized === 1,
    status: telegramStatus(),
  });
}
