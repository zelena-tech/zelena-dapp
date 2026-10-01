/**
 * WP31-D · ritos en la base (criterios D3, D4, D5, D5b, D6, D8 y D9).
 *
 * Base en memoria con `schema.sql` + `seedIfEmpty` (las cuentas sembradas son demo).
 * Las personas de cada test se crean aquí con wallets de mentira: ningún dato real.
 * Todos los instantes se inyectan (`ahora`): nada depende del reloj del servidor.
 *
 * Calendario (America/Bogota, UTC−5): demo vie 9 oct 2026 16:00 = 21:00 UTC, ventana
 * [20:30, 22:30] UTC con RITE_WINDOW_MIN = 30. Sync lun 5 oct 09:00 = 14:00 UTC.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { merkleRoot } from "./crypto";
import { currentEpoch, GENOME_DEFAULTS } from "./genome";
import { tipoDesdeEtiqueta } from "./agora-labels";
import type { Role, TeamActor } from "./roles";
import { bucketDe, codigoRito, hashCierre, ritesSecret } from "./ritos-codigo";
import {
  COPY_ASISTENCIA,
  LIMITES_ASISTENCIA,
  RitoError,
  abrirRito,
  actorDeRitos,
  anotarFallo,
  asignarRolesRito,
  asistenciaPropia,
  asistioARito,
  cerrarRito,
  codigoActual,
  decisionesPublicas,
  demasiadosFallos,
  detalleRito,
  estadoAsistencia,
  participacionRitos,
  prepararRito,
  puedePresentarRito,
  refRito,
  registrarAsistencia,
  ritosPublicos,
  sesionesGestionables,
} from "./ritos";

const WEB = process.cwd();
const SCHEMA = fs.readFileSync(path.join(WEB, "src", "lib", "schema.sql"), "utf8");
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

const ROT = GENOME_DEFAULTS.RITE_CODE_ROTATION_S;
const PREP = new Date("2026-10-01T12:00:00.000Z");
const DEMO = "2026-10-09T21:00:00.000Z";
const ABRE_DEMO = new Date("2026-10-09T20:45:00.000Z");
const EN_DEMO = new Date("2026-10-09T21:10:00.000Z");
const CIERRE_DEMO = new Date("2026-10-09T22:05:00.000Z");
const SYNC = "2026-10-05T14:00:00.000Z";
const EN_SYNC = new Date("2026-10-05T13:45:00.000Z");

function db0(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedIfEmpty(db);
  return db;
}

interface OpcionesPersona {
  role?: Role;
  sup?: boolean;
  demo?: boolean;
  cla?: boolean;
  status?: string;
}

/** Crea una persona y devuelve su actor. Nombre = "Nombre <wallet>" para buscarlo luego. */
function persona(db: DB, wallet: string, o: OpcionesPersona = {}): TeamActor {
  const role = o.role ?? "contributor";
  db.prepare(
    `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor)
     VALUES (?, ?, 'Bronze', NULL, ?, ?, ?, ?, ?, ?)`
  ).run(wallet, `Nombre ${wallet}`, o.status ?? "active", o.demo ? 1 : 0, role === "founder" ? 1 : 0, o.cla === false ? 0 : 1, role, o.sup ? 1 : 0);
  return { wallet, name: `Nombre ${wallet}`, role, isSupervisor: !!o.sup };
}

function codigoEn(sessionId: number, t: Date): string {
  return codigoRito(ritesSecret(), sessionId, bucketDe(t.getTime(), ROT));
}

function filas(db: DB, sql: string, ...p: unknown[]) {
  return db.prepare(sql).all(...p) as Array<Record<string, unknown>>;
}

function huella(db: DB): string {
  return JSON.stringify(
    ["reputation_events", "points_ledger", "rite_attendance", "rite_sessions", "anchor_queue", "decision_log"].map((t) =>
      filas(db, `SELECT * FROM ${t} ORDER BY id`)
    )
  );
}

/** Espera un RitoError con ese status (y, si se da, ese texto). */
function lanza(fn: () => unknown, status: number, texto?: RegExp | string): RitoError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RitoError);
    const r = e as RitoError;
    expect(r.status).toBe(status);
    if (texto) expect(r.message).toMatch(texto);
    return r;
  }
  throw new Error("se esperaba un RitoError");
}

let db: DB;
let fundadora: TeamActor;
let supervisora: TeamActor;
let core: TeamActor;
let anfitrion: TeamActor;
let relator: TeamActor;
let a1: TeamActor;
let a2: TeamActor;

beforeEach(() => {
  db = db0();
  fundadora = persona(db, "G_FUNDADORA", { role: "founder", sup: true });
  supervisora = persona(db, "G_SUPERVISORA", { role: "core", sup: true });
  core = persona(db, "G_CORE", { role: "core" });
  anfitrion = persona(db, "G_ANFITRION");
  relator = persona(db, "G_RELATOR");
  a1 = persona(db, "G_ASISTENTE_1");
  a2 = persona(db, "G_ASISTENTE_2");
});

