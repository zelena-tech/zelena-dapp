/**
 * WP15 — criterios del dashboard de seguimiento sobre datos REALES de WP14.
 *
 *  1. Bloqueos primero: motivo, responsable y días bloqueado (del historial
 *     append-only, no de una columna inventada).
 *  2. Integración real: un bloqueo aplicado con `applyAssignmentAction` (lo que
 *     hace `/equipo/hoy`) aparece en el agregado del dashboard al siguiente render.
 *  3. Solo founder y supervisores; un `core` normal recibe 403.
 *  4. Carga por persona para repartir, NUNCA ordenada por cantidad de trabajo.
 *  5. Cero métricas inventadas: sin datos, ceros y nulls explícitos.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, type TeamActor } from "./roles";
import { TeamError, applyAssignmentAction, createAssignment, seedTeam, upsertCheckin, upsertInitiative } from "./team";
import {
  LOAD_PURPOSE,
  blockedWithAge,
  buildDashboard,
  daysBetween,
  epochSnapshot,
  founderInbox,
  initiativeBars,
  loadByPerson,
  plazosDelEquipo,
  riteHealth,
} from "./dashboard";
import { instanteLocal } from "./zona-horaria";
import { clearGenomeCache } from "./genome";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const FAUSTO = pendingPrincipal("fausto");
const DAVID = pendingPrincipal("david");

/** Lunes 2026-07-27. Jueves de esa semana = 2026-07-30. Construidos en hora local
 *  (mediodía) para que ningún desplazamiento de zona horaria corra el día. */
const LUNES = new Date(2026, 6, 27, 12, 0, 0);
const MARTES = new Date(2026, 6, 28, 12, 0, 0);
const JUEVES = new Date(2026, 6, 30, 12, 0, 0);

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

const ACTORS: Record<string, TeamActor> = {
  [JOHN]: { wallet: JOHN, name: "John", role: "founder", isSupervisor: true },
  [VALE]: { wallet: VALE, name: "Vale", role: "core", isSupervisor: true },
  [FAUSTO]: { wallet: FAUSTO, name: "Fausto", role: "core", isSupervisor: false },
  [DAVID]: { wallet: DAVID, name: "David", role: "core", isSupervisor: false },
};

describe("días de calendario", () => {
  it("cuenta días entre dos días YYYY-MM-DD y devuelve null si la fecha no es válida", () => {
    expect(daysBetween("2026-07-25", "2026-07-30")).toBe(5);
    expect(daysBetween("2026-07-30", "2026-07-30")).toBe(0);
    // Cruce de mes y de horario de verano: sigue siendo un día por día.
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("no-es-un-dia", "2026-07-30")).toBeNull();
  });
});

