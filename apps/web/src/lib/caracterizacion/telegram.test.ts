/**
 * Prueba de caracterización · Telegram (bot, vinculación, webhook, focos del día).
 * Ficha: docs/features/telegram.md · DFD: docs/dfd/telegram.json
 * Commit de referencia: 0e07d8f; revisada contra wp/32-release (4032c7c).
 *
 * Protege el comportamiento ACTUAL, no el deseado. Recorre el flujo principal por las
 * rutas reales:
 *   /equipo/telegram → POST /api/telegram/vincular (código de un solo uso, solo su hash
 *   en la base) → la persona escribe «/start CÓDIGO» → Telegram llama a
 *   POST /api/telegram/webhook (secret token) → handleUpdate → consumeLinkCode
 *   → respuesta por sendMessage → «/focos», «/pendientes» y texto libre.
 * Persona del flujo: alguien del equipo interno SIN supervisión (core). Es el caso que
 * más se usa desde WP31-C2 (todo el equipo se vincula) y el que queda en solo lectura.
 *
 * Los casos marcados "HALLAZGO" fijan una rareza actual que la auditoría reporta. Si
 * alguien la corrige, esta prueba debe fallar y actualizarse en el mismo cambio.
 *
 * Dobles (y solo estos):
 *  - Sesión: `@/lib/session` devuelve la wallet que diga cada caso.
 *  - Red: `fetch` global capturado (Bot API de Telegram y, si se llamara, Anthropic).
 *    Ningún paquete sale de la máquina.
 * Los alias `@/lib/…` de las rutas se redirigen al módulo REAL.
 *
 * Base: SQLite en memoria con `schema.sql` + `seedTeam`, inyectada en
 * `globalThis.__zelenaDb`. Personas y títulos ficticios.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const sesion = vi.hoisted(() => ({ wallet: null as string | null }));

vi.mock("@/lib/db", () => import("../db"));
vi.mock("@/lib/config", () => import("../config"));
vi.mock("@/lib/rate-limit", () => import("../rate-limit"));
vi.mock("@/lib/authz", () => import("../authz"));
vi.mock("@/lib/bot-store", () => import("../bot-store"));
vi.mock("@/lib/bot-agent", () => import("../bot-agent"));
vi.mock("@/lib/telegram", () => import("../telegram"));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sesion.wallet ? { wallet: sesion.wallet } : null),
}));

import { openDb, type DB } from "../db";
import { seedTeam } from "../team";
import { BOT_COPY } from "../telegram";
import { hashLinkCode, LINK_CODE_PREFIX } from "../bot-store";
import { focosDelDia, debeEnviarFocos } from "../bot-tools";
import { POST as postVincular, GET as getVincular } from "../../../app/api/telegram/vincular/route";
import { POST as postWebhook } from "../../../app/api/telegram/webhook/route";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");

// Persona ficticia (wallet de mentira) del equipo interno, sin supervisión.
const EJE = "GCARACTERIZATELEGRAMEJEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TG_EJE = 515151;
const TG_EXTRANO = 999001;
const TITULO = "Pieza de caracterización del bot";

const SECRETO_WEBHOOK = "webhook-secreto-de-prueba"; // valor de prueba: solo vive en este proceso
const TOKEN = "TEST-TOKEN-FALSO";

const g = globalThis as unknown as { __zelenaDb?: DB };
const dbPrevia = g.__zelenaDb;
const ENV_KEYS = ["TELEGRAM_ENABLED", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_TOKEN", "ANTHROPIC_API_KEY"] as const;
const envPrevio = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

interface Llamada {
  url: string;
  body: Record<string, unknown>;
}
let llamadas: Llamada[] = [];
let db: DB;
let ip = 1;
let update = 1000;

function baseTemporal(): DB {
  const d = openDb(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  seedTeam(d);
  return d;
}

function vincular(cuerpo: unknown = {}): NextRequest {
  return new NextRequest("http://localhost/api/telegram/vincular", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.18.0.${ip++}` },
    body: JSON.stringify(cuerpo),
  });
}

function webhook(texto: string, o: { from?: number; secreto?: string | null } = {}): NextRequest {
  const from = o.from ?? TG_EJE;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "149.154.160.1" };
  const secreto = o.secreto === undefined ? SECRETO_WEBHOOK : o.secreto;
  if (secreto) headers["x-telegram-bot-api-secret-token"] = secreto;
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify({
      update_id: update++,
      message: { from: { id: from }, chat: { id: from, type: "private" }, text: texto },
    }),
  });
}

function enviados(): Llamada[] {
  return llamadas.filter((l) => l.url.endsWith("/sendMessage"));
}

function filas(sql: string, ...p: unknown[]) {
  return db.prepare(sql).all(...p) as Array<Record<string, unknown>>;
}

/** Vincula a EJE de punta a punta y devuelve el código que vio en pantalla. */
async function vincularDePuntaAPunta(): Promise<string> {
  sesion.wallet = EJE;
  const { code } = await (await postVincular(vincular())).json();
  const res = await postWebhook(webhook(`/start ${code}`));
  expect(await res.json()).toEqual({ ok: true, attended: true });
  llamadas = [];
  return code;
}