function demoPreparada(): number {
  const r = prepararRito(
    db,
    fundadora,
    { kind: "demo", scheduledFor: DEMO, lugar: "Sala abierta del piso 2", joinUrl: "https://meet.example.org/demo" },
    PREP
  );
  return r.id;
}

function demoAbierta(): number {
  const id = demoPreparada();
  asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: anfitrion.wallet, recorderWallet: relator.wallet });
  abrirRito(db, anfitrion, id, ABRE_DEMO);
  return id;
}

// ---------------------------------------------------------------------------

describe("D5 · permisos de preparar, asignar, abrir, cerrar y ver el código", () => {
  it("preparar: founder y supervisor sí; core y contributor no (403)", () => {
    lanza(() => prepararRito(db, core, { kind: "demo", scheduledFor: DEMO }, PREP), 403);
    lanza(() => prepararRito(db, a1, { kind: "demo", scheduledFor: DEMO }, PREP), 403);
    expect(prepararRito(db, supervisora, { kind: "demo", scheduledFor: DEMO }, PREP).state).toBe("Planned");
    const r = prepararRito(db, fundadora, { kind: "retro", scheduledFor: "2026-10-05T15:00:00Z" }, PREP);
    expect(r).toMatchObject({ kind: "retro", scheduled_for: "2026-10-05T15:00:00.000Z", duration_min: 60, state: "Planned" });
  });

  it("el mismo instante en dos formatos → 409: la fecha se normaliza a ISO UTC antes del UNIQUE", () => {
    const r = prepararRito(db, fundadora, { kind: "demo", scheduledFor: "2026-10-09T16:00:00-05:00" }, PREP);
    expect(r.scheduled_for).toBe(DEMO);
    lanza(() => prepararRito(db, fundadora, { kind: "demo", scheduledFor: DEMO }, PREP), 409, "ya está preparado");
    expect(filas(db, `SELECT id FROM rite_sessions`)).toHaveLength(1);
  });

  it("fuera de la cadencia o a más de 60 días → 400; lugar largo o enlace sin https → 400", () => {
    lanza(() => prepararRito(db, fundadora, { kind: "demo", scheduledFor: "2026-10-16T21:00:00Z" }, PREP), 400);
    lanza(() => prepararRito(db, fundadora, { kind: "demo", scheduledFor: "2026-10-09T20:00:00Z" }, PREP), 400);
    lanza(() => prepararRito(db, fundadora, { kind: "sync", scheduledFor: "2026-12-07T14:00:00Z" }, PREP), 400);
    lanza(() => prepararRito(db, fundadora, { kind: "otro" as "sync", scheduledFor: SYNC }, PREP), 400);
    lanza(() => prepararRito(db, fundadora, { kind: "sync", scheduledFor: "no es fecha" }, PREP), 400);
    lanza(() => prepararRito(db, fundadora, { kind: "demo", scheduledFor: DEMO, lugar: "x".repeat(121) }, PREP), 400);
    lanza(() => prepararRito(db, fundadora, { kind: "demo", scheduledFor: DEMO, joinUrl: "http://meet.example.org/x" }, PREP), 400);
    lanza(() => prepararRito(db, fundadora, { kind: "demo", scheduledFor: DEMO, joinUrl: "javascript:alert(1)" }, PREP), 400);
    expect(filas(db, `SELECT id FROM rite_sessions`)).toHaveLength(0);
  });

  it("asignar: solo founder o supervisor; quien presenta necesita cuenta real con acuerdo; dos personas distintas", () => {
    const id = demoPreparada();
    persona(db, "G_DEMO", { demo: true });
    persona(db, "G_SIN_ACUERDO", { cla: false });
    lanza(() => asignarRolesRito(db, core, { sessionId: id, hostWallet: anfitrion.wallet }), 403);
    lanza(() => asignarRolesRito(db, anfitrion, { sessionId: id, hostWallet: anfitrion.wallet }), 403);
    lanza(() => asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: "G_DEMO" }), 400);
    lanza(() => asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: "G_SIN_ACUERDO" }), 400);
    lanza(() => asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: "pending:juan" }), 400);
    lanza(() => asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: "G_NO_EXISTE" }), 400);
    lanza(() => asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: a1.wallet, recorderWallet: a1.wallet }), 409);
    lanza(() => asignarRolesRito(db, fundadora, { sessionId: 999, hostWallet: a1.wallet }), 404);

    const r = asignarRolesRito(db, supervisora, { sessionId: id, hostWallet: anfitrion.wallet, recorderWallet: relator.wallet });
    expect([r.host_wallet, r.recorder_wallet]).toEqual([anfitrion.wallet, relator.wallet]);
    // undefined no cambia; null quita.
    const r2 = asignarRolesRito(db, fundadora, { sessionId: id, recorderWallet: null });
    expect([r2.host_wallet, r2.recorder_wallet]).toEqual([anfitrion.wallet, null]);
  });

  it("abrir: el anfitrión (aunque sea de la comunidad) sí; otra persona no; fuera de la ventana → 409", () => {
    const id = demoPreparada();
    asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: anfitrion.wallet });
    expect(puedePresentarRito(db, anfitrion, id)).toBe(true);
    expect(puedePresentarRito(db, a1, id)).toBe(false);
    expect(puedePresentarRito(db, core, id)).toBe(false);
    lanza(() => abrirRito(db, a1, id, ABRE_DEMO), 403);
    lanza(() => abrirRito(db, core, id, ABRE_DEMO), 403);
    lanza(
      () => abrirRito(db, anfitrion, id, new Date("2026-10-09T20:29:00Z")),
      409,
      "Este rito todavía no se puede abrir: se abre media hora antes de empezar."
    );
    lanza(() => abrirRito(db, anfitrion, id, new Date("2026-10-09T22:31:00Z")), 409, /ventana/);
    const r = abrirRito(db, anfitrion, id, ABRE_DEMO);
    expect(r.state).toBe("Open");
    expect(r.opened_at).toBe("2026-10-09 20:45:00");
    lanza(() => abrirRito(db, fundadora, id, ABRE_DEMO), 409, "ya está abierto");
  });

  it("código: solo quien presenta y con el rito abierto; da el conteo, nunca la lista", () => {
    const id = demoPreparada();
    asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: anfitrion.wallet });
    lanza(() => codigoActual(db, anfitrion, id, ABRE_DEMO), 409, COPY_ASISTENCIA.noAbierto);
    abrirRito(db, anfitrion, id, ABRE_DEMO);
    lanza(() => codigoActual(db, a1, id, EN_DEMO), 403);
    lanza(() => codigoActual(db, core, id, EN_DEMO), 403);
    const c = codigoActual(db, anfitrion, id, EN_DEMO);
    expect(c.codigo).toBe(codigoEn(id, EN_DEMO));
    expect(c.expiraEnS).toBeGreaterThan(0);
    expect(c.expiraEnS).toBeLessThanOrEqual(ROT);
    expect(c.asistentes).toBe(0);
    expect(Object.keys(c).sort()).toEqual(["asistentes", "codigo", "expiraEnS"]);
    expect(codigoActual(db, supervisora, id, EN_DEMO).codigo).toBe(c.codigo);
    // Pasada la ventana ya no hay código que dar.
    lanza(() => codigoActual(db, anfitrion, id, new Date("2026-10-09T22:31:00Z")), 409, /ventana/);
  });

  it("cerrar: solo quien presenta y solo un rito abierto", () => {
    const id = demoPreparada();
    asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: anfitrion.wallet });
    lanza(() => cerrarRito(db, anfitrion, { sessionId: id }, CIERRE_DEMO), 409, "Solo se cierra un rito abierto.");
    abrirRito(db, anfitrion, id, ABRE_DEMO);
    lanza(() => cerrarRito(db, a1, { sessionId: id }, CIERRE_DEMO), 403);
    lanza(() => cerrarRito(db, anfitrion, { sessionId: id, notesUrl: "ftp://acta" }, CIERRE_DEMO), 400);
    expect(cerrarRito(db, anfitrion, { sessionId: id }, CIERRE_DEMO).state).toBe("Closed");
  });

  it("el actor sale de la base: sin fila o inactivo no es nadie", () => {
    persona(db, "G_ALUMNI", { status: "alumni" });
    expect(actorDeRitos(db, "G_NO_EXISTE")).toBeNull();
    expect(actorDeRitos(db, "G_ALUMNI")).toBeNull();
    expect(actorDeRitos(db, null)).toBeNull();
    expect(actorDeRitos(db, fundadora.wallet)).toMatchObject({ wallet: fundadora.wallet, role: "founder", isSupervisor: true });
  });
});

