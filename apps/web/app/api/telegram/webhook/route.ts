/**
 * Webhook de Telegram (WP19). Una ruta más de la misma app: sin infraestructura
 * nueva. En LOCAL no se usa —el bot corre en modo polling con
 * `packages/scripts/telegram-bot.mjs`, que no necesita URL pública—; esto se
 * activa al desplegar en Azure.
 *
 * El handler solo hace de puerta:
 *   1. flag apagado → 404 (el bot no existe hacia fuera);
 *   2. valida el SECRET TOKEN en CADA petición y rechaza sin él;
 *   3. sin `TELEGRAM_BOT_TOKEN` → 503 (no hay con qué responder);
 *   4. delega en lib/bot-agent.ts, donde vive toda la lógica.
 *
 * `ANTHROPIC_API_KEY` es OPCIONAL (WP31-C2): sin ella `claude = null` y el bot
 * atiende `/start`, los comandos y el resto de lo determinista; el texto libre
 * responde que por ahora atiende comandos. Así todo el equipo puede vincularse y
 * recibir sus recordatorios aunque no haya modelo configurado.
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
  if (!token) {
    // El flag está encendido pero falta el token: se dice, no se adivina.
    return NextResponse.json({ error: "El bot no está configurado." }, { status: 503 });
  }
  const apiKey = anthropicApiKey();

  const raw = await req.json().catch(() => null);
  if (!raw) return NextResponse.json({ ok: true, skipped: "cuerpo_invalido" });

  try {
    const result = await handleUpdate(
      {
        db: getDb(),
        transport: createTelegramTransport(token),
        // Sin clave, sin modelo: comandos sí, texto libre no (WP31-C2).
        claude: apiKey ? createClaudeClient({ apiKey }) : null,
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