beforeEach(() => {
  db = baseTemporal();
  g.__zelenaDb = db;
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, is_supervisor, status, is_demo, cla_signed)
     VALUES (?, 'Persona Ejecuta', 'core', 0, 'active', 0, 1)`
  ).run(EJE);
  db.prepare(
    `INSERT INTO assignments (title, owner_wallet, status, priority) VALUES (?, ?, 'En curso', 'High')`
  ).run(TITULO, EJE);

  process.env.TELEGRAM_ENABLED = "1";
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRETO_WEBHOOK;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  delete process.env.ANTHROPIC_API_KEY;

  llamadas = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: llamadas.length } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  sesion.wallet = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  g.__zelenaDb = dbPrevia;
  for (const k of ENV_KEYS) {
    if (envPrevio[k] === undefined) delete process.env[k];
    else process.env[k] = envPrevio[k];
  }
});

describe("vinculación desde /equipo/telegram (POST /api/telegram/vincular)", () => {
  it("sin sesión 401; con sesión de alguien que no entra a /equipo, 403", async () => {
    expect((await postVincular(vincular())).status).toBe(401);
    db.prepare(
      `INSERT INTO users (wallet, display_name, role, is_supervisor, status, is_demo, cla_signed)
       VALUES ('GCARACTERIZASINEQUIPOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'Sin equipo', 'contributor', 0, 'active', 0, 1)`
    ).run();
    sesion.wallet = "GCARACTERIZASINEQUIPOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect((await postVincular(vincular())).status).toBe(403);
  });

  it("emite un código de un solo uso; la base guarda solo su hash, con vencimiento a 30 min y en lectura", async () => {
    sesion.wallet = EJE;
    const res = await postVincular(vincular());
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo.code).toMatch(new RegExp(`^${LINK_CODE_PREFIX}[0-9A-F]{10}$`));
    expect(cuerpo.willAuthorizeWrite).toBe(false);
    expect(cuerpo.status).toMatchObject({ enabled: true, configured: true, textoLibre: false });

    const [fila] = filas(`SELECT * FROM telegram_links WHERE wallet = ?`, EJE);
    expect(fila.link_code_hash).toBe(hashLinkCode(cuerpo.code));
    expect(JSON.stringify(fila)).not.toContain(cuerpo.code);
    expect(fila.telegram_user_id).toBeNull();
    expect(fila.is_authorized).toBe(0);
    const minutos = (Date.parse(String(fila.code_expires_at)) - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(29);
    expect(minutos).toBeLessThanOrEqual(30);

    const estado = await (await getVincular()).json();
    expect(estado).toMatchObject({ ok: true, linked: false, canWrite: false });
  });
});

