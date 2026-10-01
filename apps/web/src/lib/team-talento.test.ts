/**
 * WP31-A2 · Talento y roster como dato (spec §5.A.5, §5.A.7; criterios A2-1, A2-2 y A2-4).
 *
 *  A2-1 `cambiarRol` / `cambiarSupervisor`: solo founder, nunca sobre sí ni sobre un
 *       founder, el cambio persiste tras `seedTeam`, y a `contributor` con piezas
 *       abiertas fuera de sus proyectos → 409.
 *  A2-2 `vincularPrincipal`: mueve todo lo que referencia la wallet, conserva las sumas
 *       de puntos y reputación, borra el pending y el arranque no lo recrea; rechaza
 *       destinos inválidos salvo la excepción del founder; 409 ante historia sellada;
 *       la simulación no deja huella y cuenta lo mismo que la real. Introspección de
 *       `REFERENCIAS_WALLET` contra `schema.sql`.
 *  A2-4 `directorioTalento`: vínculo derivado, carga abierta, filtro y sin demo.
 *
 * Datos inventados (huerto y cocina demo). Ningún nombre de cliente.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, type TeamActor } from "./roles";
import { createAssignment, seedTeam, upsertInitiative, TeamError } from "./team";
import {
  HISTORIA_SELLADA,
  REFERENCIAS_WALLET,
  cambiarRol,
  cambiarSupervisor,
  candidatosAVincular,
  cuentaActiva,
  describirVinculo,
  directorioTalento,
  rosterMemberFor,
  talentoAccionSchema,
  vincularPrincipal,
  walletDeRoster,
} from "./talento";
import { identidadesDe, mismaPersona } from "./identidades";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");

const SESION = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // con la que entra el founder
const DEMO = "GA7ZELENAFOUNDERDEMOWALLET000000000000000000000000000AAA"; // fila demo con rol founder
const JUAN_REAL = "GJUANREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ANA = "GANACONTRIBUIDORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const LUIS = "GLUISCONTRIBUIDORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SINCLA = "GSINCLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DEMOCONTRIB = "GDEMOCONTRIBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VIEJO_FOUNDER = "GFOUNDERALUMNIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const JUAN = pendingPrincipal("juan");
const DAVID = pendingPrincipal("david");
const FAUSTO = pendingPrincipal("fausto");
const VALE = pendingPrincipal("vale");
const JOHN = pendingPrincipal("john");

const FOUNDER: TeamActor = { wallet: SESION, name: "John", role: "founder", isSupervisor: true };
const VALE_ACTOR: TeamActor = { wallet: VALE, name: "Vale", role: "core", isSupervisor: true };
const FAUSTO_ACTOR: TeamActor = { wallet: FAUSTO, name: "Fausto", role: "core", isSupervisor: false };

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedTeam(db);
  return db;
}

function usuario(
  db: DB,
  wallet: string,
  o: { nombre?: string; role?: string; status?: string; isDemo?: number; cla?: number; invitedBy?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed, invited_by) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    wallet,
    o.nombre ?? wallet.slice(1, 6),
    o.role ?? "contributor",
    o.status ?? "active",
    o.isDemo ?? 0,
    o.cla ?? 1,
    o.invitedBy ?? null
  );
}

function periodo(db: DB, state: "Open" | "Closed" | "Anchored", name = "Época"): number {
  const r = db
    .prepare(`INSERT INTO periods (name, epoch_budget, academia_budget, state) VALUES (?, 100000, 5000, ?)`)
    .run(name, state);
  return Number(r.lastInsertRowid);
}

function miembro(db: DB, initiativeId: number, wallet: string, rol: string, vinculo = "interno"): void {
  db.prepare(
    `INSERT INTO project_members (initiative_id, wallet, rol_proyecto, vinculo, added_by) VALUES (?, ?, ?, ?, ?)`
  ).run(initiativeId, wallet, rol, vinculo, SESION);
}

function rol(db: DB, wallet: string): { role: string; is_supervisor: number } | undefined {
  return db.prepare(`SELECT role, is_supervisor FROM users WHERE wallet = ?`).get(wallet) as
    | { role: string; is_supervisor: number }
    | undefined;
}

function n(db: DB, sql: string, ...p: unknown[]): number {
  return Number((db.prepare(sql).get(...p) as { n: number }).n);
}

/** Huella completa de la base: todas las filas de todas las tablas, en orden. */
function huella(db: DB): string {
  const tablas = (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as Array<{ name: string }>
  ).map((t) => t.name);
  return JSON.stringify(tablas.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
}

function esperaError(fn: () => unknown, status: number, mensaje?: RegExp | string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TeamError);
    expect((e as TeamError).status).toBe(status);
    if (mensaje) expect((e as TeamError).message).toMatch(mensaje);
    return;
  }
  throw new Error(`se esperaba TeamError ${status}`);
}

// ---------------------------------------------------------------------------
// A2-1 · rol y supervisión
// ---------------------------------------------------------------------------

