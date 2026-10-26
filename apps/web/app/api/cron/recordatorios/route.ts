/**
 * `POST /api/cron/recordatorios` — lo llama el workflow programado de GitHub Actions
 * (`.github/workflows/recordatorios.yml`) cada 15 minutos en horario hábil (WP31-C1).
 *
 * El handler solo hace de puerta; la corrida vive en lib/recordatorios-db.ts:
 *  1. sin `CRON_SECRET` configurado (o con menos de 32 caracteres) → 503
 *     `sin_configurar`: un endpoint que escribe no se abre sin secreto;
 *  2. cabecera `x-cron-secret` ausente o distinta → 401 (comparación en tiempo
 *     constante dentro de `autorizarCron`). La cabecera nunca se registra;
 *  3. corrida viva → 200 con `omitido: 'en_curso'`; si no, 200 con el resultado.
 *
 * Responde SOLO conteos (`ResultadoCorrida`): nunca wallets, nombres ni textos.
 * `?simular=1` cuenta lo que haría sin escribir ni enviar nada (se usa antes de
 * encender `SLA_REMINDERS_ENABLED` en producción).
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appBaseUrl, cronSecret } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { autorizarCron, correrRecordatorios } from "@/lib/recordatorios-db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SIN_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  if (!rateLimit(`cron:recordatorios:${clientIp(req.headers)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429, headers: SIN_CACHE });
  }

  const auth = autorizarCron(req.headers.get("x-cron-secret"), cronSecret());
  if (auth === "sin_configurar") {
    return NextResponse.json({ error: "sin_configurar" }, { status: 503, headers: SIN_CACHE });
  }
  if (auth !== "ok") {
    return NextResponse.json({ error: "No autorizado." }, { status: 401, headers: SIN_CACHE });
  }

  const simular = req.nextUrl.searchParams.get("simular") === "1";
  try {
    const resultado = await correrRecordatorios(getDb(), { simular, appUrl: appBaseUrl() });
    return NextResponse.json(resultado, { status: 200, headers: SIN_CACHE });
  } catch {
    // Nunca se filtra el detalle del error a un endpoint público.
    return NextResponse.json({ error: "No se pudo completar la corrida." }, { status: 500, headers: SIN_CACHE });
  }
}
