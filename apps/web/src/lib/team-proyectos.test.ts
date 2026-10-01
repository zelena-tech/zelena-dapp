/**
 * WP31-A · proyectos, membresías, cuatro ojos y edición de entregas (base en memoria).
 *
 * Criterios del spec §11: A1b, A4, A4b, A4c, A5, A6, A6b, A7, A8 (ataques) y A10
 * (proyecto ajeno). Las personas son ficticias: nada de este archivo nombra a un
 * cliente real ni a alguien del equipo fuera de los slugs del roster.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, MOTIVO_TRANSICION, type TeamActor } from "./roles";
import { equipoActor, type EquipoActor } from "./authz";
import { instanteDb } from "./zona-horaria";
import {
  agregarMiembro,
  applyAssignmentAction,
  candidatosParaProyecto,
  COPY_EN_REVISION,
  createAssignment,
  createAssignmentAs,
  crearProyecto,
  editarAsignacion,
  editarProyecto,
  getAssignment,
  getProyectoPorSlug,
  membresiasDe,
  miembrosDeProyecto,
  parseFiltrosTablero,
  permisosDe,
  proyectosVisibles,
  puedeVerProyecto,
  quitarMiembro,
  rolesEnProyecto,
  seedTeam,
  supervisoresDeProyecto,
  tableroDeProyecto,
  TeamError,
} from "./team";
import { createClient, addMember } from "./clients";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const FAUSTO = pendingPrincipal("fausto");
const DAVID = pendingPrincipal("david");

// Personas ficticias de la comunidad (wallets de prueba).
const ANA = "GANAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RITA = "GRITAREVISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EST = "GESTRUCTURAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EJE2 = "GEJECUTADOSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTRO = "GOTROPROYECTOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CARLA = "GCARLASINACUERDOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DEMO = "GDEMOCONTRIBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SESION_FOUNDER = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const AHORA = new Date("2026-10-01T15:00:00.000Z");

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
  o: { role?: string; cla?: number; invitedBy?: string | null; isDemo?: number; status?: string; nombre?: string } = {}
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

const ACTORES: Record<string, TeamActor> = {
  [JOHN]: { wallet: JOHN, name: "John", role: "founder", isSupervisor: true },
  [VALE]: { wallet: VALE, name: "Vale", role: "core", isSupervisor: true },
  [FAUSTO]: { wallet: FAUSTO, name: "Fausto", role: "core", isSupervisor: false },
  [DAVID]: { wallet: DAVID, name: "David", role: "core", isSupervisor: false },
};
function actor(wallet: string): TeamActor {
  return ACTORES[wallet] ?? { wallet, name: wallet.slice(1, 6), role: "contributor", isSupervisor: false };
}
function equipo(db: DB, wallet: string): EquipoActor {
  const a = equipoActor({ wallet }, db);
  if (!a) throw new Error(`sin acceso a /equipo: ${wallet}`);
  return a;
}

/** Status y motivo de un TeamError, para comparar en una línea. */
function fallo(fn: () => unknown): { status: number; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof TeamError) return { status: e.status, message: e.message };
    throw e;
  }
}

function ledgers(db: DB): number {
  const a = (db.prepare(`SELECT COUNT(*) AS n FROM points_ledger`).get() as { n: number }).n;
  const b = (db.prepare(`SELECT COUNT(*) AS n FROM reputation_events`).get() as { n: number }).n;
  return a + b;
}

/** Proyecto P (ANA ejecuta, RITA revisa, EST estructura, EJE2 ejecuta) y Q (OTRO revisa). */
function escenario(db: DB): { p: number; q: number } {
  for (const w of [ANA, RITA, EST, EJE2, OTRO]) usuario(db, w);
  usuario(db, CARLA, { cla: 0 });
  usuario(db, DEMO, { isDemo: 1 });
  const p = crearProyecto(db, actor(JOHN), { name: "Proyecto Piloto" }).id;
  const q = crearProyecto(db, actor(JOHN), { name: "Otro Proyecto" }).id;
  agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "ejecuta" });
  agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: RITA, rol: "revisa" });
  agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: EST, rol: "estructura" });
  agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: EJE2, rol: "ejecuta" });
  agregarMiembro(db, actor(JOHN), { initiativeId: q, wallet: OTRO, rol: "revisa" });
  return { p, q };
}

