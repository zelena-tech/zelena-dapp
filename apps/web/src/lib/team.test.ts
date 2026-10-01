/**
 * WP14 — criterios 2, 4, 5 y 6 sobre la capa de datos del módulo equipo.
 *
 *  2. Cada miembro ve SOLO sus asignaciones; founder y supervisor ven todo.
 *  4. Bloquear exige motivo; el bloqueo aparece en la vista de proyectos.
 *  5. Check-in diario: uno por persona por día, editable el mismo día.
 *  6. Copys/vocabulario auditados: se califican entregas, nunca personas.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, type TeamActor } from "./roles";
import { BlockReasonRequiredError, InvalidTeamTransitionError } from "./team-state-machine";
import {
  applyAssignmentAction,
  assignmentEventsOfDay,
  assignmentsForClient,
  assignmentsByInitiative,
  assignmentsForOwner,
  actorFromSession,
  createAssignmentAs,
  checkinsOfDay,
  createAssignment,
  getAssignment,
  getCheckin,
  listBlocked,
  listNeedsFounder,
  listTeamMembers,
  ownProgress,
  seedTeam,
  today,
  upsertCheckin,
  upsertInitiative,
  visibleAssignments,
  weekStart,
  prevWeekStart,
  TeamError,
  type AssignmentRow,
} from "./team";
import { createClient } from "./clients";

const FAUSTO = pendingPrincipal("fausto");
const DAVID = pendingPrincipal("david");
const VALE = pendingPrincipal("vale");
const JOHN = pendingPrincipal("john");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

/** Actores fijos del roster, con los roles del plano 07 §5. */
function actor(wallet: string): TeamActor {
  const map: Record<string, TeamActor> = {
    [FAUSTO]: { wallet: FAUSTO, name: "Fausto", role: "core", isSupervisor: false },
    [DAVID]: { wallet: DAVID, name: "David", role: "core", isSupervisor: false },
    [VALE]: { wallet: VALE, name: "Vale", role: "core", isSupervisor: true },
    [JOHN]: { wallet: JOHN, name: "John", role: "founder", isSupervisor: true },
  };
  return map[wallet];
}

function seedWork(db: DB): { wms: number; a1: number; a2: number } {
  const wms = upsertInitiative(db, "WMS", "Ahora");
  const a1 = createAssignment(db, {
    title: "Módulo de analítica",
    initiativeId: wms,
    ownerWallet: FAUSTO,
    status: "Asignada",
    priority: "High",
    acceptanceCriteria: "Vistas navegables con QA aprobado.",
  });
  const a2 = createAssignment(db, {
    title: "Soporte a clientes en producción",
    initiativeId: wms,
    ownerWallet: DAVID,
    status: "Asignada",
    priority: "Urgent",
    acceptanceCriteria: "Incidentes atendidos dentro del SLA.",
  });
  return { wms, a1, a2 };
}

