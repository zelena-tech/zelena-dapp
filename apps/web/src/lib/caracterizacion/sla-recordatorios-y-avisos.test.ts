/**
 * Prueba de caracterización · SLA, recordatorios y avisos.
 * Ficha: docs/features/sla-recordatorios-y-avisos.md · DFD: docs/dfd/sla-recordatorios-y-avisos.json
 * Commit de referencia: 0e07d8f; revisada contra wp/32-release (4032c7c).
 *
 * Protege el comportamiento ACTUAL, no el deseado. Recorre el flujo principal de punta a
 * punta por las rutas reales:
 *   workflow programado → POST /api/cron/recordatorios (x-cron-secret)
 *   → correrRecordatorios → planificarRecordatorios (sla.ts) → avisos + reminders_sent
 *   → Telegram (sendMessage) → GET/POST /api/avisos (la bandeja de /equipo/avisos)
 * y el semáforo de la misma pieza (slaDeAsignaciones), que es lo que pintan los tableros.
 *
 * Los casos marcados "HALLAZGO" fijan una rareza actual que la auditoría reporta. Si
 * alguien la corrige, esta prueba debe fallar y actualizarse en el mismo cambio.
 *
 * Dobles (y solo estos):
 *  - Reloj: `vi.useFakeTimers({ toFake: ["Date"] })`. La ruta del cron usa `new Date()`;
 *    se fija un lunes 09:30 de Bogotá para que el resultado no dependa de la hora del CI.
 *  - Sesión: `@/lib/session` devuelve la wallet que diga cada caso (la sesión es la
 *    feature de login; aquí solo importa quién pregunta).
 *  - Red: `fetch` global capturado. Es el borde con la Bot API de Telegram; ningún
 *    paquete sale de la máquina.
 * Los alias `@/lib/…` de las rutas se redirigen al módulo REAL (vitest.config.ts no los
 * declara): la ruta corre su código de verdad.
 *
 * Base: SQLite en memoria con `schema.sql` + `seedTeam`, inyectada en
 * `globalThis.__zelenaDb` (lo primero que mira `getDb()`). Personas y títulos ficticios.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const sesion = vi.hoisted(() => ({ wallet: null as string | null }));

vi.mock("@/lib/db", () => import("../db"));
vi.mock("@/lib/config", () => import("../config"));
vi.mock("@/lib/rate-limit", () => import("../rate-limit"));
vi.mock("@/lib/recordatorios-db", () => import("../recordatorios-db"));
vi.mock("@/lib/avisos", () => import("../avisos"));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sesion.wallet ? { wallet: sesion.wallet } : null),
}));

import { openDb, type DB } from "../db";
import { seedTeam } from "../team";
import { instanteDb, instanteLocal } from "../zona-horaria";
import { slaConfig, slaDeAsignaciones } from "../sla-db";
import { SLA_LABEL } from "../sla";
import { semaforo } from "../semaforo";
import { activadoDesde } from "../recordatorios-db";
import { POST as postCron } from "../../../app/api/cron/recordatorios/route";
import { GET as getAvisos, POST as postAvisos } from "../../../app/api/avisos/route";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
const TZ = "America/Bogota";
const LUN = "2026-10-05"; // lunes
const SAB = "2026-10-03"; // sábado

/** Instante de Bogotá (UTC−5). Los tests corren con TZ=UTC. */
function bog(dia: string, hhmm: string): Date {
  return instanteLocal(dia, hhmm, TZ);
}

// Personas ficticias (wallets de mentira).
const ANA = "GCARACTERIZAANASLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTRA = "GCARACTERIZAOTRASLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TG_ANA = 424242;
const TITULO = "Pieza urgente de caracterización";

const SECRETO = "s".repeat(40); // valor de prueba: solo vive en este proceso
const TOKEN = "TEST-TOKEN-FALSO";
const APP = "https://app.ejemplo.test";

const g = globalThis as unknown as { __zelenaDb?: DB; __zelenaRecordatorios?: unknown };
const dbPrevia = g.__zelenaDb;
const ENV_KEYS = ["CRON_SECRET", "SLA_REMINDERS_ENABLED", "TELEGRAM_BOT_TOKEN", "ZELENA_APP_URL"] as const;
const envPrevio = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

interface LlamadaTelegram {
  url: string;
  body: Record<string, unknown>;
}
let llamadas: LlamadaTelegram[] = [];
let db: DB;
let ip = 1;