describe("D3 · registrar asistencia", () => {
  it("solo con el rito abierto y dentro de su ventana", () => {
    const id = demoPreparada();
    asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: anfitrion.wallet });
    const r = lanza(
      () => registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO),
      409,
      COPY_ASISTENCIA.noAbierto
    );
    expect(r.motivo).toBe("no_abierto");
    abrirRito(db, anfitrion, id, ABRE_DEMO);
    const tarde = new Date("2026-10-09T22:31:00Z");
    lanza(() => registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, tarde) }, tarde), 409, COPY_ASISTENCIA.noAbierto);
    lanza(() => registrarAsistencia(db, a1.wallet, { sessionId: 999, codigo: "000000" }, EN_DEMO), 404);
    expect(filas(db, `SELECT id FROM rite_attendance`)).toHaveLength(0);
  });

  it("acepta el código actual o el anterior (y lo normaliza); uno incorrecto → 400 con el copy", () => {
    const id = demoAbierta();
    const mal = lanza(() => registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: "abc" }, EN_DEMO), 400, COPY_ASISTENCIA.codigo);
    expect(mal.motivo).toBe("codigo");
    const viejo = codigoEn(id, new Date(EN_DEMO.getTime() - 2 * ROT * 1000));
    if (viejo !== codigoEn(id, EN_DEMO) && viejo !== codigoEn(id, new Date(EN_DEMO.getTime() - ROT * 1000))) {
      lanza(() => registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: viejo }, EN_DEMO), 400, COPY_ASISTENCIA.codigo);
    }

    const actual = codigoEn(id, EN_DEMO);
    const conEspacio = `${actual.slice(0, 3)} ${actual.slice(3)}`;
    expect(registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: conEspacio }, EN_DEMO)).toEqual({
      registrada: true,
      yaEstaba: false,
      reputacion: GENOME_DEFAULTS.RITE_ATTEND_REP,
    });
    const anterior = codigoEn(id, new Date(EN_DEMO.getTime() - ROT * 1000));
    expect(registrarAsistencia(db, a2.wallet, { sessionId: id, codigo: anterior }, EN_DEMO).registrada).toBe(true);
    expect(codigoActual(db, anfitrion, id, EN_DEMO).asistentes).toBe(2);
  });

  it("una vez por persona, también con dos identidades; +2 de comunidad una sola vez con period_id explícito", () => {
    // Época 2 abierta: si el INSERT omitiera period_id, caería en la 1 por el DEFAULT.
    db.prepare(`INSERT INTO periods (name, epoch_budget, academia_budget, state) VALUES ('Época 2', 100000, 5000, 'Open')`).run();
    expect(currentEpoch(db)).toBe(2);
    // Dos filas founder activas = la misma persona (identidadesDe).
    const otraFila = persona(db, "G_FUNDADORA_SESION", { role: "founder", sup: true });
    const id = demoAbierta();
    const codigo = codigoEn(id, EN_DEMO);

    expect(registrarAsistencia(db, fundadora.wallet, { sessionId: id, codigo }, EN_DEMO).registrada).toBe(true);
    expect(registrarAsistencia(db, fundadora.wallet, { sessionId: id, codigo }, EN_DEMO)).toEqual({
      registrada: false,
      yaEstaba: true,
      reputacion: 0,
    });
    expect(registrarAsistencia(db, otraFila.wallet, { sessionId: id, codigo }, EN_DEMO).yaEstaba).toBe(true);
    expect(asistioARito(db, otraFila.wallet, id)).toBe(true);

    expect(filas(db, `SELECT wallet FROM rite_attendance WHERE session_id = ?`, id)).toEqual([{ wallet: fundadora.wallet }]);
    const rep = filas(db, `SELECT wallet, axis, delta, ref, period_id FROM reputation_events WHERE ref LIKE 'rito:%'`);
    expect(rep).toEqual([
      { wallet: fundadora.wallet, axis: "comunidad", delta: 2, ref: refRito(id, "asistencia"), period_id: 2 },
    ]);
  });

  it("rechaza cuentas demo, principales pending: y personas sin acuerdo (con su copy)", () => {
    const id = demoAbierta();
    const codigo = codigoEn(id, EN_DEMO);
    persona(db, "G_DEMO", { demo: true });
    persona(db, "G_SIN_ACUERDO", { cla: false });
    persona(db, "G_ALUMNI", { status: "alumni" });
    expect(lanza(() => registrarAsistencia(db, "G_DEMO", { sessionId: id, codigo }, EN_DEMO), 403).motivo).toBe("demo");
    expect(lanza(() => registrarAsistencia(db, "pending:juan", { sessionId: id, codigo }, EN_DEMO), 403).motivo).toBe("pendiente");
    expect(
      lanza(() => registrarAsistencia(db, "G_SIN_ACUERDO", { sessionId: id, codigo }, EN_DEMO), 403, COPY_ASISTENCIA.sinAcuerdo).motivo
    ).toBe("sin_acuerdo");
    expect(lanza(() => registrarAsistencia(db, "G_ALUMNI", { sessionId: id, codigo }, EN_DEMO), 403).motivo).toBe("inactiva");
    expect(lanza(() => registrarAsistencia(db, "G_NO_EXISTE", { sessionId: id, codigo }, EN_DEMO), 401).motivo).toBe("sin_cuenta");
    expect(filas(db, `SELECT id FROM rite_attendance`)).toHaveLength(0);
    expect(filas(db, `SELECT id FROM reputation_events WHERE ref LIKE 'rito:%'`)).toHaveLength(0);
  });

  it("el sync es del equipo: un contributor no registra; alguien del equipo interno sí", () => {
    const id = prepararRito(db, fundadora, { kind: "sync", scheduledFor: SYNC }, PREP).id;
    abrirRito(db, fundadora, id, EN_SYNC);
    const codigo = codigoEn(id, EN_SYNC);
    const r = lanza(() => registrarAsistencia(db, a1.wallet, { sessionId: id, codigo }, EN_SYNC), 403);
    expect(r.motivo).toBe("audiencia");
    expect(registrarAsistencia(db, core.wallet, { sessionId: id, codigo }, EN_SYNC).registrada).toBe(true);
  });

  it("estadoAsistencia dice a la página qué mostrar sin mirar el código", () => {
    const id = demoPreparada();
    expect(estadoAsistencia(db, a1.wallet, id, EN_DEMO)).toEqual({ puede: false, yaEstaba: false, mensaje: COPY_ASISTENCIA.noAbierto });
    asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: anfitrion.wallet });
    abrirRito(db, anfitrion, id, ABRE_DEMO);
    expect(estadoAsistencia(db, a1.wallet, id, EN_DEMO)).toEqual({ puede: true, yaEstaba: false, mensaje: null });
    persona(db, "G_SIN_ACUERDO", { cla: false });
    expect(estadoAsistencia(db, "G_SIN_ACUERDO", id, EN_DEMO).mensaje).toBe(COPY_ASISTENCIA.sinAcuerdo);
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    expect(estadoAsistencia(db, a1.wallet, id, EN_DEMO)).toEqual({ puede: false, yaEstaba: true, mensaje: COPY_ASISTENCIA.yaEstaba });
  });

  it("límite de fallos por (rito, persona): 20 y se corta", () => {
    const t = Date.parse("2026-10-09T21:00:00Z");
    expect(LIMITES_ASISTENCIA).toEqual({ intentosPorMinuto: 10, fallosPorRito: 20 });
    for (let i = 0; i < 19; i++) anotarFallo(4242, "G_INTENTOS", t);
    expect(demasiadosFallos(4242, "G_INTENTOS", t)).toBe(false);
    expect(anotarFallo(4242, "G_INTENTOS", t)).toBe(20);
    expect(demasiadosFallos(4242, "G_INTENTOS", t)).toBe(true);
    expect(demasiadosFallos(4243, "G_INTENTOS", t)).toBe(false); // otro rito
    expect(demasiadosFallos(4242, "G_INTENTOS", t + 25 * 60 * 60 * 1000)).toBe(false); // caduca
  });
});