describe("webhook (POST /api/telegram/webhook)", () => {
  it("con la flag apagada 404; sin el secret token 401; nada se atiende", async () => {
    process.env.TELEGRAM_ENABLED = "";
    expect((await postWebhook(webhook("/ayuda"))).status).toBe(404);
    process.env.TELEGRAM_ENABLED = "1";
    expect((await postWebhook(webhook("/ayuda", { secreto: null }))).status).toBe(401);
    expect((await postWebhook(webhook("/ayuda", { secreto: "otro" }))).status).toBe(401);
    expect(llamadas).toHaveLength(0);
    expect(filas(`SELECT * FROM bot_actions`)).toHaveLength(0);
  });

  it("«/start CÓDIGO» vincula el chat, borra el hash y responde la bienvenida de lectura", async () => {
    sesion.wallet = EJE;
    const { code } = await (await postVincular(vincular())).json();

    const res = await postWebhook(webhook(`/start ${code}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, attended: true });

    const [fila] = filas(`SELECT * FROM telegram_links WHERE wallet = ?`, EJE);
    expect(fila).toMatchObject({ telegram_user_id: String(TG_EJE), link_code_hash: null, code_expires_at: null });
    expect(fila.linked_at).toBeTruthy();

    expect(enviados()).toHaveLength(1);
    expect(enviados()[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(enviados()[0].body).toEqual({
      chat_id: TG_EJE,
      text: `${BOT_COPY.bienvenidaLectura}\n\n${BOT_COPY.soloComandosLectura}`,
    });

    // El mismo código no sirve dos veces (lo intenta otra cuenta de Telegram).
    llamadas = [];
    await postWebhook(webhook(`/start ${code}`, { from: TG_EXTRANO }));
    expect(enviados()[0].body.text).toBe(BOT_COPY.codigoInvalido);

    expect(filas(`SELECT action, outcome, detail FROM bot_actions ORDER BY id`)).toEqual([
      { action: "alta", outcome: "ok", detail: "vínculo creado" },
      { action: "alta", outcome: "rechazado", detail: "codigo_invalido" },
    ]);
  });

  it("«/focos» propone sus 3 focos (solo lo suyo) y «/pendientes» lista su trabajo abierto", async () => {
    await vincularDePuntaAPunta();

    await postWebhook(webhook("/focos"));
    const focos = String(enviados()[0].body.text);
    expect(focos.startsWith(BOT_COPY.focosCabecera)).toBe(true);
    expect(focos).toContain(TITULO);
    expect(focos).toContain("Responde «focos 2 1 3» para reordenarlos, o «ok» si están bien.");

    llamadas = [];
    await postWebhook(webhook("/pendientes"));
    const pendientes = String(enviados()[0].body.text);
    expect(pendientes.startsWith("Tu trabajo abierto (1):")).toBe(true);
    expect(pendientes).toContain(TITULO);
  });

  it("su texto libre nunca llega al modelo: responde soloComandosLectura y no llama a Anthropic", async () => {
    await vincularDePuntaAPunta();
    process.env.ANTHROPIC_API_KEY = "clave-de-prueba-que-no-se-usa";
    await postWebhook(webhook("crea una tarea para revisar la propuesta"));
    expect(llamadas.some((l) => l.url.includes("anthropic"))).toBe(false);
    expect(enviados()[0].body.text).toBe(BOT_COPY.soloComandosLectura);
    // Ni el texto crudo ni un borrador quedan en la base.
    expect(filas(`SELECT * FROM bot_drafts`)).toHaveLength(0);
    expect(JSON.stringify(filas(`SELECT * FROM bot_actions`))).not.toContain("revisar la propuesta");
  });

  it("escribir en el tablero queda rechazado para quien está en lectura («cierra N»)", async () => {
    await vincularDePuntaAPunta();
    const [{ id }] = filas(`SELECT id FROM assignments WHERE title = ?`, TITULO);
    await postWebhook(webhook(`cierra ${id}`));
    expect(enviados()[0].body.text).toBe(BOT_COPY.soloLectura);
    expect(filas(`SELECT status FROM assignments WHERE id = ?`, id)).toEqual([{ status: "En curso" }]);
  });

  it("un telegram_user_id no registrado se ignora en silencio y queda en el log con su id", async () => {
    const res = await postWebhook(webhook("hola", { from: TG_EXTRANO }));
    expect(await res.json()).toEqual({ ok: true, attended: false });
    expect(enviados()).toHaveLength(0);
    expect(filas(`SELECT sender_ref, action, outcome FROM bot_actions`)).toEqual([
      { sender_ref: String(TG_EXTRANO), action: "mensaje", outcome: "ignorado" },
    ]);
  });

  it("desvincular desde la app deja el chat sin vínculo y el bot vuelve a ignorarlo", async () => {
    await vincularDePuntaAPunta();
    sesion.wallet = EJE;
    expect(await (await postVincular(vincular({ action: "desvincular" }))).json()).toEqual({ ok: true, linked: false });
    const res = await postWebhook(webhook("/focos"));
    expect(await res.json()).toEqual({ ok: true, attended: false });
  });
});

describe("HALLAZGOS fijados (comportamiento actual que la auditoría reporta)", () => {
  it("HALLAZGO: el mismo update_id reenviado por Telegram se atiende dos veces (no hay deduplicación)", async () => {
    await vincularDePuntaAPunta();
    const cuerpo = {
      update_id: 777,
      message: { from: { id: TG_EJE }, chat: { id: TG_EJE, type: "private" }, text: "/focos" },
    };
    const peticion = () =>
      new NextRequest("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRETO_WEBHOOK },
        body: JSON.stringify(cuerpo),
      });
    await postWebhook(peticion());
    await postWebhook(peticion());
    expect(enviados()).toHaveLength(2);
    expect(filas(`SELECT COUNT(*) AS n FROM bot_actions WHERE action = 'focos'`)).toEqual([{ n: 2 }]);
  });

  it("HALLAZGO: la app emite códigos aunque el bot esté apagado (la UI deshabilita el botón, la API no)", async () => {
    process.env.TELEGRAM_ENABLED = "";
    sesion.wallet = EJE;
    const res = await postVincular(vincular());
    expect(res.status).toBe(200);
    expect((await res.json()).status.enabled).toBe(false);
  });

  it("HALLAZGO: los focos del día no tienen envío programado en la app; `debeEnviarFocos` usa la hora del servidor", () => {
    // focosDelDia existe y se usa por comando; el envío diario solo vive en el script de polling local.
    expect(typeof focosDelDia).toBe("function");
    // Con TZ=UTC (Azure, GitHub y estos tests), las 07:30 UTC son las 02:30 en Bogotá, y ya
    // cuentan como "después de las 7" (DAILY_FOCUS_HOUR) porque se mira getHours() del servidor.
    expect(debeEnviarFocos(7, new Date("2026-10-05T07:30:00.000Z"), null)).toBe(true);
    expect(debeEnviarFocos(7, new Date("2026-10-05T06:30:00.000Z"), null)).toBe(false);
  });
});