describe("cambiarRol y cambiarSupervisor (A2-1)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    usuario(db, SESION, { nombre: "John", role: "founder" });
  });

  it("solo el founder: un core o una supervisora reciben 403", () => {
    esperaError(() => cambiarRol(db, FAUSTO_ACTOR, { wallet: JUAN, role: "contributor" }), 403);
    esperaError(() => cambiarRol(db, VALE_ACTOR, { wallet: JUAN, role: "contributor" }), 403);
    esperaError(() => cambiarSupervisor(db, VALE_ACTOR, { wallet: JUAN, isSupervisor: true }), 403);
    expect(rol(db, JUAN)).toEqual({ role: "core", is_supervisor: 0 });
  });

  it("nunca sobre sí mismo: sus dos identidades cuentan como una (sesión y pending:john)", () => {
    esperaError(() => cambiarRol(db, FOUNDER, { wallet: JOHN, role: "core" }), 403, /otra persona/);
    esperaError(() => cambiarSupervisor(db, FOUNDER, { wallet: SESION, isSupervisor: false }), 403, /otra persona/);
  });

  it("nunca sobre un founder, y el rol founder no se asigna desde aquí", () => {
    // Toda fila con rol founder cuenta como la misma persona (identidadesDe), así que la
    // regla de "sobre sí mismo" ya la cubre; la de founder es defensa en profundidad.
    usuario(db, VIEJO_FOUNDER, { role: "founder", status: "alumni" });
    esperaError(() => cambiarRol(db, FOUNDER, { wallet: VIEJO_FOUNDER, role: "core" }), 403);
    esperaError(() => cambiarSupervisor(db, FOUNDER, { wallet: VIEJO_FOUNDER, isSupervisor: false }), 403);
    expect(rol(db, VIEJO_FOUNDER)?.role).toBe("founder");
    esperaError(
      () => cambiarRol(db, FOUNDER, { wallet: JUAN, role: "founder" as unknown as "core" }),
      400
    );
    expect(talentoAccionSchema.safeParse({ action: "rol", wallet: JUAN, role: "founder" }).success).toBe(false);
  });

  it("persona inexistente → 404; cuenta demo → 400", () => {
    esperaError(() => cambiarRol(db, FOUNDER, { wallet: "GNADIE", role: "core" }), 404);
    usuario(db, DEMOCONTRIB, { isDemo: 1 });
    esperaError(() => cambiarRol(db, FOUNDER, { wallet: DEMOCONTRIB, role: "core" }), 400);
  });

  it("el cambio de rol y de supervisión PERSISTE tras seedTeam (el roster es dato)", () => {
    cambiarRol(db, FOUNDER, { wallet: JUAN, role: "contributor" });
    cambiarSupervisor(db, FOUNDER, { wallet: FAUSTO, isSupervisor: true });
    cambiarSupervisor(db, FOUNDER, { wallet: VALE, isSupervisor: false });

    seedTeam(db);
    seedTeam(db);

    expect(rol(db, JUAN)).toEqual({ role: "contributor", is_supervisor: 0 });
    expect(rol(db, FAUSTO)).toEqual({ role: "core", is_supervisor: 1 });
    expect(rol(db, VALE)).toEqual({ role: "core", is_supervisor: 0 });
  });

  it("escribe talent_events describiendo el cambio (y nada si no cambia)", () => {
    cambiarRol(db, FOUNDER, { wallet: JUAN, role: "contributor" });
    cambiarRol(db, FOUNDER, { wallet: JUAN, role: "contributor" }); // ya lo es: no-op
    cambiarSupervisor(db, FOUNDER, { wallet: FAUSTO, isSupervisor: true });
    const ev = db
      .prepare(`SELECT actor_wallet, target_wallet, action, detail FROM talent_events ORDER BY id`)
      .all() as Array<{ actor_wallet: string; target_wallet: string; action: string; detail: string }>;
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ actor_wallet: SESION, target_wallet: JUAN, action: "rol" });
    expect(JSON.parse(ev[0].detail)).toEqual({ de: "core", a: "contributor" });
    expect(ev[1]).toMatchObject({ target_wallet: FAUSTO, action: "supervisor" });
    expect(JSON.parse(ev[1].detail)).toEqual({ de: false, a: true });
  });

  it("a contributor con piezas abiertas fuera de sus proyectos → 409 (perdería el acceso a su trabajo)", () => {
    const huerto = upsertInitiative(db, "Huerto Demo");
    createAssignment(db, { title: "Regar", initiativeId: huerto, ownerWallet: DAVID, status: "En curso" });
    esperaError(
      () => cambiarRol(db, FOUNDER, { wallet: DAVID, role: "contributor" }),
      409,
      "Primero reasigna sus entregas abiertas o súmale a esos proyectos."
    );
    // Una pieza sin proyecto también la dejaría fuera.
    const db2 = freshDb();
    usuario(db2, SESION, { role: "founder" });
    createAssignment(db2, { title: "Suelta", ownerWallet: DAVID, status: "Asignada" });
    esperaError(() => cambiarRol(db2, FOUNDER, { wallet: DAVID, role: "contributor" }), 409);

    // Con membresía en ese proyecto (y el acuerdo firmado) ya no pierde nada.
    miembro(db, huerto, DAVID, "ejecuta");
    esperaError(() => cambiarRol(db, FOUNDER, { wallet: DAVID, role: "contributor" }), 409, /acuerdo/);
    db.prepare(`UPDATE users SET cla_signed = 1 WHERE wallet = ?`).run(DAVID);
    cambiarRol(db, FOUNDER, { wallet: DAVID, role: "contributor" });
    expect(rol(db, DAVID)?.role).toBe("contributor");
  });

  it("las piezas Hechas no cuentan: lo cerrado no ata a nadie", () => {
    createAssignment(db, { title: "Cerrada", ownerWallet: DAVID, status: "Hecha" });
    cambiarRol(db, FOUNDER, { wallet: DAVID, role: "contributor" });
    expect(rol(db, DAVID)?.role).toBe("contributor");
  });
});

// ---------------------------------------------------------------------------
// Roster como dato
// ---------------------------------------------------------------------------