describe("D4 · cerrar un rito", () => {
  it("huella determinista, anclaje 'rite', acta 'Rito …' y reconocimiento a anfitrión y relator una sola vez", () => {
    const id = demoAbierta();
    registrarAsistencia(db, a2.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    const r = cerrarRito(
      db,
      anfitrion,
      { sessionId: id, summary: "Se mostró el tablero nuevo.", notesUrl: "https://notas.example.org/acta" },
      CIERRE_DEMO
    );

    const esperado = hashCierre({
      kind: "demo",
      scheduledFor: DEMO,
      asistentes: [a1.wallet, a2.wallet],
      host: anfitrion.wallet,
      recorder: relator.wallet,
      summary: "Se mostró el tablero nuevo.",
    });
    expect(r).toMatchObject({ state: "Closed", hash: esperado, closed_at: "2026-10-09 22:05:00", notes_url: "https://notas.example.org/acta" });

    const anclas = filas(db, `SELECT kind, ref, data_key, payload_hash, status FROM anchor_queue WHERE kind = 'rite'`);
    expect(anclas).toEqual([{ kind: "rite", ref: String(id), data_key: `rite:${id}`, payload_hash: esperado, status: "pending" }]);

    const acta = db.prepare(`SELECT title, reason, date FROM decision_log WHERE id = ?`).get(r.decision_log_id) as {
      title: string;
      reason: string;
      date: string;
    };
    expect(acta.title).toBe("Rito demo quincenal del 9 de octubre de 2026 cerrado · 2 asistentes");
    expect(acta.date).toBe("2026-10-09");
    expect(acta.reason).toContain(esperado);
    // El acta no nombra a nadie.
    for (const w of [a1.wallet, a2.wallet, anfitrion.wallet, relator.wallet]) expect(acta.title + acta.reason).not.toContain(w);

    const rep = filas(db, `SELECT wallet, delta, ref FROM reputation_events WHERE ref LIKE 'rito:%' ORDER BY ref, wallet`);
    expect(rep).toEqual([
      { wallet: anfitrion.wallet, delta: 5, ref: refRito(id, "anfitrion") },
      { wallet: a1.wallet, delta: 2, ref: refRito(id, "asistencia") },
      { wallet: a2.wallet, delta: 2, ref: refRito(id, "asistencia") },
      { wallet: relator.wallet, delta: 5, ref: refRito(id, "relator") },
    ]);
  });

  it("no se cierra dos veces y nada se duplica; nunca hay deltas negativos", () => {
    const id = demoAbierta();
    cerrarRito(db, anfitrion, { sessionId: id }, CIERRE_DEMO);
    const antes = huella(db);
    lanza(() => cerrarRito(db, fundadora, { sessionId: id }, CIERRE_DEMO), 409, "ya se cerró");
    lanza(() => abrirRito(db, fundadora, id, ABRE_DEMO), 409);
    lanza(() => asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: a1.wallet }), 409);
    expect(huella(db)).toBe(antes);
    const min = db.prepare(`SELECT MIN(delta) AS m FROM reputation_events`).get() as { m: number | null };
    expect(min.m === null || min.m > 0).toBe(true);
  });

  it("sin anfitrión ni relator también cierra (sin reconocimiento que dar) y el acta dice '1 asistente'", () => {
    const id = demoPreparada();
    abrirRito(db, fundadora, id, ABRE_DEMO);
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    const r = cerrarRito(db, fundadora, { sessionId: id }, CIERRE_DEMO);
    const acta = db.prepare(`SELECT title FROM decision_log WHERE id = ?`).get(r.decision_log_id) as { title: string };
    expect(acta.title).toMatch(/^Rito demo quincenal del .* · 1 asistente$/);
    expect(filas(db, `SELECT ref FROM reputation_events WHERE ref LIKE 'rito:%'`)).toEqual([{ ref: refRito(id, "asistencia") }]);
  });
});

