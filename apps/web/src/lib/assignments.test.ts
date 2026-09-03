import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import {
  transitionAssignment,
  availableActions,
  puedeActuar,
  assertPuedeActuar,
  InvalidAssignmentTransitionError,
  AssignmentPermissionError,
  WIP_MAX,
  type ActorAsignacion,
  type AssignmentState,
  type AssignmentAction,
} from "./assignment-state";
import {
  createInitiative,
  createAssignment,
  applyAction,
  getAssignment,
  listForOwner,
  listBacklog,
  assignmentHistory,
  upsertCheckin,
  getCheckin,
  loadByPerson,
  blockedAssignments,
  actorDesdeWallet,
  AssignmentError,
} from "./assignments";
import { createClient } from "./clients";

const SCHEMA = path.join(process.cwd(), "src", "lib", "schema.sql");

/** Atajo: actor no supervisor. Los tests de permisos usan variantes explícitas. */
const A = (wallet: string): ActorAsignacion => ({ wallet, isFounder: false, isSupervisor: false });
const SUP = (wallet: string): ActorAsignacion => ({ wallet, isFounder: false, isSupervisor: true });
const FOUNDER: ActorAsignacion = { wallet: "W_JOHN", isFounder: true, isSupervisor: false };

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA, "utf8"));
  for (const [w, n] of [
    ["W_JOHN", "John"],
    ["W_DAVID", "David"],
  ]) {
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES (?, ?)`).run(w, n);
  }
  return db;
}

// ─── Máquina de estados: tabla de verdad ─────────────────────────────────

describe("máquina de estados de asignaciones (función pura)", () => {
  const validas: Array<[AssignmentState, AssignmentAction, AssignmentState]> = [
    ["Backlog", "asignar", "Asignada"],
    ["Asignada", "empezar", "En curso"],
    ["En curso", "a_revision", "En revisión"],
    ["En revisión", "aprobar", "Hecha"],
    ["En revisión", "devolver", "En curso"],
  ];
  it.each(validas)("%s --%s--> %s", (from, action, to) => {
    expect(transitionAssignment({ current: from, action })).toBe(to);
  });

  const invalidas: Array<[AssignmentState, AssignmentAction]> = [
    ["Backlog", "empezar"],
    ["Backlog", "aprobar"],
    ["Asignada", "aprobar"],
    ["En curso", "asignar"],
    ["Hecha", "empezar"],
    ["Hecha", "bloquear"],
    ["Bloqueada", "empezar"],
  ];
  it.each(invalidas)("rechaza %s --%s-->", (from, action) => {
    expect(() => transitionAssignment({ current: from, action })).toThrow(InvalidAssignmentTransitionError);
  });

  it("bloquear EXIGE motivo", () => {
    expect(() => transitionAssignment({ current: "En curso", action: "bloquear" })).toThrow(/motivo/i);
    expect(() => transitionAssignment({ current: "En curso", action: "bloquear", reason: "  " })).toThrow(/motivo/i);
    expect(
      transitionAssignment({ current: "En curso", action: "bloquear", reason: "Falta acceso a la BD del cliente" })
    ).toBe("Bloqueada");
  });

  it("desbloquear devuelve al estado previo, no a uno arbitrario", () => {
    expect(transitionAssignment({ current: "Bloqueada", action: "desbloquear", previous: "En curso" })).toBe("En curso");
    expect(transitionAssignment({ current: "Bloqueada", action: "desbloquear", previous: "Asignada" })).toBe("Asignada");
    expect(() => transitionAssignment({ current: "Bloqueada", action: "desbloquear", previous: "Hecha" })).toThrow();
    expect(() => transitionAssignment({ current: "Bloqueada", action: "desbloquear" })).toThrow();
  });

  it("availableActions no duplica las reglas de transición", () => {
    expect(availableActions("Backlog")).toEqual(["asignar"]);
    expect(availableActions("En curso").sort()).toEqual(["a_revision", "bloquear"]);
    expect(availableActions("En revisión").sort()).toEqual(["aprobar", "bloquear", "devolver"]);
    expect(availableActions("Hecha")).toEqual([]);
    expect(availableActions("Bloqueada")).toEqual(["desbloquear"]);
  });
});

// ─── Persistencia y reglas de contexto ───────────────────────────────────

describe("WP14 · módulo equipo", () => {
  let db: DB;
  let wms: number;

  beforeEach(() => {
    db = freshDb();
    wms = createInitiative(db, { slug: "wms", name: "WMS", horizon: "ahora" });
  });

  it("una asignación sin responsable nace en Backlog; con responsable nace Asignada", () => {
    const a = createAssignment(db, { title: "Documentar picking", initiativeId: wms });
    const b = createAssignment(db, { title: "Arreglar packing", initiativeId: wms, ownerWallet: "W_DAVID" });
    expect(getAssignment(db, a)!.status).toBe("Backlog");
    expect(getAssignment(db, b)!.status).toBe("Asignada");
  });

  it("cada persona ve SOLO sus asignaciones, por prioridad y vencimiento", () => {
    createAssignment(db, { title: "Baja", ownerWallet: "W_DAVID", priority: "baja" });
    createAssignment(db, { title: "Alta", ownerWallet: "W_DAVID", priority: "alta" });
    createAssignment(db, { title: "De John", ownerWallet: "W_JOHN", priority: "alta" });
    const mias = listForOwner(db, "W_DAVID");
    expect(mias.map((a) => a.title)).toEqual(["Alta", "Baja"]);
  });

  it("el límite de WIP personal se cobra explícito", () => {
    const ids = [1, 2, 3].map((i) =>
      createAssignment(db, { title: `Tarea ${i}`, ownerWallet: "W_DAVID" })
    );
    for (const id of ids.slice(0, WIP_MAX)) {
      applyAction(db, { assignmentId: id, action: "empezar", actor: A("W_DAVID") });
    }
    expect(() =>
      applyAction(db, { assignmentId: ids[WIP_MAX], action: "empezar", actor: A("W_DAVID") })
    ).toThrow(AssignmentError);
  });

  it("bloquear guarda el motivo y desbloquear vuelve al estado exacto previo", () => {
    const id = createAssignment(db, { title: "Integrar Shopify", ownerWallet: "W_DAVID" });
    applyAction(db, { assignmentId: id, action: "empezar", actor: A("W_DAVID") });
    applyAction(db, {
      assignmentId: id,
      action: "bloquear",
      actor: A("W_DAVID"),
      reason: "Falta el token de Shopify del cliente",
    });
    const bloqueada = getAssignment(db, id)!;
    expect(bloqueada.status).toBe("Bloqueada");
    expect(bloqueada.blockedReason).toMatch(/token de Shopify/);
    expect(blockedAssignments(db)).toHaveLength(1);

    applyAction(db, { assignmentId: id, action: "desbloquear", actor: A("W_DAVID") });
    const vuelta = getAssignment(db, id)!;
    expect(vuelta.status).toBe("En curso"); // no "Asignada": el historial sabe de dónde venía
    expect(vuelta.blockedReason).toBeNull();
  });

  it("cada transición queda en el historial append-only", () => {
    const id = createAssignment(db, { title: "X y Z", ownerWallet: "W_DAVID" });
    applyAction(db, { assignmentId: id, action: "empezar", actor: A("W_DAVID") });
    applyAction(db, { assignmentId: id, action: "a_revision", actor: A("W_DAVID") });
    applyAction(db, { assignmentId: id, action: "aprobar", actor: FOUNDER });
    const h = assignmentHistory(db, id);
    expect(h.map((e) => e.action)).toEqual(["crear", "empezar", "a_revision", "aprobar"]);
    expect(h[3].actor_wallet).toBe("W_JOHN");
  });

  it("una transición inválida se rechaza también al persistir", () => {
    const id = createAssignment(db, { title: "Sin empezar", ownerWallet: "W_DAVID" });
    expect(() => applyAction(db, { assignmentId: id, action: "aprobar", actor: FOUNDER })).toThrow(
      InvalidAssignmentTransitionError
    );
    expect(getAssignment(db, id)!.status).toBe("Asignada");
  });

  it("una asignación puede referenciar un nodo del grafo (por referencia, no por copia)", () => {
    const montoc = createClient(db, { name: "Montoc" });
    const id = createAssignment(db, {
      title: "Verificar la variante de retención contra el sistema",
      clientId: montoc,
      graphNodeId: "montoc.variante.facturacion-retencion",
      acceptanceCriteria: "El nodo queda en confianza: verificado con evidencia de la BD",
    });
    const a = getAssignment(db, id)!;
    expect(a.graphNodeId).toBe("montoc.variante.facturacion-retencion");
    expect(a.clientName).toBe("Montoc");
    expect(listBacklog(db, { clientId: montoc })).toHaveLength(1);
  });

  it("el check-in diario es uno por persona por día y editable el mismo día", () => {
    upsertCheckin(db, { wallet: "W_DAVID", day: "2026-08-16", done: "a", doing: "b" });
    upsertCheckin(db, { wallet: "W_DAVID", day: "2026-08-16", done: "a corregido", doing: "b", blocked: "c" });
    const c = getCheckin(db, "W_DAVID", "2026-08-16")!;
    expect(c.done).toBe("a corregido");
    expect(c.blocked).toBe("c");
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM checkins`).get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it("la carga por persona mide trabajo abierto, nunca 'rendimiento'", () => {
    const a = createAssignment(db, { title: "Uno", ownerWallet: "W_DAVID" });
    createAssignment(db, { title: "Dos", ownerWallet: "W_DAVID" });
    applyAction(db, { assignmentId: a, action: "empezar", actor: A("W_DAVID") });
    const carga = loadByPerson(db).find((c) => c.wallet === "W_DAVID")!;
    expect(carga.en_curso).toBe(1);
    expect(carga.asignadas).toBe(1);
    // El agregado no expone ningún juicio sobre la persona: solo conteos de estado.
    expect(Object.keys(carga).sort()).toEqual(
      ["asignadas", "bloqueadas", "en_curso", "en_revision", "wallet"].sort()
    );
  });
});


