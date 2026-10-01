/**
 * WP19 — protocolo de Telegram: el secret del webhook y el parseo de `update`.
 *
 * Criterios que cubre:
 *  - El webhook RECHAZA cualquier petición sin el secret token, con él mal, o si el
 *    entorno no tiene secret configurado.
 *  - v1 es 1:1: un update de grupo se reconoce como tal.
 *  - Cero red: aquí no se instancia el transporte real.
 */
import { describe, it, expect, afterEach } from "vitest";
import { telegramBotUsername, telegramMissingVars, telegramOptionalMissing, telegramStatus } from "./config";
import {
  BOT_COPY,
  TELEGRAM_SECRET_HEADER,
  constantTimeEquals,
  draftKeyboard,
  parseCallbackData,
  parseUpdate,
  sendMessage,
  verifyWebhookSecret,
  type TelegramTransport,
} from "./telegram";

function fakeTransport(): TelegramTransport & { calls: Array<{ method: string; payload: Record<string, unknown> }> } {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    async call(method, payload) {
      calls.push({ method, payload });
      return { message_id: calls.length };
    },
  };
}

describe("secret token del webhook (criterio de WP19)", () => {
  it("el nombre del header es el que manda Telegram", () => {
    expect(TELEGRAM_SECRET_HEADER).toBe("x-telegram-bot-api-secret-token");
  });

  it("acepta solo cuando el header coincide exactamente", () => {
    expect(verifyWebhookSecret("s3cr3to", "s3cr3to")).toEqual({ ok: true });
  });

  it("rechaza una petición SIN el header", () => {
    expect(verifyWebhookSecret(null, "s3cr3to")).toEqual({ ok: false, reason: "header_ausente" });
    expect(verifyWebhookSecret("", "s3cr3to")).toEqual({ ok: false, reason: "header_ausente" });
  });

  it("rechaza un secret incorrecto, incluso de otra longitud", () => {
    expect(verifyWebhookSecret("otro", "s3cr3to")).toEqual({ ok: false, reason: "secret_incorrecto" });
    expect(verifyWebhookSecret("s3cr3tos", "s3cr3to")).toEqual({ ok: false, reason: "secret_incorrecto" });
    expect(verifyWebhookSecret("s3cr3t", "s3cr3to")).toEqual({ ok: false, reason: "secret_incorrecto" });
  });

  it("sin secret configurado en el entorno NO se acepta nada (falla ruidoso)", () => {
    expect(verifyWebhookSecret("cualquiera", null)).toEqual({ ok: false, reason: "sin_secret_configurado" });
    expect(verifyWebhookSecret("cualquiera", "   ")).toEqual({ ok: false, reason: "sin_secret_configurado" });
  });

  it("la comparación es en tiempo constante y no revela la longitud lanzando", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("", "")).toBe(true);
    expect(constantTimeEquals("ñ", "n")).toBe(false);
  });
});

describe("parseo de updates", () => {
  const chatPrivado = { id: 555, type: "private" };

  it("normaliza un mensaje de texto", () => {
    const u = parseUpdate({
      update_id: 9,
      message: { from: { id: 42 }, chat: chatPrivado, text: "asigna a David el dashboard" },
    });
    expect(u).toMatchObject({
      updateId: 9,
      kind: "texto",
      chatId: 555,
      telegramUserId: "42",
      text: "asigna a David el dashboard",
      isGroup: false,
    });
  });

  it("normaliza una nota de voz sin quedarse con nada del audio salvo la referencia", () => {
    const u = parseUpdate({
      update_id: 10,
      message: { from: { id: 42 }, chat: chatPrivado, voice: { file_id: "AwAC", duration: 31 } },
    });
    expect(u?.kind).toBe("audio");
    expect(u?.voice).toEqual({ fileId: "AwAC", durationSeconds: 31 });
    expect(u?.text).toBe("");
  });

  it("normaliza el botón de un borrador", () => {
    const u = parseUpdate({
      update_id: 11,
      callback_query: { id: "cb1", from: { id: 42 }, data: "ok:7", message: { chat: chatPrivado } },
    });
    expect(u).toMatchObject({ kind: "boton", callbackData: "ok:7", callbackId: "cb1", telegramUserId: "42" });
  });

  it("marca los updates de grupo (v1 es 1:1)", () => {
    const u = parseUpdate({
      update_id: 12,
      message: { from: { id: 42 }, chat: { id: -100, type: "supergroup" }, text: "hola" },
    });
    expect(u?.isGroup).toBe(true);
  });

  it("devuelve null para lo que no sabe atender, en vez de adivinar", () => {
    expect(parseUpdate(null)).toBeNull();
    expect(parseUpdate({ update_id: 1 })).toBeNull();
    expect(parseUpdate({ update_id: 1, message: { from: { id: 1 }, chat: chatPrivado } })).toBeNull();
    expect(parseUpdate({ update_id: 1, message: { from: { id: 1 }, chat: chatPrivado, text: "   " } })).toBeNull();
    expect(parseUpdate({ update_id: 1, edited_message: { text: "x" } })).toBeNull();
  });
});