describe("D5b · tras cerrar la época N, los ritos no cambian su raíz", () => {
  /** Hojas de la época: JSON canónico por fila de los dos ledgers, orden (tabla, id). */
  function hojas(e: number): string[] {
    return [
      ...filas(db, `SELECT * FROM points_ledger WHERE period_id = ? ORDER BY id`, e).map((r) => JSON.stringify(["points_ledger", r])),
      ...filas(db, `SELECT * FROM reputation_events WHERE period_id = ? ORDER BY id`, e).map((r) =>
        JSON.stringify(["reputation_events", r])
      ),
    ];
  }

  it("asistir y cerrar un rito después del cierre no toca la época cerrada", () => {
    // Época 1: un rito completo.
    const id1 = demoAbierta();
    registrarAsistencia(db, a1.wallet, { sessionId: id1, codigo: codigoEn(id1, EN_DEMO) }, EN_DEMO);
    cerrarRito(db, anfitrion, { sessionId: id1 }, CIERRE_DEMO);
    expect(hojas(1).length).toBeGreaterThan(0);

    // Cierre de la época 1 y apertura de la 2 (lo hará epocas.ts: aquí, lo mínimo).
    const raiz = merkleRoot(hojas(1));
    db.prepare(`UPDATE periods SET state = 'Closed', merkle_root = ? WHERE id = 1`).run(raiz);
    db.prepare(`INSERT INTO periods (name, epoch_budget, academia_budget, state) VALUES ('Época 2', 100000, 5000, 'Open')`).run();

    // Época 2: otra demo, asistencia y cierre; y un intento de volver a emitir la anterior.
    const prep2 = new Date("2026-10-20T12:00:00Z");
    const id2 = prepararRito(db, fundadora, { kind: "demo", scheduledFor: "2026-10-23T21:00:00.000Z" }, prep2).id;
    asignarRolesRito(db, fundadora, { sessionId: id2, hostWallet: anfitrion.wallet, recorderWallet: relator.wallet });
    abrirRito(db, anfitrion, id2, new Date("2026-10-23T20:45:00Z"));
    const t2 = new Date("2026-10-23T21:05:00Z");
    registrarAsistencia(db, a1.wallet, { sessionId: id2, codigo: codigoEn(id2, t2) }, t2);
    registrarAsistencia(db, a2.wallet, { sessionId: id2, codigo: codigoEn(id2, t2) }, t2);
    cerrarRito(db, anfitrion, { sessionId: id2 }, new Date("2026-10-23T22:10:00Z"));

    expect(merkleRoot(hojas(1))).toBe(raiz);
    const nuevas = filas(db, `SELECT DISTINCT period_id FROM reputation_events WHERE ref LIKE ?`, `rito:${id2}:%`);
    expect(nuevas).toEqual([{ period_id: 2 }]);
  });
});