/** Pieza de `owner` en P que su dueño lleva hasta En revisión con la máquina. */
function enRevision(db: DB, initiativeId: number, owner: string, enviaQuien: string = owner): number {
  const id = createAssignment(db, {
    title: "Pieza de prueba",
    initiativeId,
    ownerWallet: owner,
    status: "Asignada",
    acceptanceCriteria: "Se ve en el tablero.",
    size: "M",
  });
  applyAssignmentAction(db, { assignmentId: id, action: "empezar", actor: actor(owner), now: AHORA });
  applyAssignmentAction(db, { assignmentId: id, action: "enviar_a_revision", actor: actor(enviaQuien), now: AHORA });
  return id;
}

describe("A1b · sin acuerdo de contribución no hay primer trabajo", () => {
  let db: DB;
  let p: number;
  beforeEach(() => {
    db = freshDb();
    p = escenario(db).p;
  });

  it("sumar a un contributor sin CLA → 409; con CLA → ok y vínculo externo por defecto", () => {
    expect(fallo(() => agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: CARLA, rol: "ejecuta" }))).toEqual({
      status: 409,
      message: "Primero tiene que firmar el acuerdo de contribución.",
    });
    db.prepare(`UPDATE users SET cla_signed = 1 WHERE wallet = ?`).run(CARLA);
    agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: CARLA, rol: "ejecuta" });
    const fila = miembrosDeProyecto(db, p).find((m) => m.wallet === CARLA)!;
    expect(fila.vinculo).toBe("externo");
    expect(fila.added_by).toBe(JOHN);
  });

  it("vínculo externo explícito sin CLA → 409 aunque sea del equipo interno; interno por defecto → ok", () => {
    expect(
      fallo(() => agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: FAUSTO, rol: "ejecuta", vinculo: "externo" }))
    ).toEqual({ status: 409, message: "Primero tiene que firmar el acuerdo de contribución." });
    agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: FAUSTO, rol: "ejecuta" });
    expect(miembrosDeProyecto(db, p).find((m) => m.wallet === FAUSTO)!.vinculo).toBe("interno");
  });

  it("cuentas demo o inactivas no se suman", () => {
    expect(fallo(() => agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: DEMO, rol: "ejecuta" }))?.status).toBe(400);
    expect(fallo(() => agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: "GNADIE", rol: "ejecuta" }))?.status).toBe(
      400
    );
  });
});

describe("A4 · revisa aprueba lo ajeno de SU proyecto; ejecuta no; revisa de otro proyecto no", () => {
  let db: DB;
  let p: number;
  beforeEach(() => {
    db = freshDb();
    p = escenario(db).p;
  });

  it("quien solo ejecuta no aprueba", () => {
    const id = enRevision(db, p, ANA);
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(EJE2) }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.revision,
    });
  });

  it("un revisa de otro proyecto no aprueba (ni ve la pieza)", () => {
    const id = enRevision(db, p, ANA);
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(OTRO) }))?.status).toBe(
      403
    );
    expect(getAssignment(db, id)!.status).toBe("En revisión");
  });

  it("un revisa de este proyecto sí aprueba una entrega ajena", () => {
    const id = enRevision(db, p, ANA);
    const row = applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(RITA), now: AHORA });
    expect(row.status).toBe("Hecha");
  });
});

describe("A4b · quien la envió a revisión no la aprueba ni la devuelve", () => {
  it("aunque planifique; otra persona con revisar sí", () => {
    const db = freshDb();
    const { p } = escenario(db);
    // EST planifica: puede mover la pieza de ANA a revisión, pero entonces no la revisa.
    const id = enRevision(db, p, ANA, EST);
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(EST) }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.envio,
    });
    expect(
      fallo(() => applyAssignmentAction(db, { assignmentId: id, action: "devolver", reason: "falta algo", actor: actor(EST) }))
    ).toEqual({ status: 403, message: MOTIVO_TRANSICION.envio });
    expect(applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(RITA) }).status).toBe("Hecha");
  });
});