describe("bloqueos primero (criterio 1 y 2 de WP15)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("un bloqueo creado con la acción de /equipo/hoy aparece en el dashboard con motivo, responsable y días", () => {
    const wms = upsertInitiative(db, "WMS", "Ahora");
    const id = createAssignment(db, {
      title: "Migrar inventario del WMS",
      initiativeId: wms,
      ownerWallet: FAUSTO,
      status: "Backlog",
    });

    // Antes de bloquear: el dashboard no muestra ningún bloqueo.
    expect(blockedWithAge(db, JUEVES)).toHaveLength(0);

    // Recorrido REAL de la UI: tomar → empezar → bloquear con motivo.
    applyAssignmentAction(db, { assignmentId: id, action: "asignar", actor: ACTORS[FAUSTO], now: LUNES });
    applyAssignmentAction(db, { assignmentId: id, action: "empezar", actor: ACTORS[FAUSTO], now: LUNES });
    applyAssignmentAction(db, {
      assignmentId: id,
      action: "bloquear",
      reason: "Falta la credencial del cliente",
      actor: ACTORS[FAUSTO],
      now: LUNES,
    });

    // Siguiente render del dashboard (jueves de la misma semana).
    const items = blockedWithAge(db, JUEVES);
    expect(items).toHaveLength(1);
    expect(items[0].assignment.id).toBe(id);
    expect(items[0].assignment.title).toBe("Migrar inventario del WMS");
    expect(items[0].reason).toBe("Falta la credencial del cliente");
    expect(items[0].assignment.owner_name).toBe("Fausto");
    expect(items[0].since).toBe("2026-07-27");
    expect(items[0].daysBlocked).toBe(3);
    // Los días salen del historial append-only, no de una columna nueva.
    expect(items[0].sinceSource).toBe("evento");

    // Y también entra en el resumen de la iniciativa.
    const wmsBar = initiativeBars(db, JUEVES).find((b) => b.name === "WMS");
    expect(wmsBar?.blocked).toBe(1);
    expect(wmsBar?.byStatus.Bloqueada).toBe(1);
    expect(wmsBar?.open).toBe(0);
  });

  it("desbloquear en /equipo/hoy lo saca del dashboard en el siguiente render", () => {
    const id = createAssignment(db, { title: "Integrar Odoo", ownerWallet: DAVID, status: "Backlog" });
    applyAssignmentAction(db, { assignmentId: id, action: "asignar", actor: ACTORS[DAVID], now: LUNES });
    applyAssignmentAction(db, {
      assignmentId: id,
      action: "bloquear",
      reason: "Espera decisión de alcance",
      actor: ACTORS[DAVID],
      now: LUNES,
    });
    expect(blockedWithAge(db, JUEVES)).toHaveLength(1);

    applyAssignmentAction(db, { assignmentId: id, action: "desbloquear", actor: ACTORS[DAVID], now: MARTES });
    expect(blockedWithAge(db, JUEVES)).toHaveLength(0);
  });

  it("un re-bloqueo cuenta días desde el bloqueo VIGENTE, no desde el primero", () => {
    const id = createAssignment(db, { title: "Definir marca de Harmony", ownerWallet: DAVID, status: "Asignada" });
    applyAssignmentAction(db, {
      assignmentId: id,
      action: "bloquear",
      reason: "Primer bloqueo",
      actor: ACTORS[DAVID],
      now: LUNES,
    });
    applyAssignmentAction(db, { assignmentId: id, action: "desbloquear", actor: ACTORS[DAVID], now: LUNES });
    applyAssignmentAction(db, {
      assignmentId: id,
      action: "bloquear",
      reason: "Segundo bloqueo, otro motivo",
      actor: ACTORS[DAVID],
      now: MARTES,
    });

    const items = blockedWithAge(db, JUEVES);
    expect(items).toHaveLength(1);
    expect(items[0].since).toBe("2026-07-28");
    expect(items[0].daysBlocked).toBe(2);
    expect(items[0].reason).toBe("Segundo bloqueo, otro motivo");
  });

  it("ordena los bloqueos del más viejo al más nuevo y no inventa antigüedad cuando no hay registro", () => {
    const viejo = createAssignment(db, { title: "Bloqueo viejo", ownerWallet: FAUSTO, status: "En curso" });
    const nuevo = createAssignment(db, { title: "Bloqueo nuevo", ownerWallet: DAVID, status: "En curso" });
    // Fila creada directamente como Bloqueada, sin evento y sin blocked_at:
    // el importador o un dato previo pueden verse así.
    const sinRegistro = createAssignment(db, { title: "Sin registro", ownerWallet: DAVID, status: "Bloqueada" });

    applyAssignmentAction(db, { assignmentId: viejo, action: "bloquear", reason: "a", actor: ACTORS[FAUSTO], now: LUNES });
    applyAssignmentAction(db, { assignmentId: nuevo, action: "bloquear", reason: "b", actor: ACTORS[DAVID], now: MARTES });

    const items = blockedWithAge(db, JUEVES);
    expect(items.map((i) => i.assignment.id)).toEqual([viejo, nuevo, sinRegistro]);
    expect(items[0].daysBlocked).toBe(3);
    expect(items[1].daysBlocked).toBe(2);
    expect(items[2].daysBlocked).toBeNull();
    expect(items[2].sinceSource).toBe("sin-registro");
  });
});