describe("seed idempotente del roster (WP14)", () => {
  it("crea los 6 con su principal `pending:<slug>` y sus roles del plano 07", () => {
    const db = freshDb();
    const rows = db
      .prepare(`SELECT wallet, display_name, role, is_supervisor FROM users WHERE wallet LIKE 'pending:%' ORDER BY wallet`)
      .all() as Array<{ wallet: string; display_name: string; role: string; is_supervisor: number }>;
    expect(rows).toHaveLength(6);
    const john = rows.find((r) => r.wallet === JOHN)!;
    expect(john.role).toBe("founder");
    expect(john.is_supervisor).toBe(1);
    const vale = rows.find((r) => r.wallet === VALE)!;
    expect(vale.role).toBe("core");
    expect(vale.is_supervisor).toBe(1);
    const fausto = rows.find((r) => r.wallet === FAUSTO)!;
    expect(fausto.role).toBe("core");
    expect(fausto.is_supervisor).toBe(0);
  });

  it("correr el seed dos veces no duplica usuarios ni iniciativas", () => {
    const db = freshDb();
    const users = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    const inits = (db.prepare(`SELECT COUNT(*) AS n FROM initiatives`).get() as { n: number }).n;
    seedTeam(db);
    seedTeam(db);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(users);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM initiatives`).get() as { n: number }).n).toBe(inits);
  });

  it("no guarda correos ni ningún secreto en la fila del roster", () => {
    const db = freshDb();
    const dump = JSON.stringify(db.prepare(`SELECT * FROM users WHERE wallet LIKE 'pending:%'`).all());
    expect(dump).not.toMatch(/@/);
    expect(dump.toLowerCase()).not.toMatch(/password|secret|token/);
  });

  it("listTeamMembers devuelve el equipo interno (founder + core), no la cohorte demo", () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, cla_signed, role) VALUES ('GDEMOCONTRIB0001','Demo','Bronze',1,'contributor')`
    ).run();
    const members = listTeamMembers(db);
    expect(members.map((m) => m.wallet)).not.toContain("GDEMOCONTRIB0001");
    expect(members).toHaveLength(6);
  });

  // D2-04: quien se va sale del denominador de los ritos y de la carga, pero NO de
  // la historia. Sin este filtro, una persona `alumni` bajaba el % del equipo para
  // siempre por alguien que ya no está.
  it("un miembro `alumni` sale de listTeamMembers, pero conserva su historial", () => {
    const db = freshDb();
    const vale = pendingPrincipal("vale");

    expect(listTeamMembers(db).map((m) => m.wallet)).toContain(vale);

    // Le acreditamos algo ANTES de la baja, para comprobar que no se confisca.
    db.prepare(
      `INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 40, 1, 'ejecucion', 'demo')`
    ).run(vale);

    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet = ?`).run(vale);

    const activos = listTeamMembers(db);
    expect(activos.map((m) => m.wallet)).not.toContain(vale);
    expect(activos).toHaveLength(5); // el denominador del rito baja de 6 a 5

    // Y lo ganado sigue ahí: salir del equipo activo no borra el historial.
    const total = (
      db.prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger WHERE wallet = ?`).get(vale) as {
        n: number;
      }
    ).n;
    expect(total).toBe(40);
    // Su fila sigue existiendo: la identidad es el registro (plano 05).
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(vale)).toBeTruthy();
  });
});

describe("criterio 2 — visibilidad: cada quien lo suyo; founder y supervisor todo", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    seedWork(db);
  });

  it("un `core` ve SOLO sus asignaciones", () => {
    const mine = visibleAssignments(db, actor(FAUSTO));
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Módulo de analítica");
    expect(mine.every((a) => a.owner_wallet === FAUSTO)).toBe(true);
  });

  it("el founder ve todo el equipo", () => {
    expect(visibleAssignments(db, actor(JOHN))).toHaveLength(2);
  });

  it("una supervisora `core` (Vale) ve todo, aunque no tenga nada asignado", () => {
    expect(assignmentsForOwner(db, VALE)).toHaveLength(0);
    expect(visibleAssignments(db, actor(VALE))).toHaveLength(2);
  });

  it("las asignaciones de hoy vienen ordenadas por prioridad y luego por vencimiento", () => {
    const wms = upsertInitiative(db, "WMS");
    createAssignment(db, { title: "Baja sin fecha", initiativeId: wms, ownerWallet: FAUSTO, priority: "Low" });
    createAssignment(db, {
      title: "Normal con fecha cercana",
      initiativeId: wms,
      ownerWallet: FAUSTO,
      priority: "Normal",
      dueDate: "2026-08-01",
    });
    createAssignment(db, {
      title: "Normal con fecha lejana",
      initiativeId: wms,
      ownerWallet: FAUSTO,
      priority: "Normal",
      dueDate: "2026-12-01",
    });
    createAssignment(db, { title: "Urgente", initiativeId: wms, ownerWallet: FAUSTO, priority: "Urgent" });

    expect(assignmentsForOwner(db, FAUSTO).map((a) => a.title)).toEqual([
      "Urgente",
      "Módulo de analítica", // High
      "Normal con fecha cercana",
      "Normal con fecha lejana",
      "Baja sin fecha",
    ]);
  });

  it("el trabajo cerrado no ocupa la vista de hoy", () => {
    const id = (db.prepare(`SELECT id FROM assignments WHERE owner_wallet = ?`).get(FAUSTO) as { id: number }).id;
    applyAssignmentAction(db, { assignmentId: id, action: "empezar", actor: actor(FAUSTO) });
    applyAssignmentAction(db, { assignmentId: id, action: "enviar_a_revision", actor: actor(FAUSTO) });
    applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(VALE) });
    expect(assignmentsForOwner(db, FAUSTO)).toHaveLength(0);
  });
});