describe("A4c · B8 en las dos direcciones; el founder exento; dueño pending solo F/S", () => {
  let db: DB;
  let p: number;
  beforeEach(() => {
    db = freshDb();
    p = escenario(db).p;
  });

  it("quien invitó al dueño no aprueba", () => {
    db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(RITA, ANA);
    const id = enRevision(db, p, ANA);
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(RITA) }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.invitacion,
    });
  });

  it("el invitado del dueño tampoco, al revés", () => {
    db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(ANA, RITA);
    const id = enRevision(db, p, ANA);
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: id, action: "devolver", reason: "x", actor: actor(RITA) }))).toEqual(
      { status: 403, message: MOTIVO_TRANSICION.invitacion }
    );
  });

  it("el founder sí puede aunque haya invitado al dueño", () => {
    db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(JOHN, ANA);
    const id = enRevision(db, p, ANA);
    expect(applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(JOHN) }).status).toBe("Hecha");
  });

  it("dueño pending sin vincular: un revisa no aprueba; un supervisor sí", () => {
    agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: FAUSTO, rol: "ejecuta" });
    const id = enRevision(db, p, FAUSTO);
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(RITA) }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.pendiente,
    });
    expect(applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(VALE) }).status).toBe("Hecha");
  });
});

describe("A5 · un contributor solo ve y crea en sus proyectos; proyectos de cliente", () => {
  let db: DB;
  let p: number;
  let q: number;
  beforeEach(() => {
    db = freshDb();
    ({ p, q } = escenario(db));
  });

  it("proyectosVisibles y puedeVerProyecto: solo los suyos", () => {
    const ana = equipo(db, ANA);
    expect(ana.alcance).toBe("proyectos");
    expect(ana.proyectos).toEqual([p]);
    expect(proyectosVisibles(db, ana).map((i) => i.id)).toEqual([p]);
    expect(puedeVerProyecto(db, ana, p)).toBe(true);
    expect(puedeVerProyecto(db, ana, q)).toBe(false); // A10: el tablero ajeno responde notFound
    expect(puedeVerProyecto(db, ana, 9999)).toBe(false);
    expect(membresiasDe(db, ANA)).toEqual([{ initiativeId: p, roles: ["ejecuta"] }]);
  });

  it("crea solo en sus proyectos y el tamaño que manda se ignora", () => {
    const id = createAssignmentAs(db, actor(ANA), { title: "Lo mío", initiativeId: p, size: "L", ownerWallet: ANA }, AHORA);
    const row = getAssignment(db, id)!;
    expect(row.size).toBeNull();
    expect(row.owner_wallet).toBe(ANA);
    expect(row.status).toBe("Asignada");
    expect(fallo(() => createAssignmentAs(db, actor(ANA), { title: "Ajeno", initiativeId: q }))?.status).toBe(403);
    expect(fallo(() => createAssignmentAs(db, actor(ANA), { title: "Sin proyecto" }))?.status).toBe(403);
    // Ni puede ponerle trabajo a otra persona del proyecto.
    expect(fallo(() => createAssignmentAs(db, actor(ANA), { title: "Para Rita", initiativeId: p, ownerWallet: RITA }))?.status).toBe(
      403
    );
  });

  it("quien planifica fija el tamaño y asigna dentro del proyecto (nunca a un externo de fuera)", () => {
    const id = createAssignmentAs(db, actor(EST), { title: "Plan", initiativeId: p, size: "L", ownerWallet: ANA }, AHORA);
    expect(getAssignment(db, id)!.size).toBe("L");
    expect(fallo(() => createAssignmentAs(db, actor(EST), { title: "X", initiativeId: p, ownerWallet: OTRO }))).toEqual({
      status: 400,
      message: "Primero súmale al proyecto.",
    });
    // El evento de creación guarda el instante inyectado.
    const ev = db.prepare(`SELECT created_at FROM assignment_events WHERE assignment_id = ?`).get(id) as { created_at: string };
    expect(ev.created_at).toBe(instanteDb(AHORA));
  });

  it("un proyecto de cliente: el core sin participación no lo ve; con client_members o membresía sí; el founder siempre", () => {
    const cliente = createClient(db, { name: "Cliente Demo" });
    const c = crearProyecto(db, actor(JOHN), { name: "Proyecto de cliente", clientId: cliente }).id;
    const fausto = equipo(db, FAUSTO);
    const david = equipo(db, DAVID);
    const vale = equipo(db, VALE);
    expect(puedeVerProyecto(db, fausto, c)).toBe(false);
    expect(puedeVerProyecto(db, vale, c)).toBe(false); // supervisar no abre proyectos de cliente
    expect(permisosDe(db, fausto, c).ver).toBe(false);
    expect(fallo(() => createAssignmentAs(db, fausto, { title: "X", initiativeId: c }))?.status).toBe(403);
    addMember(db, cliente, FAUSTO, "colaborador");
    expect(puedeVerProyecto(db, fausto, c)).toBe(true);
    agregarMiembro(db, actor(JOHN), { initiativeId: c, wallet: DAVID, rol: "ejecuta" });
    expect(puedeVerProyecto(db, david, c)).toBe(true);
    expect(puedeVerProyecto(db, equipo(db, JOHN), c)).toBe(true);
    expect(proyectosVisibles(db, fausto).map((i) => i.id)).toContain(c);
  });
});

