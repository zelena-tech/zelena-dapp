/**
 * Corrida del motor de recordatorios (WP31 §5.C.2) sobre una base en memoria con el
 * esquema real: criterios C1-2, C1-3, C1-4, C1-5, C1-6, C1-8, C1-9, C1-11, C1-12 y
 * C1-13. El transporte de Telegram es un doble (cero red).
 *
 * Reloj fijo en Bogotá (UTC−5; los tests corren con TZ=UTC): lunes 2026-10-05, martes
 * 06, sábado 03. Personas ficticias; ningún nombre de cliente real.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { GENOME_DEFAULTS } from "./genome";
import { pendingPrincipal } from "./roles";
import { seedTeam } from "./team";
import type { TelegramTransport } from "./telegram";
import { cronSecret, isSlaRemindersEnabled, appBaseUrl, CRON_SECRET_MIN } from "./config";
import { instanteDb, instanteLocal } from "./zona-horaria";
import { configRecordatoriosDesdeGenoma, type ConfigRecordatorios } from "./recordatorios";
import {
  activadoDesde,
  autorizarCron,
  cargarPiezasRecordables,
  correrRecordatorios,
  resolverDestinatarios,
  type OpcionesCorrida,
} from "./recordatorios-db";

const TZ = "America/Bogota";
const SAB = "2026-10-03";
const LUN = "2026-10-05";
const MAR = "2026-10-06";

function bog(dia: string, hhmm: string): Date {
  return instanteLocal(dia, hhmm, TZ);
}

// Personas ficticias (wallets de prueba).
const ANA = "GANAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EJE = "GEJECUTADOSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EST = "GESTRUCTURAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RITA = "GRITAREVISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SUPER = "GSUPERVISORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DEMOSUP = "GDEMOSUPERVISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ALUM = "GALUMNISUPERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EXTERNO = "GEXTERNOESTRUCTURAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SESION_FOUNDER = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const FAUSTO = pendingPrincipal("fausto");

const APP = "https://www.zelena.tech";
/** Activo desde mucho antes: la guarda de arranque no interviene (salvo en C1-11). */
const CFG: ConfigRecordatorios = {
  ...configRecordatoriosDesdeGenoma(GENOME_DEFAULTS),
  activadoDesde: new Date("2026-09-01T13:00:00.000Z"),
};

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

function usuario(
  db: DB,
  wallet: string,
  o: { role?: string; supervisor?: number; isDemo?: number; status?: string; nombre?: string } = {}
): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, is_supervisor, status, is_demo, cla_signed) VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(wallet, o.nombre ?? wallet.slice(1, 6), o.role ?? "contributor", o.supervisor ?? 0, o.status ?? "active", o.isDemo ?? 0);
}

function proyecto(db: DB, slug: string, nombre: string, clientId: number | null = null): number {
  return Number(
    db.prepare(`INSERT INTO initiatives (slug, name, client_id) VALUES (?, ?, ?)`).run(slug, nombre, clientId).lastInsertRowid
  );
}

function miembro(db: DB, ini: number, wallet: string, rol: string): void {
  db.prepare(`INSERT INTO project_members (initiative_id, wallet, rol_proyecto, vinculo) VALUES (?, ?, ?, 'externo')`).run(
    ini,
    wallet,
    rol
  );
}

interface PiezaInput {
  title?: string;
  owner?: string | null;
  priority?: string;
  status?: string;
  due?: string | null;
  ini?: number | null;
  clientId?: number | null;
  eventos?: Array<[string, string, string, Date]>;
  blockedAt?: Date | null;
  blockedReason?: string | null;
  creada?: Date;
}