describe("esperando a John (bandeja de gates)", () => {
  it("trae solo lo marcado needs_founder y no lo ya cerrado", () => {
    const db = freshDb();
    createAssignment(db, { title: "Decidir presupuesto de Harmony", ownerWallet: JOHN, needsFounder: true });
    createAssignment(db, { title: "Aprobar identidad visual", ownerWallet: DAVID, needsFounder: true });
    createAssignment(db, { title: "Trabajo normal", ownerWallet: DAVID });
    createAssignment(db, { title: "Gate ya resuelto", ownerWallet: DAVID, needsFounder: true, status: "Hecha" });

    const inbox = founderInbox(db);
    expect(inbox.map((a) => a.title).sort()).toEqual([
      "Aprobar identidad visual",
      "Decidir presupuesto de Harmony",
    ]);
  });
});

describe("carga por persona: repartir, no rankear (doc 16)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("cuenta abiertas y en curso por miembro y separa el trabajo sin responsable", () => {
    createAssignment(db, { title: "A", ownerWallet: FAUSTO, status: "En curso" });
    createAssignment(db, { title: "B", ownerWallet: FAUSTO, status: "En curso" });
    createAssignment(db, { title: "C", ownerWallet: FAUSTO, status: "En revisión" });
    createAssignment(db, { title: "D", ownerWallet: DAVID, status: "Asignada", needsFounder: true });
    createAssignment(db, { title: "E", ownerWallet: DAVID, status: "Bloqueada" });
    createAssignment(db, { title: "F", ownerWallet: null, status: "Backlog" });
    createAssignment(db, { title: "G", ownerWallet: FAUSTO, status: "Hecha" }); // cerrada: no es carga

    const load = loadByPerson(db);
    const fausto = load.people.find((p) => p.name === "Fausto")!;
    expect(fausto.open).toBe(3);
    expect(fausto.inProgress).toBe(2);
    expect(fausto.inReview).toBe(1);
    expect(fausto.blocked).toBe(0);

    const david = load.people.find((p) => p.name === "David")!;
    expect(david.open).toBe(1);
    expect(david.assigned).toBe(1);
    expect(david.blocked).toBe(1);
    expect(david.needsFounder).toBe(1);

    expect(load.unassignedOpen).toBe(1);
    expect(load.totalOpen).toBe(5); // 3 Fausto + 1 David + 1 sin responsable
    expect(load.totalInProgress).toBe(2);
  });

  it("lista el roster completo en orden ALFABÉTICO, no por cantidad de trabajo", () => {
    createAssignment(db, { title: "muchas", ownerWallet: VALE, status: "En curso" });
    createAssignment(db, { title: "mas", ownerWallet: VALE, status: "En curso" });
    createAssignment(db, { title: "una", ownerWallet: ACTORS[DAVID].wallet, status: "En curso" });

    const load = loadByPerson(db);
    const names = load.people.map((p) => p.name);
    // Los 6 del roster aparecen, incluida la gente con cero: es un roster, no
    // una tabla de posiciones.
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "es")));
    expect(names).toContain("Angela");
    expect(load.people.find((p) => p.name === "Angela")!.open).toBe(0);
    // La persona con más carga NO queda primera por tener más carga.
    expect(names[0]).not.toBe("Vale");
  });

  it("declara su propósito explícitamente y no habla del valor de las personas", () => {
    const load = loadByPerson(db);
    expect(load.purpose).toBe(LOAD_PURPOSE);
    expect(load.purpose).toMatch(/repartir/i);
    expect(load.purpose).toMatch(/no para rankear/i);
    // Doc 16: no existe "bajo desempeño" ni lenguaje sobre el valor de nadie.
    expect(LOAD_PURPOSE.toLowerCase()).not.toMatch(/desempe|rendimiento|productividad/);
  });
});

