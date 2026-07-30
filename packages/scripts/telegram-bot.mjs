#!/usr/bin/env node
/**
 * Bot de Telegram en modo POLLING — Zelena DAO (WP19, desarrollo local).
 *
 * En local NO hace falta URL pública: este proceso le pregunta a Telegram por
 * updates con `getUpdates` y los entrega a la app que ya corre en tu máquina.
 *
 * DECISIÓN DE DISEÑO: este script no reimplementa nada. Es un PUENTE de 150 líneas
 * que empuja cada update al mismo handler que usará Azure
 * (`POST /api/telegram/webhook`). Así hay UN solo camino de lógica —el de
 * lib/bot-agent.ts, que es el que está testeado— en vez de dos que se
 * desincronizan. El precio es que en local también hace falta
 * `TELEGRAM_WEBHOOK_SECRET`: aquí no protege una URL pública, es simplemente el
 * secreto compartido entre este proceso y tu servidor de desarrollo.
 *
 * Uso:
 *   # 1) desde la raíz del monorepo
 *   npm install
 *   # 2) en apps/web/.env.local (NO lo edita ningún agente; lo pones tú):
 *   #      TELEGRAM_ENABLED=true
 *   #      TELEGRAM_BOT_TOKEN=...        (de @BotFather)
 *   #      TELEGRAM_WEBHOOK_SECRET=...   (cualquier cadena larga que inventes)
 *   #      ANTHROPIC_API_KEY=...
 *   # 3) arranca la app:            cd apps/web && npm run dev
 *   # 4) y en otra terminal:        node packages/scripts/telegram-bot.mjs
 *
 * Sin dinero real, sin mainnet y sin secretos en el repo: todo sale del entorno.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const APP_URL = process.env.ZELENA_APP_URL ?? "http://localhost:3000";
const DB_FILE =
  process.env.DATABASE_FILE ?? path.join(__dirname, "..", "..", "apps", "web", "data", "zelena.db");

function faltan() {
  const out = [];
  if (!TOKEN) out.push("TELEGRAM_BOT_TOKEN");
  if (!SECRET) out.push("TELEGRAM_WEBHOOK_SECRET");
  return out;
}

// --------------------------------------------------------------------------
// Bot API
// --------------------------------------------------------------------------

async function llamar(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!body?.ok) throw new Error(`Telegram rechazó ${method}: ${body?.description ?? res.status}`);
  return body.result;
}

/** Empuja el update al MISMO handler que corre en Azure. */
async function entregar(update) {
  const res = await fetch(`${APP_URL}/api/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(update),
  });
  if (res.status === 404) throw new Error("La app responde 404: ¿TELEGRAM_ENABLED sigue apagado?");
  if (res.status === 401) throw new Error("La app rechazó el secret token: revisa TELEGRAM_WEBHOOK_SECRET.");
  if (!res.ok) throw new Error(`La app respondió ${res.status}.`);
  return res.json().catch(() => ({}));
}

// --------------------------------------------------------------------------
// Los 3 focos del día: la HORA sale del genoma versionado, nunca de un literal
// --------------------------------------------------------------------------

function abrirDb(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const Database = require_("better-sqlite3");
    return new Database(file, { readonly: true });
  } catch {
    try {
      const { DatabaseSync } = require_("node:sqlite");
      return new DatabaseSync(file);
    } catch {
      return null;
    }
  }
}

/**
 * Lee `DAILY_FOCUS_HOUR` del genoma activo. Si no puede leerlo, devuelve null y el
 * script se salta los focos: preferimos no mandar nada a inventar una hora.
 */
function horaDeLosFocos(db) {
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT params FROM genome_versions ORDER BY effective_from_epoch DESC, version DESC LIMIT 1`
      )
      .get();
    if (!row) return null;
    const hora = JSON.parse(row.params).DAILY_FOCUS_HOUR;
    return Number.isInteger(hora) ? hora : null;
  } catch {
    return null;
  }
}

/** El destinatario autorizado (v1: solo John). */
function destinatarioAutorizado(db) {
  if (!db) return null;
  try {
    const row = db
      .prepare(
        `SELECT telegram_user_id FROM telegram_links WHERE is_authorized = 1 AND telegram_user_id IS NOT NULL LIMIT 1`
      )
      .get();
    return row?.telegram_user_id ?? null;
  } catch {
    return null;
  }
}

function hoy() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

/**
 * Sintetiza el comando `/focos` como si lo hubiera escrito John. Reusar el mismo
 * camino evita una segunda implementación de la propuesta del día.
 */
async function mandarFocos(telegramUserId) {
  const id = Number(telegramUserId);
  await entregar({
    update_id: Date.now(),
    message: { from: { id }, chat: { id, type: "private" }, text: "/focos" },
  });
}

// --------------------------------------------------------------------------
// Bucle
// --------------------------------------------------------------------------

async function main() {
  const pendientes = faltan();
  if (pendientes.length > 0) {
    console.error(`Faltan variables de entorno: ${pendientes.join(", ")}.`);
    console.error("El scaffolding está listo; se enciende cuando existan (paso A3 de docs/DESPLIEGUE-V1.md).");
    process.exit(1);
  }

  const yo = await llamar("getMe", {});
  console.log(`Bot @${yo.username} en modo polling. App: ${APP_URL}`);

  // El webhook y el polling son excluyentes en la Bot API.
  await llamar("deleteWebhook", { drop_pending_updates: false });

  const db = abrirDb(DB_FILE);
  if (!db) console.warn(`No pude abrir la base (${DB_FILE}): me salto los 3 focos del día.`);

  let offset = 0;
  let ultimoDiaDeFocos = null;

  for (;;) {
    try {
      const updates = await llamar("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          const r = await entregar(u);
          console.log(`update ${u.update_id}: ${r.attended ? "atendido" : "ignorado"}`);
        } catch (e) {
          console.error(`update ${u.update_id}: ${e.message}`);
        }
      }

      // ¿Toca la propuesta del día? Una vez, a la hora del genoma.
      const hora = horaDeLosFocos(db);
      const destino = destinatarioAutorizado(db);
      if (hora !== null && destino && ultimoDiaDeFocos !== hoy() && new Date().getHours() >= hora) {
        try {
          await mandarFocos(destino);
          ultimoDiaDeFocos = hoy();
          console.log(`3 focos del día enviados (hora del genoma: ${hora}:00).`);
        } catch (e) {
          console.error(`no pude mandar los focos: ${e.message}`);
        }
      }
    } catch (e) {
      console.error(`polling: ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