let titulos = 0;
function pieza(db: DB, o: PiezaInput = {}): number {
  titulos++;
  const creada = o.creada ?? bog("2026-09-01", "09:00");
  const id = Number(
    db
      .prepare(
        `INSERT INTO assignments (title, initiative_id, client_id, owner_wallet, status, priority, due_date,
                                  blocked_at, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        o.title ?? `Entrega de prueba ${titulos}`,
        o.ini ?? null,
        o.clientId ?? null,
        o.owner === undefined ? ANA : o.owner,
        o.status ?? "Asignada",
        o.priority ?? "Normal",
        o.due ?? null,
        o.blockedAt ? instanteDb(o.blockedAt) : null,
        o.blockedReason ?? null,
        instanteDb(creada),
        instanteDb(creada)
      ).lastInsertRowid
  );
  for (const [action, from, to, d] of o.eventos ?? []) {
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, actor_wallet, day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, action, from, to, JOHN, instanteDb(d).slice(0, 10), instanteDb(d));
  }
  return id;
}

/** P1 asignado el lunes a las 09:00 que vence mañana: a las 09:30 solo da `p1_asignada`. */
function p1(db: DB, owner: string, o: PiezaInput = {}): number {
  return pieza(db, {
    owner,
    priority: "Urgent",
    status: "Asignada",
    due: MAR,
    eventos: [["asignar", "Backlog", "Asignada", bog(LUN, "09:00")]],
    ...o,
  });
}

/** High en curso que vence hoy (lunes): da `vence_hoy`, que va al resumen. */
function venceHoy(db: DB, owner: string, o: PiezaInput = {}): number {
  return pieza(db, {
    owner,
    priority: "High",
    status: "En curso",
    due: LUN,
    eventos: [
      ["asignar", "Backlog", "Asignada", bog("2026-09-28", "09:00")],
      ["empezar", "Asignada", "En curso", bog("2026-09-28", "09:30")],
    ],
    ...o,
  });
}

/** High en curso que venció hace semanas: vencida + escalamientos (al resumen). */
function vencidaVieja(db: DB, owner: string, o: PiezaInput = {}): number {
  return pieza(db, {
    owner,
    priority: "High",
    status: "En curso",
    due: "2026-09-21",
    eventos: [
      ["asignar", "Backlog", "Asignada", bog("2026-09-14", "09:00")],
      ["empezar", "Asignada", "En curso", bog("2026-09-14", "09:30")],
    ],
    ...o,
  });
}

function telegram(db: DB, wallet: string, userId: number): void {
  db.prepare(
    `INSERT INTO telegram_links (wallet, telegram_user_id, is_authorized, linked_at) VALUES (?, ?, 0, '2026-09-01T00:00:00.000Z')`
  ).run(wallet, String(userId));
}

interface Enviado {
  chat_id: number;
  text: string;
  [k: string]: unknown;
}

/** Lo que la Bot API acepta en `sendMessage.text`: más largo, responde 400 y no envía nada. */
const LIMITE_BOT_API = 4096;

function transporte(o: { lentoMs?: number; fallos?: number } = {}): {
  t: TelegramTransport;
  enviados: Enviado[];
  rechazados: number;
} {
  const enviados: Enviado[] = [];
  const out = { t: null as unknown as TelegramTransport, enviados, rechazados: 0 };
  let fallos = o.fallos ?? 0;
  out.t = {
    async call(method, payload) {
      if (o.lentoMs) await new Promise((r) => setTimeout(r, o.lentoMs));
      if (fallos > 0) {
        fallos--;
        throw new Error("Telegram no respondió");
      }
      if (method === "sendMessage" && String((payload as Enviado).text ?? "").length > LIMITE_BOT_API) {
        out.rechazados++;
        throw new Error("Telegram rechazó sendMessage: Bad Request: message is too long");
      }
      if (method === "sendMessage") enviados.push(payload as Enviado);
      return { ok: true };
    },
  };
  return out; // `rechazados` se lee del objeto (no desestructurado): cambia durante la corrida
}

function correr(db: DB, o: OpcionesCorrida = {}) {
  return correrRecordatorios(db, { enabled: true, cfg: CFG, transport: null, appUrl: APP, ahora: bog(LUN, "10:00"), ...o });
}

function contar(db: DB, sql: string, ...p: unknown[]): number {
  return Number((db.prepare(sql).get(...p) as { n: number }).n);
}

function huella(db: DB): string {
  return JSON.stringify({
    avisos: db.prepare(`SELECT * FROM avisos ORDER BY id`).all(),
    enviados: db.prepare(`SELECT * FROM reminders_sent ORDER BY id`).all(),
  });
}

/** Un entorno de prueba (los tipos de Next exigen NODE_ENV en `ProcessEnv`). */
function env(o: Record<string, string> = {}): NodeJS.ProcessEnv {
  return o as unknown as NodeJS.ProcessEnv;
}

function lineas(texto: string): number {
  return texto.split("\n").filter((l) => l.startsWith("· ")).length;
}

let db: DB;
beforeEach(() => {
  db = freshDb();
  for (const w of [ANA, EJE, EST, RITA, EXTERNO]) usuario(db, w);
  usuario(db, SUPER, { role: "core", supervisor: 1 });
  usuario(db, DEMOSUP, { role: "core", supervisor: 1, isDemo: 1 });
  usuario(db, ALUM, { role: "core", supervisor: 1, status: "alumni" });
  usuario(db, SESION_FOUNDER, { role: "founder", supervisor: 1 });
});

// ---------------------------------------------------------------------------

describe("cargarPiezasRecordables y activadoDesde", () => {
  it("trae las piezas abiertas con título, dueño, proyecto y motivo; no las Hecha", () => {
    const ini = proyecto(db, "proyecto-piloto", "Proyecto Piloto");
    const a = pieza(db, { ini, title: "Integrar el pago", status: "Bloqueada", blockedReason: "Falta acceso", blockedAt: bog(LUN, "09:00") });
    pieza(db, { status: "Hecha" });
    const ps = cargarPiezasRecordables(db);
    expect(ps.map((p) => p.id)).toEqual([a]);
    expect(ps[0]).toMatchObject({
      title: "Integrar el pago",
      owner_wallet: ANA,
      initiative_id: ini,
      initiative_slug: "proyecto-piloto",
      initiative_name: "Proyecto Piloto",
      blocked_reason: "Falta acceso",
      client_id: null,
    });
  });

  it("activadoDesde = MIN(created_at) de reminders_sent; null sin filas", () => {
    expect(activadoDesde(db)).toBeNull();
    db.prepare(`INSERT INTO reminders_sent (clave, wallet, dia, created_at) VALUES ('x', ?, '2026-10-05', '2026-10-05 15:00:00')`).run(ANA);
    db.prepare(`INSERT INTO reminders_sent (clave, wallet, dia, created_at) VALUES ('y', ?, '2026-10-02', '2026-10-02 13:30:00')`).run(ANA);
    expect(activadoDesde(db)?.toISOString()).toBe("2026-10-02T13:30:00.000Z");
  });
});

describe("C1-2 · idempotencia", () => {
  it("dos corridas con el mismo ahora: la segunda crea 0 avisos y envía 0 mensajes", async () => {
    p1(db, ANA, { title: "Restablecer el servicio" });
    venceHoy(db, ANA, { title: "Cerrar la conciliación" });
    telegram(db, ANA, 1001);
    const { t, enviados } = transporte();
    const ahora = bog(LUN, "09:30");

    const r1 = await correr(db, { ahora, transport: t });
    expect(r1).toMatchObject({ enabled: true, simulado: false, avisosCreados: 2, inmediatosEnviados: 1, digestEnviados: 1, errores: 0 });
    expect(r1.omitido).toBeUndefined();
    expect(enviados).toHaveLength(2);

    const r2 = await correr(db, { ahora, transport: t });
    expect(r2).toMatchObject({ avisosCreados: 0, inmediatosEnviados: 0, digestEnviados: 0, errores: 0 });
    expect(enviados).toHaveLength(2);
    expect(contar(db, `SELECT COUNT(*) AS n FROM avisos`)).toBe(2);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE clave LIKE 'digest:%'`)).toBe(1);
  });

  it("reserva con is_inmediato/is_telegram y created_at del instante inyectado", async () => {
    p1(db, ANA);
    venceHoy(db, ANA);
    telegram(db, ANA, 1001);
    const { t } = transporte();
    await correr(db, { ahora: bog(LUN, "09:30"), transport: t });
    const filas = db.prepare(`SELECT clave, dia, is_inmediato, is_telegram, created_at FROM reminders_sent ORDER BY id`).all() as Array<{
      clave: string;
      dia: string;
      is_inmediato: number;
      is_telegram: number;
      created_at: string;
    }>;
    expect(filas.map((f) => [f.clave.split(":")[0], f.is_inmediato, f.is_telegram])).toEqual([
      ["p1_asignada", 1, 1],
      ["vence_hoy", 0, 1],
      ["digest", 0, 1],
    ]);
    expect(filas.every((f) => f.dia === LUN && f.created_at === "2026-10-05 14:30:00")).toBe(true);
  });
});