// ─── Autorización (hueco encontrado verificando el servidor en vivo) ──────

describe("autorización de acciones sobre asignaciones", () => {
  let db: DB;
  let mia: number;   // de W_DAVID
  let ajena: number; // de W_JOHN

  beforeEach(() => {
    db = freshDb();
    mia = createAssignment(db, { title: "Lo de David", ownerWallet: "W_DAVID" });
    ajena = createAssignment(db, { title: "Lo de John", ownerWallet: "W_JOHN" });
  });

  it("un tercero NO puede mover el trabajo de otro (el hueco original)", () => {
    applyAction(db, { assignmentId: ajena, action: "empezar", actor: FOUNDER });
    // W_DAVID no es dueño ni supervisor: la transición es válida, el permiso no.
    expect(() =>
      applyAction(db, { assignmentId: ajena, action: "a_revision", actor: A("W_DAVID") })
    ).toThrow(AssignmentPermissionError);
    expect(getAssignment(db, ajena)!.status).toBe("En curso");
  });

  it("el dueño sí puede mover lo suyo", () => {
    applyAction(db, { assignmentId: mia, action: "empezar", actor: A("W_DAVID") });
    expect(getAssignment(db, mia)!.status).toBe("En curso");
  });

  it("NADIE aprueba su propio trabajo, ni siquiera un supervisor", () => {
    applyAction(db, { assignmentId: mia, action: "empezar", actor: A("W_DAVID") });
    applyAction(db, { assignmentId: mia, action: "a_revision", actor: A("W_DAVID") });
    // David supervisor sobre su PROPIA asignación: rechazado.
    expect(() =>
      applyAction(db, { assignmentId: mia, action: "aprobar", actor: SUP("W_DAVID") })
    ).toThrow(/su propio trabajo/i);
    // Otro supervisor sí puede cerrarla.
    applyAction(db, { assignmentId: mia, action: "aprobar", actor: FOUNDER });
    expect(getAssignment(db, mia)!.status).toBe("Hecha");
  });

  it("asignar trabajo requiere supervisión", () => {
    const libre = createAssignment(db, { title: "Sin dueño todavía" });
    expect(() =>
      applyAction(db, { assignmentId: libre, action: "asignar", actor: A("W_DAVID"), toWallet: "W_DAVID" })
    ).toThrow(AssignmentPermissionError);
    applyAction(db, { assignmentId: libre, action: "asignar", actor: FOUNDER, toWallet: "W_DAVID" });
    expect(getAssignment(db, libre)!.ownerWallet).toBe("W_DAVID");
  });

  it("tabla de permisos por acción", () => {
    const casos: Array<[AssignmentAction, ActorAsignacion, string | null, boolean]> = [
      ["empezar",     A("W_DAVID"),   "W_DAVID", true],
      ["empezar",     A("W_JOHN"),    "W_DAVID", false],
      ["empezar",     SUP("W_VALE"),  "W_DAVID", true],
      ["bloquear",    A("W_DAVID"),   "W_DAVID", true],
      ["bloquear",    A("W_JOHN"),    "W_DAVID", false],
      ["asignar",     A("W_DAVID"),   null,      false],
      ["asignar",     FOUNDER,        null,      true],
      ["aprobar",     A("W_DAVID"),   "W_DAVID", false],
      ["aprobar",     SUP("W_DAVID"), "W_DAVID", false], // sin autoaprobación
      ["aprobar",     SUP("W_VALE"),  "W_DAVID", true],
      ["devolver",    SUP("W_VALE"),  "W_DAVID", true],
      ["devolver",    A("W_DAVID"),   "W_DAVID", false],
    ];
    for (const [action, actor, owner, esperado] of casos) {
      expect(puedeActuar(action, actor, owner), `${action} · ${actor.wallet} · dueño ${owner}`).toBe(esperado);
    }
  });

  it("actorDesdeWallet lee la supervisión de la base", () => {
    db.prepare(`UPDATE users SET is_supervisor = 1 WHERE wallet = 'W_JOHN'`).run();
    expect(actorDesdeWallet(db, "W_JOHN", false).isSupervisor).toBe(true);
    expect(actorDesdeWallet(db, "W_DAVID", false).isSupervisor).toBe(false);
    expect(actorDesdeWallet(db, "W_DAVID", true).isFounder).toBe(true);
  });

  it("assertPuedeActuar explica el motivo, no solo niega", () => {
    expect(() => assertPuedeActuar("asignar", A("W_DAVID"), null)).toThrow(/supervisión/i);
    expect(() => assertPuedeActuar("aprobar", SUP("W_DAVID"), "W_DAVID")).toThrow(/propio trabajo/i);
    expect(() => assertPuedeActuar("empezar", A("W_JOHN"), "W_DAVID")).toThrow(/responsable/i);
  });
});
