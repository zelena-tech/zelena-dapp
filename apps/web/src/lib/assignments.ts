/**
 * WP14 · Módulo equipo: iniciativas, asignaciones y check-in diario.
 *
 * Los handlers NO deciden transiciones: invocan `transitionAssignment()`
 * (función pura, assignment-state.ts). Aquí solo se persiste y se aplican las
 * reglas de contexto (WIP, permisos, historial).
 *
 * Regla del doc 16: se califican ENTREGAS, nunca personas. Todas las métricas
 * de este módulo son de carga y de flujo de trabajo — no de "rendimiento".
 */
import type { DB } from "./db";
import {
  transitionAssignment,
  assertPuedeActuar,
  ESTADOS_ABIERTOS,
  WIP_MAX,
  type ActorAsignacion,
  type AssignmentAction,
  type AssignmentState,
} from "./assignment-state";

export const PRIORITIES = ["alta", "media", "baja"] as const;
export const SIZES = ["S", "M", "L"] as const;
export const HORIZONS = ["ahora", "siguiente", "parqueado"] as const;

export class AssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentError";
  }
}

// ─── Iniciativas ─────────────────────────────────────────────────────────

export function createInitiative(
  db: DB,
  input: { slug: string; name: string; horizon?: string; clientId?: number | null; notes?: string }
): number {
  const horizon = input.horizon ?? "ahora";
  if (!(HORIZONS as readonly string[]).includes(horizon)) {
    throw new AssignmentError(`Horizonte inválido: ${horizon}.`);
  }
  const info = db
    .prepare(`INSERT INTO initiatives (slug, name, horizon, client_id, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(input.slug, input.name, horizon, input.clientId ?? null, input.notes ?? null);
  return info.lastInsertRowid as number;
}

export function listInitiatives(db: DB, horizon?: string) {
  const sql = horizon
    ? `SELECT * FROM initiatives WHERE horizon = ? ORDER BY name`
    : `SELECT * FROM initiatives ORDER BY horizon, name`;
  const rows = (horizon ? db.prepare(sql).all(horizon) : db.prepare(sql).all()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    horizon: r.horizon as string,
    clientId: (r.client_id as number) ?? null,
  }));
}

// ─── Asignaciones ────────────────────────────────────────────────────────

export interface AssignmentInput {
  title: string;
  description?: string;
  initiativeId?: number | null;
  clientId?: number | null;
  ownerWallet?: string | null;
  priority?: string;
  size?: string;
  dueDate?: string | null;
  acceptanceCriteria?: string | null;
  specUrl?: string | null;
  /** Referencia a un nodo del grafo (WP20). Por referencia, jamás por copia. */
  graphNodeId?: string | null;
  createdBy?: string;
}

export function createAssignment(db: DB, input: AssignmentInput): number {
  const title = (input.title ?? "").trim();
  if (title.length < 3) throw new AssignmentError("La asignación necesita un título.");
  const priority = input.priority ?? "media";
  const size = input.size ?? "M";
  if (!(PRIORITIES as readonly string[]).includes(priority)) throw new AssignmentError(`Prioridad inválida: ${priority}.`);
  if (!(SIZES as readonly string[]).includes(size)) throw new AssignmentError(`Tamaño inválido: ${size}.`);

  // Nace en Backlog; si viene con responsable, nace Asignada.
  const status: AssignmentState = input.ownerWallet ? "Asignada" : "Backlog";
  const info = db
    .prepare(
      `INSERT INTO assignments
        (title, description, initiative_id, client_id, owner_wallet, status, priority, size,
         due_date, acceptance_criteria, spec_url, graph_node_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description ?? null,
      input.initiativeId ?? null,
      input.clientId ?? null,
      input.ownerWallet ?? null,
      status,
      priority,
      size,
      input.dueDate ?? null,
      input.acceptanceCriteria ?? null,
      input.specUrl ?? null,
      input.graphNodeId ?? null,
      input.createdBy ?? null
    );
  const id = info.lastInsertRowid as number;
  db.prepare(
    `INSERT INTO assignment_events (assignment_id, from_status, to_status, action, actor_wallet)
     VALUES (?, NULL, ?, 'crear', ?)`
  ).run(id, status, input.createdBy ?? "sistema");
  return id;
}

export interface AssignmentRow {
  id: number;
  title: string;
  description: string | null;
  initiativeId: number | null;
  initiativeName: string | null;
  clientId: number | null;
  clientName: string | null;
  ownerWallet: string | null;
  status: AssignmentState;
  priority: string;
  size: string;
  dueDate: string | null;
  acceptanceCriteria: string | null;
  specUrl: string | null;
  graphNodeId: string | null;
  blockedReason: string | null;
  updatedAt: string;
}

const SELECT_BASE = `
  SELECT a.*, i.name AS initiative_name, c.name AS client_name
    FROM assignments a
    LEFT JOIN initiatives i ON i.id = a.initiative_id
    LEFT JOIN clients c ON c.id = a.client_id`;

function mapAssignment(r: Record<string, unknown>): AssignmentRow {
  return {
    id: r.id as number,
    title: r.title as string,
    description: (r.description as string) ?? null,
    initiativeId: (r.initiative_id as number) ?? null,
    initiativeName: (r.initiative_name as string) ?? null,
    clientId: (r.client_id as number) ?? null,
    clientName: (r.client_name as string) ?? null,
    ownerWallet: (r.owner_wallet as string) ?? null,
    status: r.status as AssignmentState,
    priority: r.priority as string,
    size: r.size as string,
    dueDate: (r.due_date as string) ?? null,
    acceptanceCriteria: (r.acceptance_criteria as string) ?? null,
    specUrl: (r.spec_url as string) ?? null,
    graphNodeId: (r.graph_node_id as string) ?? null,
    blockedReason: (r.blocked_reason as string) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export function getAssignment(db: DB, id: number): AssignmentRow | null {
  const r = db.prepare(`${SELECT_BASE} WHERE a.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? mapAssignment(r) : null;
}

/** Orden de la pantalla que abre cada persona: prioridad y luego vencimiento. */
const ORDEN_HOY = `
  ORDER BY CASE a.priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
           a.due_date IS NULL, a.due_date, a.id`;

export function listForOwner(db: DB, wallet: string, opts?: { includeDone?: boolean }): AssignmentRow[] {
  const estados = opts?.includeDone ? [...ESTADOS_ABIERTOS, "Hecha"] : ESTADOS_ABIERTOS;
  const marks = estados.map(() => "?").join(",");
  const rows = db
    .prepare(`${SELECT_BASE} WHERE a.owner_wallet = ? AND a.status IN (${marks}) ${ORDEN_HOY}`)
    .all(wallet, ...estados) as Array<Record<string, unknown>>;
  return rows.map(mapAssignment);
}

export function listBacklog(db: DB, filter?: { initiativeId?: number; clientId?: number }): AssignmentRow[] {
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (filter?.initiativeId != null) {
    where.push("a.initiative_id = ?");
    params.push(filter.initiativeId);
  }
  if (filter?.clientId != null) {
    where.push("a.client_id = ?");
    params.push(filter.clientId);
  }
  const rows = db
    .prepare(`${SELECT_BASE} WHERE ${where.join(" AND ")} ${ORDEN_HOY}`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapAssignment);
}

export interface ActionInput {
  assignmentId: number;
  action: AssignmentAction;
  /**
   * Quién actúa. OBLIGATORIO: sin esto, cualquiera con sesión podría mover el
   * trabajo de otro (hueco encontrado al verificar el servidor en vivo).
   */
  actor: ActorAsignacion;
  /** Para `asignar`: a quién. */
  toWallet?: string;
  /** Obligatorio para `bloquear`. */
  reason?: string;
}

/**
 * Aplica una acción. La transición la decide la función pura; aquí solo se
 * añaden las reglas de contexto y se persiste con historial.
 */
export function applyAction(db: DB, input: ActionInput): AssignmentRow {
  const actual = getAssignment(db, input.assignmentId);
  if (!actual) throw new AssignmentError("La asignación no existe.");

  // Autorización ANTES de cualquier otra cosa: la máquina de estados valida que
  // la transición sea posible, no que quien la pide tenga derecho.
  assertPuedeActuar(input.action, input.actor, actual.ownerWallet);

  // Estado previo al bloqueo: se recupera del historial, no se adivina.
  let previous: AssignmentState | null = null;
  if (input.action === "desbloquear") {
    const ev = db
      .prepare(
        `SELECT from_status FROM assignment_events
          WHERE assignment_id = ? AND action = 'bloquear' ORDER BY id DESC LIMIT 1`
      )
      .get(input.assignmentId) as { from_status: string | null } | undefined;
    previous = (ev?.from_status as AssignmentState) ?? null;
  }

  const siguiente = transitionAssignment({
    current: actual.status,
    action: input.action,
    previous,
    reason: input.reason,
  });

  const owner = input.action === "asignar" ? (input.toWallet ?? actual.ownerWallet) : actual.ownerWallet;
  if (input.action === "asignar" && !owner) {
    throw new AssignmentError("Asignar requiere un responsable.");
  }

  // WIP personal: el multitasking es el impuesto invisible; el límite lo cobra
  // explícito. Es una regla de carga, no una evaluación de la persona.
  if (input.action === "empezar" && owner) {
    const n = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ? AND status = 'En curso' AND id <> ?`)
        .get(owner, input.assignmentId) as { n: number }
    ).n;
    if (n >= WIP_MAX) {
      throw new AssignmentError(
        `Límite de trabajo en curso alcanzado (${WIP_MAX}). Cierra o devuelve algo antes de empezar otra cosa.`
      );
    }
  }

  const blockedReason = siguiente === "Bloqueada" ? (input.reason ?? "").trim() : null;

  db.transaction(() => {
    db.prepare(
      `UPDATE assignments
          SET status = ?, owner_wallet = ?, blocked_reason = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(siguiente, owner ?? null, blockedReason, input.assignmentId);
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, from_status, to_status, action, actor_wallet, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(input.assignmentId, actual.status, siguiente, input.action, input.actor.wallet, input.reason ?? null);
  })();

  return getAssignment(db, input.assignmentId)!;
}

export function assignmentHistory(db: DB, assignmentId: number) {
  return db
    .prepare(
      `SELECT from_status, to_status, action, actor_wallet, reason, created_at
         FROM assignment_events WHERE assignment_id = ? ORDER BY id`
    )
    .all(assignmentId) as Array<{
    from_status: string | null;
    to_status: string;
    action: string;
    actor_wallet: string;
    reason: string | null;
    created_at: string;
  }>;
}

// ─── Check-in diario (rito 1) ────────────────────────────────────────────

export function upsertCheckin(
  db: DB,
  input: { wallet: string; day: string; done: string; doing: string; blocked?: string }
): void {
  db.prepare(
    `INSERT INTO checkins (wallet, day, done, doing, blocked, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (wallet, day) DO UPDATE SET
       done = excluded.done, doing = excluded.doing, blocked = excluded.blocked,
       updated_at = datetime('now')`
  ).run(input.wallet, input.day, input.done, input.doing, input.blocked ?? null);
}

export function getCheckin(db: DB, wallet: string, day: string) {
  return db.prepare(`SELECT * FROM checkins WHERE wallet = ? AND day = ?`).get(wallet, day) as
    | { wallet: string; day: string; done: string; doing: string; blocked: string | null }
    | undefined;
}

// ─── Vistas agregadas (WP15) ─────────────────────────────────────────────

/** Carga por persona. Se miden ENTREGAS y CARGAS, jamás "rendimiento". */
export function loadByPerson(db: DB) {
  return db
    .prepare(
      `SELECT COALESCE(a.owner_wallet,'(sin responsable)') AS wallet,
              SUM(CASE WHEN a.status = 'En curso' THEN 1 ELSE 0 END)   AS en_curso,
              SUM(CASE WHEN a.status = 'Asignada' THEN 1 ELSE 0 END)   AS asignadas,
              SUM(CASE WHEN a.status = 'En revisión' THEN 1 ELSE 0 END) AS en_revision,
              SUM(CASE WHEN a.status = 'Bloqueada' THEN 1 ELSE 0 END)  AS bloqueadas
         FROM assignments a
        WHERE a.status IN ('Asignada','En curso','En revisión','Bloqueada')
        GROUP BY a.owner_wallet
        ORDER BY en_curso DESC, asignadas DESC`
    )
    .all() as Array<{
    wallet: string;
    en_curso: number;
    asignadas: number;
    en_revision: number;
    bloqueadas: number;
  }>;
}

export function blockedAssignments(db: DB): AssignmentRow[] {
  const rows = db
    .prepare(`${SELECT_BASE} WHERE a.status = 'Bloqueada' ORDER BY a.updated_at`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapAssignment);
}

/**
 * Supervisión del tablero. El founder siempre; los demás por `users.is_supervisor`
 * (plano 07: John y Vale). Se consulta en la API para armar el ActorAsignacion.
 */
export function actorDesdeWallet(db: DB, wallet: string, isFounder: boolean): ActorAsignacion {
  const r = db.prepare(`SELECT is_supervisor FROM users WHERE wallet = ?`).get(wallet) as
    | { is_supervisor: number | null }
    | undefined;
  return { wallet, isFounder, isSupervisor: (r?.is_supervisor ?? 0) === 1 };
}

// ─── Seguimiento por cliente y proyecto ──────────────────────────────────
//
// Lo que faltaba para responder la pregunta que de verdad importa en el día a
// día: qué está atrasado y de quién es. El tablero por iniciativa no lo muestra
// porque ordena por prioridad, no por fecha, y la pantalla personal solo ve lo
// propio.

/** Todo lo que sigue vivo: abierto más el backlog sin tomar. */
export const ESTADOS_SEGUIMIENTO = ["Backlog", "Asignada", "En curso", "En revisión", "Bloqueada"] as const;

export type EstadoVencimiento = "atrasada" | "hoy" | "proxima" | "a_tiempo" | "sin_fecha";

export interface TareaSeguimiento extends AssignmentRow {
  vencimiento: EstadoVencimiento;
  /** Días hasta la fecha límite. Negativo si ya pasó. null si no tiene fecha. */
  diasRestantes: number | null;
}

export interface GrupoProyecto {
  initiativeId: number | null;
  initiativeName: string;
  tareas: TareaSeguimiento[];
  atrasadas: number;
}

export interface GrupoCliente {
  clientId: number | null;
  clientName: string;
  proyectos: GrupoProyecto[];
  total: number;
  atrasadas: number;
  venceHoy: number;
  sinFecha: number;
  sinResponsable: number;
}

const DIA_MS = 86_400_000;

/** Día de hoy en formato YYYY-MM-DD, el mismo que guarda la columna due_date. */
export function hoyISO(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 10);
}

export function clasificarVencimiento(
  dueDate: string | null,
  hoy: string
): { vencimiento: EstadoVencimiento; diasRestantes: number | null } {
  if (!dueDate) return { vencimiento: "sin_fecha", diasRestantes: null };
  const dias = Math.round((Date.parse(dueDate + "T00:00:00Z") - Date.parse(hoy + "T00:00:00Z")) / DIA_MS);
  if (Number.isNaN(dias)) return { vencimiento: "sin_fecha", diasRestantes: null };
  if (dias < 0) return { vencimiento: "atrasada", diasRestantes: dias };
  if (dias === 0) return { vencimiento: "hoy", diasRestantes: 0 };
  if (dias <= 7) return { vencimiento: "proxima", diasRestantes: dias };
  return { vencimiento: "a_tiempo", diasRestantes: dias };
}

/**
 * Trabajo abierto agrupado por cliente y, dentro de cada cliente, por proyecto.
 * El cliente con más tareas atrasadas aparece primero: la pantalla ordena por
 * urgencia real, no alfabéticamente.
 *
 * `hoy` se inyecta para poder probarlo sin depender del reloj de la máquina.
 */
export function seguimientoPorCliente(db: DB, hoy: string = hoyISO()): GrupoCliente[] {
  // Incluye Backlog a propósito: una tarea con fecha vencida que NADIE tomó es
  // el peor retraso que puede haber, y `ESTADOS_ABIERTOS` lo deja fuera porque
  // está pensado para la carga de cada persona, no para el seguimiento.
  const estados = ESTADOS_SEGUIMIENTO;
  const marks = estados.map(() => "?").join(",");
  const rows = db
    .prepare(
      `${SELECT_BASE} WHERE a.status IN (${marks})
        ORDER BY a.due_date IS NULL, a.due_date,
                 CASE a.priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END, a.id`
    )
    .all(...estados) as Array<Record<string, unknown>>;

  const porCliente = new Map<string, GrupoCliente>();

  for (const r of rows) {
    const base = mapAssignment(r);
    const tarea: TareaSeguimiento = { ...base, ...clasificarVencimiento(base.dueDate, hoy) };

    const claveCliente = String(base.clientId ?? "interno");
    let cliente = porCliente.get(claveCliente);
    if (!cliente) {
      cliente = {
        clientId: base.clientId,
        clientName: base.clientName ?? "Trabajo interno",
        proyectos: [],
        total: 0,
        atrasadas: 0,
        venceHoy: 0,
        sinFecha: 0,
        sinResponsable: 0,
      };
      porCliente.set(claveCliente, cliente);
    }

    const claveProyecto = String(base.initiativeId ?? "sin-proyecto");
    let proyecto = cliente.proyectos.find((p) => String(p.initiativeId ?? "sin-proyecto") === claveProyecto);
    if (!proyecto) {
      proyecto = {
        initiativeId: base.initiativeId,
        initiativeName: base.initiativeName ?? "Sin proyecto",
        tareas: [],
        atrasadas: 0,
      };
      cliente.proyectos.push(proyecto);
    }

    proyecto.tareas.push(tarea);
    cliente.total++;
    if (tarea.vencimiento === "atrasada") {
      cliente.atrasadas++;
      proyecto.atrasadas++;
    }
    if (tarea.vencimiento === "hoy") cliente.venceHoy++;
    if (tarea.vencimiento === "sin_fecha") cliente.sinFecha++;
    if (!tarea.ownerWallet) cliente.sinResponsable++;
  }

  const grupos = [...porCliente.values()];
  for (const c of grupos) c.proyectos.sort((a, b) => b.atrasadas - a.atrasadas || a.initiativeName.localeCompare(b.initiativeName));
  grupos.sort((a, b) => b.atrasadas - a.atrasadas || b.venceHoy - a.venceHoy || a.clientName.localeCompare(b.clientName));
  return grupos;
}

/** Resumen de una línea para encabezar la pantalla. */
export function resumenSeguimiento(grupos: GrupoCliente[]) {
  return grupos.reduce(
    (acc, g) => ({
      clientes: acc.clientes + 1,
      total: acc.total + g.total,
      atrasadas: acc.atrasadas + g.atrasadas,
      venceHoy: acc.venceHoy + g.venceHoy,
      sinFecha: acc.sinFecha + g.sinFecha,
      sinResponsable: acc.sinResponsable + g.sinResponsable,
    }),
    { clientes: 0, total: 0, atrasadas: 0, venceHoy: 0, sinFecha: 0, sinResponsable: 0 }
  );
}