describe("C1-3 · un mensaje por persona", () => {
  beforeEach(() => telegram(db, ANA, 1001));

  it("tres items de resumen para la misma persona → 1 mensaje", async () => {
    for (let i = 0; i < 3; i++) venceHoy(db, ANA);
    const { t, enviados } = transporte();
    const r = await correr(db, { transport: t });
    expect(r).toMatchObject({ avisosCreados: 3, digestEnviados: 1, inmediatosEnviados: 0 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].chat_id).toBe(1001);
    expect(enviados[0].text.startsWith("Esto es lo de hoy en tus entregas:")).toBe(true);
    expect(lineas(enviados[0].text)).toBe(3);
    expect(enviados[0].text.endsWith(`Ver en Zelena: ${APP}/equipo/hoy`)).toBe(true);
    expect(enviados[0]).not.toHaveProperty("parse_mode");
  });

  it("dos P1 de la misma persona en una corrida → 1 mensaje agrupado", async () => {
    p1(db, ANA);
    p1(db, ANA);
    const { t, enviados } = transporte();
    const r = await correr(db, { ahora: bog(LUN, "09:30"), transport: t });
    expect(r).toMatchObject({ inmediatosEnviados: 1, digestEnviados: 0 });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].text.startsWith("Lo urgente de ahora:")).toBe(true);
    expect(lineas(enviados[0].text)).toBe(2);
  });

  it("cinco P1 → 3 en el mensaje inmediato y 2 al resumen", async () => {
    for (let i = 0; i < 5; i++) p1(db, ANA);
    const { t, enviados } = transporte();
    const r = await correr(db, { ahora: bog(LUN, "09:30"), transport: t });
    expect(r).toMatchObject({ avisosCreados: 5, inmediatosEnviados: 1, digestEnviados: 1 });
    expect(enviados).toHaveLength(2);
    expect(enviados[0].text.startsWith("Lo urgente de ahora:")).toBe(true);
    expect(lineas(enviados[0].text)).toBe(3);
    expect(enviados[1].text.startsWith("Esto es lo de hoy en tus entregas:")).toBe(true);
    expect(lineas(enviados[1].text)).toBe(2);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_inmediato = 1`)).toBe(3);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_inmediato = 0 AND clave NOT LIKE 'digest:%'`)).toBe(2);
  });

  it("un segundo resumen el mismo día no sale (lo nuevo queda en la bandeja)", async () => {
    venceHoy(db, ANA);
    const { t, enviados } = transporte();
    await correr(db, { ahora: bog(LUN, "10:00"), transport: t });
    expect(enviados).toHaveLength(1);
    venceHoy(db, ANA);
    const r = await correr(db, { ahora: bog(LUN, "11:00"), transport: t });
    expect(r).toMatchObject({ avisosCreados: 1, digestEnviados: 0 });
    expect(enviados).toHaveLength(1);
    expect(contar(db, `SELECT COUNT(*) AS n FROM avisos WHERE wallet = ?`, ANA)).toBe(2);
  });

  it("la hora del resumen (REMINDER_DIGEST_HOUR) retiene lo no urgente; lo urgente sale igual", async () => {
    p1(db, ANA);
    venceHoy(db, ANA);
    const tarde: ConfigRecordatorios = { ...CFG, digestHora: 12 };
    const { t, enviados } = transporte();
    const r = await correr(db, { ahora: bog(LUN, "09:30"), cfg: tarde, transport: t });
    expect(r).toMatchObject({ avisosCreados: 1, inmediatosEnviados: 1, digestEnviados: 0 });
    expect(enviados).toHaveLength(1);
    // A las 12:00: el resumen (vence_hoy) y, aparte, el P1 que sigue sin respuesta.
    const r2 = await correr(db, { ahora: bog(LUN, "12:00"), cfg: tarde, transport: t });
    expect(r2).toMatchObject({ avisosCreados: 2, inmediatosEnviados: 1, digestEnviados: 1 });
    expect(r2.porTipo).toEqual({ p1_sin_respuesta: 1, vence_hoy: 1 });
  });
});