describe("D6 · lecturas públicas sin wallets ni nombres; el enlace solo con sesión", () => {
  it("ritosPublicos, detalleRito y sesionesGestionables", () => {
    const id = demoAbierta();
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    const retro = prepararRito(db, fundadora, { kind: "retro", scheduledFor: "2026-11-02T15:00:00Z", joinUrl: "https://meet.example.org/retro" }, PREP);
    cerrarRito(db, anfitrion, { sessionId: id, summary: "Resumen público." }, CIERRE_DEMO);

    const prohibidos = [fundadora, supervisora, anfitrion, relator, a1, a2].flatMap((p) => [p.wallet, p.name]);
    const sinDatos = (x: unknown) => {
      const s = JSON.stringify(x);
      for (const w of prohibidos) expect(s).not.toContain(w);
    };

    const pub = ritosPublicos(db, new Date("2026-10-09T23:00:00Z"));
    sinDatos(pub);
    expect(JSON.stringify(pub)).not.toContain("meet.example.org");
    expect(pub.proximos.every((p) => p.kind !== "sync")).toBe(true);
    expect(pub.pasados).toEqual([
      expect.objectContaining({ id, kind: "demo", scheduledFor: DEMO, asistentes: 1, summary: "Resumen público.", txId: null }),
    ]);
    const proxRetro = pub.proximos.find((p) => p.sessionId === retro.id);
    expect(proxRetro).toMatchObject({ kind: "retro", state: "Planned", conEnlace: true });

    const sinSesion = detalleRito(db, retro.id, false);
    const conSesion = detalleRito(db, retro.id, true);
    sinDatos(sinSesion);
    sinDatos(conSesion);
    expect(sinSesion?.join_url).toBeNull();
    expect(conSesion?.join_url).toBe("https://meet.example.org/retro");
    const cerrado = detalleRito(db, id, true);
    sinDatos(cerrado);
    expect(cerrado).toMatchObject({ asistentes: 1, conAnfitrion: true, conRelator: true, host_wallet: null, recorder_wallet: null });
    expect(detalleRito(db, 999, true)).toBeUndefined();

    const gest = sesionesGestionables(db, new Date("2026-10-09T23:00:00Z"));
    sinDatos(gest);
    expect(gest.map((g) => [g.id, g.state, g.asistentes])).toEqual([
      [retro.id, "Planned", 0],
      [id, "Closed", 1],
    ]);
  });

  it("txId solo si el anclaje es verificable; 'pendiente de cerrar' si la ventana pasó abierta", () => {
    const id = demoAbierta();
    expect(sesionesGestionables(db, EN_DEMO)[0].pendienteDeCerrar).toBe(false);
    expect(sesionesGestionables(db, new Date("2026-10-09T22:31:00Z"))[0].pendienteDeCerrar).toBe(true);
    cerrarRito(db, anfitrion, { sessionId: id }, CIERRE_DEMO);
    db.prepare(`UPDATE anchor_queue SET status = 'anchored', tx_id = 'SEEDTX_NO_VALE' WHERE kind = 'rite'`).run();
    expect(ritosPublicos(db, CIERRE_DEMO).pasados[0].txId).toBeNull();
    const tx = "a".repeat(64);
    db.prepare(`UPDATE anchor_queue SET tx_id = ? WHERE kind = 'rite'`).run(tx);
    expect(ritosPublicos(db, CIERRE_DEMO).pasados[0].txId).toBe(tx);
  });

  it("los próximos de comunidad marcan la sesión preparada; uno cerrado deja de ser 'próximo'", () => {
    const id = demoAbierta();
    const enCurso = ritosPublicos(db, EN_DEMO);
    expect(enCurso.proximos[0]).toMatchObject({ kind: "demo", sessionId: id, state: "Open", lugar: "Sala abierta del piso 2", conEnlace: true });
    cerrarRito(db, anfitrion, { sessionId: id }, new Date("2026-10-09T21:20:00Z"));
    const despues = ritosPublicos(db, new Date("2026-10-09T21:25:00Z"));
    expect(despues.proximos.some((p) => p.sessionId === id)).toBe(false);
    expect(despues.pasados.map((p) => p.id)).toEqual([id]);
  });
});

