/**
 * WP31-D · ritos en la base (criterios D3, D4, D5, D5b, D6, D8 y D9), y la gestión
 * del corte 2 en /admin (épocas y ritos) y en la landing (próxima demo o retro).
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
import { merkleRoot, sha256Hex } from "./crypto";
import { currentEpoch, GENOME_DEFAULTS } from "./genome";
import { computeAndStoreEpochFitness, signEpochDecision } from "./epochs";
import { recordNoMutation } from "./mutation";
import { cerrarYAbrirEpoca, hojasDeEpoca } from "./epocas";
import { translate } from "./sql-dialect";
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
  candidatosPresentador,
  cerrarRito,
  codigoActual,
  decisionesPublicas,
  demasiadosFallos,
  detalleRito,
  estadoAsistencia,
  ocurrenciasPreparables,
  panelRitosAdmin,
  participacionRitos,
  prepararRito,
  proximoRitoDeComunidad,
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

/**
 * Suma a la persona a un proyecto (la fila que deja `agregarMiembro`): con el acuerdo
 * firmado, un contributor pasa a tener `equipoActor` con alcance 'proyectos'.
 */
function miembroDeProyecto(db: DB, wallet: string): void {
  let ini = db.prepare(`SELECT id FROM initiatives WHERE slug = 'rito-proyecto-de-prueba'`).get() as { id: number } | undefined;
  if (!ini) {
    const r = db.prepare(`INSERT INTO initiatives (slug, name) VALUES ('rito-proyecto-de-prueba', 'Proyecto de prueba')`).run();
    ini = { id: Number(r.lastInsertRowid) };
  }
  db.prepare(`INSERT INTO project_members (initiative_id, wallet, rol_proyecto, vinculo) VALUES (?, ?, 'ejecuta', 'externo')`).run(
    ini.id,
    wallet
  );
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

/**
 * El ataque del revisor (§4.D.6): con las wallets candidatas y lo que publica
 * `ritosPublicos` (tipo, fecha, conteo, resumen y huella), probar cada lista de
 * tamaño N con cada anfitrión y relator posibles contra el sha256 del JSON canónico.
 */
function enumerarLista(
  pasado: { kind: string; scheduledFor: string; asistentes: number; summary: string | null; huella: string | null },
  candidatas: string[]
): string[] | null {
  const listas = (xs: string[], n: number): string[][] =>
    n === 0 ? [[]] : xs.length < n ? [] : [...listas(xs.slice(1), n - 1).map((l) => [xs[0], ...l]), ...listas(xs.slice(1), n)];
  const papeles = [null, ...candidatas];
  for (const lista of listas(candidatas, pasado.asistentes)) {
    for (const host of papeles) {
      for (const recorder of papeles) {
        const canonico = JSON.stringify({
          asistentes: [...lista].sort(),
          host,
          kind: pasado.kind,
          recorder,
          scheduledFor: pasado.scheduledFor,
          summary: pasado.summary,
        });
        if (sha256Hex(canonico) === pasado.huella) return lista;
      }
    }
  }
  return null;
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

  it("el sync es del equipo y de quien trabaja en un proyecto: la misma puerta que /equipo (equipoActor)", () => {
    const id = prepararRito(db, fundadora, { kind: "sync", scheduledFor: SYNC }, PREP).id;
    abrirRito(db, fundadora, id, EN_SYNC);
    const codigo = codigoEn(id, EN_SYNC);
    // Un contributor de la comunidad sin proyecto: no es su sync.
    const r = lanza(() => registrarAsistencia(db, a1.wallet, { sessionId: id, codigo }, EN_SYNC), 403);
    expect(r.motivo).toBe("audiencia");
    // El equipo interno, sí.
    expect(registrarAsistencia(db, core.wallet, { sessionId: id, codigo }, EN_SYNC).registrada).toBe(true);
    // Un contributor con el acuerdo firmado y una membresía (alcance 'proyectos'), también.
    miembroDeProyecto(db, a2.wallet);
    expect(registrarAsistencia(db, a2.wallet, { sessionId: id, codigo }, EN_SYNC)).toMatchObject({ registrada: true, reputacion: 2 });
    // Con membresía pero sin acuerdo no pasa (sin acuerdo no hay primer trabajo).
    persona(db, "G_MIEMBRO_SIN_ACUERDO", { cla: false });
    miembroDeProyecto(db, "G_MIEMBRO_SIN_ACUERDO");
    lanza(() => registrarAsistencia(db, "G_MIEMBRO_SIN_ACUERDO", { sessionId: id, codigo }, EN_SYNC), 403, COPY_ASISTENCIA.sinAcuerdo);
    expect(filas(db, `SELECT wallet FROM rite_attendance WHERE session_id = ? ORDER BY wallet`, id)).toEqual([
      { wallet: a2.wallet },
      { wallet: core.wallet },
    ]);
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

  it("la lista nominal no se saca de la huella pública enumerando wallets candidatas", () => {
    const id = demoAbierta();
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    registrarAsistencia(db, a2.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    cerrarRito(db, anfitrion, { sessionId: id, summary: "Resumen público." }, CIERRE_DEMO);

    const [pasado] = ritosPublicos(db, new Date("2026-10-09T23:00:00Z")).pasados;
    expect(pasado).toMatchObject({ id, asistentes: 2, summary: "Resumen público." });
    expect(pasado.huella).toMatch(/^[0-9a-f]{64}$/);
    // Quien conoce a todo el equipo y los datos públicos del cierre no acierta.
    const candidatas = [fundadora, supervisora, core, anfitrion, relator, a1, a2].map((p) => p.wallet);
    expect(enumerarLista(pasado, candidatas)).toBeNull();
    // El servidor, con su secreto, sí la reproduce.
    expect(pasado.huella).toBe(
      hashCierre(
        {
          kind: "demo",
          scheduledFor: DEMO,
          asistentes: [a2.wallet, a1.wallet],
          host: anfitrion.wallet,
          recorder: relator.wallet,
          summary: "Resumen público.",
        },
        ritesSecret()
      )
    );
  });
});

describe("D5b · tras cerrar la época N, los ritos no cambian su raíz", () => {
  it("asistir y cerrar un rito después de cerrarYAbrirEpoca no cambia merkleRoot(hojasDeEpoca(N))", () => {
    // Época 1: un rito completo (asistencia, anfitrión y relator).
    const id1 = demoAbierta();
    registrarAsistencia(db, a1.wallet, { sessionId: id1, codigo: codigoEn(id1, EN_DEMO) }, EN_DEMO);
    cerrarRito(db, anfitrion, { sessionId: id1 }, CIERRE_DEMO);
    const refsEpoca1 = hojasDeEpoca(db, 1).map((h) => JSON.parse(h).ref as string | null);
    expect(refsEpoca1).toEqual(
      expect.arrayContaining([refRito(id1, "asistencia"), refRito(id1, "anfitrion"), refRito(id1, "relator")])
    );

    // Cierre real de la época 1 y apertura de la 2 (epocas.ts), con sus precondiciones.
    recordNoMutation(db, 2, "Sin cambios de genoma para la siguiente época.");
    signEpochDecision(db, computeAndStoreEpochFitness(db, 1).id, "keep");
    const cierre = cerrarYAbrirEpoca(
      db,
      fundadora,
      { justificacion: "Cierre de prueba con el fitness firmado." },
      new Date("2026-10-12T15:00:00Z")
    );
    expect(cierre).toMatchObject({ cerrada: 1, abierta: 2 });
    expect(currentEpoch(db)).toBe(2);
    const guardada = (db.prepare(`SELECT merkle_root FROM periods WHERE id = 1`).get() as { merkle_root: string }).merkle_root;
    expect(guardada).toBe(cierre.merkleRoot);
    expect(merkleRoot(hojasDeEpoca(db, 1))).toBe(guardada);
    // La raíz queda en la cola para anclarla en la red de pruebas.
    expect(
      db.prepare(`SELECT kind, ref, data_key, payload_hash, status FROM anchor_queue WHERE id = ?`).get(cierre.anchorQueueId)
    ).toEqual({ kind: "merkle_root", ref: "1", data_key: "epoch:1", payload_hash: guardada, status: "pending" });
    const hojasAntes = hojasDeEpoca(db, 1);

    // Época 2: otra demo con asistencia y cierre; y un intento de volver a registrar la anterior.
    const prep2 = new Date("2026-10-20T12:00:00Z");
    const id2 = prepararRito(db, fundadora, { kind: "demo", scheduledFor: "2026-10-23T21:00:00.000Z" }, prep2).id;
    asignarRolesRito(db, fundadora, { sessionId: id2, hostWallet: anfitrion.wallet, recorderWallet: relator.wallet });
    abrirRito(db, anfitrion, id2, new Date("2026-10-23T20:45:00Z"));
    const t2 = new Date("2026-10-23T21:05:00Z");
    registrarAsistencia(db, a1.wallet, { sessionId: id2, codigo: codigoEn(id2, t2) }, t2);
    registrarAsistencia(db, a2.wallet, { sessionId: id2, codigo: codigoEn(id2, t2) }, t2);
    lanza(() => registrarAsistencia(db, a2.wallet, { sessionId: id1, codigo: codigoEn(id1, t2) }, t2), 409);
    cerrarRito(db, anfitrion, { sessionId: id2 }, new Date("2026-10-23T22:10:00Z"));

    // Nada nuevo cayó en la época cerrada: sus hojas y su raíz son las mismas.
    expect(hojasDeEpoca(db, 1)).toEqual(hojasAntes);
    expect(merkleRoot(hojasDeEpoca(db, 1))).toBe(guardada);
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

  it("el enlace del sync es del equipo: un contributor con sesión no lo recibe", () => {
    const sync = prepararRito(
      db,
      fundadora,
      { kind: "sync", scheduledFor: SYNC, joinUrl: "https://meet.example.org/team-sync" },
      PREP
    );
    const enlace = (conSesion: boolean, wallet?: string) => detalleRito(db, sync.id, conSesion, wallet)?.join_url;

    // Contributor de la comunidad con la cookie vigente: ni con su wallet ni sin decir quién mira.
    expect(enlace(true, a1.wallet)).toBeNull();
    expect(enlace(true)).toBeNull();
    // Sabe que hay enlace (para el copy), pero no cuál es.
    expect(detalleRito(db, sync.id, true, a1.wallet)?.conEnlace).toBe(true);
    // Una cuenta del equipo que ya no está activa (alumni) tampoco.
    const alumni = persona(db, "G_ALUMNI_CORE", { role: "core", status: "alumni" });
    expect(enlace(true, alumni.wallet)).toBeNull();
    // Sin sesión, nadie.
    expect(enlace(false, core.wallet)).toBeNull();
    // El equipo interno sí (la misma puerta que la asistencia al sync).
    expect(enlace(true, core.wallet)).toBe("https://meet.example.org/team-sync");
    // Y quien trabaja en un proyecto (contributor con acuerdo y membresía): es su sync.
    miembroDeProyecto(db, a2.wallet);
    expect(enlace(true, a2.wallet)).toBe("https://meet.example.org/team-sync");
    expect(enlace(true, supervisora.wallet)).toBe("https://meet.example.org/team-sync");
    expect(enlace(true, fundadora.wallet)).toBe("https://meet.example.org/team-sync");
  });

  it("con una cookie vigente de una cuenta inactiva o sin fila, el enlace de la demo no sale", () => {
    const id = demoPreparada();
    const baja = persona(db, "G_ALUMNI", { status: "alumni" });
    expect(detalleRito(db, id, true, baja.wallet)?.join_url).toBeNull();
    expect(detalleRito(db, id, true, "G_SIN_FILA")?.join_url).toBeNull();
    // La demo es de la comunidad: cualquier cuenta activa la ve.
    expect(detalleRito(db, id, true, a1.wallet)?.join_url).toBe("https://meet.example.org/demo");
  });

  it("las páginas deciden el enlace por la fila activa y la wallet, no solo por la cookie", () => {
    for (const r of ["app/comunidad/ritos/[id]/page.tsx", "app/comunidad/page.tsx"]) {
      const src = leer(r);
      expect(src).toMatch(/actorDeRitos\(db, session\.wallet\)/);
      expect(src).not.toMatch(/detalleRito\(db, [^)]*!!session\)/);
      expect(src).toMatch(/detalleRito\(db, [^)]*session\.wallet\)/);
    }
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

// ---------------------------------------------------------------------------
// Corte 2: gestión en /admin y lo próximo en la landing
// ---------------------------------------------------------------------------

describe("corte 2 · gestión de ritos en /admin", () => {
  const DIAS_60 = 60 * 24 * 60 * 60 * 1000;

  it("ocurrenciasPreparables: fechas reales de la cadencia en los próximos 60 días, sin las ya preparadas", () => {
    // Desde el jueves 1 de octubre de 2026: sync y retro el lunes 5, demo el viernes 9 (ancla).
    const antes = ocurrenciasPreparables(db, PREP);
    expect(antes.find((f) => f.kind === "demo")).toEqual({ kind: "demo", scheduledFor: DEMO, etiqueta: "viernes 9 de octubre · 16:00" });
    expect(antes.find((f) => f.kind === "sync")?.scheduledFor).toBe(SYNC);
    expect(antes.find((f) => f.kind === "retro")?.scheduledFor).toBe("2026-10-05T15:00:00.000Z");
    for (const kind of ["sync", "demo", "retro"]) {
      expect(antes.filter((f) => f.kind === kind).length).toBeGreaterThan(0);
      expect(antes.filter((f) => f.kind === kind).length).toBeLessThanOrEqual(4);
    }
    for (const f of antes) expect(Date.parse(f.scheduledFor) - PREP.getTime()).toBeLessThanOrEqual(DIAS_60);

    demoPreparada();
    const despues = ocurrenciasPreparables(db, PREP);
    expect(despues.some((f) => f.kind === "demo" && f.scheduledFor === DEMO)).toBe(false);
    // Toda fecha que ofrece el panel se puede preparar de verdad (misma guarda que prepararRito).
    for (const f of despues) {
      expect(prepararRito(db, fundadora, { kind: f.kind, scheduledFor: f.scheduledFor }, PREP).scheduled_for).toBe(f.scheduledFor);
    }
  });

  it("candidatosPresentador: cuentas activas, propias, no demo y con el acuerdo firmado, por nombre", () => {
    persona(db, "G_DEMO_X", { demo: true });
    persona(db, "G_SIN_ACUERDO_X", { cla: false });
    persona(db, "G_BAJA_X", { status: "alumni" });
    const lista = candidatosPresentador(db);
    const wallets = lista.map((c) => c.wallet);
    expect(wallets).toEqual(expect.arrayContaining([fundadora.wallet, anfitrion.wallet, relator.wallet, a1.wallet]));
    for (const w of ["G_DEMO_X", "G_SIN_ACUERDO_X", "G_BAJA_X"]) expect(wallets).not.toContain(w);
    expect(wallets.some((w) => w.startsWith("pending:"))).toBe(false);
    const nombres = lista.map((c) => c.nombre);
    expect(nombres).toEqual([...nombres].sort());
    // Quien está en la lista puede presentar de verdad.
    const id = demoPreparada();
    for (const c of lista) expect(() => asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: c.wallet })).not.toThrow();
  });

  it("panelRitosAdmin: solo el conteo de asistentes; quién presenta y relata para el selector; pendiente de cerrar", () => {
    const id = demoAbierta();
    registrarAsistencia(db, a1.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);
    registrarAsistencia(db, a2.wallet, { sessionId: id, codigo: codigoEn(id, EN_DEMO) }, EN_DEMO);

    const panel = panelRitosAdmin(db, EN_DEMO);
    expect(panel.sesiones.find((x) => x.id === id)).toEqual({
      id,
      kind: "demo",
      nombre: "Demo quincenal",
      cuando: "viernes 9 de octubre · 16:00",
      state: "Open",
      estado: "Abierto ahora",
      lugar: "Sala abierta del piso 2",
      conEnlace: true,
      asistentes: "2 personas registradas",
      pendienteDeCerrar: false,
      ventanaPasada: false,
      anfitrion: anfitrion.wallet,
      relator: relator.wallet,
    });
    // Nunca la lista nominal ni el enlace de conexión.
    const sesiones = JSON.stringify(panel.sesiones);
    for (const w of [a1.wallet, a2.wallet]) expect(sesiones).not.toContain(w);
    expect(sesiones).not.toContain("meet.example.org");
    expect(panel).toMatchObject({ margen: "media hora", zona: "hora de Bogotá" });
    expect(panel.tipos.map((t) => t.kind)).toEqual(["sync", "demo", "retro"]);
    expect(panel.preparables.some((f) => f.kind === "demo" && f.scheduledFor === DEMO)).toBe(false);

    // Abierta y con la ventana ya pasada: pendiente de cerrar (no hay cierre automático).
    expect(panelRitosAdmin(db, new Date("2026-10-09T22:31:00Z")).sesiones.find((x) => x.id === id)?.pendienteDeCerrar).toBe(true);
    // Preparada y con la ventana pasada sin abrirse: ya no se puede abrir.
    const sync = prepararRito(db, fundadora, { kind: "sync", scheduledFor: SYNC }, PREP).id;
    const tarde = new Date("2026-10-05T15:01:00Z");
    expect(panelRitosAdmin(db, tarde).sesiones.find((x) => x.id === sync)).toMatchObject({ state: "Planned", ventanaPasada: true });
    lanza(() => abrirRito(db, fundadora, sync, tarde), 409);
  });

  it("todo el SQL de la gestión y de la landing se traduce a T-SQL (Azure)", () => {
    demoAbierta();
    const sqls: string[] = [];
    const espia: DB = {
      prepare: (sql: string) => {
        sqls.push(sql);
        return db.prepare(sql);
      },
      exec: (sql: string) => db.exec(sql),
      pragma: (d: string) => db.pragma(d),
      transaction: db.transaction.bind(db) as DB["transaction"],
    };
    panelRitosAdmin(espia, EN_DEMO);
    proximoRitoDeComunidad(espia, PREP);
    expect(sqls.length).toBeGreaterThan(5);
    for (const s of new Set(sqls)) expect(() => translate(s), s).not.toThrow();
  });

  it("proximoRitoDeComunidad: la próxima demo o retro, nunca el sync; sin wallets ni enlace", () => {
    // El sync del lunes 5 a las 09:00 llega antes, pero es del equipo: se anuncia la retro de las 10:00.
    expect(proximoRitoDeComunidad(db, PREP)).toMatchObject({
      kind: "retro",
      inicio: new Date("2026-10-05T15:00:00.000Z"),
      sessionId: null,
    });
    // Pasada la retro, la demo del 9; si está preparada, con su sesión y su lugar.
    const id = demoPreparada();
    const p = proximoRitoDeComunidad(db, new Date("2026-10-06T12:00:00Z"));
    expect(p).toMatchObject({ kind: "demo", sessionId: id, lugar: "Sala abierta del piso 2", conEnlace: true });
    expect(JSON.stringify(p)).not.toContain("meet.example.org");
    // Una demo ya cerrada deja de ser "la próxima".
    asignarRolesRito(db, fundadora, { sessionId: id, hostWallet: anfitrion.wallet });
    abrirRito(db, anfitrion, id, ABRE_DEMO);
    cerrarRito(db, anfitrion, { sessionId: id }, new Date("2026-10-09T21:20:00Z"));
    expect(proximoRitoDeComunidad(db, new Date("2026-10-09T21:25:00Z"))?.sessionId).not.toBe(id);
  });
});

describe("D8 (corte 2) · /admin, la ruta de épocas y la landing · estáticos", () => {
  it("admin/page.tsx importa EpocaPanel y RitosAdminPanel y pone Épocas y Ritos antes del motor de fitness", () => {
    const src = leer("app/admin/page.tsx");
    expect(src).toMatch(/import EpocaPanel from "@\/components\/EpocaPanel"/);
    expect(src).toMatch(/import RitosAdminPanel from "@\/components\/RitosAdminPanel"/);
    const epocas = src.indexOf(">Épocas</h2>");
    const ritos = src.indexOf(">Ritos</h2>");
    const motor = src.indexOf(">Motor de épocas · Fitness</h2>");
    expect(epocas).toBeGreaterThan(0);
    expect(ritos).toBeGreaterThan(epocas);
    expect(motor).toBeGreaterThan(ritos);
    expect(src).toContain("estadoCierreEpoca(db)");
    expect(src).toContain("panelRitosAdmin(db)");
    expect(src).toContain("adminActor(session, db)");
  });

  it("/api/admin/epoca: solo el founder (adminActor) y todo pasa por epocas.ts con el estado y el copy de EpocaError", () => {
    const src = leer("app/api/admin/epoca/route.ts");
    expect(src).toContain("adminActor(");
    expect(src).toContain("getSession(");
    expect(src).not.toContain("actorFromSession(");
    for (const f of ["cerrarYAbrirEpoca(", "abrirEpoca(", "estadoCierreEpoca(", "instanceof EpocaError", "e.status", "e.faltantes", "rateLimit(", "no-store"]) {
      expect(src).toContain(f);
    }
    expect(src).toMatch(/export async function GET\(/);
    expect(src).toMatch(/export async function POST\(/);
    // La ruta no escribe SQL: el cierre (y su anclaje) es la operación atómica de epocas.ts.
    expect(src).not.toMatch(/\.prepare\(|UPDATE\s|INSERT\s+INTO/);
  });

  it("los paneles de /admin son de cliente y no importan nada de servidor", () => {
    for (const r of ["src/components/EpocaPanel.tsx", "src/components/RitosAdminPanel.tsx"]) {
      const src = leer(r);
      expect(src.startsWith('"use client";')).toBe(true);
      const imports = src.split("\n").filter((l) => /^\s*import\b/.test(l) && !/^\s*import type\b/.test(l));
      for (const l of imports) {
        expect(l).not.toMatch(/@\/lib\/(db|crypto|session|ritos|ritos-codigo|authz|genome|epocas|epochs|mutation)["']|node:/);
      }
    }
  });

  it("ProximoEncuentro anuncia solo ritos de comunidad, sin personas ni enlace de conexión", () => {
    const src = leer("src/components/ProximoEncuentro.tsx");
    expect(src).not.toMatch(/^"use client"/);
    expect(src).toContain("proximoRitoDeComunidad(");
    expect(src).toContain("elegirProximo(");
    expect(src).toContain("Las próximas fechas se publican en");
    expect(src).not.toMatch(/join_url|detalleRito|sesionesGestionables|host_wallet|recorder_wallet/);
  });
});
