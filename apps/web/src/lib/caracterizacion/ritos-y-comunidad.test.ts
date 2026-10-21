/**
 * Prueba de caracterización · Ritos y comunidad (ritos, código rotativo, asistencia,
 * /comunidad, encuentros y su aviso).
 * Ficha: docs/features/ritos-y-comunidad.md · DFD: docs/dfd/ritos-y-comunidad.json
 * Commit de referencia: 0e07d8f.
 *
 * Protege el comportamiento ACTUAL, no el deseado. Recorre el flujo principal por las
 * rutas reales, en el orden en que pasa en la vida real:
 *   /admin (founder) → POST /api/ritos {preparar, asignar}
 *   /comunidad/ritos/[id] (anfitrión) → POST /api/ritos {abrir} → GET /api/ritos/codigo
 *   /comunidad/ritos/[id] (asistente) → POST /api/ritos/asistir {codigo}
 *   anfitrión → POST /api/ritos {cerrar} → huella + acta + cola de anclaje + reputación
 *   /comunidad → ritosPublicos / decisionesPublicas / asistenciaPropia (sin wallets)
 * y el aviso de /encuentros (POST /api/encuentros/aviso → leads).
 *
 * Los casos marcados "HALLAZGO" fijan una rareza actual que la auditoría reporta. Si
 * alguien la corrige, esta prueba debe fallar y actualizarse en el mismo cambio.
 *
 * Dobles (y solo estos):
 *  - Reloj: `vi.useFakeTimers({ toFake: ["Date"] })`. Las rutas usan `new Date()`; se
 *    fija el calendario de la demo del viernes 9 oct 2026 16:00 Bogotá (21:00 UTC),
 *    ventana [20:30, 22:30] UTC con RITE_WINDOW_MIN = 30.
 *  - Sesión: `@/lib/session` devuelve la wallet que diga cada caso.
 * Los alias `@/lib/…` de las rutas se redirigen al módulo REAL.
 *
 * Base: SQLite en memoria con `schema.sql` + `seedIfEmpty` (cuentas sembradas = demo),
 * inyectada en `globalThis.__zelenaDb`. Personas y textos ficticios.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const sesion = vi.hoisted(() => ({ wallet: null as string | null }));

vi.mock("@/lib/db", () => import("../db"));
vi.mock("@/lib/rate-limit", () => import("../rate-limit"));
vi.mock("@/lib/ritos", () => import("../ritos"));
vi.mock("@/lib/ritos-labels", () => import("../ritos-labels"));
vi.mock("@/lib/validation", () => import("../validation"));
vi.mock("@/lib/servicios", () => import("../servicios"));
vi.mock("@/lib/session", () => ({
  getSession: async () => (sesion.wallet ? { wallet: sesion.wallet } : null),
}));

import { openDb, type DB } from "../db";
import { seedIfEmpty } from "../seed";
import { currentEpoch, GENOME_DEFAULTS } from "../genome";
import { bucketDe, codigoRito, ritesSecret } from "../ritos-codigo";
import {
  COPY_ASISTENCIA,
  asistenciaPropia,
  decisionesPublicas,
  detalleRito,
  participacionRitos,
  ritosPublicos,
} from "../ritos";
import { ENCUENTROS, proximosEncuentros } from "../encuentros";
import { INTERES_ENCUENTROS } from "../servicios";
import { POST as postRitos } from "../../../app/api/ritos/route";
import { GET as getCodigo } from "../../../app/api/ritos/codigo/route";
import { POST as postAsistir } from "../../../app/api/ritos/asistir/route";
import { POST as postAviso } from "../../../app/api/encuentros/aviso/route";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
const ROT = GENOME_DEFAULTS.RITE_CODE_ROTATION_S;

// Calendario (America/Bogota, UTC−5).
const PREP = new Date("2026-10-01T12:00:00.000Z");
const DEMO = "2026-10-09T21:00:00.000Z";
const ABRE_DEMO = new Date("2026-10-09T20:45:00.000Z");
const EN_DEMO = new Date("2026-10-09T21:10:00.000Z");
const CIERRE_DEMO = new Date("2026-10-09T22:05:00.000Z");
const DESPUES = new Date("2026-10-12T15:00:00.000Z");

// Personas ficticias (wallets de mentira).
const FOUNDER = "GCARACTERIZARITOFOUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ANF = "GCARACTERIZARITOANFITRIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REL = "GCARACTERIZARITORELATORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ASIS = "GCARACTERIZARITOASISTENTEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RESUMEN = "Resumen de prueba: se mostró lo que salió y lo que no.";

const g = globalThis as unknown as { __zelenaDb?: DB };
const dbPrevia = g.__zelenaDb;
let db: DB;
let ip = 1;

function baseTemporal(): DB {
  const d = openDb(":memory:");
  d.pragma("foreign_keys = ON");
  d.exec(SCHEMA);
  seedIfEmpty(d, { NODE_ENV: "test" } as NodeJS.ProcessEnv);
  // La época sembrada nace con la hora real de SQLite; se lleva a antes del calendario
  // del test para que "esta temporada" y la participación cuenten la demo.
  d.prepare(`UPDATE periods SET created_at = '2026-09-01 00:00:00'`).run();
  return d;
}

function persona(d: DB, wallet: string, role: string, cla = 1): void {
  d.prepare(
    `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor)
     VALUES (?, ?, 'Bronze', NULL, 'active', 0, ?, ?, ?, 0)`
  ).run(wallet, `Nombre ${wallet.slice(-8)}`, role === "founder" ? 1 : 0, cla, role);
}

function post(url: string, cuerpo: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${ip++}` },
    body: JSON.stringify(cuerpo),
  });
}

function getReq(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { headers: { "x-forwarded-for": `192.0.2.${ip++}` } });
}

async function como(wallet: string | null, fn: () => Promise<Response>): Promise<{ status: number; body: Record<string, unknown>; res: Response }> {
  sesion.wallet = wallet;
  const res = await fn();
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, res };
}

function filas(sql: string, ...p: unknown[]) {
  return db.prepare(sql).all(...p) as Array<Record<string, unknown>>;
}

/** Un código de 6 dígitos que NO es el del tramo actual ni el anterior. */
function codigoMalo(id: number, t: Date): string {
  const validos = [0, 1].map((k) => codigoRito(ritesSecret(), id, bucketDe(t.getTime(), ROT) - k));
  for (const c of ["000000", "111111", "222222"]) if (!validos.includes(c)) return c;
  return "333333";
}