describe("asistencia propia (cada quien ve la suya)", () => {
  it("cuenta sus ritos, en total y en esta época, sumando sus identidades", () => {
    db.prepare(`UPDATE periods SET created_at = '2026-09-01 00:00:00' WHERE id = 1`).run();
    const id = demoAbierta();
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    expect(asistenciaPropia(db, a1.wallet)).toEqual({ total: 1, estaEpoca: 1 });
    expect(asistenciaPropia(db, a2.wallet)).toEqual({ total: 0, estaEpoca: 0 });
    // Época nueva (creada después): el total sigue, "esta temporada" vuelve a 0.
    db.prepare(
      `INSERT INTO periods (name, epoch_budget, academia_budget, state, created_at) VALUES ('Época 2', 100000, 5000, 'Open', '2026-10-15 00:00:00')`
    ).run();
    expect(asistenciaPropia(db, a1.wallet)).toEqual({ total: 1, estaEpoca: 0 });
    expect(asistenciaPropia(db, a1.wallet, 1)).toEqual({ total: 1, estaEpoca: 1 });
  });
});

describe("participación de la época (para el fitness)", () => {
  it("sin ritos cerrados en la época → null; con uno → asistencias / (personas × ritos)", () => {
    db.prepare(`UPDATE periods SET created_at = '2026-09-01 00:00:00' WHERE id = 1`).run();
    expect(participacionRitos(db, 1)).toBeNull();
    const id = demoAbierta();
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    expect(participacionRitos(db, 1)).toBeNull(); // abierto aún: no cuenta
    cerrarRito(db, anfitrion, { sessionId: id }, CIERRE_DEMO);
    const personas = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND is_demo = 0 AND wallet NOT LIKE 'pending:%'`)
        .get() as { n: number }
    ).n;
    expect(participacionRitos(db, 1)).toEqual({ checkins: 1, expectedCheckins: personas });
    expect(participacionRitos(db, 99)).toBeNull();
  });
});

describe("D9 · decisionesPublicas", () => {
  it("orden descendente, sin actas de ritos ni la decisión reemplazada; 3 por defecto", () => {
    const ins = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-10-01', ?, ?, 'h')`);
    const n1 = Number(ins.run("Una decisión normal", "Porque sí.").lastInsertRowid);
    ins.run("Rito demo quincenal del 9 de octubre de 2026 cerrado · 2 asistentes", "Acta.");
    ins.run("La decisión vieja", `Las campañas quedan etiquetadas ${tipoDesdeEtiqueta("cliente")}, con hitos.`);
    const n2 = Number(ins.run("Otra decisión normal", "También.").lastInsertRowid);

    const d = decisionesPublicas(db);
    expect(d).toHaveLength(3);
    expect(d[0].id).toBe(n2);
    expect(d[1].id).toBe(n1);
    for (let i = 1; i < d.length; i++) expect(d[i].id).toBeLessThan(d[i - 1].id);
    const todas = decisionesPublicas(db, 100);
    expect(todas.some((x) => x.title.startsWith("Rito "))).toBe(false);
    expect(todas.some((x) => x.title === "La decisión vieja")).toBe(false);
    expect(Object.keys(d[0]).sort()).toEqual(["date", "hash", "id", "reason", "title"]);
    expect(decisionesPublicas(db, 0)).toEqual([]);
  });
});