describe("C1-3 · cada mensaje cabe en el límite de Telegram (4096)", () => {
  /** Títulos largos (~115 caracteres), como los que deja un backlog importado. */
  const largo = (i: number) =>
    `Conciliar los movimientos del trimestre con el extracto del banco y documentar cada diferencia encontrada, lote ${i}`;
  /** El «Y N más.» del final; 0 si el mensaje lo lista todo. */
  const resto = (texto: string) => Number(/^Y (\d+) más\.$/m.exec(texto)?.[1] ?? 0);
  /** Filas de reminders_sent (sin las marcas del resumen) de quien no es ninguna de `fuera`. */
  const filasMenos = (...fuera: string[]) =>
    contar(
      db,
      `SELECT COUNT(*) AS n FROM reminders_sent WHERE clave NOT LIKE 'digest:%' AND wallet NOT IN (${fuera.map(() => "?").join(", ")})`,
      ...fuera
    );

  beforeEach(() => {
    telegram(db, ANA, 1001);
    telegram(db, SESION_FOUNDER, 1004); // el founder recibe los escalamientos
  });

  it("guarda de arranque: 35 vencidas importadas → 1 resumen al dueño que cabe, con «Y N más», y todo queda enviado", async () => {
    for (let i = 1; i <= 35; i++) vencidaVieja(db, ANA, { priority: i % 2 ? "Normal" : "High", title: largo(i) });
    expect(activadoDesde(db)).toBeNull();
    const tr = transporte();
    const sinGuardaFija: ConfigRecordatorios = { ...CFG, activadoDesde: null };
    const r = await correr(db, { ahora: bog(LUN, "10:00"), cfg: sinGuardaFija, transport: tr.t });
    expect(tr.rechazados).toBe(0);
    expect(r).toMatchObject({ avisosCreados: 35, digestEnviados: 1, inmediatosEnviados: 0, errores: 0 });
    expect(r.porTipo).toEqual({ vencida: 35 }); // nada escala: lo importado ya venía vencido
    expect(tr.enviados).toHaveLength(1);
    const { chat_id, text } = tr.enviados[0];
    expect(chat_id).toBe(1001);
    expect(text.length).toBeLessThanOrEqual(LIMITE_BOT_API);
    expect(text.startsWith("Esto es lo de hoy en tus entregas:")).toBe(true);
    expect(resto(text)).toBeGreaterThan(0);
    expect(text.endsWith(`\nY ${resto(text)} más.\nVer en Zelena: ${APP}/equipo/hoy`)).toBe(true);
    expect(lineas(text) + resto(text)).toBe(35); // nada se pierde: lo que no cabe se cuenta
    expect(tr.enviados[0]).not.toHaveProperty("parse_mode");

    // Todo lo del resumen quedó marcado como enviado, y el resumen del día también.
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_telegram = 0`)).toBe(0);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE clave = ? AND is_telegram = 1`, `digest:${LUN}`)).toBe(1);

    // La corrida siguiente no lo repite.
    const r2 = await correr(db, { ahora: bog(LUN, "10:15"), cfg: sinGuardaFija, transport: tr.t });
    expect(r2).toMatchObject({ avisosCreados: 0, digestEnviados: 0, errores: 0 });
    expect(tr.enviados).toHaveLength(1);
  });

  it("escalamientos que se juntan → el resumen del dueño y el del founder caben; todo queda enviado", async () => {
    for (let i = 1; i <= 30; i++) vencidaVieja(db, ANA, { priority: "Normal", title: largo(i) });
    const tr = transporte();
    const r = await correr(db, { ahora: bog(LUN, "10:00"), transport: tr.t });
    expect(tr.rechazados).toBe(0);
    expect(r).toMatchObject({ digestEnviados: 2, inmediatosEnviados: 0, errores: 0 });
    // El dueño, sus 30 vencidas; el founder, por cada pieza, la de supervisor global y la suya.
    const esperado = new Map([
      [1001, filasMenos(SUPER, SESION_FOUNDER, JOHN)],
      [1004, filasMenos(SUPER, ANA)],
    ]);
    expect([esperado.get(1001), esperado.get(1004)]).toEqual([30, 60]);
    expect(tr.enviados.map((e) => e.chat_id).sort()).toEqual([1001, 1004]);
    for (const e of tr.enviados) {
      expect(e.text.length).toBeLessThanOrEqual(LIMITE_BOT_API);
      expect(e.text.startsWith("Esto es lo de hoy en tus entregas:")).toBe(true);
      expect(e.text.endsWith(`Ver en Zelena: ${APP}/equipo/hoy`)).toBe(true);
      expect(resto(e.text)).toBeGreaterThan(0);
      expect(lineas(e.text) + resto(e.text)).toBe(esperado.get(e.chat_id));
    }
    // De quienes tienen Telegram nada queda pendiente, y el resumen de cada uno queda marcado.
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_telegram = 0 AND wallet <> ?`, SUPER)).toBe(0);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE clave = ? AND is_telegram = 1`, `digest:${LUN}`)).toBe(2);

    const r2 = await correr(db, { ahora: bog(LUN, "10:15"), transport: tr.t });
    expect(r2).toMatchObject({ digestEnviados: 0, errores: 0 });
    expect(tr.enviados).toHaveLength(2);
  });

  it("muchos urgentes en una corrida (tope alto) → un mensaje que cabe y enlaza a la bandeja", async () => {
    for (let i = 1; i <= 40; i++) p1(db, ANA, { title: largo(i) });
    const tr = transporte();
    const cfg: ConfigRecordatorios = { ...CFG, maxInmediatos: 40 };
    const r = await correr(db, { ahora: bog(LUN, "09:30"), cfg, transport: tr.t });
    expect(tr.rechazados).toBe(0);
    expect(r).toMatchObject({ avisosCreados: 40, inmediatosEnviados: 1, digestEnviados: 0, errores: 0 });
    expect(tr.enviados).toHaveLength(1);
    const texto = tr.enviados[0].text;
    expect(texto.length).toBeLessThanOrEqual(LIMITE_BOT_API);
    expect(texto.startsWith("Lo urgente de ahora:")).toBe(true);
    expect(texto.endsWith(`Ver en Zelena: ${APP}/equipo/avisos`)).toBe(true);
    expect(resto(texto)).toBeGreaterThan(0);
    expect(lineas(texto) + resto(texto)).toBe(40);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_telegram = 0`)).toBe(0);
  });

  it("un proyecto con un nombre desmesurado → los escalamientos salen recortados y caben, sin dejar fuera a ninguno", async () => {
    const P = proyecto(db, "proyecto-largo", "Proyecto de prueba con un nombre larguísimo ".repeat(120)); // ~5300 caracteres
    vencidaVieja(db, ANA, { ini: P, priority: "Normal" });
    vencidaVieja(db, ANA, { ini: P, priority: "Normal" });
    const tr = transporte();
    const r = await correr(db, { ahora: bog(LUN, "10:00"), transport: tr.t });
    expect(tr.rechazados).toBe(0);
    expect(r).toMatchObject({ digestEnviados: 2, errores: 0 });
    const alFounder = tr.enviados.filter((e) => e.chat_id === 1004);
    expect(alFounder).toHaveLength(1);
    const texto = alFounder[0].text;
    expect(texto.length).toBeLessThanOrEqual(LIMITE_BOT_API);
    expect(lineas(texto)).toBe(4); // por pieza, la de supervisor global y la del founder
    expect(resto(texto)).toBe(0);
    expect(texto.match(/Proyecto de prueba[^·\n)]*…\)/g)).toHaveLength(4); // el nombre, recortado con «…»
    expect(contar(db, `SELECT COUNT(*) AS n FROM avisos WHERE length(texto) > 600`)).toBe(0); // y en la bandeja también
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_telegram = 0 AND wallet <> ?`, SUPER)).toBe(0);
  });
});