describe("A6 · editarAsignacion: permisos por clase de campo, reasignar, Backlog → Asignada, Hecha", () => {
  let db: DB;
  let p: number;
  let q: number;
  beforeEach(() => {
    db = freshDb();
    ({ p, q } = escenario(db));
  });

  function piezaDeAna(status: "Asignada" | "Backlog" = "Asignada"): number {
    return createAssignment(db, {
      title: "Pieza",
      initiativeId: p,
      ownerWallet: status === "Backlog" ? null : ANA,
      status,
      priority: "Normal",
    });
  }

  it("el dueño cambia el contexto; la planificación no (403)", () => {
    const id = piezaDeAna();
    editarAsignacion(db, actor(ANA), { assignmentId: id, description: "más contexto", specUrl: "https://ejemplo.org/spec" }, AHORA);
    expect(getAssignment(db, id)!.description).toBe("más contexto");
    expect(fallo(() => editarAsignacion(db, actor(ANA), { assignmentId: id, title: "otro título" }))?.status).toBe(403);
    expect(fallo(() => editarAsignacion(db, actor(ANA), { assignmentId: id, priority: "Urgent" }))?.status).toBe(403);
    // Reenviar un campo IGUAL no pide permiso (el formulario manda todo).
    expect(editarAsignacion(db, actor(ANA), { assignmentId: id, priority: "Normal" }).priority).toBe("Normal");
  });

  it("otra persona del proyecto sin planificar no toca la pieza ajena", () => {
    const id = piezaDeAna();
    expect(fallo(() => editarAsignacion(db, actor(EJE2), { assignmentId: id, description: "x" }))?.status).toBe(403);
    // Y quien no ve el proyecto no sabe que existe.
    expect(fallo(() => editarAsignacion(db, actor(OTRO), { assignmentId: id, description: "x" }))?.status).toBe(404);
  });

  it("quien estructura planifica: título, prioridad, tamaño, fecha", () => {
    const id = piezaDeAna();
    const row = editarAsignacion(
      db,
      actor(EST),
      { assignmentId: id, title: "Nuevo", priority: "High", size: "S", dueDate: "2026-10-09" },
      AHORA
    );
    expect([row.title, row.priority, row.size, row.due_date]).toEqual(["Nuevo", "High", "S", "2026-10-09"]);
  });

  it("reasignar a un externo que no es miembro → 400; a un miembro → evento reasignar", () => {
    const id = piezaDeAna();
    db.prepare(`UPDATE users SET cla_signed = 1 WHERE wallet = ?`).run(CARLA);
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: id, ownerWallet: CARLA }))).toEqual({
      status: 400,
      message: "Primero súmale al proyecto.",
    });
    const row = editarAsignacion(db, actor(EST), { assignmentId: id, ownerWallet: EJE2, motivo: "repartir carga" }, AHORA);
    expect(row.owner_wallet).toBe(EJE2);
    expect(row.status).toBe("Asignada");
    const ev = db
      .prepare(`SELECT action, from_status, to_status, reason, created_at FROM assignment_events WHERE assignment_id = ?`)
      .all(id);
    expect(ev).toEqual([
      { action: "reasignar", from_status: "Asignada", to_status: "Asignada", reason: "repartir carga", created_at: instanteDb(AHORA) },
    ]);
  });

  it("Backlog + dueño → Asignada por la máquina de estados (evento asignar); null solo en Backlog", () => {
    const id = piezaDeAna("Backlog");
    const row = editarAsignacion(db, actor(EST), { assignmentId: id, ownerWallet: ANA }, AHORA);
    expect(row.status).toBe("Asignada");
    const ev = db.prepare(`SELECT action, from_status, to_status FROM assignment_events WHERE assignment_id = ?`).all(id);
    expect(ev).toEqual([{ action: "asignar", from_status: "Backlog", to_status: "Asignada" }]);
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: id, ownerWallet: null }))?.status).toBe(409);
  });

  it("un evento por llamada, con los NOMBRES de los campos cambiados (nunca valores)", () => {
    const id = piezaDeAna();
    editarAsignacion(db, actor(EST), { assignmentId: id, title: "Algo secreto", priority: "High" }, AHORA);
    const ev = db.prepare(`SELECT action, reason FROM assignment_events WHERE assignment_id = ?`).all(id) as Array<{
      action: string;
      reason: string;
    }>;
    expect(ev).toHaveLength(1);
    expect(ev[0].action).toBe("editar");
    expect(ev[0].reason).toBe("campos: title, priority");
    expect(ev[0].reason).not.toContain("secreto");
  });

  it("Hecha no se edita (409)", () => {
    const id = enRevision(db, p, ANA);
    applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(RITA) });
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: id, title: "x" }))).toEqual({
      status: 409,
      message: "Una entrega aprobada no se edita.",
    });
  });

  it("mover de proyecto exige planificar también en el destino; sin proyecto, solo F/S", () => {
    const id = piezaDeAna();
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: id, initiativeId: q }))?.status).toBe(403);
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: id, initiativeId: null }))?.status).toBe(403);
    // El founder sí, pero ANA no es miembro de Q ni del equipo interno: hay que sumarla antes.
    expect(fallo(() => editarAsignacion(db, actor(JOHN), { assignmentId: id, initiativeId: q }))).toEqual({
      status: 400,
      message: "Primero súmale al proyecto.",
    });
    agregarMiembro(db, actor(JOHN), { initiativeId: q, wallet: ANA, rol: "ejecuta" });
    expect(fallo(() => editarAsignacion(db, actor(JOHN), { assignmentId: id, initiativeId: q }))).toBeNull();
    expect(getAssignment(db, id)!.initiative_id).toBe(q);
  });

  it("un enlace de referencia que no es http(s) se rechaza", () => {
    const id = piezaDeAna();
    expect(fallo(() => editarAsignacion(db, actor(ANA), { assignmentId: id, specUrl: "javascript:alert(1)" }))?.status).toBe(400);
  });
});