describe("transiciones persistidas — la máquina pura es la única autoridad", () => {
  let db: DB;
  let a1: number;
  let a2: number;
  beforeEach(() => {
    db = freshDb();
    const ids = seedWork(db);
    a1 = ids.a1;
    a2 = ids.a2;
  });

  it("una transición inválida se rechaza y NO toca la fila", () => {
    expect(() => applyAssignmentAction(db, { assignmentId: a1, action: "aprobar", actor: actor(FAUSTO) })).toThrow(
      InvalidTeamTransitionError
    );
    expect(getAssignment(db, a1)!.status).toBe("Asignada");
    expect(assignmentEventsOfDay(db, today())).toHaveLength(0); // no se registró evento
  });

  it("cada transición válida deja un evento append-only con actor y día", () => {
    applyAssignmentAction(db, { assignmentId: a1, action: "empezar", actor: actor(FAUSTO) });
    applyAssignmentAction(db, { assignmentId: a1, action: "enviar_a_revision", actor: actor(FAUSTO) });
    const events = assignmentEventsOfDay(db, today());
    expect(events.map((e) => e.action)).toEqual(["empezar", "enviar_a_revision"]);
    expect(events[0].from_status).toBe("Asignada");
    expect(events[0].to_status).toBe("En curso");
    expect(events[0].actor_wallet).toBe(FAUSTO);
  });

  it("aprobar la entrega deja fecha de cierre (base de 'cerradas esta semana')", () => {
    applyAssignmentAction(db, { assignmentId: a1, action: "empezar", actor: actor(FAUSTO) });
    applyAssignmentAction(db, { assignmentId: a1, action: "enviar_a_revision", actor: actor(FAUSTO) });
    const row = applyAssignmentAction(db, { assignmentId: a1, action: "aprobar", actor: actor(VALE) });
    expect(row.status).toBe("Hecha");
    expect(row.closed_at).not.toBeNull();
  });

  it("quien no es responsable ni supervisor recibe 403 (no puede mover trabajo ajeno)", () => {
    let err: unknown;
    try {
      applyAssignmentAction(db, { assignmentId: a2, action: "empezar", actor: actor(FAUSTO) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TeamError);
    expect((err as TeamError).status).toBe(403);
    expect(getAssignment(db, a2)!.status).toBe("Asignada");
  });

  it("tomar del Backlog algo sin dueño lo asigna a quien lo toma", () => {
    const wms = upsertInitiative(db, "WMS");
    const libre = createAssignment(db, { title: "Sin dueño", initiativeId: wms, status: "Backlog" });
    const row = applyAssignmentAction(db, { assignmentId: libre, action: "asignar", actor: actor(DAVID) });
    expect(row.status).toBe("Asignada");
    expect(row.owner_wallet).toBe(DAVID);
  });

  it("asignación inexistente → 404", () => {
    expect(() => applyAssignmentAction(db, { assignmentId: 9999, action: "empezar", actor: actor(JOHN) })).toThrow(
      TeamError
    );
  });
});

describe("criterio 4 — bloquear exige motivo y el bloqueo se ve en proyectos", () => {
  let db: DB;
  let a1: number;
  beforeEach(() => {
    db = freshDb();
    a1 = seedWork(db).a1;
  });

  it("bloquear sin motivo se rechaza y la fila queda intacta", () => {
    for (const reason of [undefined, "", "   "]) {
      expect(() =>
        applyAssignmentAction(db, { assignmentId: a1, action: "bloquear", reason, actor: actor(FAUSTO) })
      ).toThrow(BlockReasonRequiredError);
    }
    const row = getAssignment(db, a1)!;
    expect(row.status).toBe("Asignada");
    expect(row.blocked_reason).toBeNull();
  });

  it("bloquear con motivo lo persiste con fecha, y aparece en la vista de proyectos", () => {
    applyAssignmentAction(db, {
      assignmentId: a1,
      action: "bloquear",
      reason: "esperando accesos del cliente",
      actor: actor(FAUSTO),
    });
    const row = getAssignment(db, a1)!;
    expect(row.status).toBe("Bloqueada");
    expect(row.blocked_reason).toBe("esperando accesos del cliente");
    expect(row.blocked_at).not.toBeNull();
    expect(row.status_before_block).toBe("Asignada");

    // Vista de proyectos: el bloqueo sale en su iniciativa, con motivo y responsable.
    const wms = assignmentsByInitiative(db).find((s) => s.initiative?.name === "WMS")!;
    expect(wms.blocked.map((b) => b.title)).toContain("Módulo de analítica");
    expect(wms.blocked[0].blocked_reason).toBe("esperando accesos del cliente");
    expect(wms.blocked[0].owner_name).toBe("Fausto");
    expect(wms.open.map((o) => o.title)).not.toContain("Módulo de analítica");

    // Y en la lista global de bloqueos que consume el dashboard (WP15).
    expect(listBlocked(db).map((b) => b.id)).toEqual([a1]);
  });

  it("desbloquear devuelve la pieza a donde estaba y limpia el motivo", () => {
    applyAssignmentAction(db, { assignmentId: a1, action: "empezar", actor: actor(FAUSTO) });
    applyAssignmentAction(db, { assignmentId: a1, action: "bloquear", reason: "falta un dato", actor: actor(FAUSTO) });
    const back = applyAssignmentAction(db, { assignmentId: a1, action: "desbloquear", actor: actor(FAUSTO) });
    expect(back.status).toBe("En curso");
    expect(back.blocked_reason).toBeNull();
    expect(back.blocked_at).toBeNull();
    expect(listBlocked(db)).toHaveLength(0);
  });

  it("la bandeja `needs_founder` recoge lo que espera una decisión de John (WP15)", () => {
    const wms = upsertInitiative(db, "WMS");
    createAssignment(db, {
      title: "Decidir la identidad visual",
      initiativeId: wms,
      ownerWallet: DAVID,
      status: "Asignada",
      needsFounder: true,
    });
    expect(listNeedsFounder(db).map((a) => a.title)).toEqual(["Decidir la identidad visual"]);
  });
});

describe("vista por iniciativa y filtro por horizonte", () => {
  it("agrupa abiertas, bloqueadas, cerradas esta semana y responsables", () => {
    const db = freshDb();
    const wms = upsertInitiative(db, "WMS", "Ahora");
    const parked = upsertInitiative(db, "Ideas Guardadas", "Parqueado");

    const abierta = createAssignment(db, { title: "Abierta", initiativeId: wms, ownerWallet: FAUSTO, status: "Asignada" });
    createAssignment(db, { title: "Parqueada", initiativeId: parked, ownerWallet: DAVID, status: "Backlog" });
    const cerrada = createAssignment(db, {
      title: "Cerrada hoy",
      initiativeId: wms,
      ownerWallet: DAVID,
      status: "En revisión",
    });
    applyAssignmentAction(db, { assignmentId: cerrada, action: "aprobar", actor: actor(JOHN) });
    applyAssignmentAction(db, {
      assignmentId: abierta,
      action: "bloquear",
      reason: "esperando revisión legal",
      actor: actor(JOHN),
    });

    const wmsSummary = assignmentsByInitiative(db).find((s) => s.initiative?.name === "WMS")!;
    expect(wmsSummary.blocked).toHaveLength(1);
    expect(wmsSummary.closedThisWeek.map((c) => c.title)).toEqual(["Cerrada hoy"]);
    expect(wmsSummary.owners.map((o) => o.name)).toEqual(["Fausto"]); // solo lo abierto/bloqueado

  });

  it("el filtro por horizonte filtra ASIGNACIONES, no iniciativas", () => {
    // Caso real de los CSV del equipo: una iniciativa con filas en dos horizontes.
    const db = freshDb();
    const nuevos = upsertInitiative(db, "Productos Nuevos", "Siguiente");
    createAssignment(db, {
      title: "Descubrimiento de un producto",
      initiativeId: nuevos,
      ownerWallet: JOHN,
      status: "Backlog",
      horizon: "Siguiente",
    });
    createAssignment(db, {
      title: "POS para tenderos",
      initiativeId: nuevos,
      ownerWallet: JOHN,
      status: "Backlog",
      horizon: "Parqueado",
    });

    // La iniciativa toma el horizonte MÁS urgente de sus filas…
    const initiative = assignmentsByInitiative(db).find((s) => s.initiative?.name === "Productos Nuevos")!;
    expect(initiative.initiative!.horizon).toBe("Siguiente");
    expect(initiative.open).toHaveLength(2);

    // …pero pedir 'Parqueado' SÍ devuelve el trabajo parqueado de esa iniciativa
    // (si se filtrara por el horizonte de la iniciativa, aquí no habría nada).
    const parqueado = assignmentsByInitiative(db, { horizon: "Parqueado" }).filter((s) => s.open.length > 0);
    expect(parqueado.map((s) => s.initiative?.name)).toEqual(["Productos Nuevos"]);
    expect(parqueado[0].open.map((o) => o.title)).toEqual(["POS para tenderos"]);

    const siguiente = assignmentsByInitiative(db, { horizon: "Siguiente" }).filter((s) => s.open.length > 0);
    expect(siguiente[0].open.map((o) => o.title)).toEqual(["Descubrimiento de un producto"]);
  });

  it("cerradas la semana pasada no cuentan como cerradas esta semana", () => {
    const db = freshDb();
    const wms = upsertInitiative(db, "WMS");
    const id = createAssignment(db, { title: "Vieja", initiativeId: wms, ownerWallet: FAUSTO, status: "Hecha" });
    db.prepare(`UPDATE assignments SET closed_at = ? WHERE id = ?`).run(`${prevWeekStart()}T10:00:00.000Z`, id);
    const wmsSummary = assignmentsByInitiative(db).find((s) => s.initiative?.name === "WMS")!;
    expect(wmsSummary.closedThisWeek).toHaveLength(0);
  });

  it("el trabajo sin iniciativa no se esconde", () => {
    const db = freshDb();
    createAssignment(db, { title: "Huérfana", ownerWallet: FAUSTO, status: "Asignada" });
    const orphan = assignmentsByInitiative(db).find((s) => s.initiative === null)!;
    expect(orphan.open.map((o) => o.title)).toEqual(["Huérfana"]);
  });
});

describe("criterio 5 — check-in diario: uno por persona por día, editable el mismo día", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("guarda el check-in del día y lo devuelve", () => {
    const c = upsertCheckin(db, FAUSTO, { done: "cerré el módulo", doing: "reviso QA", blocked: "" });
    expect(c.day).toBe(today());
    expect(c.done).toBe("cerré el módulo");
    expect(getCheckin(db, FAUSTO, today())!.id).toBe(c.id);
  });

  it("un segundo check-in el MISMO día EDITA el existente (no crea otro)", () => {
    const first = upsertCheckin(db, FAUSTO, { done: "a", doing: "b", blocked: "" });
    const second = upsertCheckin(db, FAUSTO, { done: "a corregido", doing: "b", blocked: "me falta un acceso" });
    expect(second.id).toBe(first.id);
    expect(second.done).toBe("a corregido");
    expect(second.blocked).toBe("me falta un acceso");
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM checkins WHERE wallet = ?`).get(FAUSTO) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("el UNIQUE(wallet, day) del esquema impide dos filas del mismo día", () => {
    upsertCheckin(db, FAUSTO, { done: "a", doing: "", blocked: "" });
    expect(() =>
      db.prepare(`INSERT INTO checkins (wallet, day, done, doing, blocked) VALUES (?, ?, 'x','','')`).run(FAUSTO, today())
    ).toThrow();
  });

  it("el check-in de OTRO día es una fila nueva (el historial no se sobreescribe)", () => {
    upsertCheckin(db, FAUSTO, { done: "hoy", doing: "", blocked: "" });
    db.prepare(`INSERT INTO checkins (wallet, day, done, doing, blocked) VALUES (?, '2026-01-02', 'ayer','','')`).run(
      FAUSTO
    );
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM checkins WHERE wallet = ?`).get(FAUSTO) as { n: number }).n;
    expect(n).toBe(2);
    expect(getCheckin(db, FAUSTO, "2026-01-02")!.done).toBe("ayer");
  });

  it("un check-in totalmente vacío se rechaza", () => {
    expect(() => upsertCheckin(db, FAUSTO, { done: "  ", doing: "", blocked: "" })).toThrow(TeamError);
  });

  it("checkinsOfDay alimenta el digest de WP15 con nombre de cada persona", () => {
    upsertCheckin(db, FAUSTO, { done: "a", doing: "b", blocked: "" });
    upsertCheckin(db, DAVID, { done: "c", doing: "d", blocked: "esperando datos" });
    const rows = checkinsOfDay(db, today());
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["David", "Fausto"]);
  });
});