/** Prepara y asigna la demo como founder; devuelve su id. */
async function prepararDemo(): Promise<number> {
  vi.setSystemTime(PREP);
  const prep = await como(FOUNDER, () =>
    postRitos(
      post("/api/ritos", {
        action: "preparar",
        kind: "demo",
        scheduledFor: DEMO,
        lugar: "Sala de prueba",
        joinUrl: "https://reunion.ejemplo.test/rito",
      })
    )
  );
  expect(prep.status).toBe(200);
  const id = Number(prep.body.id);
  const asig = await como(FOUNDER, () =>
    postRitos(post("/api/ritos", { action: "asignar", sessionId: id, hostWallet: ANF, recorderWallet: REL }))
  );
  expect(asig.body).toEqual({ ok: true, id, state: "Planned" });
  return id;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = baseTemporal();
  g.__zelenaDb = db;
  persona(db, FOUNDER, "founder");
  persona(db, ANF, "core");
  persona(db, REL, "contributor");
  persona(db, ASIS, "contributor");
  sesion.wallet = null;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  g.__zelenaDb = dbPrevia;
});

describe("gestión del rito (POST /api/ritos)", () => {
  it("preparar: founder sí (Planned, fecha normalizada); sin sesión 401; un contributor 403", async () => {
    const id = await prepararDemo();
    expect(filas(`SELECT kind, scheduled_for, duration_min, state, lugar, join_url FROM rite_sessions WHERE id = ?`, id)).toEqual([
      {
        kind: "demo",
        scheduled_for: DEMO,
        duration_min: 60,
        state: "Planned",
        lugar: "Sala de prueba",
        join_url: "https://reunion.ejemplo.test/rito",
      },
    ]);
    const sin = await como(null, () => postRitos(post("/api/ritos", { action: "abrir", sessionId: id })));
    expect(sin.status).toBe(401);
    const contrib = await como(ASIS, () =>
      postRitos(post("/api/ritos", { action: "preparar", kind: "demo", scheduledFor: "2026-10-23T21:00:00.000Z" }))
    );
    expect(contrib).toMatchObject({ status: 403, body: { error: "Preparar un rito es del founder o de un supervisor." } });
    // Una fecha que no es de la cadencia se rechaza.
    const fuera = await como(FOUNDER, () =>
      postRitos(post("/api/ritos", { action: "preparar", kind: "demo", scheduledFor: "2026-10-10T21:00:00.000Z" }))
    );
    expect(fuera.status).toBe(400);
  });

  it("abrir: antes de la ventana 409; dentro, el anfitrión lo abre", async () => {
    const id = await prepararDemo();
    vi.setSystemTime(new Date("2026-10-09T20:00:00.000Z"));
    const pronto = await como(ANF, () => postRitos(post("/api/ritos", { action: "abrir", sessionId: id })));
    expect(pronto.status).toBe(409);
    expect(pronto.body.error).toMatch(/todavía no se puede abrir/);
    vi.setSystemTime(ABRE_DEMO);
    const abre = await como(ANF, () => postRitos(post("/api/ritos", { action: "abrir", sessionId: id })));
    expect(abre.body).toEqual({ ok: true, id, state: "Open" });
  });
});