describe("seedTeamRoster solo inserta y respeta roster_links", () => {
  it("una fila existente no se pisa y un slug vinculado no se recrea", () => {
    const db = freshDb();
    db.prepare(`UPDATE users SET role = 'contributor', is_supervisor = 1, display_name = 'Juanito' WHERE wallet = ?`).run(JUAN);
    db.prepare(`DELETE FROM users WHERE wallet = ?`).run(FAUSTO);
    usuario(db, "GFAUSTOREAL", { role: "core" });
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('fausto', 'GFAUSTOREAL', ?)`).run(SESION);

    seedTeam(db);

    expect(db.prepare(`SELECT display_name, role, is_supervisor FROM users WHERE wallet = ?`).get(JUAN)).toEqual({
      display_name: "Juanito",
      role: "contributor",
      is_supervisor: 1,
    });
    expect(rol(db, FAUSTO)).toBeUndefined();
    // Lo que falta sí se siembra.
    db.prepare(`DELETE FROM users WHERE wallet = ?`).run(DAVID);
    seedTeam(db);
    expect(rol(db, DAVID)).toEqual({ role: "core", is_supervisor: 0 });
  });

  it("walletDeRoster y rosterMemberFor resuelven por pending y por roster_links", () => {
    const db = freshDb();
    expect(walletDeRoster(db, "juan")).toBe(JUAN);
    expect(walletDeRoster(db, "marciano")).toBeNull();
    expect(rosterMemberFor(db, JUAN)?.slug).toBe("juan");
    expect(rosterMemberFor(db, ANA)).toBeUndefined();

    usuario(db, JUAN_REAL, { role: "core" });
    db.prepare(`DELETE FROM users WHERE wallet = ?`).run(JUAN);
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('juan', ?, ?)`).run(JUAN_REAL, SESION);
    expect(walletDeRoster(db, "juan")).toBe(JUAN_REAL);
    expect(rosterMemberFor(db, JUAN_REAL)?.name).toBe("Juan");
  });
});

// ---------------------------------------------------------------------------
// A2-2 · vincularPrincipal
// ---------------------------------------------------------------------------

interface Escenario {
  db: DB;
  abierto: number;
  huerto: number;
  cocina: number;
}

/**
 * pending:juan con trabajo, check-ins, membresías, avisos, Telegram, puntos y
 * reputación en la época abierta, y asistencia a un rito abierto. La cuenta real
 * (JUAN_REAL, contributor con acuerdo) ya tiene un check-in el mismo día, la misma
 * membresía en el huerto y el mismo aviso: esas filas del pending se descartan.
 */