describe("D8 (corte 1) y reglas duras · estáticos", () => {
  it("ritos.ts nunca hace UPDATE ni DELETE de los ledgers", () => {
    const src = leer("src/lib/ritos.ts");
    expect(src).not.toMatch(/UPDATE\s+points_ledger|DELETE\s+FROM\s+points_ledger|UPDATE\s+reputation_events|DELETE\s+FROM\s+reputation_events/i);
  });

  it("todo INSERT en reputation_events de los ritos lleva period_id explícito", () => {
    for (const r of ["src/lib/ritos.ts"]) {
      const inserts = leer(r).match(/INSERT INTO reputation_events[^`]*/g) ?? [];
      expect(inserts.length).toBeGreaterThan(0);
      for (const i of inserts) expect(i).toContain("period_id");
    }
  });

  it("el código nuevo de ritos no usa la hora del servidor", () => {
    for (const r of ["src/lib/ritos.ts", "src/lib/ritos-codigo.ts", "src/lib/ritos-labels.ts"]) {
      expect(leer(r)).not.toMatch(/\btoday\(|\.getHours\(|\.getDate\(|INSERT OR IGNORE|ON CONFLICT/);
    }
  });

  it("/api/ritos/codigo responde con Cache-Control: no-store; las tres rutas limitan tasa", () => {
    const codigo = leer("app/api/ritos/codigo/route.ts");
    expect(codigo).toMatch(/"Cache-Control":\s*"no-store"/);
    expect(codigo).toContain("codigoActual(");
    for (const r of ["app/api/ritos/route.ts", "app/api/ritos/codigo/route.ts", "app/api/ritos/asistir/route.ts"]) {
      const src = leer(r);
      expect(src).toContain("rateLimit(");
      expect(src).toContain("no-store");
      expect(src).toContain("getSession(");
      expect(src).not.toContain("actorFromSession(");
    }
    const asistir = leer("app/api/ritos/asistir/route.ts");
    expect(asistir).toContain("LIMITES_ASISTENCIA.intentosPorMinuto");
    expect(asistir).toContain("demasiadosFallos(");
    expect(asistir).toContain("anotarFallo(");
  });

  it("los componentes de cliente de ritos no importan nada de servidor", () => {
    for (const r of ["src/components/RitoCodigo.tsx", "src/components/RitoAsistenciaForm.tsx", "src/components/RitoAnfitrionAcciones.tsx"]) {
      const src = leer(r);
      expect(src.startsWith('"use client";')).toBe(true);
      const imports = src.split("\n").filter((l) => /^\s*import\b/.test(l) && !/^\s*import type\b/.test(l));
      for (const l of imports) {
        expect(l).not.toMatch(/@\/lib\/(db|crypto|session|ritos|ritos-codigo|authz|genome)["']|node:/);
      }
    }
  });
});