describe("A6b · En revisión: lo que define la entrega queda fijo (409); el contexto no", () => {
  let db: DB;
  let p: number;
  let id: number;
  beforeEach(() => {
    db = freshDb();
    p = escenario(db).p;
    id = enRevision(db, p, ANA);
  });

  it.each([
    ["ownerWallet", { ownerWallet: EJE2 }],
    ["size", { size: "L" as const }],
    ["dueDate", { dueDate: "2026-12-31" }],
    ["priority", { priority: "Urgent" as const }],
    ["acceptanceCriteria", { acceptanceCriteria: "otro criterio" }],
  ])("cambiar %s → 409", (_campo, cambio) => {
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: id, ...cambio }))).toEqual({
      status: 409,
      message: COPY_EN_REVISION,
    });
  });

  it("la descripción sí se puede (el dueño)", () => {
    expect(editarAsignacion(db, actor(ANA), { assignmentId: id, description: "nota" }).description).toBe("nota");
    expect(getAssignment(db, id)!.status).toBe("En revisión");
  });
});

describe("A7 · proyectos y miembros con sus permisos", () => {
  let db: DB;
  let p: number;
  beforeEach(() => {
    db = freshDb();
    p = escenario(db).p;
  });

  it("crearProyecto: founder o supervisor; nombre 2–80; slug único (409)", () => {
    expect(fallo(() => crearProyecto(db, actor(FAUSTO), { name: "Mío" }))?.status).toBe(403);
    expect(fallo(() => crearProyecto(db, actor(EST), { name: "Mío" }))?.status).toBe(403);
    const r = crearProyecto(db, actor(VALE), { name: "Nuevo Frente", horizon: "Siguiente", notes: "  para probar  " });
    expect(r.slug).toBe("nuevo-frente");
    expect(r.notes).toBe("para probar");
    expect(fallo(() => crearProyecto(db, actor(VALE), { name: "nuevo frente" }))).toEqual({
      status: 409,
      message: "Ya existe un proyecto con ese nombre.",
    });
    expect(fallo(() => crearProyecto(db, actor(VALE), { name: "X" }))?.status).toBe(400);
    expect(fallo(() => crearProyecto(db, actor(VALE), { name: "y".repeat(81) }))?.status).toBe(400);
  });

  it("editarProyecto: estructura edita nombre y descripción; el slug no cambia; el cliente, solo F/S", () => {
    const antes = getProyectoPorSlug(db, "proyecto-piloto")!;
    const r = editarProyecto(db, actor(EST), { initiativeId: p, name: "Piloto renombrado", notes: "descripción" });
    expect(r.name).toBe("Piloto renombrado");
    expect(r.slug).toBe(antes.slug);
    const cliente = createClient(db, { name: "Cliente Demo" });
    expect(fallo(() => editarProyecto(db, actor(EST), { initiativeId: p, clientId: cliente }))).toEqual({
      status: 403,
      message: "El cliente del proyecto lo cambian el founder o un supervisor.",
    });
    expect(editarProyecto(db, actor(VALE), { initiativeId: p, clientId: cliente }).client_id).toBe(cliente);
    expect(fallo(() => editarProyecto(db, actor(RITA), { initiativeId: p, name: "No" }))?.status).toBe(403);
    expect(fallo(() => editarProyecto(db, actor(FAUSTO), { initiativeId: p, name: "No" }))?.status).toBe(403);
  });

  it("estructura no concede ni quita revisa/estructura (403); sí ejecuta y vende", () => {
    db.prepare(`UPDATE users SET cla_signed = 1 WHERE wallet = ?`).run(CARLA);
    expect(fallo(() => agregarMiembro(db, actor(EST), { initiativeId: p, wallet: CARLA, rol: "revisa" }))?.status).toBe(403);
    expect(fallo(() => agregarMiembro(db, actor(EST), { initiativeId: p, wallet: CARLA, rol: "estructura" }))?.status).toBe(403);
    expect(fallo(() => quitarMiembro(db, actor(EST), { initiativeId: p, wallet: RITA, rol: "revisa" }))?.status).toBe(403);
    agregarMiembro(db, actor(EST), { initiativeId: p, wallet: CARLA, rol: "vende" });
    agregarMiembro(db, actor(EST), { initiativeId: p, wallet: CARLA, rol: "ejecuta" });
    expect(rolesEnProyecto(db, CARLA, p)).toEqual(["ejecuta", "vende"]);
    quitarMiembro(db, actor(EST), { initiativeId: p, wallet: CARLA, rol: "vende" });
    expect(rolesEnProyecto(db, CARLA, p)).toEqual(["ejecuta"]);
    // Quien no planifica no suma a nadie.
    expect(fallo(() => agregarMiembro(db, actor(ANA), { initiativeId: p, wallet: CARLA, rol: "vende" }))?.status).toBe(403);
  });

  it("nadie cambia sus propios roles, tampoco el founder con su otra identidad", () => {
    expect(fallo(() => quitarMiembro(db, actor(EST), { initiativeId: p, wallet: EST, rol: "estructura" }))).toEqual({
      status: 403,
      message: "Tus propios roles los cambia otra persona.",
    });
    expect(fallo(() => agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: JOHN, rol: "revisa" }))?.status).toBe(403);
    usuario(db, SESION_FOUNDER, { role: "founder" });
    const founderSesion: TeamActor = { wallet: SESION_FOUNDER, name: "John", role: "founder", isSupervisor: true };
    expect(fallo(() => agregarMiembro(db, founderSesion, { initiativeId: p, wallet: JOHN, rol: "revisa" }))).toEqual({
      status: 403,
      message: "Tus propios roles los cambia otra persona.",
    });
  });

  it("409 de duplicado y de entregas abiertas al quitar", () => {
    expect(fallo(() => agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "ejecuta" }))?.status).toBe(409);
    createAssignment(db, { title: "Abierta", initiativeId: p, ownerWallet: ANA, status: "En curso" });
    expect(fallo(() => quitarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "ejecuta" }))).toEqual({
      status: 409,
      message: "Primero reasigna sus entregas abiertas en este proyecto.",
    });
    // Con otro rol que la mantiene dentro, sí se le puede quitar este.
    agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "vende" });
    quitarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "ejecuta" });
    expect(rolesEnProyecto(db, ANA, p)).toEqual(["vende"]);
    expect(fallo(() => quitarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "ejecuta" }))?.status).toBe(404);
  });

  it("cada operación deja su línea en talent_events, sin juzgar a nadie", () => {
    editarProyecto(db, actor(JOHN), { initiativeId: p, horizon: "Siguiente" });
    agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "vende" });
    quitarMiembro(db, actor(JOHN), { initiativeId: p, wallet: ANA, rol: "vende" });
    const acciones = (
      db.prepare(`SELECT action FROM talent_events WHERE initiative_id = ? ORDER BY id`).all(p) as Array<{ action: string }>
    ).map((r) => r.action);
    expect(acciones[0]).toBe("proyecto_crear");
    expect(acciones).toContain("miembro_alta");
    expect(acciones).toContain("proyecto_editar");
    expect(acciones.slice(-2)).toEqual(["miembro_alta", "miembro_baja"]);
    const dump = JSON.stringify(db.prepare(`SELECT * FROM talent_events`).all()).toLowerCase();
    for (const prohibido of ["desempeño", "ranking", "castigo"]) expect(dump).not.toContain(prohibido);
  });

  it("candidatosParaProyecto: F/S ven internos + contributors con CLA; estructura, internos + miembros; el resto, nadie", () => {
    const deJohn = candidatosParaProyecto(db, actor(JOHN), p).map((c) => c.wallet);
    expect(deJohn).toContain(FAUSTO);
    expect(deJohn).toContain(OTRO); // contributor con CLA aunque no sea miembro
    expect(deJohn).not.toContain(CARLA); // sin acuerdo
    expect(deJohn).not.toContain(DEMO);
    const deEst = candidatosParaProyecto(db, actor(EST), p);
    expect(deEst.map((c) => c.wallet)).toContain(FAUSTO);
    expect(deEst.map((c) => c.wallet)).toContain(ANA);
    expect(deEst.map((c) => c.wallet)).not.toContain(OTRO); // a un externo lo suma por su wallet exacta
    expect(deEst.find((c) => c.wallet === FAUSTO)!.interno).toBe(true);
    expect(deEst.find((c) => c.wallet === ANA)!.interno).toBe(false);
    expect(candidatosParaProyecto(db, actor(ANA), p)).toEqual([]);
  });

  it("supervisoresDeProyecto: quien estructura; si no hay, los supervisores globales activos", () => {
    const { q } = { q: getProyectoPorSlug(db, "otro-proyecto")!.id };
    expect(supervisoresDeProyecto(db, p)).toEqual([EST]);
    expect(supervisoresDeProyecto(db, q).sort()).toEqual([JOHN, VALE].sort());
    expect(supervisoresDeProyecto(db, null).sort()).toEqual([JOHN, VALE].sort());
  });
});