describe("C1-4 · fuera de horario y flag apagada: no escribe ni envía", () => {
  beforeEach(() => {
    telegram(db, ANA, 1001);
    p1(db, ANA);
    venceHoy(db, ANA);
  });

  it.each([
    ["sábado", bog(SAB, "10:00")],
    ["antes de abrir", bog(LUN, "07:30")],
    ["después de cerrar", bog(LUN, "19:00")],
  ])("fuera de horario (%s) → omitido", async (_n, ahora) => {
    const { t, enviados } = transporte();
    const r = await correr(db, { ahora, transport: t });
    expect(r.omitido).toBe("fuera_de_horario");
    expect(r.avisosCreados).toBe(0);
    expect(enviados).toHaveLength(0);
    expect(huella(db)).toBe(JSON.stringify({ avisos: [], enviados: [] }));
  });

  it("flag apagada → omitido, sin escribir ni enviar", async () => {
    const { t, enviados } = transporte();
    const r = await correr(db, { enabled: false, transport: t });
    expect(r).toMatchObject({ enabled: false, omitido: "flag_apagada", avisosCreados: 0 });
    expect(enviados).toHaveLength(0);
    expect(huella(db)).toBe(JSON.stringify({ avisos: [], enviados: [] }));
  });

  describe("la flag por defecto sale de SLA_REMINDERS_ENABLED", () => {
    const antes = process.env.SLA_REMINDERS_ENABLED;
    afterEach(() => {
      if (antes === undefined) delete process.env.SLA_REMINDERS_ENABLED;
      else process.env.SLA_REMINDERS_ENABLED = antes;
    });

    it("sin la variable está apagada; con 1 corre", async () => {
      delete process.env.SLA_REMINDERS_ENABLED;
      expect(isSlaRemindersEnabled()).toBe(false);
      const apagada = await correrRecordatorios(db, { cfg: CFG, transport: null, ahora: bog(LUN, "10:00") });
      expect(apagada.omitido).toBe("flag_apagada");
      process.env.SLA_REMINDERS_ENABLED = "1";
      const encendida = await correrRecordatorios(db, { cfg: CFG, transport: null, ahora: bog(LUN, "10:00") });
      expect(encendida.omitido).toBeUndefined();
      expect(encendida.porTipo).toEqual({ p1_asignada: 1, p1_sin_respuesta: 1, vence_hoy: 1 });
    });

    it("acepta 1, true y yes; cualquier otra cosa la deja apagada", () => {
      for (const v of ["1", "true", "YES", " yes "]) expect(isSlaRemindersEnabled(env({ SLA_REMINDERS_ENABLED: v }))).toBe(true);
      for (const v of ["", "0", "no", "on"]) expect(isSlaRemindersEnabled(env({ SLA_REMINDERS_ENABLED: v }))).toBe(false);
    });
  });
});