function baseTemporal(): DB {
  const d = openDb(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  seedTeam(d);
  return d;
}

function usuario(d: DB, wallet: string, nombre: string): void {
  d.prepare(
    `INSERT INTO users (wallet, display_name, role, is_supervisor, status, is_demo, cla_signed)
     VALUES (?, ?, 'core', 0, 'active', 0, 1)`
  ).run(wallet, nombre);
}

/** P1 creada a las 08:55 y asignada a Ana el lunes a las 09:00 (vence la respuesta a las 11:00). */
function piezaP1(d: DB): number {
  const creada = bog(LUN, "08:55");
  const asignada = bog(LUN, "09:00");
  const id = Number(
    d
      .prepare(
        `INSERT INTO assignments (title, owner_wallet, status, priority, created_at, updated_at)
         VALUES (?, ?, 'Asignada', 'Urgent', ?, ?)`
      )
      .run(TITULO, ANA, instanteDb(creada), instanteDb(asignada)).lastInsertRowid
  );
  d.prepare(
    `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, actor_wallet, day, created_at)
     VALUES (?, 'asignar', 'Backlog', 'Asignada', ?, ?, ?)`
  ).run(id, ANA, LUN, instanteDb(asignada));
  return id;
}

function cron(o: { secreto?: string | null; query?: string } = {}): NextRequest {
  const headers: Record<string, string> = { "x-forwarded-for": `203.0.113.${ip++}` };
  if (o.secreto) headers["x-cron-secret"] = o.secreto;
  return new NextRequest(`http://localhost/api/cron/recordatorios${o.query ?? ""}`, { method: "POST", headers });
}

function avisosPost(cuerpo: unknown): NextRequest {
  return new NextRequest("http://localhost/api/avisos", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${ip++}` },
    body: JSON.stringify(cuerpo),
  });
}

function avisosGet(): NextRequest {
  return new NextRequest("http://localhost/api/avisos", { headers: { "x-forwarded-for": `203.0.113.${ip++}` } });
}

function filas(sql: string, ...p: unknown[]) {
  return db.prepare(sql).all(...p) as Array<Record<string, unknown>>;
}

let idPieza = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(bog(LUN, "09:30"));
  db = baseTemporal();
  g.__zelenaDb = db;
  g.__zelenaRecordatorios = null;
  usuario(db, ANA, "Ana Prueba");
  usuario(db, OTRA, "Otra Prueba");
  db.prepare(
    `INSERT INTO telegram_links (wallet, telegram_user_id, is_authorized, linked_at) VALUES (?, ?, 0, ?)`
  ).run(ANA, String(TG_ANA), instanteDb(bog("2026-10-01", "10:00")));
  idPieza = piezaP1(db);

  process.env.CRON_SECRET = SECRETO;
  process.env.SLA_REMINDERS_ENABLED = "1";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.ZELENA_APP_URL = APP;

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
  vi.useRealTimers();
});

afterAll(() => {
  g.__zelenaDb = dbPrevia;
  for (const k of ENV_KEYS) {
    if (envPrevio[k] === undefined) delete process.env[k];
    else process.env[k] = envPrevio[k];
  }
});

describe("puerta del cron (POST /api/cron/recordatorios)", () => {
  it("sin CRON_SECRET configurado (o con menos de 32) responde 503 sin_configurar", async () => {
    process.env.CRON_SECRET = "corto";
    const res = await postCron(cron({ secreto: "corto" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "sin_configurar" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sin cabecera o con otra cabecera responde 401 y no escribe nada", async () => {
    expect((await postCron(cron())).status).toBe(401);
    expect((await postCron(cron({ secreto: "x".repeat(40) }))).status).toBe(401);
    expect(filas(`SELECT * FROM avisos`)).toHaveLength(0);
    expect(filas(`SELECT * FROM reminders_sent`)).toHaveLength(0);
  });

  it("con la flag apagada responde 200 omitido flag_apagada y no escribe nada", async () => {
    process.env.SLA_REMINDERS_ENABLED = "";
    const res = await postCron(cron({ secreto: SECRETO }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, omitido: "flag_apagada", avisosCreados: 0 });
    expect(filas(`SELECT * FROM avisos`)).toHaveLength(0);
  });

  it("fuera del horario hábil (sábado) responde omitido fuera_de_horario", async () => {
    vi.setSystemTime(bog(SAB, "10:00"));
    const res = await postCron(cron({ secreto: SECRETO }));
    expect(await res.json()).toMatchObject({ enabled: true, omitido: "fuera_de_horario" });
    expect(llamadas).toHaveLength(0);
  });

  it("?simular=1 cuenta lo que haría sin escribir ni enviar", async () => {
    const res = await postCron(cron({ secreto: SECRETO, query: "?simular=1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      simulado: true,
      evaluadas: 1,
      avisosCreados: 0,
      inmediatosEnviados: 0,
      digestEnviados: 0,
      errores: 0,
      porTipo: { p1_asignada: 1, vence_hoy: 1 },
      destinatarios: 1,
      inmediatos: 2,
    });
    expect(filas(`SELECT * FROM reminders_sent`)).toHaveLength(0);
    expect(llamadas).toHaveLength(0);
  });
});

describe("flujo principal: cron → avisos + Telegram → bandeja", () => {
  it("la corrida deja dos avisos para la dueña, los manda en UN mensaje y responde solo conteos", async () => {
    const res = await postCron(cron({ secreto: SECRETO }));
    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(cuerpo).toEqual({
      enabled: true,
      simulado: false,
      evaluadas: 1,
      avisosCreados: 2,
      inmediatosEnviados: 1,
      digestEnviados: 0,
      errores: 0,
      porTipo: { p1_asignada: 1, vence_hoy: 1 },
      destinatarios: 1,
    });
    // La respuesta nunca lleva wallets ni textos.
    expect(JSON.stringify(cuerpo)).not.toContain(ANA);
    expect(JSON.stringify(cuerpo)).not.toContain(TITULO);

    // Bandeja: una fila por (wallet, clave).
    const avisos = filas(`SELECT wallet, clave, tipo, assignment_id, texto, is_leido FROM avisos ORDER BY id`);
    expect(avisos).toEqual([
      {
        wallet: ANA,
        clave: `p1_asignada:${idPieza}`,
        tipo: "p1_asignada",
        assignment_id: idPieza,
        texto: `«${TITULO}» (P1) es urgente y te espera. Primera respuesta antes de 11:00.`,
        is_leido: 0,
      },
      {
        wallet: ANA,
        clave: `vence_hoy:${idPieza}:${LUN}`,
        tipo: "vence_hoy",
        assignment_id: idPieza,
        texto: `«${TITULO}» (P1) vence hoy a las 17:00.`,
        is_leido: 0,
      },
    ]);

    // Lo ya procesado, con Telegram confirmado.
    expect(filas(`SELECT clave, wallet, dia, is_inmediato, is_telegram FROM reminders_sent ORDER BY id`)).toEqual([
      { clave: `p1_asignada:${idPieza}`, wallet: ANA, dia: LUN, is_inmediato: 1, is_telegram: 1 },
      { clave: `vence_hoy:${idPieza}:${LUN}`, wallet: ANA, dia: LUN, is_inmediato: 1, is_telegram: 1 },
    ]);

    // Telegram: un solo sendMessage, sin parse_mode, con el token en la URL (así es la Bot API).
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(llamadas[0].body).toEqual({
      chat_id: TG_ANA,
      text: [
        "Lo urgente de ahora:",
        `· «${TITULO}» (P1) es urgente y te espera. Primera respuesta antes de 11:00.`,
        `· «${TITULO}» (P1) vence hoy a las 17:00.`,
        `Ver en Zelena: ${APP}/equipo/avisos`,
      ].join("\n"),
    });

    // La guarda de arranque queda fijada por la primera fila escrita.
    expect(activadoDesde(db)?.toISOString()).toBe(bog(LUN, "09:30").toISOString());
  });

  it("es idempotente: una segunda corrida en el mismo instante no crea ni envía nada", async () => {
    await postCron(cron({ secreto: SECRETO }));
    const res = await postCron(cron({ secreto: SECRETO }));
    expect(await res.json()).toMatchObject({ avisosCreados: 0, inmediatosEnviados: 0, porTipo: {}, destinatarios: 0 });
    expect(filas(`SELECT * FROM avisos`)).toHaveLength(2);
    expect(llamadas).toHaveLength(1);
  });

  it("si Telegram falla, el aviso queda en la bandeja y la fila sigue en is_telegram = 0 (se reintenta)", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: false, description: "caído" }), { status: 502 }));
    const res = await postCron(cron({ secreto: SECRETO }));
    expect(await res.json()).toMatchObject({ avisosCreados: 2, inmediatosEnviados: 0, errores: 1 });
    expect(filas(`SELECT is_telegram FROM reminders_sent`)).toEqual([{ is_telegram: 0 }, { is_telegram: 0 }]);
  });

  it("la dueña ve sus avisos en /api/avisos y los marca como leídos; otra persona no puede marcarlos", async () => {
    await postCron(cron({ secreto: SECRETO }));

    sesion.wallet = null;
    expect((await getAvisos(avisosGet())).status).toBe(401);

    sesion.wallet = ANA;
    const lista = await getAvisos(avisosGet());
    expect(lista.status).toBe(200);
    const { avisos, noLeidos } = await lista.json();
    expect(noLeidos).toBe(2);
    // Orden: no leídos primero y, dentro, el más nuevo primero.
    expect(avisos.map((a: { tipo: string }) => a.tipo)).toEqual(["vence_hoy", "p1_asignada"]);
    expect(Object.keys(avisos[0]).sort()).toEqual(["assignmentId", "id", "leido", "texto", "tipo"]);

    sesion.wallet = OTRA;
    const ajena = await postAvisos(avisosPost({ ids: [avisos[0].id, avisos[1].id] }));
    expect(await ajena.json()).toMatchObject({ ok: true, marcados: 0, noLeidos: 0 });

    sesion.wallet = ANA;
    const propia = await postAvisos(avisosPost({ ids: [avisos[0].id] }));
    expect(await propia.json()).toMatchObject({ ok: true, marcados: 1, noLeidos: 1 });
    const todas = await postAvisos(avisosPost({}));
    expect(await todas.json()).toMatchObject({ ok: true, marcados: 1, noLeidos: 0 });

    expect((await postAvisos(avisosPost({ ids: ["1"] }))).status).toBe(400);
  });

  it("el semáforo de la misma pieza a las 09:30: fase respuesta, A tiempo, quedan 1,5 h hábiles", () => {
    const ahora = bog(LUN, "09:30");
    const cfg = slaConfig(db);
    const r = slaDeAsignaciones(db, [idPieza], ahora, cfg).get(idPieza);
    expect(r).toMatchObject({ fase: "respuesta", estado: "a_tiempo", horasRestantes: 1.5, respondida: false });
    expect(r?.vence?.toISOString()).toBe(bog(LUN, "11:00").toISOString());
    expect(semaforo(r, ahora, cfg).texto).toBe(`${SLA_LABEL.a_tiempo} · vence hoy 11:00`);
    // A las 10:45 ya está "Por vencer" (queda ≤ 25 % de la ventana de 2 h).
    const tarde = slaDeAsignaciones(db, [idPieza], bog(LUN, "10:45"), cfg).get(idPieza);
    expect(tarde?.estado).toBe("por_vencer");
  });
});

describe("HALLAZGOS fijados (comportamiento actual que la auditoría reporta)", () => {
  it("HALLAZGO: una P1 sin responsable en Backlog sale «Vencida» en el semáforo pero no genera ningún recordatorio", async () => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO assignments (title, owner_wallet, status, priority, created_at, updated_at)
           VALUES ('P1 sin dueño', NULL, 'Backlog', 'Urgent', ?, ?)`
        )
        .run(instanteDb(bog("2026-10-01", "09:00")), instanteDb(bog("2026-10-01", "09:00"))).lastInsertRowid
    );
    expect(slaDeAsignaciones(db, [id], bog(LUN, "09:30")).get(id)?.estado).toBe("vencida");
    const res = await postCron(cron({ secreto: SECRETO, query: "?simular=1" }));
    const cuerpo = await res.json();
    expect(cuerpo.evaluadas).toBe(2);
    expect(cuerpo.porTipo).toEqual({ p1_asignada: 1, vence_hoy: 1 }); // nada para la P1 sin dueño
  });

  it("HALLAZGO: mientras reminders_sent está vacía, la guarda de arranque se mueve con cada corrida (activadoDesde = ahora)", async () => {
    // Una pieza Normal que venció el viernes, con el motor ya encendido pero sin filas escritas.
    db.prepare(`DELETE FROM assignment_events`).run();
    db.prepare(`DELETE FROM assignments`).run();
    const id = Number(
      db
        .prepare(
          `INSERT INTO assignments (title, owner_wallet, status, priority, due_date, created_at, updated_at)
           VALUES ('Normal vencida', ?, 'En curso', 'Normal', '2026-09-25', ?, ?)`
        )
        .run(ANA, instanteDb(bog("2026-09-20", "09:00")), instanteDb(bog("2026-09-20", "09:00"))).lastInsertRowid
    );
    expect(activadoDesde(db)).toBeNull();
    vi.setSystemTime(bog(LUN, "09:30"));
    const res = await postCron(cron({ secreto: SECRETO, query: "?simular=1" }));
    // Solo el aviso a la dueña: ni escala_supervisor ni escala_founder, aunque ya pasaron sus umbrales.
    expect((await res.json()).porTipo).toEqual({ vencida: 1 });
    expect(id).toBeGreaterThan(0);
  });
});