describe("A8 · ataques", () => {
  const SEGUNDA = "GSEGUNDAWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  let db: DB;
  let p: number;
  let pieza: number;
  beforeEach(() => {
    db = freshDb();
    p = escenario(db).p;
    // Un externo con `estructura` (EST) invita a una segunda wallet suya.
    usuario(db, SEGUNDA, { invitedBy: EST });
    // Su propia entrega, en revisión.
    agregarMiembro(db, actor(JOHN), { initiativeId: p, wallet: EST, rol: "ejecuta" });
    pieza = enRevision(db, p, EST);
  });

  it("(1) sumarla como revisa → 403; como ejecuta sí, pero no aprueba su entrega (B8)", () => {
    expect(fallo(() => agregarMiembro(db, actor(EST), { initiativeId: p, wallet: SEGUNDA, rol: "revisa" }))?.status).toBe(403);
    agregarMiembro(db, actor(EST), { initiativeId: p, wallet: SEGUNDA, rol: "ejecuta" });
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: pieza, action: "aprobar", actor: actor(SEGUNDA) }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.invitacion,
    });
    expect(ledgers(db)).toBe(0);
  });

  it("(2) reasignar a esa cuenta una entrega En revisión → 409", () => {
    agregarMiembro(db, actor(EST), { initiativeId: p, wallet: SEGUNDA, rol: "ejecuta" });
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: pieza, ownerWallet: SEGUNDA }))?.status).toBe(409);
    expect(getAssignment(db, pieza)!.owner_wallet).toBe(EST);
    expect(ledgers(db)).toBe(0);
  });

  it("(3) mover la fecha de una entrega En revisión → 409", () => {
    expect(fallo(() => editarAsignacion(db, actor(EST), { assignmentId: pieza, dueDate: "2026-12-31" }))?.status).toBe(409);
    expect(fallo(() => editarAsignacion(db, actor(JOHN), { assignmentId: pieza, size: "L" }))?.status).toBe(409);
    expect(getAssignment(db, pieza)!.due_date).toBeNull();
    expect(ledgers(db)).toBe(0);
  });

  it("y quien estructura no se aprueba a sí mismo", () => {
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: pieza, action: "aprobar", actor: actor(EST) }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.dueno,
    });
    expect(ledgers(db)).toBe(0);
  });
});