describe("la cohorte demo no se cuela en las vistas del equipo", () => {
  /**
   * Regresión encontrada renderizando la página real: `seedIfEmpty` crea un
   * founder de DEMOSTRACIÓN ("John (Founder)", is_demo = 1) y `seedTeamRoster` lo
   * promueve a role='founder'. Sin filtrar, John salía DOS VECES en la carga y la
   * salud del rito dividía entre 7 personas en vez de 6.
   */
  function dbWithDemoCohort(): DB {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor)
       VALUES ('GDEMOFOUNDER', 'John (Founder)', 'Gold', NULL, 'active', 1, 1, 1, 'founder', 1)`
    ).run();
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor)
       VALUES ('GDEMOCORE', 'Delina', 'Silver', NULL, 'active', 1, 0, 'contributor', 0, 0)`
    ).run();
    return db;
  }

  it("no duplica a John ni infla el denominador del rito", () => {
    const db = dbWithDemoCohort();
    const load = loadByPerson(db);
    const johns = load.people.filter((p) => p.name.startsWith("John"));
    expect(johns).toHaveLength(1);
    expect(johns[0].wallet).toBe(JOHN);
    expect(load.people).toHaveLength(6);

    const r = riteHealth(db, JUEVES);
    expect(r.members).toBe(6);
    expect(r.expected).toBe(24);
    expect(r.perMember.filter((m) => m.name.startsWith("John"))).toHaveLength(1);
  });

  it("el trabajo de un dueño fuera del roster se cuenta en los totales, no se descarta en silencio", () => {
    const db = dbWithDemoCohort();
    createAssignment(db, { title: "De la cuenta demo", ownerWallet: "GDEMOFOUNDER", status: "En curso" });
    createAssignment(db, { title: "Bloqueada demo", ownerWallet: "GDEMOFOUNDER", status: "Bloqueada" });
    createAssignment(db, { title: "Del roster", ownerWallet: FAUSTO, status: "En curso" });

    const load = loadByPerson(db);
    // No aparece como fila de persona…
    expect(load.people.some((p) => p.wallet === "GDEMOFOUNDER")).toBe(false);
    // …pero el total sí lo cuenta: 1 de Fausto + 1 de fuera del roster.
    expect(load.outsideRosterOpen).toBe(1);
    expect(load.outsideRosterBlocked).toBe(1);
    expect(load.totalOpen).toBe(2);
  });
});

describe("salud de ritos", () => {
  it("calcula el % contra los días transcurridos de la semana, sin telemetría de presencia", () => {
    const db = freshDb();
    // Semana del lunes 2026-07-27; "hoy" es jueves 30 → 4 días transcurridos.
    upsertCheckin(db, FAUSTO, { done: "a", doing: "b", blocked: "" }, LUNES);
    upsertCheckin(db, FAUSTO, { done: "a", doing: "b", blocked: "" }, MARTES);
    upsertCheckin(db, VALE, { done: "c", doing: "", blocked: "" }, MARTES);

    const r = riteHealth(db, JUEVES);
    expect(r.weekStart).toBe("2026-07-27");
    expect(r.daysElapsed).toBe(4);
    expect(r.members).toBe(6);
    expect(r.expected).toBe(24);
    expect(r.actual).toBe(3);
    expect(r.pct).toBe(13); // 3/24 = 12.5 → 13
    expect(r.perMember.map((m) => m.name)).toEqual(
      [...r.perMember.map((m) => m.name)].sort((a, b) => a.localeCompare(b, "es"))
    );
    expect(r.perMember.find((m) => m.name === "Fausto")!.checkins).toBe(2);
  });

  it("no cuenta check-ins de la semana anterior", () => {
    const db = freshDb();
    const domingoAnterior = new Date(2026, 6, 26, 12, 0, 0);
    upsertCheckin(db, FAUSTO, { done: "de la semana pasada", doing: "", blocked: "" }, domingoAnterior);
    const r = riteHealth(db, JUEVES);
    expect(r.actual).toBe(0);
    expect(r.pct).toBe(0);
  });
});

