/**
 * Webhook de Telegram (WP19). Una ruta más de la misma app: sin infraestructura
 * nueva. En LOCAL no se usa —el bot corre en modo polling con
 * `packages/scripts/telegram-bot.mjs`, que no necesita URL pública—; esto se
 * activa al desplegar en Azure.
 *
 * El handler solo hace de puerta:
 *   1. flag apagado → 404 (el bot no existe hacia fuera);
 *   2. valida el SECRET TOKEN en CADA petición y rechaza sin él;
 *   3. delega en lib/bot-agent.ts, donde vive toda la lógica.
 *
 * Siempre responde 200 tras la validación: Telegram reintenta cualquier otra cosa
 * y un reintento infinito de un update que no sabemos atender no ayuda a nadie.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { anthropicApiKey, isTelegramEnabled, telegramBotToken, telegramWebhookSecret } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createClaudeClient, handleUpdate } from "@/lib/bot-agent";
import { TELEGRAM_SECRET_HEADER, createTelegramTransport, verifyWebhookSecret } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isTelegramEnabled()) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }

  // Criterio: sin el secret token correcto no se atiende nada. Comparación en
  // tiempo constante dentro de `verifyWebhookSecret`.
  const check = verifyWebhookSecret(req.headers.get(TELEGRAM_SECRET_HEADER), telegramWebhookSecret());
  if (!check.ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (!rateLimit(`telegram:webhook:${clientIp(req.headers)}`, 120, 60_000)) {
    return NextResponse.json({ ok: true, skipped: "rate_limit" });
  }

  const token = telegramBotToken();
  const apiKey = anthropicApiKey();
  if (!token || !apiKey) {
    // El flag está encendido pero falta configuración: se dice, no se adivina.
    return NextResponse.json({ error: "El bot no está configurado." }, { status: 503 });
  }

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ ok: true, skipped: "cuerpo_invalido" });

  try {
    const result = await handleUpdate(
      {
        db: getDb(),
        transport: createTelegramTransport(token),
        claude: createClaudeClient({ apiKey }),
        // Sin proveedor de transcripción todavía (decisión pendiente de John):
        // el flujo de audio responde con honestidad en vez de fingir.
        transcriber: null,
      },
      raw
    );
    return NextResponse.json({ ok: true, attended: result.attended });
  } catch {
    // Nunca se filtra el detalle del error a un endpoint público.
    return NextResponse.json({ ok: true, skipped: "error_interno" });
  }
}