describe("tablero del proyecto y filtros por query string", () => {
  let db: DB;
  let p: number;
  beforeEach(() => {
    db = freshDb();
    p = escenario(db).p;
  });

  it("parseFiltrosTablero ignora valores inválidos", () => {
    expect(parseFiltrosTablero({})).toEqual({});
    expect(
      parseFiltrosTablero({
        responsable: "sin",
        prioridad: "High",
        tamano: "M",
        horizonte: "Ahora",
        vence: "semana",
        q: "  módulo ",
        hechas: "30",
      })
    ).toEqual({ owner: "sin", priority: "High", size: "M", horizon: "Ahora", vence: "semana", q: "módulo", hechasDias: 30 });
    expect(
      parseFiltrosTablero({ prioridad: "Máxima", tamano: "XL", horizonte: "Mañana", vence: "ayer", hechas: "-3", q: "" })
    ).toEqual({});
    expect(parseFiltrosTablero({ prioridad: ["Low", "High"] })).toEqual({ priority: "Low" });
  });

  it("agrupa por columna y filtra por responsable, prioridad, tamaño, vencimiento y texto", () => {
    const a = createAssignment(db, { title: "Módulo de pagos", initiativeId: p, ownerWallet: ANA, status: "Asignada", priority: "High", size: "M", dueDate: "2026-09-20" });
    const b = createAssignment(db, { title: "Diseño", initiativeId: p, status: "Backlog", dueDate: "2026-10-05" });
    createAssignment(db, { title: "Otra", initiativeId: p, ownerWallet: EJE2, status: "En curso" });
    const vieja = createAssignment(db, { title: "Vieja", initiativeId: p, ownerWallet: ANA, status: "Hecha" });
    db.prepare(`UPDATE assignments SET closed_at = '2026-08-01T10:00:00.000Z' WHERE id = ?`).run(vieja);
    const reciente = createAssignment(db, { title: "Reciente", initiativeId: p, ownerWallet: ANA, status: "Hecha" });
    db.prepare(`UPDATE assignments SET closed_at = '2026-09-28T10:00:00.000Z' WHERE id = ?`).run(reciente);

    const todo = tableroDeProyecto(db, p, {}, AHORA);
    expect(todo.total).toBe(4); // "Vieja" queda fuera de los 14 días
    expect(todo.columnas.Asignada.map((x) => x.id)).toEqual([a]);
    expect(todo.columnas.Backlog.map((x) => x.id)).toEqual([b]);
    expect(todo.columnas.Hecha.map((x) => x.id)).toEqual([reciente]);
    expect(tableroDeProyecto(db, p, { hechasDias: 90 }, AHORA).columnas.Hecha).toHaveLength(2);

    expect(tableroDeProyecto(db, p, { owner: "sin" }, AHORA).total).toBe(1);
    expect(tableroDeProyecto(db, p, { owner: ANA }, AHORA).total).toBe(2);
    expect(tableroDeProyecto(db, p, { priority: "High" }, AHORA).total).toBe(1);
    expect(tableroDeProyecto(db, p, { size: "sin" }, AHORA).total).toBe(3);
    expect(tableroDeProyecto(db, p, { vence: "vencidas" }, AHORA).columnas.Asignada.map((x) => x.id)).toEqual([a]);
    expect(tableroDeProyecto(db, p, { vence: "semana" }, AHORA).columnas.Backlog.map((x) => x.id)).toEqual([b]);
    expect(tableroDeProyecto(db, p, { q: "MODULO" }, AHORA).total).toBe(1);
    expect(tableroDeProyecto(db, p, { q: "nada que ver" }, AHORA).total).toBe(0);
  });
});