describe("'Tu progreso' — auto-comparación (regla WP09 / doc 16)", () => {
  it("compara la propia semana con la anterior y nunca resta lo logrado", () => {
    const db = freshDb();
    const wms = upsertInitiative(db, "WMS");
    const thisWeek = createAssignment(db, { title: "De esta semana", initiativeId: wms, ownerWallet: FAUSTO, status: "En revisión" });
    applyAssignmentAction(db, { assignmentId: thisWeek, action: "aprobar", actor: actor(FAUSTO) });
    const lastWeek = createAssignment(db, { title: "De la anterior", initiativeId: wms, ownerWallet: FAUSTO, status: "Hecha" });
    db.prepare(`UPDATE assignments SET closed_at = ? WHERE id = ?`).run(`${prevWeekStart()}T09:00:00.000Z`, lastWeek);
    createAssignment(db, { title: "Abierta", initiativeId: wms, ownerWallet: FAUSTO, status: "Asignada" });

    const p = ownProgress(db, FAUSTO);
    expect(p.weekStart).toBe(weekStart());
    expect(p.closedThisWeek).toBe(1);
    expect(p.closedPrevWeek).toBe(1);
    expect(p.delta).toBe(0);
    expect(p.openNow).toBe(1);
    expect(p.blockedNow).toBe(0);
  });

  it("no mezcla el progreso de una persona con el de otra", () => {
    const db = freshDb();
    const wms = upsertInitiative(db, "WMS");
    const id = createAssignment(db, { title: "De David", initiativeId: wms, ownerWallet: DAVID, status: "En revisión" });
    applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(DAVID) });
    expect(ownProgress(db, DAVID).closedThisWeek).toBe(1);
    expect(ownProgress(db, FAUSTO).closedThisWeek).toBe(0);
  });

  it("cuenta los check-ins propios de la semana sin telemetría de presencia", () => {
    const db = freshDb();
    upsertCheckin(db, FAUSTO, { done: "a", doing: "", blocked: "" });
    const p = ownProgress(db, FAUSTO);
    expect(p.checkinsThisWeek).toBe(1);
    // El objeto de progreso no expone nada parecido a horas, presencia o última conexión.
    expect(Object.keys(p).join(" ").toLowerCase()).not.toMatch(/hora|presenc|conexion|online/);
  });
});