describe("flujo principal: abrir → código → asistencia → cerrar → /comunidad", () => {
  it("de punta a punta, con el conteo y nunca la lista nominal", async () => {
    const id = await prepararDemo();

    vi.setSystemTime(ABRE_DEMO);
    expect((await como(ANF, () => postRitos(post("/api/ritos", { action: "abrir", sessionId: id })))).body.state).toBe("Open");

    // El anfitrión ve el código vigente (sin caché) y el conteo.
    vi.setSystemTime(EN_DEMO);
    const cod = await como(ANF, () => getCodigo(getReq(`/api/ritos/codigo?sesion=${id}`)));
    expect(cod.status).toBe(200);
    expect(cod.res.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(cod.body).sort()).toEqual(["asistentes", "codigo", "expiraEnS"]);
    expect(cod.body.codigo).toMatch(/^\d{6}$/);
    expect(cod.body.asistentes).toBe(0);
    // Quien asiste no ve el código.
    expect((await como(ASIS, () => getCodigo(getReq(`/api/ritos/codigo?sesion=${id}`)))).status).toBe(403);

    // Código equivocado: 400 con el copy de §8.4.
    const mal = await como(ASIS, () => postAsistir(post("/api/ritos/asistir", { sessionId: id, codigo: codigoMalo(id, EN_DEMO) })));
    expect(mal).toMatchObject({ status: 400, body: { error: COPY_ASISTENCIA.codigo } });

    // Código bueno (con espacios, como lo escribe la gente): registra y suma reputación.
    const conEspacio = `${String(cod.body.codigo).slice(0, 3)} ${String(cod.body.codigo).slice(3)}`;
    const bien = await como(ASIS, () => postAsistir(post("/api/ritos/asistir", { sessionId: id, codigo: conEspacio })));
    expect(bien.body).toEqual({ ok: true, registrada: true, yaEstaba: false, reputacion: 2, mensaje: COPY_ASISTENCIA.exito });
    const otraVez = await como(ASIS, () => postAsistir(post("/api/ritos/asistir", { sessionId: id, codigo: String(cod.body.codigo) })));
    expect(otraVez.body).toEqual({ ok: true, registrada: false, yaEstaba: true, reputacion: 0, mensaje: COPY_ASISTENCIA.yaEstaba });

    expect((await como(ANF, () => getCodigo(getReq(`/api/ritos/codigo?sesion=${id}`)))).body.asistentes).toBe(1);

    // Cierre: huella, acta, cola de anclaje y reconocimiento a anfitrión y relator.
    vi.setSystemTime(CIERRE_DEMO);
    const cierre = await como(ANF, () => postRitos(post("/api/ritos", { action: "cerrar", sessionId: id, summary: RESUMEN })));
    expect(cierre.body).toEqual({ ok: true, id, state: "Closed" });

    const [rito] = filas(`SELECT state, hash, summary, decision_log_id FROM rite_sessions WHERE id = ?`, id);
    expect(rito.state).toBe("Closed");
    expect(String(rito.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(rito.summary).toBe(RESUMEN);

    expect(filas(`SELECT wallet, layer FROM rite_attendance WHERE session_id = ?`, id)).toEqual([{ wallet: ASIS, layer: 1 }]);
    const epoca = currentEpoch(db);
    expect(filas(`SELECT wallet, axis, delta, ref, period_id FROM reputation_events WHERE ref LIKE 'rito:%' ORDER BY id`)).toEqual([
      { wallet: ASIS, axis: "comunidad", delta: 2, ref: `rito:${id}:asistencia`, period_id: epoca },
      { wallet: ANF, axis: "comunidad", delta: 5, ref: `rito:${id}:anfitrion`, period_id: epoca },
      { wallet: REL, axis: "comunidad", delta: 5, ref: `rito:${id}:relator`, period_id: epoca },
    ]);
    expect(filas(`SELECT kind, ref, data_key, payload_hash, status FROM anchor_queue WHERE kind = 'rite'`)).toEqual([
      { kind: "rite", ref: String(id), data_key: `rite:${id}`, payload_hash: rito.hash, status: "pending" },
    ]);
    const [acta] = filas(`SELECT title, reason FROM decision_log WHERE id = ?`, rito.decision_log_id);
    expect(String(acta.title)).toMatch(/^Rito demo quincenal del .+ cerrado · 1 asistente$/);
    expect(String(acta.reason)).toContain(`Resumen: ${RESUMEN}`);
    expect(String(acta.reason)).toContain(`Huella del cierre: ${rito.hash}.`);
    // Ni el acta ni nada público lleva las wallets.
    for (const w of [ASIS, ANF, REL]) expect(JSON.stringify(acta)).not.toContain(w);

    // /comunidad: pasados con conteo y huella; sin wallets ni enlace de conexión.
    const pub = ritosPublicos(db, DESPUES);
    expect(pub.pasados[0]).toMatchObject({ id, kind: "demo", scheduledFor: DEMO, asistentes: 1, summary: RESUMEN, huella: rito.hash, txId: null });
    expect(pub.proximos.some((p) => p.sessionId === id)).toBe(false);
    for (const w of [ASIS, ANF, REL]) expect(JSON.stringify(pub)).not.toContain(w);
    expect(decisionesPublicas(db, 10).some((d) => d.title.startsWith("Rito "))).toBe(false);
    const det = detalleRito(db, id, false);
    expect(det).toMatchObject({ join_url: null, host_wallet: null, recorder_wallet: null, asistentes: 1, conEnlace: true, conAnfitrion: true });
    expect(asistenciaPropia(db, ASIS)).toEqual({ total: 1, estaEpoca: 1 });
  });

  it("fuera de la ventana ya no se registra asistencia (409) aunque el rito siga abierto", async () => {
    const id = await prepararDemo();
    vi.setSystemTime(ABRE_DEMO);
    await como(ANF, () => postRitos(post("/api/ritos", { action: "abrir", sessionId: id })));
    vi.setSystemTime(new Date("2026-10-09T22:45:00.000Z"));
    const tarde = await como(ASIS, () => postAsistir(post("/api/ritos/asistir", { sessionId: id, codigo: "123456" })));
    expect(tarde).toMatchObject({ status: 409, body: { error: COPY_ASISTENCIA.noAbierto } });
  });
});

describe("aviso de /encuentros (POST /api/encuentros/aviso)", () => {
  it("guarda nombre, correo y ciudad en leads con interes 'encuentros'; la lista de encuentros está vacía", async () => {
    expect(ENCUENTROS).toEqual([]);
    expect(proximosEncuentros()).toEqual([]);
    const r = await como(null, () =>
      postAviso(post("/api/encuentros/aviso", { nombre: "Persona Prueba", email: "persona@ejemplo.test", ciudad: "Bogotá", sitio: "" }))
    );
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    expect(filas(`SELECT nombre, email, empresa, interes, mensaje, estado FROM leads`)).toEqual([
      { nombre: "Persona Prueba", email: "persona@ejemplo.test", empresa: null, interes: INTERES_ENCUENTROS, mensaje: "Ciudad: Bogotá", estado: "nuevo" },
    ]);
  });
});

describe("HALLAZGOS fijados (comportamiento actual que la auditoría reporta)", () => {
  it("HALLAZGO: el aviso de encuentros se acepta sin ninguna constancia de la autorización de datos (la casilla solo vive en el navegador)", async () => {
    const r = await como(null, () =>
      postAviso(post("/api/encuentros/aviso", { nombre: "Sin Casilla", email: "sin.casilla@ejemplo.test" }))
    );
    expect(r.status).toBe(200);
    const columnas = (db.prepare(`PRAGMA table_info(leads)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(columnas.some((c) => /acept|consent|autoriz/i.test(c))).toBe(false);
  });

  it("HALLAZGO: la ruta valida `lugar` hasta 200 y la lógica hasta 120 (dos validaciones con topes distintos)", async () => {
    vi.setSystemTime(PREP);
    const r = await como(FOUNDER, () =>
      postRitos(post("/api/ritos", { action: "preparar", kind: "demo", scheduledFor: DEMO, lugar: "x".repeat(150) }))
    );
    expect(r).toMatchObject({ status: 400, body: { error: "El lugar admite hasta 120 caracteres." } });
  });

  it("HALLAZGO: la participación esperada cuenta a quien no puede asistir (sin acuerdo firmado)", async () => {
    const id = await prepararDemo();
    vi.setSystemTime(ABRE_DEMO);
    await como(ANF, () => postRitos(post("/api/ritos", { action: "abrir", sessionId: id })));
    vi.setSystemTime(CIERRE_DEMO);
    await como(ANF, () => postRitos(post("/api/ritos", { action: "cerrar", sessionId: id })));
    const antes = participacionRitos(db, currentEpoch(db));
    persona(db, "GCARACTERIZARITOSINACUERDOAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "contributor", 0);
    const despues = participacionRitos(db, currentEpoch(db));
    expect(antes).not.toBeNull();
    expect(despues!.expectedCheckins).toBe(antes!.expectedCheckins + 1);
  });
});