describe("C1-5 · sin transporte: solo bandeja", () => {
  const antes = process.env.TELEGRAM_BOT_TOKEN;
  afterEach(() => {
    if (antes === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = antes;
  });

  it("crea los avisos in-app y 0 envíos, sin error", async () => {
    telegram(db, ANA, 1001);
    p1(db, ANA);
    venceHoy(db, ANA);
    const r = await correr(db, { ahora: bog(LUN, "09:30"), transport: null });
    expect(r).toMatchObject({ avisosCreados: 2, inmediatosEnviados: 0, digestEnviados: 0, errores: 0 });
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_telegram = 1`)).toBe(0);
  });

  it("sin TELEGRAM_BOT_TOKEN el transporte por defecto es nulo (ni Anthropic ni TELEGRAM_ENABLED hacen falta)", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    telegram(db, ANA, 1001);
    p1(db, ANA);
    const r = await correr(db, { ahora: bog(LUN, "09:30"), transport: undefined });
    expect(r).toMatchObject({ avisosCreados: 1, inmediatosEnviados: 0, errores: 0 });
  });
});

describe("C1-6 · destinatarios", () => {
  let P: number;
  beforeEach(() => {
    P = proyecto(db, "proyecto-piloto", "Proyecto Piloto");
    miembro(db, P, EST, "estructura");
    miembro(db, P, RITA, "revisa");
    miembro(db, P, ANA, "ejecuta");
  });
  const ordenar = (ws: string[]) => [...ws].sort();

  it("los escalamientos van a quien estructura, nunca al dueño", () => {
    expect(resolverDestinatarios(db, { tipo: "supervision", initiativeId: P, incluyeRevisa: false }, ANA)).toEqual([EST]);
  });

  it("revision_pendiente incluye a quien revisa (y nunca a quien entregó)", () => {
    const d = { tipo: "supervision", initiativeId: P, incluyeRevisa: true } as const;
    expect(ordenar(resolverDestinatarios(db, d, ANA))).toEqual(ordenar([EST, RITA]));
    expect(resolverDestinatarios(db, d, RITA)).toEqual([EST]);
  });

  it("si quien estructura es el dueño → supervisores globales válidos (ni demo, ni inactivos, ni pending sin vincular)", () => {
    const ws = resolverDestinatarios(db, { tipo: "supervision", initiativeId: P, incluyeRevisa: false }, EST);
    // SUPER (core con supervisión) y el principal del founder; VALE es `pending:` sin vincular.
    expect(ordenar(ws)).toEqual(ordenar([SUPER, JOHN]));
    expect(ws).not.toContain(VALE);
    expect(ws).not.toContain(DEMOSUP);
    expect(ws).not.toContain(ALUM);
    expect(ws).not.toContain(SESION_FOUNDER); // misma persona que JOHN: deduplicado
  });

  it("sin supervisores globales → founder", () => {
    db.prepare(`UPDATE users SET is_supervisor = 0`).run();
    expect(resolverDestinatarios(db, { tipo: "supervision", initiativeId: P, incluyeRevisa: false }, EST)).toEqual([JOHN]);
  });

  it("founder = su principal de equipo; nunca si el dueño es él (en cualquiera de sus identidades)", () => {
    expect(resolverDestinatarios(db, { tipo: "founder" }, ANA)).toEqual([JOHN]);
    expect(resolverDestinatarios(db, { tipo: "founder" }, SESION_FOUNDER)).toEqual([]);
    expect(resolverDestinatarios(db, { tipo: "founder" }, JOHN)).toEqual([]);
    const ws = resolverDestinatarios(db, { tipo: "supervision", initiativeId: null, incluyeRevisa: false }, SESION_FOUNDER);
    expect(ws).toEqual([SUPER]);
  });

  it("con el roster vinculado, el founder recibe en la cuenta vinculada", () => {
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('john', ?, ?)`).run(SESION_FOUNDER, SESION_FOUNDER);
    db.prepare(`DELETE FROM users WHERE wallet = ?`).run(JOHN);
    expect(resolverDestinatarios(db, { tipo: "founder" }, ANA)).toEqual([SESION_FOUNDER]);
  });

  it("persona: solo el dueño válido (nunca pending sin vincular, demo ni inactivo)", () => {
    expect(resolverDestinatarios(db, { tipo: "persona", wallet: ANA }, ANA)).toEqual([ANA]);
    expect(resolverDestinatarios(db, { tipo: "persona", wallet: FAUSTO }, FAUSTO)).toEqual([]);
    expect(resolverDestinatarios(db, { tipo: "persona", wallet: DEMOSUP }, DEMOSUP)).toEqual([]);
    expect(resolverDestinatarios(db, { tipo: "persona", wallet: ALUM }, ALUM)).toEqual([]);
    // El founder sí, como excepción, en su principal de equipo.
    expect(resolverDestinatarios(db, { tipo: "persona", wallet: SESION_FOUNDER }, SESION_FOUNDER)).toEqual([JOHN]);
  });

  it("dos identidades de la misma persona reciben una sola vez", () => {
    const Q = proyecto(db, "otro-proyecto", "Otro Proyecto");
    miembro(db, Q, SESION_FOUNDER, "estructura");
    miembro(db, Q, JOHN, "estructura");
    expect(resolverDestinatarios(db, { tipo: "supervision", initiativeId: Q, incluyeRevisa: false }, ANA)).toEqual([JOHN]);
  });

  it("un contributor solo recibe avisos de sus piezas (de sus proyectos)", async () => {
    const Q = proyecto(db, "otro-proyecto", "Otro Proyecto");
    miembro(db, P, EXTERNO, "estructura");
    expect(resolverDestinatarios(db, { tipo: "supervision", initiativeId: Q, incluyeRevisa: false }, ANA)).not.toContain(EXTERNO);
    expect(resolverDestinatarios(db, { tipo: "supervision", initiativeId: null, incluyeRevisa: false }, ANA)).not.toContain(EXTERNO);

    vencidaVieja(db, ANA, { ini: Q, title: "Pieza de otro proyecto" });
    vencidaVieja(db, EJE, { ini: null, title: "Pieza sin proyecto" });
    vencidaVieja(db, ANA, { ini: P, title: "Pieza del piloto" });
    await correr(db, { ahora: bog(LUN, "10:00") });
    const deExterno = db.prepare(`SELECT texto FROM avisos WHERE wallet = ?`).all(EXTERNO) as Array<{ texto: string }>;
    expect(deExterno.length).toBeGreaterThan(0);
    expect(deExterno.every((a) => a.texto.includes("«Pieza del piloto»"))).toBe(true);
  });

  it("un proyecto de cliente no escala a un supervisor que no participa en ese cliente", () => {
    const cliente = Number(db.prepare(`INSERT INTO clients (slug, name) VALUES ('cliente-demo', 'Cliente Demo')`).run().lastInsertRowid);
    const C = proyecto(db, "proyecto-de-cliente", "Proyecto de cliente", cliente);
    miembro(db, C, ANA, "ejecuta");
    const d = { tipo: "supervision", initiativeId: C, incluyeRevisa: false } as const;
    const pz = { initiative_id: C, client_id: null };
    expect(resolverDestinatarios(db, d, ANA, pz)).toEqual([JOHN]);
    db.prepare(`INSERT INTO client_members (client_id, wallet, access_level) VALUES (?, ?, 'colaborador')`).run(cliente, SUPER);
    expect(ordenar(resolverDestinatarios(db, d, ANA, pz))).toEqual(ordenar([SUPER, JOHN]));
  });

  it("en una corrida real: el dueño recibe lo suyo y quien estructura el escalamiento", async () => {
    vencidaVieja(db, ANA, { ini: P });
    await correr(db, { ahora: bog(LUN, "10:00") });
    const por = (w: string) =>
      (db.prepare(`SELECT tipo FROM avisos WHERE wallet = ? ORDER BY id`).all(w) as Array<{ tipo: string }>).map((a) => a.tipo);
    expect(por(ANA)).toEqual(["vencida"]);
    expect(por(EST)).toEqual(["escala_supervisor"]);
    expect(por(JOHN)).toEqual(["escala_founder"]);
    expect(por(RITA)).toEqual([]);
  });
});

describe("C1-8 · autorización del cron", () => {
  const SECRETO = "s".repeat(CRON_SECRET_MIN);

  it("sin secreto → sin_configurar; distinto o de otro largo → rechazado; igual → ok", () => {
    expect(autorizarCron(SECRETO, null)).toBe("sin_configurar");
    expect(autorizarCron(SECRETO, "")).toBe("sin_configurar");
    expect(autorizarCron(null, SECRETO)).toBe("rechazado");
    expect(autorizarCron("", SECRETO)).toBe("rechazado");
    expect(autorizarCron(`${SECRETO}x`, SECRETO)).toBe("rechazado");
    expect(autorizarCron("t".repeat(CRON_SECRET_MIN), SECRETO)).toBe("rechazado");
    expect(autorizarCron(SECRETO, SECRETO)).toBe("ok");
  });

  it("cronSecret con menos de 32 caracteres → null", () => {
    expect(cronSecret(env())).toBeNull();
    expect(cronSecret(env({ CRON_SECRET: "x".repeat(31) }))).toBeNull();
    expect(cronSecret(env({ CRON_SECRET: "x".repeat(32) }))).toBe("x".repeat(32));
    expect(cronSecret(env({ CRON_SECRET: `  ${"y".repeat(40)}  ` }))).toBe("y".repeat(40));
  });

  it("appBaseUrl usa ZELENA_APP_URL (sin barra final) o el host canónico", () => {
    expect(appBaseUrl(env())).toBe("https://www.zelena.tech");
    expect(appBaseUrl(env({ ZELENA_APP_URL: "https://staging.example.org/" }))).toBe("https://staging.example.org");
    expect(appBaseUrl(env({ ZELENA_APP_URL: "javascript:alert(1)" }))).toBe("https://www.zelena.tech");
  });
});