describe("actorFromSession — la DB es la autoridad, no la cookie", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("lee role/is_supervisor de `users` e ignora los claims de la cookie", () => {
    // Cookie que MIENTE (dice founder+supervisor) para una fila `core` sin supervisión.
    const a = actorFromSession(db, { wallet: FAUSTO, role: "founder", isSupervisor: true, isFounder: true });
    expect(a.role).toBe("core");
    expect(a.isSupervisor).toBe(false);
    expect(a.name).toBe("Fausto");
    expect(visibleAssignments(db, a)).toHaveLength(0); // no ve nada ajeno
  });

  it("reconoce a la supervisora `core` real (Vale)", () => {
    const a = actorFromSession(db, { wallet: VALE });
    expect(a.role).toBe("core");
    expect(a.isSupervisor).toBe(true);
  });

  it("usuario que no está en la DB: cae al fallback conservador de los claims", () => {
    const a = actorFromSession(db, { wallet: "GDESCONOCIDO0001", name: "X", isFounder: false });
    expect(a.role).toBe("contributor");
    expect(a.isSupervisor).toBe(false);
  });
});

describe("criterio 6 — vocabulario auditado: se califican entregas, nunca personas", () => {
  it("ningún texto del modelo juzga a una persona", () => {
    const db = freshDb();
    const wms = upsertInitiative(db, "WMS");
    const id = createAssignment(db, { title: "Algo", initiativeId: wms, ownerWallet: FAUSTO, status: "Asignada" });
    applyAssignmentAction(db, { assignmentId: id, action: "bloquear", reason: "falta un dato", actor: actor(FAUSTO) });

    const dump = [
      JSON.stringify(db.prepare(`SELECT * FROM assignments`).all()),
      JSON.stringify(db.prepare(`SELECT * FROM assignment_events`).all()),
      JSON.stringify(db.prepare(`SELECT * FROM initiatives`).all()),
      fs.readFileSync(path.join(process.cwd(), "src", "lib", "team.ts"), "utf8"),
      fs.readFileSync(path.join(process.cwd(), "src", "lib", "team-state-machine.ts"), "utf8"),
    ]
      .join(" ")
      .toLowerCase();

    for (const prohibido of [
      "bajo desempeño",
      "bajo rendimiento",
      "mal desempeño",
      "no cumple",
      "incumplido",
      "improductiv",
      "ranking de personas",
    ]) {
      expect(dump, `vocabulario prohibido: '${prohibido}'`).not.toContain(prohibido);
    }
  });

  it("no existe ninguna columna de saldo mutable ni de puntaje de persona", () => {
    const db = freshDb();
    const cols = (db.prepare(`PRAGMA table_info(assignments)`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const prohibida of ["score", "puntos", "points", "balance", "saldo", "rating"]) {
      expect(cols).not.toContain(prohibida);
    }
  });

  it("las asignaciones nunca duplican un bounty del Ágora: lo enlazan", () => {
    const db = freshDb();
    const cols = (db.prepare(`PRAGMA table_info(assignments)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("published_as_project_id");
    const row: AssignmentRow | undefined = getAssignment(db, 1);
    expect(row).toBeUndefined(); // sin trabajo sembrado; el puente es solo un enlace
  });
});

// Alta desde la web (FB del día 1). Hasta ahora el trabajo solo entraba por el
// importador de CSV o por el bot; sin esto no se puede añadir nada durante el día.
describe("createAssignmentAs — quién puede ponerle trabajo a quién", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  const actorDe = (wallet: string, role: TeamActor["role"], isSupervisor = false): TeamActor => ({
    wallet,
    name: wallet,
    role,
    isSupervisor,
  });

  it("el founder puede asignarle trabajo a otra persona, y nace 'Asignada'", () => {
    const id = createAssignmentAs(db, actorDe(JOHN, "founder", true), {
      title: "Revisar la propuesta de analítica",
      ownerWallet: DAVID,
    });
    const row = getAssignment(db, id)!;
    expect(row.owner_wallet).toBe(DAVID);
    expect(row.status).toBe("Asignada");
    expect(row.created_by).toBe(JOHN);
  });

  it("una supervisora que NO es founder también puede (es por rol, no por persona)", () => {
    const id = createAssignmentAs(db, actorDe(VALE, "core", true), {
      title: "Auditar los copys del bot",
      ownerWallet: DAVID,
    });
    expect(getAssignment(db, id)!.owner_wallet).toBe(DAVID);
  });

  it("un `core` NO puede poner trabajo en la cola de otra persona", () => {
    expect(() =>
      createAssignmentAs(db, actorDe(FAUSTO, "core"), { title: "Algo", ownerWallet: DAVID })
    ).toThrow(TeamError);
    // Y no deja rastro: nada a medio crear.
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM assignments`).get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it("un `core` SÍ puede capturar lo suyo o dejarlo sin dueño", () => {
    const propio = createAssignmentAs(db, actorDe(FAUSTO, "core"), {
      title: "Lo mío",
      ownerWallet: FAUSTO,
    });
    expect(getAssignment(db, propio)!.status).toBe("Asignada");

    const huerfano = createAssignmentAs(db, actorDe(FAUSTO, "core"), { title: "Para alguien" });
    const row = getAssignment(db, huerfano)!;
    // Sin dueño va al Backlog: el estado nunca miente diciendo que está asignado.
    expect(row.owner_wallet).toBeNull();
    expect(row.status).toBe("Backlog");
  });

  it("rechaza un responsable que no está en el registro", () => {
    expect(() =>
      createAssignmentAs(db, actorDe(JOHN, "founder", true), {
        title: "X",
        ownerWallet: "GNOEXISTE0001",
      })
    ).toThrow(TeamError);
  });

  it("deja evento append-only el mismo día, así el digest ve lo creado hoy", () => {
    const id = createAssignmentAs(db, actorDe(JOHN, "founder", true), {
      title: "Con evento",
      ownerWallet: DAVID,
    });
    const ev = db
      .prepare(`SELECT action, to_status, actor_wallet, day FROM assignment_events WHERE assignment_id = ?`)
      .all(id) as Array<{ action: string; to_status: string; actor_wallet: string; day: string }>;
    expect(ev).toHaveLength(1);
    expect(ev[0].action).toBe("crear");
    expect(ev[0].to_status).toBe("Asignada");
    expect(ev[0].actor_wallet).toBe(JOHN);
    expect(ev[0].day).toBe(today());
  });

  it("una pieza recién creada es operable por la máquina de estados, sin saltos", () => {
    const id = createAssignmentAs(db, actorDe(JOHN, "founder", true), {
      title: "Ciclo completo",
      ownerWallet: DAVID,
    });
    const actorDavid = actorDe(DAVID, "core");
    applyAssignmentAction(db, { assignmentId: id, action: "empezar", actor: actorDavid });
    applyAssignmentAction(db, { assignmentId: id, action: "enviar_a_revision", actor: actorDavid });
    const row = applyAssignmentAction(db, {
      assignmentId: id,
      action: "devolver",
      reason: "falta el caso de wallet vacía",
      actor: actorDe(JOHN, "founder", true),
    });
    expect(row.status).toBe("En curso");
  });
});

describe("WP17 · trabajo por cliente (fusión: listado que antes vivía en assignments.ts)", () => {
  it("una asignación referencia cliente y nodo del grafo, y aparece en el backlog de ESE cliente", () => {
    const db = freshDb();
    const montoc = createClient(db, { name: "Montoc" });
    const otro = createClient(db, { name: "Otro" });
    const id = createAssignment(db, {
      title: "Verificar la variante de retención contra el sistema",
      clientId: montoc,
      graphNodeId: "montoc.variante.facturacion-retencion",
      acceptanceCriteria: "El nodo queda verificado con evidencia de la BD",
      priority: "High",
    });
    createAssignment(db, { title: "Trabajo interno, sin cliente" });
    createAssignment(db, { title: "De otro cliente", clientId: otro });

    const row = getAssignment(db, id)!;
    expect(row.client_id).toBe(montoc);
    expect(row.graph_node_id).toBe("montoc.variante.facturacion-retencion");

    const backlog = assignmentsForClient(db, montoc);
    expect(backlog.map((a) => a.id)).toEqual([id]);
    expect(backlog[0].priority).toBe("High");
  });

  it("lo cerrado no aparece en el backlog del cliente; lo bloqueado sí", () => {
    const db = freshDb();
    const c = createClient(db, { name: "Cliente" });
    const abierta = createAssignment(db, { title: "Abierta", clientId: c, ownerWallet: DAVID, status: "Asignada" });
    createAssignment(db, { title: "Cerrada", clientId: c, ownerWallet: DAVID, status: "Hecha" });
    const bloqueada = createAssignment(db, { title: "Bloqueada", clientId: c, ownerWallet: DAVID, status: "Asignada" });
    applyAssignmentAction(db, {
      assignmentId: bloqueada,
      action: "bloquear",
      reason: "Falta el acceso del cliente",
      actor: actor(DAVID),
    });
    expect(assignmentsForClient(db, c).map((a) => a.id).sort()).toEqual([abierta, bloqueada].sort());
  });

  it("sin cliente, nada cambia: client_id y graph_node_id quedan en NULL", () => {
    const db = freshDb();
    const id = createAssignment(db, { title: "Interna" });
    const row = getAssignment(db, id)!;
    expect(row.client_id).toBeNull();
    expect(row.graph_node_id).toBeNull();
  });

  it("createAssignmentAs rechaza un cliente que no existe", () => {
    const db = freshDb();
    expect(() => createAssignmentAs(db, actor(JOHN), { title: "X", clientId: 999 })).toThrow(TeamError);
  });
});