function escenario(): Escenario {
  const db = freshDb();
  usuario(db, SESION, { nombre: "John", role: "founder" });
  usuario(db, JUAN_REAL, { nombre: "Juan R", role: "contributor", invitedBy: SESION });
  usuario(db, ANA, { nombre: "Ana", invitedBy: JUAN });
  const abierto = periodo(db, "Open", "Génesis");
  const huerto = upsertInitiative(db, "Huerto Demo");
  const cocina = upsertInitiative(db, "Cocina Demo");

  const a1 = createAssignment(db, { title: "Plantar", initiativeId: huerto, ownerWallet: JUAN, status: "En curso", createdBy: JUAN });
  createAssignment(db, { title: "Cosechar", initiativeId: cocina, ownerWallet: JUAN, status: "Hecha", createdBy: SESION });
  db.prepare(
    `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, actor_wallet, day) VALUES (?, 'crear', 'Backlog', 'En curso', ?, '2026-09-30')`
  ).run(a1, JUAN);

  db.prepare(`INSERT INTO checkins (wallet, day, done) VALUES (?, '2026-09-29', 'a'), (?, '2026-09-30', 'b'), (?, '2026-09-30', 'c')`).run(
    JUAN,
    JUAN,
    JUAN_REAL
  );
  miembro(db, huerto, JUAN, "ejecuta");
  miembro(db, cocina, JUAN, "revisa");
  miembro(db, huerto, JUAN_REAL, "ejecuta", "externo");

  db.prepare(`INSERT INTO avisos (wallet, clave, tipo, texto) VALUES (?, 'vence:1', 'vencida', 't'), (?, 'vence:2', 'vencida', 't'), (?, 'vence:1', 'vencida', 't')`).run(
    JUAN,
    JUAN,
    JUAN_REAL
  );
  db.prepare(`INSERT INTO reminders_sent (clave, wallet, dia) VALUES ('vence:2', ?, '2026-09-30')`).run(JUAN);
  db.prepare(`INSERT INTO telegram_links (wallet, telegram_user_id, is_authorized) VALUES (?, '777', 0)`).run(JUAN);

  const insPts = db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, ?, 'ejecucion', ?)`);
  insPts.run(JUAN, 30, abierto, "assignment:1");
  insPts.run(JUAN, 10, abierto, "assignment:2");
  insPts.run(JUAN_REAL, 80, abierto, "assignment:9");
  const insRep = db.prepare(`INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, ?, ?, ?, ?)`);
  insRep.run(JUAN, "ejecucion", 3, "assignment:1", abierto);
  insRep.run(JUAN, "comunidad", 2, "rito:1:asistencia", abierto);
  insRep.run(JUAN_REAL, "ejecucion", 8, "assignment:9", abierto);

  const rito = db
    .prepare(`INSERT INTO rite_sessions (kind, scheduled_for, duration_min, state, host_wallet) VALUES ('sync', '2026-09-28T14:00:00.000Z', 30, 'Open', ?)`)
    .run(JUAN);
  db.prepare(`INSERT INTO rite_attendance (session_id, wallet, layer) VALUES (?, ?, 1)`).run(Number(rito.lastInsertRowid), JUAN);

  return { db, abierto, huerto, cocina };
}

function sumas(db: DB, wallets: string[]) {
  const marcas = wallets.map(() => "?").join(",");
  const puntos = n(db, `SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE wallet IN (${marcas})`, ...wallets);
  const ejes = db
    .prepare(`SELECT axis, SUM(delta) AS s FROM reputation_events WHERE wallet IN (${marcas}) GROUP BY axis ORDER BY axis`)
    .all(...wallets);
  return { puntos, ejes };
}

describe("vincularPrincipal (A2-2)", () => {
  it("mueve asignaciones, eventos, check-ins, membresías, avisos, puntos y reputación", () => {
    const { db, huerto, cocina } = escenario();
    const antes = sumas(db, [JUAN, JUAN_REAL]);

    const r = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL });

    expect(r.simulado).toBe(false);
    expect(r.movidas).toEqual({
      "assignments.owner_wallet": 2,
      "assignments.created_by": 1,
      "assignment_events.actor_wallet": 1,
      "checkins.wallet": 1,
      "project_members.wallet": 1,
      "telegram_links.wallet": 1,
      "points_ledger.wallet": 2,
      "reputation_events.wallet": 2,
      "users.invited_by": 1,
      "rite_sessions.host_wallet": 1,
      "rite_attendance.wallet": 1,
      "avisos.wallet": 1,
      "reminders_sent.wallet": 1,
    });
    expect(r.descartadas).toEqual({ "checkins.wallet": 1, "project_members.wallet": 1, "avisos.wallet": 1 });

    // Nada queda a nombre del pending, en ninguna tabla de REFERENCIAS_WALLET.
    for (const ref of REFERENCIAS_WALLET) {
      expect(n(db, `SELECT COUNT(*) AS n FROM ${ref.tabla} WHERE ${ref.columna} = ?`, JUAN), `${ref.tabla}.${ref.columna}`).toBe(0);
    }
    // Sumas por eje y de puntos: iguales antes y después (lo ganado no se pierde).
    expect(sumas(db, [JUAN_REAL])).toEqual(antes);

    expect(n(db, `SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ?`, JUAN_REAL)).toBe(2);
    expect(n(db, `SELECT COUNT(*) AS n FROM checkins WHERE wallet = ?`, JUAN_REAL)).toBe(2);
    const membresias = db
      .prepare(`SELECT initiative_id, rol_proyecto FROM project_members WHERE wallet = ? ORDER BY initiative_id`)
      .all(JUAN_REAL);
    expect(membresias).toEqual([
      { initiative_id: huerto, rol_proyecto: "ejecuta" },
      { initiative_id: cocina, rol_proyecto: "revisa" },
    ]);
    expect(n(db, `SELECT COUNT(*) AS n FROM avisos WHERE wallet = ?`, JUAN_REAL)).toBe(2);
    expect((db.prepare(`SELECT invited_by FROM users WHERE wallet = ?`).get(ANA) as { invited_by: string }).invited_by).toBe(
      JUAN_REAL
    );

    // La fila del roster desaparece y queda el vínculo.
    expect(rol(db, JUAN)).toBeUndefined();
    expect(db.prepare(`SELECT wallet, linked_by FROM roster_links WHERE slug = 'juan'`).get()).toEqual({
      wallet: JUAN_REAL,
      linked_by: SESION,
    });
    // Rol más alto de los dos (core > contributor), y conserva su nombre.
    expect(db.prepare(`SELECT display_name, role, is_supervisor FROM users WHERE wallet = ?`).get(JUAN_REAL)).toEqual({
      display_name: "Juan R",
      role: "core",
      is_supervisor: 0,
    });
    expect(walletDeRoster(db, "juan")).toBe(JUAN_REAL);
    expect(rosterMemberFor(db, JUAN_REAL)?.slug).toBe("juan");
  });

  it("seedTeam posterior no recrea pending:<slug>", () => {
    const { db } = escenario();
    vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL });
    seedTeam(db);
    seedTeam(db);
    expect(rol(db, JUAN)).toBeUndefined();
    expect(rol(db, JUAN_REAL)?.role).toBe("core");
  });

  it("talent_events guarda los conteos exactos de movidas y descartadas", () => {
    const { db } = escenario();
    const r = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL });
    const ev = db.prepare(`SELECT actor_wallet, target_wallet, action, detail FROM talent_events WHERE action = 'vincular'`).all() as Array<{
      actor_wallet: string;
      target_wallet: string;
      detail: string;
    }>;
    expect(ev).toHaveLength(1);
    expect(ev[0].actor_wallet).toBe(SESION);
    expect(ev[0].target_wallet).toBe(JUAN_REAL);
    expect(JSON.parse(ev[0].detail)).toEqual({ slug: "juan", movidas: r.movidas, descartadas: r.descartadas });
  });

  it("simular: true deja la huella de la base igual y devuelve los mismos conteos que la real", () => {
    const { db } = escenario();
    const antes = huella(db);
    const sim = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL, simular: true });
    expect(sim.simulado).toBe(true);
    expect(huella(db)).toBe(antes);

    const real = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL });
    expect(real.movidas).toEqual(sim.movidas);
    expect(real.descartadas).toEqual(sim.descartadas);
    expect(huella(db)).not.toBe(antes);

    const resumen = describirVinculo(sim);
    expect(resumen.total).toBe(Object.values(sim.movidas).reduce((s, x) => s + x, 0));
    expect(resumen.detalle).toMatch(/2 entregas a su nombre/);
    expect(resumen.descartadas).toBe(3);
  });

  it("solo el founder vincula", () => {
    const { db } = escenario();
    esperaError(() => vincularPrincipal(db, VALE_ACTOR, { slug: "juan", wallet: JUAN_REAL }), 403);
    esperaError(() => vincularPrincipal(db, FAUSTO_ACTOR, { slug: "juan", wallet: JUAN_REAL, simular: true }), 403);
  });

  it("rechaza destino demo, pending, sin acuerdo, ya vinculado o inexistente", () => {
    const { db } = escenario();
    usuario(db, DEMOCONTRIB, { isDemo: 1 });
    usuario(db, SINCLA, { cla: 0 });
    const antes = huella(db);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: DEMOCONTRIB }), 400);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: DAVID }), 400);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: SINCLA }), 409, /acuerdo/);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: "GNADIE" }), 404);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "marciano", wallet: JUAN_REAL }), 404);
    // Un founder demo solo vale para el slug del founder (la excepción no se extiende).
    usuario(db, DEMO, { role: "founder", isDemo: 1 });
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: DEMO }), 400);
    db.prepare(`DELETE FROM users WHERE wallet = ?`).run(DEMO);
    expect(huella(db)).toBe(antes);

    vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL });
    usuario(db, LUIS);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: LUIS }), 409, /ya está vinculada/);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "david", wallet: JUAN_REAL }), 409, /ya está vinculada/);
  });

  it("la fila pending no puede tener firmas del acuerdo", () => {
    const { db } = escenario();
    db.prepare(`INSERT INTO cla_signatures (wallet, cla_hash, signature) VALUES (?, 'h', 's')`).run(JUAN);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409);
    expect(rol(db, JUAN)).toBeDefined();
  });

  it("excepción del founder: destino con role='founder' demo → se acepta y queda is_demo=0", () => {
    const db = freshDb();
    usuario(db, DEMO, { nombre: "John (Founder)", role: "founder", isDemo: 1 });
    const huerto = upsertInitiative(db, "Huerto Demo");
    createAssignment(db, { title: "Decidir", initiativeId: huerto, ownerWallet: JOHN, status: "Asignada" });
    const actorDemo: TeamActor = { wallet: DEMO, name: "John", role: "founder", isSupervisor: true };

    expect(candidatosAVincular(db, "john").map((c) => c.wallet)).toContain(DEMO);
    expect(candidatosAVincular(db, "juan").map((c) => c.wallet)).not.toContain(DEMO);

    const r = vincularPrincipal(db, actorDemo, { slug: "john", wallet: DEMO });
    expect(r.movidas["assignments.owner_wallet"]).toBe(1);
    expect(db.prepare(`SELECT is_demo, role, is_supervisor, display_name FROM users WHERE wallet = ?`).get(DEMO)).toEqual({
      is_demo: 0,
      role: "founder",
      is_supervisor: 1,
      display_name: "John (Founder)",
    });
    expect(rol(db, JOHN)).toBeUndefined();
    seedTeam(db);
    expect(rol(db, JOHN)).toBeUndefined();
  });

  describe("no reescribe historia sellada (409)", () => {
    it("puntos en una época cerrada", () => {
      const { db } = escenario();
      const cerrada = periodo(db, "Closed", "Vieja");
      db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 5, ?, 'ejecucion', 'x')`).run(JUAN, cerrada);
      const antes = huella(db);
      esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409, HISTORIA_SELLADA);
      esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL, simular: true }), 409);
      expect(huella(db)).toBe(antes);
    });

    it("reputación en una época anclada", () => {
      const { db } = escenario();
      const anclada = periodo(db, "Anchored", "Anclada");
      db.prepare(`INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, 'comunidad', 1, 'y', ?)`).run(JUAN, anclada);
      esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409, HISTORIA_SELLADA);
    });

    it("asistencia, anfitrionía o relatoría en un rito cerrado", () => {
      const asistencia = escenario().db;
      const cerrado = asistencia
        .prepare(`INSERT INTO rite_sessions (kind, scheduled_for, duration_min, state) VALUES ('demo', '2026-09-25T21:00:00.000Z', 60, 'Closed')`)
        .run();
      asistencia.prepare(`INSERT INTO rite_attendance (session_id, wallet) VALUES (?, ?)`).run(Number(cerrado.lastInsertRowid), JUAN);
      esperaError(() => vincularPrincipal(asistencia, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409, HISTORIA_SELLADA);

      const relator = escenario().db;
      relator
        .prepare(`INSERT INTO rite_sessions (kind, scheduled_for, duration_min, state, recorder_wallet) VALUES ('retro', '2026-09-07T15:00:00.000Z', 60, 'Closed', ?)`)
        .run(JUAN);
      esperaError(() => vincularPrincipal(relator, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409, HISTORIA_SELLADA);
    });

    it("lo de la época abierta sí se mueve (todavía no está en ninguna raíz)", () => {
      const { db, abierto } = escenario();
      const r = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL });
      expect(r.movidas["points_ledger.wallet"]).toBe(2);
      expect(n(db, `SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ? AND period_id = ?`, JUAN_REAL, abierto)).toBe(3);
    });
  });
});