describe("botones de confirmación", () => {
  it("el teclado ofrece exactamente Confirmar / Editar / Descartar", () => {
    const kb = draftKeyboard(7);
    expect(kb[0].map((b) => b.text)).toEqual(["Confirmar", "Editar", "Descartar"]);
    expect(kb[0].every((b) => b.data.length <= 64)).toBe(true);
  });

  it("el callback_data va y vuelve sin ambigüedad", () => {
    expect(parseCallbackData("ok:7")).toEqual({ accion: "confirmar", draftId: 7 });
    expect(parseCallbackData("ed:7")).toEqual({ accion: "editar", draftId: 7 });
    expect(parseCallbackData("no:7")).toEqual({ accion: "descartar", draftId: 7 });
    expect(parseCallbackData("borrar:7")).toBeNull();
    expect(parseCallbackData("ok:0")).toBeNull();
    expect(parseCallbackData(null)).toBeNull();
  });
});

describe("envío de mensajes (con transporte inyectado: cero red)", () => {
  it("manda el texto y traduce el teclado al formato de la Bot API", async () => {
    const t = fakeTransport();
    await sendMessage(t, 555, { text: "hola", keyboard: draftKeyboard(3) });
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].method).toBe("sendMessage");
    expect(t.calls[0].payload.chat_id).toBe(555);
    expect(t.calls[0].payload.text).toBe("hola");
    expect(JSON.stringify(t.calls[0].payload.reply_markup)).toContain("Confirmar");
  });

  it("sin teclado no manda reply_markup", async () => {
    const t = fakeTransport();
    await sendMessage(t, 555, { text: BOT_COPY.sinBloqueos });
    expect(t.calls[0].payload.reply_markup).toBeUndefined();
  });
});

describe("WP31-C2 · configuración: la clave de Anthropic es opcional", () => {
  const CLAVES = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "ANTHROPIC_API_KEY", "TELEGRAM_BOT_USERNAME", "TELEGRAM_ENABLED"];
  const antes: Record<string, string | undefined> = {};
  for (const k of CLAVES) antes[k] = process.env[k];
  afterEach(() => {
    for (const k of CLAVES) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  });
  function limpiar() {
    for (const k of CLAVES) delete process.env[k];
  }

  it("sin ANTHROPIC_API_KEY el bot queda configurado: falta solo como opcional", () => {
    limpiar();
    process.env.TELEGRAM_BOT_TOKEN = "token-de-prueba";
    process.env.TELEGRAM_WEBHOOK_SECRET = "secreto-de-prueba";
    process.env.TELEGRAM_ENABLED = "1";
    expect(telegramMissingVars({ webhook: true })).toEqual([]);
    expect(telegramOptionalMissing()).toEqual(["ANTHROPIC_API_KEY"]);
    const s = telegramStatus({ webhook: true });
    expect(s).toMatchObject({ enabled: true, configured: true, missing: [], optional: ["ANTHROPIC_API_KEY"], textoLibre: false });
  });

  it("lo obligatorio sigue siendo el token (y el secret en modo webhook)", () => {
    limpiar();
    expect(telegramMissingVars()).toEqual(["TELEGRAM_BOT_TOKEN"]);
    expect(telegramMissingVars({ webhook: true })).toEqual(["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET"]);
    process.env.ANTHROPIC_API_KEY = "clave-de-prueba";
    expect(telegramOptionalMissing()).toEqual([]);
    expect(telegramStatus().textoLibre).toBe(true);
    expect(telegramStatus().configured).toBe(false);
  });

  it("el usuario del bot es solo copy: con @, sin espacios, o null si no es válido", () => {
    limpiar();
    expect(telegramBotUsername()).toBeNull();
    process.env.TELEGRAM_BOT_USERNAME = " zelena_demo_bot ";
    expect(telegramBotUsername()).toBe("@zelena_demo_bot");
    process.env.TELEGRAM_BOT_USERNAME = "@zelena_demo_bot";
    expect(telegramBotUsername()).toBe("@zelena_demo_bot");
    process.env.TELEGRAM_BOT_USERNAME = "no vale <b>";
    expect(telegramBotUsername()).toBeNull();
  });

  it("los copys nuevos del bot son los del spec", () => {
    expect(BOT_COPY.soloComandos).toBe(
      "Por ahora atiendo comandos: /pendientes, /focos, /nota y /ayuda. Para capturar tareas, usa la app."
    );
    expect(BOT_COPY.soloComandosLectura).toBe(
      "Por aquí te atiendo con /pendientes, /focos y /ayuda. Lo demás está en la app."
    );
  });
});
