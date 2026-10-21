/**
 * Prueba de caracterización · feature `actividades` (docs/features/actividades.md).
 *
 * Recorre el flujo principal de una entrega de punta a punta contra una base SQLite
 * temporal (en memoria, mismo patrón que src/lib/team-puntos.test.ts) y fija el
 * comportamiento ACTUAL, sin cambiarlo:
 *   crear (`createAssignmentAs`, lo que llama POST /api/equipo/crear)
 *   → bloquear con motivo y desbloquear → empezar → enviar a revisión
 *   → cuatro ojos (el dueño no aprueba; un core sin rol tampoco)
 *   → pedir ajustes con motivo → reenviar → aprobar (POST /api/equipo/asignacion)
 *   → emisión de puntos y reputación en la misma transacción.
 * Más la edición (PATCH /api/equipo/asignacion → `editarAsignacion`), el check-in
 * (POST /api/equipo/checkin → `upsertCheckin`) y el alta de un externo en su proyecto.
 *
 * Las rutas HTTP solo validan con zod e invocan estas funciones (ver la ficha, §3).
 * Si una aserción "COMPORTAMIENTO ACTUAL" deja de cumplirse porque se corrigió su
 * hallazgo, se actualiza la aserción y la ficha. Personas: slugs del roster y wallets
 * ficticias de prueba.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "../db";
import { GENOME_DEFAULTS, clearGenomeCache } from "../genome";
import { MOTIVO_TRANSICION, pendingPrincipal, type TeamActor } from "../roles";
import { BlockReasonRequiredError, InvalidTeamTransitionError } from "../team-state-machine";
import { calcularPremioTarea, refTarea } from "../gamificacion";
import { mismaPersona } from "../identidades";
import { createClient } from "../clients";
import {
  COPY_EN_REVISION,
  COPY_REVISION_NO_SE_BLOQUEA,
  TeamError,
  accionesPermitidas,
  agregarMiembro,
  aplicarAccionAsignacion,
  assignmentsForOwner,
  checkinSchema,
  createAssignmentAs,
  createAssignmentSchema,
  crearProyecto,
  editarAsignacion,
  getAssignment,
  getCheckin,
  seedTeam,
  upsertCheckin,
} from "../team";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const FAUSTO = pendingPrincipal("fausto");
const DAVID = pendingPrincipal("david");
const EXTERNA = "GEXTERNAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // contributor ficticia

const FOUNDER: TeamActor = { wallet: JOHN, name: "John", role: "founder", isSupervisor: true };
const SUPERVISORA: TeamActor = { wallet: VALE, name: "Vale", role: "core", isSupervisor: true };
const DUENO: TeamActor = { wallet: FAUSTO, name: "Fausto", role: "core", isSupervisor: false };
const OTRO_CORE: TeamActor = { wallet: DAVID, name: "David", role: "core", isSupervisor: false };
const EXT: TeamActor = { wallet: EXTERNA, name: "Externa", role: "contributor", isSupervisor: false };

// Calendario (Bogotá = UTC−5; vitest corre en UTC como Azure). Lunes 5 de octubre de 2026.
const LUN_09 = new Date("2026-10-05T14:00:00.000Z");
const LUN_10 = new Date("2026-10-05T15:00:00.000Z");
const LUN_11 = new Date("2026-10-05T16:00:00.000Z");
const LUN_12 = new Date("2026-10-05T17:00:00.000Z");
const LUN_14 = new Date("2026-10-05T19:00:00.000Z");
const MAR_10 = new Date("2026-10-06T15:00:00.000Z");
const MAR_11 = new Date("2026-10-06T16:00:00.000Z");
const MAR_15 = new Date("2026-10-06T20:00:00.000Z");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'Época 1', ?, ?, 'Open')`).run(
    GENOME_DEFAULTS.EPOCH_BUDGET,
    GENOME_DEFAULTS.ACADEMIA_BUDGET
  );
  clearGenomeCache(db);
  return db;
}

function fallo(fn: () => unknown): { status: number; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof TeamError) return { status: e.status, message: e.message };
    throw e;
  }
}

function eventos(db: DB, id: number): Array<{ action: string; from_status: string; to_status: string; reason: string | null; actor_wallet: string }> {
  return db
    .prepare(`SELECT action, from_status, to_status, reason, actor_wallet FROM assignment_events WHERE assignment_id = ? ORDER BY id`)
    .all(id) as Array<{ action: string; from_status: string; to_status: string; reason: string | null; actor_wallet: string }>;
}

describe("caracterización · actividades (flujo principal de una entrega)", () => {
  let db: DB;
  let proyecto: number;
  let pieza: number;

  beforeEach(() => {
    db = freshDb();
    proyecto = crearProyecto(db, FOUNDER, { name: "Proyecto de prueba" }).id;
    // Lo que manda TeamNewAssignment a POST /api/equipo/crear, validado por el mismo esquema.
    const body = createAssignmentSchema.parse({
      title: "Conciliar el inventario",
      initiativeId: proyecto,
      ownerWallet: FAUSTO,
      priority: "High",
      size: "M",
      dueDate: "2026-10-07",
      acceptanceCriteria: "El conteo cuadra con el sistema",
    });
    pieza = createAssignmentAs(db, FOUNDER, body, LUN_09);
  });

  it("crear: con responsable nace Asignada y deja el evento 'crear' desde el minuto cero", () => {
    const row = getAssignment(db, pieza)!;
    expect(row).toMatchObject({ status: "Asignada", owner_wallet: FAUSTO, size: "M", due_date: "2026-10-07", created_by: JOHN });
    expect(eventos(db, pieza)).toEqual([
      { action: "crear", from_status: "Backlog", to_status: "Asignada", reason: null, actor_wallet: JOHN },
    ]);
    expect(assignmentsForOwner(db, FAUSTO).map((a) => a.id)).toEqual([pieza]);
    // La UI de /equipo/hoy solo pinta lo que el dueño puede hacer.
    expect(accionesPermitidas(db, DUENO, row)).toEqual(["empezar", "bloquear"]);
  });

  it("recorrido completo: bloquear → desbloquear → empezar → revisión → cuatro ojos → ajustes → aprobar → emisión", () => {
    // Bloquear exige motivo (máquina pura); desbloquear vuelve al estado previo.
    expect(() => aplicarAccionAsignacion(db, { assignmentId: pieza, action: "bloquear", reason: "  ", actor: DUENO, now: LUN_10 })).toThrow(
      BlockReasonRequiredError
    );
    let r = aplicarAccionAsignacion(db, { assignmentId: pieza, action: "bloquear", reason: "falta el acceso", actor: DUENO, now: LUN_10 });
    expect(r.row).toMatchObject({ status: "Bloqueada", status_before_block: "Asignada", blocked_reason: "falta el acceso" });
    r = aplicarAccionAsignacion(db, { assignmentId: pieza, action: "desbloquear", actor: DUENO, now: LUN_11 });
    expect(r.row).toMatchObject({ status: "Asignada", status_before_block: null, blocked_reason: null, blocked_at: null });

    // Sin saltos: no se aprueba desde Asignada.
    expect(() => aplicarAccionAsignacion(db, { assignmentId: pieza, action: "aprobar", actor: SUPERVISORA, now: LUN_11 })).toThrow(
      InvalidTeamTransitionError
    );

    aplicarAccionAsignacion(db, { assignmentId: pieza, action: "empezar", actor: DUENO, now: LUN_12 });
    r = aplicarAccionAsignacion(db, { assignmentId: pieza, action: "enviar_a_revision", actor: DUENO, now: LUN_14 });
    expect(r.row.status).toBe("En revisión");

    // En revisión no se bloquea (se devuelve) ni se replanifica.
    expect(fallo(() => aplicarAccionAsignacion(db, { assignmentId: pieza, action: "bloquear", reason: "x", actor: DUENO, now: LUN_14 }))).toEqual({
      status: 409,
      message: COPY_REVISION_NO_SE_BLOQUEA,
    });
    expect(fallo(() => editarAsignacion(db, FOUNDER, { assignmentId: pieza, dueDate: "2026-10-20" }, LUN_14))).toEqual({
      status: 409,
      message: COPY_EN_REVISION,
    });

    // Cuatro ojos: el dueño no aprueba lo suyo y la UI no se lo ofrece.
    expect(accionesPermitidas(db, DUENO, getAssignment(db, pieza)!)).toEqual([]);
    expect(fallo(() => aplicarAccionAsignacion(db, { assignmentId: pieza, action: "aprobar", actor: DUENO, now: MAR_10 }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.dueno,
    });
    // Un core sin rol en el proyecto, frente a un dueño `pending:` sin vincular: solo founder o supervisión.
    expect(fallo(() => aplicarAccionAsignacion(db, { assignmentId: pieza, action: "aprobar", actor: OTRO_CORE, now: MAR_10 }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.pendiente,
    });
    expect(accionesPermitidas(db, SUPERVISORA, getAssignment(db, pieza)!)).toEqual(["aprobar", "devolver"]);

    // Pedir ajustes exige el "qué falta"; vuelve a En curso y el motivo vive en el evento.
    expect(() => aplicarAccionAsignacion(db, { assignmentId: pieza, action: "devolver", actor: SUPERVISORA, now: MAR_10 })).toThrow(
      BlockReasonRequiredError
    );
    r = aplicarAccionAsignacion(db, { assignmentId: pieza, action: "devolver", reason: "falta el acta", actor: SUPERVISORA, now: MAR_10 });
    expect(r.row).toMatchObject({ status: "En curso", blocked_reason: null });
    expect(r.emision).toBeNull();

    aplicarAccionAsignacion(db, { assignmentId: pieza, action: "enviar_a_revision", actor: DUENO, now: MAR_11 });
    r = aplicarAccionAsignacion(db, { assignmentId: pieza, action: "aprobar", actor: SUPERVISORA, now: MAR_15 });
    expect(r.row.status).toBe("Hecha");
    expect(r.row.closed_at).toBe(MAR_15.toISOString());

    // Emisión en la misma transacción: tamaño M aprobado antes del cierre del día de vencimiento.
    const premio = calcularPremioTarea({ size: "M", aTiempo: true }, GENOME_DEFAULTS);
    expect(r.emision).toMatchObject({ emitido: true, puntos: premio.puntos, reputacion: premio.reputacion, periodo: 1 });
    expect(r.emision!.puntos).toBe(38); // 30 + 25 % de bono a tiempo (valores por defecto del genoma)
    expect(r.textoEmision).toBeNull();
    const ref = refTarea(pieza);
    expect(db.prepare(`SELECT wallet, points, period_id, bucket FROM points_ledger WHERE ref = ?`).all(ref)).toEqual([
      { wallet: FAUSTO, points: 38, period_id: 1, bucket: "ejecucion" },
    ]);
    expect(db.prepare(`SELECT wallet, axis, delta FROM reputation_events WHERE ref = ?`).all(ref)).toEqual([
      { wallet: FAUSTO, axis: "ejecucion", delta: 3 },
    ]);

    // Hecha es final: no se aprueba dos veces ni se edita.
    expect(() => aplicarAccionAsignacion(db, { assignmentId: pieza, action: "aprobar", actor: FOUNDER, now: MAR_15 })).toThrow(
      InvalidTeamTransitionError
    );
    expect(fallo(() => editarAsignacion(db, FOUNDER, { assignmentId: pieza, title: "otro" }, MAR_15))?.status).toBe(409);

    // El historial append-only cuenta la entrega completa.
    expect(eventos(db, pieza).map((e) => `${e.action}:${e.from_status}>${e.to_status}`)).toEqual([
      "crear:Backlog>Asignada",
      "bloquear:Asignada>Bloqueada",
      "desbloquear:Bloqueada>Asignada",
      "empezar:Asignada>En curso",
      "enviar_a_revision:En curso>En revisión",
      "devolver:En revisión>En curso",
      "enviar_a_revision:En curso>En revisión",
      "aprobar:En revisión>Hecha",
    ]);
    expect(eventos(db, pieza).find((e) => e.action === "devolver")!.reason).toBe("falta el acta");
  });

  it("editar: el dueño cambia el contexto; lo de planificación es de quien planifica", () => {
    let row = editarAsignacion(db, DUENO, { assignmentId: pieza, description: "con el acta del lunes" }, LUN_10);
    expect(row.description).toBe("con el acta del lunes");
    expect(fallo(() => editarAsignacion(db, DUENO, { assignmentId: pieza, priority: "Urgent" }, LUN_10))?.status).toBe(403);
    // Quien planifica reasigna: un evento 'reasignar' con la lista de campos, nunca valores.
    row = editarAsignacion(db, SUPERVISORA, { assignmentId: pieza, ownerWallet: DAVID }, LUN_11);
    expect(row.owner_wallet).toBe(DAVID);
    const ultimo = eventos(db, pieza).at(-1)!;
    expect(ultimo).toMatchObject({ action: "reasignar", from_status: "Asignada", to_status: "Asignada", reason: "campos: ownerWallet" });
    // Un enlace que no es http(s) no entra por la edición.
    expect(fallo(() => editarAsignacion(db, SUPERVISORA, { assignmentId: pieza, specUrl: "javascript:alert(1)" }, LUN_11))?.status).toBe(400);
  });

  it("check-in: uno por persona y día, editable el mismo día; vacío → 400", () => {
    const a = upsertCheckin(db, FAUSTO, checkinSchema.parse({ done: "conté el depósito", doing: "", blocked: "" }), LUN_10);
    const b = upsertCheckin(db, FAUSTO, checkinSchema.parse({ done: "conté el depósito", doing: "conciliar", blocked: "" }), LUN_14);
    expect(b.id).toBe(a.id);
    expect(b.day).toBe("2026-10-05");
    expect(getCheckin(db, FAUSTO, "2026-10-05")!.doing).toBe("conciliar");
    expect(fallo(() => upsertCheckin(db, FAUSTO, { done: " ", doing: "", blocked: "" }, LUN_14))?.status).toBe(400);
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): el día del check-in es el del servidor (UTC), no el de BUSINESS_TZ", () => {
    // 21:30 del lunes en Bogotá = 02:30 UTC del martes: el check-in queda guardado como del martes.
    const noche = new Date("2026-10-06T02:30:00.000Z");
    expect(upsertCheckin(db, FAUSTO, { done: "cierre del día", doing: "", blocked: "" }, noche).day).toBe("2026-10-06");
  });

  it("externo con acuerdo y rol 'ejecuta': crea solo en su proyecto, para sí, sin campos de planificación, y toma lo libre", () => {
    db.prepare(
      `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, 'Externa', 'contributor', 'active', 0, 1)`
    ).run(EXTERNA);
    agregarMiembro(db, FOUNDER, { initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" });

    expect(fallo(() => createAssignmentAs(db, EXT, { title: "fuera de proyecto" }, LUN_10))).toEqual({
      status: 403,
      message: "Crea el trabajo dentro de uno de tus proyectos.",
    });
    expect(fallo(() => createAssignmentAs(db, EXT, { title: "para otro", initiativeId: proyecto, ownerWallet: FAUSTO }, LUN_10))?.status).toBe(403);
    const propia = createAssignmentAs(
      db,
      EXT,
      { title: "propia", initiativeId: proyecto, ownerWallet: EXTERNA, size: "L", priority: "Urgent", dueDate: "2026-10-09", needsFounder: true },
      LUN_10
    );
    expect(getAssignment(db, propia)).toMatchObject({ status: "Asignada", size: null, priority: "Normal", due_date: null, needs_founder: 0 });

    const libre = createAssignmentAs(db, FOUNDER, { title: "libre", initiativeId: proyecto }, LUN_10);
    expect(getAssignment(db, libre)!.status).toBe("Backlog");
    const r = aplicarAccionAsignacion(db, { assignmentId: libre, action: "asignar", actor: EXT, now: LUN_11 });
    expect(r.row).toMatchObject({ status: "Asignada", owner_wallet: EXTERNA });
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): 'Tus asignaciones' lista por wallet exacta, aunque los cuatro ojos usan todas las identidades", () => {
    // El founder entra con la wallet de su sesión (otra fila con role='founder'); su
    // trabajo puede estar a nombre de `pending:john`. Para los cuatro ojos es la misma persona…
    const SESION_FOUNDER = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    db.prepare(
      `INSERT INTO users (wallet, display_name, role, status, is_demo, is_founder, cla_signed) VALUES (?, 'Founder', 'founder', 'active', 0, 1, 1)`
    ).run(SESION_FOUNDER);
    const suya = createAssignmentAs(db, FOUNDER, { title: "del founder", initiativeId: proyecto, ownerWallet: JOHN }, LUN_10);
    expect(mismaPersona(db, SESION_FOUNDER, JOHN)).toBe(true);
    aplicarAccionAsignacion(db, { assignmentId: suya, action: "empezar", actor: FOUNDER, now: LUN_11 });
    aplicarAccionAsignacion(db, { assignmentId: suya, action: "enviar_a_revision", actor: FOUNDER, now: LUN_12 });
    const yo: TeamActor = { wallet: SESION_FOUNDER, name: "Founder", role: "founder", isSupervisor: true };
    expect(fallo(() => aplicarAccionAsignacion(db, { assignmentId: suya, action: "aprobar", actor: yo, now: LUN_14 }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.dueno,
    });
    // …pero la lista de /equipo/hoy (`assignmentsForOwner`) no la muestra como suya.
    expect(assignmentsForOwner(db, SESION_FOUNDER).map((a) => a.id)).toEqual([]);
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): sobre una pieza que no ve, POST responde 403 y PATCH 404 (la existencia se filtra por POST)", () => {
    const cliente = createClient(db, { name: "Cliente de prueba" });
    const deCliente = crearProyecto(db, FOUNDER, { name: "Proyecto de cliente", clientId: cliente }).id;
    const ajena = createAssignmentAs(db, FOUNDER, { title: "ajena", initiativeId: deCliente }, LUN_10);
    // Un core que no participa en el cliente:
    expect(fallo(() => editarAsignacion(db, OTRO_CORE, { assignmentId: ajena, description: "x" }, LUN_11))).toEqual({
      status: 404,
      message: "Asignación no encontrada.",
    });
    expect(fallo(() => aplicarAccionAsignacion(db, { assignmentId: ajena, action: "asignar", actor: OTRO_CORE, now: LUN_11 }))).toEqual({
      status: 403,
      message: MOTIVO_TRANSICION.tomar,
    });
    expect(fallo(() => aplicarAccionAsignacion(db, { assignmentId: 99_999, action: "asignar", actor: OTRO_CORE, now: LUN_11 }))?.status).toBe(404);
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): el alta acepta un specUrl que no es http(s); solo la edición lo rechaza", () => {
    const body = createAssignmentSchema.parse({ title: "con enlace raro", specUrl: "javascript:alert(1)" });
    const id = createAssignmentAs(db, FOUNDER, body, LUN_10);
    expect(getAssignment(db, id)!.spec_url).toBe("javascript:alert(1)");
  });
});