// ---------------------------------------------------------------------------
// Revisión A2 · nadie se queda con lo de otra persona al vincular
// ---------------------------------------------------------------------------

describe("vincularPrincipal · el destino es la persona de esa fila (revisión A2)", () => {
  it("el founder no vincula la fila de OTRA persona con su propia cuenta: sus puntos no pasan al founder", () => {
    const { db } = escenario();
    const antes = huella(db);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: SESION }), 400, /founder/);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: SESION, simular: true }), 400);
    expect(huella(db)).toBe(antes);
    expect(n(db, `SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE wallet = ?`, SESION)).toBe(0);
    expect(db.prepare(`SELECT slug FROM roster_links WHERE slug = 'juan'`).get()).toBeUndefined();
  });

  it("ni con otra cuenta de founder (aunque sea otra fila con ese rol)", () => {
    const { db } = escenario();
    usuario(db, VIEJO_FOUNDER, { role: "founder" });
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: VIEJO_FOUNDER }), 400, /founder/);
    expect(rol(db, JUAN)).toBeDefined();
  });

  it("el slug del founder solo se vincula con una cuenta que ya es founder: no promueve a nadie", () => {
    const { db } = escenario();
    usuario(db, LUIS, { nombre: "Luis", role: "contributor" });
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "john", wallet: LUIS }), 400, /founder/);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "john", wallet: JUAN_REAL, simular: true }), 400);
    expect(rol(db, LUIS)?.role).toBe("contributor");
    expect(rol(db, JOHN)?.role).toBe("founder");
    // Con su propia cuenta de founder, sí (el primer paso de John).
    vincularPrincipal(db, FOUNDER, { slug: "john", wallet: SESION });
    expect(db.prepare(`SELECT wallet FROM roster_links WHERE slug = 'john'`).get()).toEqual({ wallet: SESION });
  });

  it("la regla del rol máximo nunca deja a alguien como founder", () => {
    const { db } = escenario();
    db.prepare(`UPDATE users SET role = 'founder' WHERE wallet = ?`).run(JUAN); // dato raro en la fila del roster
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409, /founder/);
    expect(rol(db, JUAN_REAL)?.role).toBe("contributor");
  });

  it("el destino tiene que estar activo", () => {
    const { db } = escenario();
    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet = ?`).run(JUAN_REAL);
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409, /activa/);
    expect(rol(db, JUAN)).toBeDefined();
  });

  it("candidatosAVincular: para otra persona, sin el founder ni cuentas inactivas; para el founder, solo founders", () => {
    const { db } = escenario();
    usuario(db, LUIS, { nombre: "Luis", status: "alumni" });
    usuario(db, DEMO, { nombre: "John demo", role: "founder", isDemo: 1 });
    const paraJuan = candidatosAVincular(db, "juan", SESION).map((c) => c.wallet);
    expect(paraJuan).toContain(JUAN_REAL);
    expect(paraJuan).toContain(ANA);
    expect(paraJuan).not.toContain(SESION);
    expect(paraJuan).not.toContain(DEMO);
    expect(paraJuan).not.toContain(LUIS);
    const paraJohn = candidatosAVincular(db, "john", SESION).map((c) => c.wallet).sort();
    expect(paraJohn).toEqual([DEMO, SESION].sort());
  });
});

// ---------------------------------------------------------------------------
// Revisión A2 · una cuenta dada de baja no gestiona talento
// ---------------------------------------------------------------------------

describe("cuentas inactivas (revisión A2)", () => {
  it("cuentaActiva: solo filas con status 'active'", () => {
    const db = freshDb();
    expect(cuentaActiva(db, VALE)).toBe(true);
    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet = ?`).run(VALE);
    expect(cuentaActiva(db, VALE)).toBe(false);
    expect(cuentaActiva(db, "GNADIE")).toBe(false);
  });

  it("la página de talento y las rutas de talento e importar exigen una cuenta activa (el layout no es la puerta)", () => {
    const raiz = process.cwd();
    for (const archivo of [
      ["app", "equipo", "talento", "page.tsx"],
      ["app", "api", "equipo", "importar", "route.ts"],
      ["app", "api", "equipo", "talento", "route.ts"],
    ]) {
      const fuente = fs.readFileSync(path.join(raiz, ...archivo), "utf8");
      expect(fuente, archivo.join("/")).toContain("cuentaActiva(");
    }
  });

  it("no se da supervisión ni se pasa a core a una cuenta dada de baja (quitar sí se puede)", () => {
    const db = freshDb();
    usuario(db, SESION, { nombre: "John", role: "founder" });
    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet IN (?, ?)`).run(FAUSTO, VALE);
    esperaError(() => cambiarSupervisor(db, FOUNDER, { wallet: FAUSTO, isSupervisor: true }), 409, /activa/);
    usuario(db, LUIS, { status: "alumni" });
    esperaError(() => cambiarRol(db, FOUNDER, { wallet: LUIS, role: "core" }), 409, /activa/);
    cambiarSupervisor(db, FOUNDER, { wallet: VALE, isSupervisor: false });
    expect(rol(db, VALE)?.is_supervisor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Revisión A2 · historia sellada: vincular sin mover lo ya cerrado
// ---------------------------------------------------------------------------

describe("vincularPrincipal · conservarSellado (revisión A2)", () => {
  function conSellado() {
    const e = escenario();
    const cerrada = periodo(e.db, "Closed", "Vieja");
    e.db
      .prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 5, ?, 'ejecucion', 'assignment:50')`)
      .run(JUAN, cerrada);
    e.db
      .prepare(`INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, 'ejecucion', 1, 'assignment:50', ?)`)
      .run(JUAN, cerrada);
    const rito = Number(
      e.db
        .prepare(
          `INSERT INTO rite_sessions (kind, scheduled_for, duration_min, state, host_wallet) VALUES ('demo', '2026-09-25T21:00:00.000Z', 60, 'Closed', ?)`
        )
        .run(JUAN).lastInsertRowid
    );
    // Los dos asistieron al mismo rito cerrado: la fila sellada del pending NO se descarta.
    e.db.prepare(`INSERT INTO rite_attendance (session_id, wallet, layer) VALUES (?, ?, 1), (?, ?, 1)`).run(rito, JUAN, rito, JUAN_REAL);
    return { ...e, cerrada, rito };
  }

  function sellado(db: DB, cerrada: number, rito: number) {
    return JSON.stringify([
      db.prepare(`SELECT * FROM points_ledger WHERE period_id = ? ORDER BY id`).all(cerrada),
      db.prepare(`SELECT * FROM reputation_events WHERE period_id = ? ORDER BY id`).all(cerrada),
      db.prepare(`SELECT * FROM rite_attendance WHERE session_id = ? ORDER BY id`).all(rito),
      db.prepare(`SELECT * FROM rite_sessions WHERE id = ?`).all(rito),
    ]);
  }

  it("sin pedirlo sigue siendo 409 (la huella no se reescribe)", () => {
    const { db } = conSellado();
    esperaError(() => vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL }), 409, HISTORIA_SELLADA);
  });

  it("con conservarSellado vincula: mueve lo abierto, deja lo sellado en la fila del equipo y las une", () => {
    const { db, cerrada, rito } = conSellado();
    const huellaSellada = sellado(db, cerrada, rito);
    const antes = sumas(db, [JUAN, JUAN_REAL]);

    const r = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL, conservarSellado: true });

    // Lo sellado no cambia ni un byte (la raíz anclada sigue siendo reproducible).
    expect(sellado(db, cerrada, rito)).toBe(huellaSellada);
    expect(r.conservadas).toEqual({
      "points_ledger.wallet": 1,
      "reputation_events.wallet": 1,
      "rite_sessions.host_wallet": 1,
      "rite_attendance.wallet": 1,
    });
    // Lo de la época abierta y el trabajo sí pasan a la cuenta real.
    expect(r.movidas["points_ledger.wallet"]).toBe(2);
    expect(r.movidas["assignments.owner_wallet"]).toBe(2);
    expect(n(db, `SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ?`, JUAN)).toBe(0);
    // Nada se pierde: las sumas de las dos identidades son las mismas.
    expect(sumas(db, [JUAN, JUAN_REAL])).toEqual(antes);
    // Quedan unidas: misma persona para los cuatro ojos, el progreso y los avisos.
    expect(db.prepare(`SELECT wallet FROM roster_links WHERE slug = 'juan'`).get()).toEqual({ wallet: JUAN_REAL });
    expect(identidadesDe(db, JUAN_REAL)).toContain(JUAN);
    expect(mismaPersona(db, JUAN, JUAN_REAL)).toBe(true);
    // La fila del equipo se conserva solo como alias: sin rol que dé acceso.
    expect(
      db.prepare(`SELECT role, is_supervisor, status FROM users WHERE wallet = ?`).get(JUAN)
    ).toEqual({ role: "contributor", is_supervisor: 0, status: "alumni" });
    expect(directorioTalento(db).some((p) => p.wallet === JUAN)).toBe(false);
    expect(walletDeRoster(db, "juan")).toBe(JUAN_REAL);
    // El arranque no la toca ni la recrea.
    seedTeam(db);
    expect(db.prepare(`SELECT role, status FROM users WHERE wallet = ?`).get(JUAN)).toEqual({
      role: "contributor",
      status: "alumni",
    });
    const ev = db.prepare(`SELECT detail FROM talent_events WHERE action = 'vincular'`).get() as { detail: string };
    expect(JSON.parse(ev.detail)).toMatchObject({ slug: "juan", conservadas: r.conservadas });
  });

  it("la simulación con conservarSellado no deja huella y cuenta lo mismo", () => {
    const { db } = conSellado();
    const antes = huella(db);
    const sim = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL, conservarSellado: true, simular: true });
    expect(huella(db)).toBe(antes);
    const real = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL, conservarSellado: true });
    expect(real.movidas).toEqual(sim.movidas);
    expect(real.conservadas).toEqual(sim.conservadas);
  });

  it("sin historia sellada, conservarSellado no cambia nada: el pending se borra como siempre", () => {
    const { db } = escenario();
    const r = vincularPrincipal(db, FOUNDER, { slug: "juan", wallet: JUAN_REAL, conservarSellado: true });
    expect(r.conservadas ?? {}).toEqual({});
    expect(rol(db, JUAN)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Introspección: REFERENCIAS_WALLET cubre TODAS las columnas de wallet del esquema
// ---------------------------------------------------------------------------

/** Tablas y columnas (con sus UNIQUE) leídas de `schema.sql`, sin comentarios. */
function columnasDelEsquema(): Map<string, { columnas: string[]; unicos: string[][] }> {
  const sinComentarios = SCHEMA.replace(/--[^\n]*/g, "");
  const out = new Map<string, { columnas: string[]; unicos: string[][] }>();
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g;
  for (const m of sinComentarios.matchAll(re)) {
    const columnas: string[] = [];
    const unicos: string[][] = [];
    for (const linea of m[2].split("\n").map((l) => l.trim()).filter(Boolean)) {
      const unico = /^UNIQUE\s*\(([^)]+)\)/i.exec(linea);
      if (unico) {
        unicos.push(unico[1].split(",").map((c) => c.trim()));
        continue;
      }
      if (/^(FOREIGN KEY|PRIMARY KEY|CHECK)\b/i.test(linea)) continue;
      const col = /^(\w+)\s+\w+/.exec(linea);
      if (col) columnas.push(col[1]);
    }
    out.set(m[1], { columnas, unicos });
  }
  return out;
}

const NOMBRES_DE_WALLET = /^(wallet|\w+_wallet|created_by|author|invited_by|issuer_wallet|used_by|imported_by|added_by)$/;
const EXCLUIDAS = new Set(["users.wallet", "cla_signatures.wallet"]);
const TABLAS_EXCLUIDAS = new Set(["talent_events", "roster_links"]);

describe("REFERENCIAS_WALLET · introspección de schema.sql", () => {
  const esquema = columnasDelEsquema();
  const lista = new Set(REFERENCIAS_WALLET.map((r) => `${r.tabla}.${r.columna}`));

  it("el parser lee el esquema de verdad (no pasa por vacío)", () => {
    expect(esquema.size).toBeGreaterThan(30);
    expect(esquema.get("assignments")?.columnas).toContain("owner_wallet");
    expect(esquema.get("rite_attendance")?.unicos).toContainEqual(["session_id", "wallet", "layer"]);
  });

  it("toda columna de wallet del esquema está en la lista (salvo las exclusiones del spec)", () => {
    const faltan: string[] = [];
    for (const [tabla, { columnas }] of esquema) {
      if (TABLAS_EXCLUIDAS.has(tabla)) continue;
      for (const c of columnas) {
        const clave = `${tabla}.${c}`;
        if (NOMBRES_DE_WALLET.test(c) && !EXCLUIDAS.has(clave) && !lista.has(clave)) faltan.push(clave);
      }
    }
    expect(faltan).toEqual([]);
  });

  it("la lista no nombra tablas ni columnas que no existen, ni talent_events ni roster_links", () => {
    for (const r of REFERENCIAS_WALLET) {
      expect(esquema.get(r.tabla)?.columnas ?? [], `${r.tabla}.${r.columna}`).toContain(r.columna);
      expect(TABLAS_EXCLUIDAS.has(r.tabla)).toBe(false);
    }
    expect(lista.size).toBe(REFERENCIAS_WALLET.length); // sin duplicados
  });

  it("incluye las tablas nuevas de §3.3 con su unicaCon", () => {
    const de = (k: string) => REFERENCIAS_WALLET.find((r) => `${r.tabla}.${r.columna}` === k);
    expect(de("rite_sessions.host_wallet")).toBeDefined();
    expect(de("rite_sessions.recorder_wallet")).toBeDefined();
    expect(de("rite_sessions.created_by")).toBeDefined();
    expect(de("rite_attendance.wallet")?.unicaCon).toEqual(["session_id", "layer"]);
    expect(de("avisos.wallet")?.unicaCon).toEqual(["clave"]);
    expect(de("reminders_sent.wallet")?.unicaCon).toEqual(["clave"]);
  });

  it("unicaCon coincide con cada UNIQUE del esquema que contiene la wallet", () => {
    for (const r of REFERENCIAS_WALLET) {
      const unicos = (esquema.get(r.tabla)?.unicos ?? []).filter((u) => u.includes(r.columna));
      for (const u of unicos) {
        expect([...(r.unicaCon ?? ["(falta unicaCon)"])].sort(), `${r.tabla}.${r.columna}`).toEqual(
          u.filter((c) => c !== r.columna).sort()
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A2-4 · directorioTalento
// ---------------------------------------------------------------------------

describe("directorioTalento (A2-4)", () => {
  let db: DB;
  let huerto: number;
  let cocina: number;
  beforeEach(() => {
    db = freshDb();
    usuario(db, SESION, { nombre: "John", role: "founder" });
    usuario(db, ANA, { nombre: "Ana" });
    usuario(db, LUIS, { nombre: "Luis" });
    usuario(db, DEMOCONTRIB, { nombre: "Demo", isDemo: 1 });
    huerto = upsertInitiative(db, "Huerto Demo");
    cocina = upsertInitiative(db, "Cocina Demo");
    miembro(db, huerto, ANA, "ejecuta", "externo");
    miembro(db, huerto, ANA, "revisa", "externo");
    miembro(db, huerto, FAUSTO, "estructura", "interno");
    miembro(db, cocina, FAUSTO, "ejecuta", "externo");
    miembro(db, cocina, DAVID, "vende", "interno");
    createAssignment(db, { title: "Uno", initiativeId: huerto, ownerWallet: ANA, status: "En curso" });
    createAssignment(db, { title: "Dos", initiativeId: huerto, ownerWallet: ANA, status: "Bloqueada" });
    createAssignment(db, { title: "Tres", initiativeId: huerto, ownerWallet: ANA, status: "Hecha" });
  });

  it("deriva el vínculo de las membresías (interno, externo, mixto o sin proyectos)", () => {
    const d = new Map(directorioTalento(db).map((p) => [p.wallet, p]));
    expect(d.get(ANA)?.vinculo).toBe("externo");
    expect(d.get(DAVID)?.vinculo).toBe("interno");
    expect(d.get(FAUSTO)?.vinculo).toBe("mixto");
    expect(d.get(LUIS)?.vinculo).toBeNull();
    expect(d.get(ANA)?.membresias).toEqual([
      { initiativeId: huerto, slug: "huerto-demo", nombre: "Huerto Demo", roles: ["ejecuta", "revisa"] },
    ]);
    expect(d.get(FAUSTO)?.membresias.map((m) => m.nombre)).toEqual(["Cocina Demo", "Huerto Demo"]);
  });

  it("abiertas = carga por repartir (todo lo que no está Hecha)", () => {
    const d = new Map(directorioTalento(db).map((p) => [p.wallet, p]));
    expect(d.get(ANA)?.abiertas).toBe(2);
    expect(d.get(LUIS)?.abiertas).toBe(0);
  });

  it("sin cuentas demo y por orden de nombre (nunca por carga ni por puntos)", () => {
    const lista = directorioTalento(db);
    expect(lista.some((p) => p.wallet === DEMOCONTRIB)).toBe(false);
    const nombres = lista.map((p) => p.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })));
  });

  it("marca las filas del roster sin vincular y el acuerdo firmado", () => {
    const d = new Map(directorioTalento(db).map((p) => [p.wallet, p]));
    expect(d.get(JUAN)?.pendiente).toBe(true);
    expect(d.get(JUAN)?.tieneCla).toBe(false);
    expect(d.get(ANA)?.pendiente).toBe(false);
    expect(d.get(ANA)?.tieneCla).toBe(true);
    expect(d.get(VALE)).toMatchObject({ role: "core", isSupervisor: true, status: "active" });
  });

  it("filtro Interno · Externo: mixto en los dos; sin proyectos, por su rol", () => {
    const internas = directorioTalento(db, { vinculo: "interno" }).map((p) => p.wallet);
    const externas = directorioTalento(db, { vinculo: "externo" }).map((p) => p.wallet);
    expect(internas).toEqual(expect.arrayContaining([DAVID, FAUSTO, JUAN, SESION]));
    expect(internas).not.toContain(ANA);
    expect(internas).not.toContain(LUIS);
    expect(externas).toEqual(expect.arrayContaining([ANA, FAUSTO, LUIS]));
    expect(externas).not.toContain(DAVID);
    expect(externas).not.toContain(JUAN);
  });

  it("candidatosAVincular: cuentas reales con acuerdo, sin pending, sin demo y sin vincular", () => {
    usuario(db, SINCLA, { nombre: "Sin acuerdo", cla: 0 });
    const c = candidatosAVincular(db).map((x) => x.wallet);
    expect(c).toEqual(expect.arrayContaining([SESION, ANA, LUIS]));
    expect(c).not.toContain(SINCLA);
    expect(c).not.toContain(DEMOCONTRIB);
    expect(c.some((w) => w.startsWith("pending:"))).toBe(false);
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('fausto', ?, ?)`).run(LUIS, SESION);
    expect(candidatosAVincular(db).map((x) => x.wallet)).not.toContain(LUIS);
  });
});