describe("métricas de época (solo lectura de WP07)", () => {
  it("sin época abierta no inventa nada: period null y closedThisEpoch null", () => {
    const db = freshDb();
    const snap = epochSnapshot(db);
    expect(snap.period).toBeNull();
    expect(snap.closedThisEpoch).toBeNull();
    expect(snap.fitness).toBeNull();
    expect(snap.blockedNow).toBe(0);
  });

  it("cuenta las entregas cerradas desde que abrió la época", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO periods (id, name, epoch_budget, academia_budget, state, created_at)
       VALUES (1, 'Época Génesis', 1000, 100, 'Open', '2026-07-27 00:00:00')`
    ).run();

    const cerrada = createAssignment(db, { title: "Cerrada en la época", ownerWallet: FAUSTO, status: "En revisión" });
    applyAssignmentAction(db, { assignmentId: cerrada, action: "aprobar", actor: ACTORS[VALE], now: MARTES });
    // Cerrada ANTES de que abriera la época: no cuenta.
    createAssignment(db, { title: "Vieja", ownerWallet: FAUSTO, status: "Backlog" });
    db.prepare(`UPDATE assignments SET status='Hecha', closed_at='2026-07-01T10:00:00.000Z' WHERE title='Vieja'`).run();

    const snap = epochSnapshot(db);
    expect(snap.period?.name).toBe("Época Génesis");
    expect(snap.period?.startDay).toBe("2026-07-27");
    expect(snap.closedThisEpoch).toBe(1);
  });
});

describe("puerta de acceso: solo founder y supervisores (criterio 4 de WP15)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("un core normal recibe 403", () => {
    expect(() => buildDashboard(db, ACTORS[FAUSTO], JUEVES)).toThrowError(TeamError);
    try {
      buildDashboard(db, ACTORS[FAUSTO], JUEVES);
      throw new Error("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(TeamError);
      expect((e as TeamError).status).toBe(403);
    }
  });

  it("un contributor recibe 403", () => {
    const actor: TeamActor = { wallet: "GDEMO", name: "Alguien", role: "contributor", isSupervisor: false };
    try {
      buildDashboard(db, actor, JUEVES);
      throw new Error("debió lanzar");
    } catch (e) {
      expect((e as TeamError).status).toBe(403);
    }
  });

  it("el founder entra", () => {
    const d = buildDashboard(db, ACTORS[JOHN], JUEVES);
    expect(d.day).toBe("2026-07-30");
    expect(d.actor.wallet).toBe(JOHN);
  });

  it("una core CON flag de supervisora entra (Vale, plano 07 §5)", () => {
    const d = buildDashboard(db, ACTORS[VALE], JUEVES);
    expect(d.actor.role).toBe("core");
    expect(d.actor.isSupervisor).toBe(true);
    expect(d.rites.members).toBe(6);
  });
});

describe("cero métricas inventadas", () => {
  it("una base sin trabajo devuelve ceros y nulls, no números de relleno", () => {
    const db = freshDb();
    const d = buildDashboard(db, ACTORS[JOHN], JUEVES);
    expect(d.blocked).toEqual([]);
    expect(d.waitingOnFounder).toEqual([]);
    expect(d.load.totalOpen).toBe(0);
    expect(d.load.people.every((p) => p.open === 0 && p.blocked === 0)).toBe(true);
    expect(d.rites.actual).toBe(0);
    expect(d.epoch.closedThisEpoch).toBeNull();
    // Las iniciativas sembradas existen pero todas con total 0: la UI las oculta.
    expect(d.initiatives.every((b) => b.total === 0)).toBe(true);
  });
});

describe("plazos del equipo (criterio I4 de WP31)", () => {
  // Miércoles 2026-07-29 a las 15:00 de Bogotá (20:00 UTC): quedan 3 h hábiles del día.
  const AHORA = instanteLocal("2026-07-29", "15:00", "America/Bogota");
  let db: DB;
  let wms: number;

  /** Pieza con su reloj arrancado hace días (created_at explícito: el default sería el reloj real). */
  function pieza(o: {
    title: string;
    owner?: string | null;
    status?: "Backlog" | "Asignada" | "En curso" | "En revisión" | "Bloqueada" | "Hecha";
    priority?: "Urgent" | "High" | "Normal" | "Low";
    due?: string | null;
  }): number {
    const id = createAssignment(db, {
      title: o.title,
      initiativeId: wms,
      ownerWallet: o.owner === undefined ? FAUSTO : o.owner,
      status: o.status ?? "En curso",
      priority: o.priority ?? "Normal",
      dueDate: o.due ?? null,
    });
    db.prepare(`UPDATE assignments SET created_at = ? WHERE id = ?`).run("2026-07-20 13:00:00", id);
    return id;
  }

  beforeEach(() => {
    db = freshDb();
    wms = upsertInitiative(db, "WMS", "Ahora");
  });

  it("separa lo vencido de lo que está por vencer, cada lista por su vencimiento", () => {
    const vencidaAyer = pieza({ title: "Vencida ayer", priority: "High", due: "2026-07-28" });
    const vencidaViernes = pieza({ title: "Vencida el viernes", owner: DAVID, due: "2026-07-24" });
    const venceHoy = pieza({ title: "Vence hoy", due: "2026-07-29" });
    const venceManana = pieza({ title: "Vence mañana temprano", owner: DAVID, due: "2026-07-30" });
    pieza({ title: "A tiempo", due: "2026-08-14" });
    pieza({ title: "Sin plazo", priority: "Low", due: null });
    pieza({ title: "Bloqueada", status: "Bloqueada", due: "2026-07-01" });
    pieza({ title: "Hecha", status: "Hecha", due: "2026-07-01" });

    const p = plazosDelEquipo(db, ACTORS[JOHN], AHORA);
    expect(p.ahora).toBe(AHORA);
    expect(p.vencidas.map((x) => x.assignment.id)).toEqual([vencidaViernes, vencidaAyer]);
    expect(p.vencidas.every((x) => x.sla.estado === "vencida")).toBe(true);
    // Hoy a las 18:00 quedan 3 h hábiles; mañana, las 3 de hoy más la jornada hábil de mañana
    // hasta las 18:00 = 13 h > tope de aviso (10 h): esa va a tiempo.
    expect(p.porVencer.map((x) => x.assignment.id)).toEqual([venceHoy]);
    expect(p.porVencer[0].sla.horasRestantes).toBe(3);
    expect(p.aTiempo).toBe(2);
    expect(p.sinPlazo).toBe(1);
    // Lo bloqueado y lo hecho no entran (lo bloqueado tiene su sección arriba).
    const todas = [...p.vencidas, ...p.porVencer].map((x) => x.assignment.title);
    expect(todas).not.toContain("Bloqueada");
    expect(todas).not.toContain("Hecha");
    expect([...p.vencidas, ...p.porVencer].some((x) => x.assignment.id === venceManana)).toBe(false);
  });

  it("los plazos salen del genoma: con el tope de aviso más alto, mañana también está por vencer", () => {
    const venceManana = pieza({ title: "Vence mañana", due: "2026-07-30" });
    db.prepare(`INSERT INTO genome_versions (version, params, effective_from_epoch) VALUES (1, ?, 1)`).run(
      JSON.stringify({ SLA_WARN_MAX_H: 20, SLA_WARN_PCT: 50 })
    );
    clearGenomeCache(db);
    const p = plazosDelEquipo(db, ACTORS[JOHN], AHORA);
    expect(p.porVencer.map((x) => x.assignment.id)).toEqual([venceManana]);
  });

  it("un core sin supervisión solo ve los plazos de lo suyo", () => {
    pieza({ title: "De Fausto, vencida", due: "2026-07-28" });
    pieza({ title: "De David, vencida", owner: DAVID, due: "2026-07-28" });
    const p = plazosDelEquipo(db, ACTORS[DAVID], AHORA);
    expect(p.vencidas.map((x) => x.assignment.title)).toEqual(["De David, vencida"]);
  });

  it("sin trabajo, listas vacías y ceros: no inventa plazos", () => {
    const p = plazosDelEquipo(db, ACTORS[JOHN], AHORA);
    expect(p.vencidas).toEqual([]);
    expect(p.porVencer).toEqual([]);
    expect(p.aTiempo + p.sinPlazo).toBe(0);
  });
});