describe("C1-9 · workflow y ruta (estático)", () => {
  const RAIZ = process.cwd(); // apps/web
  const yml = fs.readFileSync(path.join(RAIZ, "..", "..", ".github", "workflows", "recordatorios.yml"), "utf8");
  const ruta = fs.readFileSync(path.join(RAIZ, "app", "api", "cron", "recordatorios", "route.ts"), "utf8");

  it("el workflow tiene schedule, workflow_dispatch y concurrency", () => {
    expect(yml).toMatch(/^\s*schedule:\s*$/m);
    expect(yml).toMatch(/cron:\s*"\*\/15 12-23 \* \* 1-5"/);
    expect(yml).toMatch(/^\s*workflow_dispatch:/m);
    expect(yml).toMatch(/^concurrency:\s*\n\s+group:\s*recordatorios\s*\n\s+cancel-in-progress:\s*false/m);
    expect(yml).toMatch(/^permissions:\s*\{\}/m);
  });

  it("usa secrets.CRON_SECRET y x-cron-secret, sin echo del secreto ni --retry, y comprueba HTTP 200", () => {
    expect(yml).toContain("${{ secrets.CRON_SECRET }}");
    expect(yml).toContain('-H "x-cron-secret: $CRON_SECRET"');
    expect(yml).not.toMatch(/echo[^\n]*\$\{?CRON_SECRET/);
    expect(yml).not.toMatch(/--retry/);
    expect(yml).not.toMatch(/curl[^\n]*\s-f\b/);
    expect(yml).toContain("%{http_code}");
    expect(yml).toMatch(/test "\$code" = 200 \|\| exit 1/);
    expect(yml).toContain("github.repository == 'zelena-tech/zelena-dapp'");
  });

  it("la ruta exporta dynamic force-dynamic, maxDuration y solo POST", () => {
    expect(ruta).toMatch(/export const dynamic = "force-dynamic";/);
    expect(ruta).toMatch(/export const maxDuration = \d+;/);
    expect(ruta).toMatch(/export async function POST\(/);
    expect(ruta).not.toMatch(/export (async )?function (GET|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
    expect(ruta).toMatch(/sin_configurar[\s\S]{0,120}status: 503/);
    expect(ruta).toMatch(/status: 401/);
    expect(ruta).toContain("autorizarCron(");
    expect(ruta).toContain('searchParams.get("simular") === "1"');
    // La cabecera nunca se registra.
    expect(ruta).not.toMatch(/console\.(log|info|warn|error)/);
  });
});

describe("C1-11 · guarda de arranque", () => {
  it("20 piezas vencidas antes de la activación → 0 inmediatos, 0 escalamientos y 1 resumen por dueño", async () => {
    const P = proyecto(db, "proyecto-piloto", "Proyecto Piloto");
    miembro(db, P, EST, "estructura");
    telegram(db, ANA, 1001);
    telegram(db, EJE, 1002);
    telegram(db, EST, 1003);
    telegram(db, SESION_FOUNDER, 1004);
    const viejo = (o: PiezaInput) =>
      pieza(db, {
        ini: P,
        status: "En curso",
        due: "2026-09-21",
        eventos: [
          ["asignar", "Backlog", "Asignada", bog("2026-09-14", "09:00")],
          ["empezar", "Asignada", "En curso", bog("2026-09-14", "09:30")],
        ],
        ...o,
      });
    for (let i = 0; i < 6; i++) viejo({ owner: ANA, priority: "Urgent" });
    for (let i = 0; i < 3; i++)
      pieza(db, {
        owner: ANA,
        ini: P,
        priority: "Urgent",
        status: "Asignada",
        eventos: [["asignar", "Backlog", "Asignada", bog("2026-09-21", "09:00")]],
      });
    for (let i = 0; i < 3; i++) viejo({ owner: ANA, priority: "High" });
    for (let i = 0; i < 4; i++) viejo({ owner: EJE, priority: "Urgent" });
    for (let i = 0; i < 4; i++) viejo({ owner: EJE, priority: "Normal" });
    // Y lo bloqueado o en revisión desde antes tampoco escala.
    pieza(db, { owner: EJE, ini: P, priority: "Urgent", status: "Bloqueada", blockedAt: bog("2026-09-14", "09:00") });
    pieza(db, {
      owner: ANA,
      ini: P,
      priority: "Urgent",
      status: "En revisión",
      eventos: [["enviar_a_revision", "En curso", "En revisión", bog("2026-09-21", "09:00")]],
    });
    expect(activadoDesde(db)).toBeNull();

    const { t, enviados } = transporte();
    const sinGuardaFija: ConfigRecordatorios = { ...CFG, activadoDesde: null };
    const r = await correr(db, { ahora: bog(LUN, "10:00"), cfg: sinGuardaFija, transport: t });
    expect(r.evaluadas).toBe(22);
    expect(r.inmediatosEnviados).toBe(0);
    for (const tipo of ["escala_supervisor", "escala_founder", "bloqueo", "revision_pendiente"] as const) {
      expect(r.porTipo[tipo] ?? 0, tipo).toBe(0);
    }
    expect(r.digestEnviados).toBe(2);
    expect(enviados.map((e) => e.chat_id).sort()).toEqual([1001, 1002]);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_inmediato = 1`)).toBe(0);
    expect(contar(db, `SELECT COUNT(*) AS n FROM avisos WHERE wallet NOT IN (?, ?)`, ANA, EJE)).toBe(0);

    // Lo que llega después de encender sí sale al momento.
    p1(db, ANA, { ini: P, due: MAR, eventos: [["asignar", "Backlog", "Asignada", bog(LUN, "10:05")]] });
    const r2 = await correr(db, { ahora: bog(LUN, "10:30"), cfg: sinGuardaFija, transport: t });
    expect(r2.inmediatosEnviados).toBe(1);
    expect(enviados.at(-1)?.text).toContain("es urgente y te espera");
  });
});

describe("C1-12 · concurrencia y reintento", () => {
  beforeEach(() => telegram(db, ANA, 1001));

  it("dos corridas a la vez con un transporte lento → 1 mensaje y la segunda en_curso", async () => {
    p1(db, ANA);
    const { t, enviados } = transporte({ lentoMs: 40 });
    const ahora = bog(LUN, "09:30");
    const [a, b] = await Promise.all([correr(db, { ahora, transport: t }), correr(db, { ahora, transport: t })]);
    expect(a.omitido).toBeUndefined();
    expect(a.inmediatosEnviados).toBe(1);
    expect(b.omitido).toBe("en_curso");
    expect(b.avisosCreados).toBe(0);
    expect(enviados).toHaveLength(1);
    // El candado se suelta al terminar: la siguiente corre (y no repite nada).
    const c = await correr(db, { ahora, transport: t });
    expect(c.omitido).toBeUndefined();
    expect(enviados).toHaveLength(1);
  });

  it("el candado se suelta aunque la corrida falle", async () => {
    p1(db, ANA);
    const roto: TelegramTransport = {
      async call() {
        throw new Error("sin red");
      },
    };
    const r = await correr(db, { ahora: bog(LUN, "09:30"), transport: roto });
    expect(r.errores).toBe(1);
    const otra = await correr(db, { ahora: bog(LUN, "09:45"), transport: null });
    expect(otra.omitido).toBeUndefined();
  });

  it("un transporte que falla una vez → el mensaje sale en la corrida siguiente", async () => {
    p1(db, ANA);
    const { t, enviados } = transporte({ fallos: 1 });
    const r1 = await correr(db, { ahora: bog(LUN, "09:30"), transport: t });
    expect(r1).toMatchObject({ avisosCreados: 1, inmediatosEnviados: 0, errores: 1 });
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_telegram = 0`)).toBe(1);
    expect(contar(db, `SELECT COUNT(*) AS n FROM avisos`)).toBe(1); // el aviso in-app ya quedó

    const r2 = await correr(db, { ahora: bog(LUN, "09:45"), transport: t });
    expect(r2).toMatchObject({ avisosCreados: 0, inmediatosEnviados: 1, errores: 0 });
    expect(enviados).toHaveLength(1);
    expect(contar(db, `SELECT COUNT(*) AS n FROM reminders_sent WHERE is_telegram = 0`)).toBe(0);
  });

  it("un resumen que falla sale en la corrida siguiente, una sola vez", async () => {
    venceHoy(db, ANA);
    const { t, enviados } = transporte({ fallos: 1 });
    const r1 = await correr(db, { ahora: bog(LUN, "10:00"), transport: t });
    expect(r1).toMatchObject({ digestEnviados: 0, errores: 1 });
    const r2 = await correr(db, { ahora: bog(LUN, "10:15"), transport: t });
    expect(r2).toMatchObject({ digestEnviados: 1, errores: 0 });
    const r3 = await correr(db, { ahora: bog(LUN, "10:30"), transport: t });
    expect(r3.digestEnviados).toBe(0);
    expect(enviados).toHaveLength(1);
  });

  it("un inmediato de un día anterior ya no sale por Telegram", async () => {
    p1(db, ANA, { title: "Restablecer el servicio" });
    const roto = transporte({ fallos: 1 });
    await correr(db, { ahora: bog(LUN, "09:30"), transport: roto.t });
    const { t, enviados } = transporte();
    const r = await correr(db, { ahora: bog(MAR, "09:00"), transport: t });
    expect(r.inmediatosEnviados).toBe(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].text).not.toContain("es urgente y te espera"); // el p1_asignada del lunes
    expect(enviados[0].text).toContain("aún no tiene primera respuesta");
  });
});

describe("C1-13 · simulación", () => {
  beforeEach(() => {
    const P = proyecto(db, "proyecto-piloto", "Proyecto Piloto");
    miembro(db, P, EST, "estructura");
    telegram(db, ANA, 1001);
    p1(db, ANA, { ini: P });
    p1(db, ANA, { ini: P });
    venceHoy(db, EJE, { ini: P });
    vencidaVieja(db, ANA, { ini: P });
  });

  it("devuelve conteos por tipo sin escribir ni enviar, aunque sea de madrugada y con la flag apagada", async () => {
    const antes = huella(db);
    const { t, enviados } = transporte();
    const r = await correr(db, { simular: true, enabled: false, ahora: bog(SAB, "03:00"), transport: t });
    expect(r).toMatchObject({ simulado: true, enabled: false, avisosCreados: 0, inmediatosEnviados: 0, digestEnviados: 0 });
    expect(r.omitido).toBeUndefined();
    expect(r.porTipo.vencida).toBeGreaterThan(0);
    expect(r.destinatarios).toBeGreaterThan(0);
    expect(enviados).toHaveLength(0);
    expect(huella(db)).toBe(antes);
    // Solo conteos: ni wallets ni nombres ni textos.
    const json = JSON.stringify(r);
    for (const w of [ANA, EJE, EST, JOHN]) expect(json).not.toContain(w);
    expect(json).not.toContain("«");
  });

  it("cuenta lo mismo que crearía una corrida real a la misma hora", async () => {
    const ahora = bog(LUN, "09:30");
    const sim = await correr(db, { simular: true, ahora });
    const real = await correr(db, { ahora });
    expect(sim.porTipo).toEqual(real.porTipo);
    expect(sim.destinatarios).toBe(real.destinatarios);
    expect(sim.inmediatos).toBe(2);
  });

  it("ignora la hora del resumen", async () => {
    const tarde: ConfigRecordatorios = { ...CFG, digestHora: 17 };
    const r = await correr(db, { simular: true, ahora: bog(LUN, "09:30"), cfg: tarde });
    expect(r.porTipo.vence_hoy).toBe(1);
  });
});
