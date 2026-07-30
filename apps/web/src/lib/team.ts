/**
 * Módulo equipo (WP14): iniciativas, asignaciones y check-in diario.
 *
 * Reglas que este archivo hace cumplir:
 *  - Los cambios de estado SIEMPRE pasan por la función pura de
 *    lib/team-state-machine.ts. Aquí no se escribe `status` a mano nunca.
 *  - La visibilidad (quién ve qué) sale de `puedeVerTodoElEquipo` de lib/roles.ts.
 *    WP15 y WP19 deben reusar esa función, no reimplementarla.
 *  - Nada de saldos mutables: los agregados se derivan con COUNT()/SUM() sobre las
 *    tablas, y `assignment_events` es append-only.
 *  - Doc 16: se califican ENTREGAS. Ningún agregado de este archivo puntúa personas;
 *    la carga por persona existe para repartir trabajo, no para rankear.
 *
 * Todas las funciones reciben la `DB` explícitamente para poder testearlas con una
 * base en memoria (mismo patrón que lib/onboard.ts y lib/academia.ts).
 */
import { z } from "zod";
import type { DB } from "./db";
import {
  TEAM_ACTIONS,
  isTeamStatus,
  teamTransition,
  type TeamAction,
  type TeamStatus,
  OPEN_STATUSES,
} from "./team-state-machine.ts";
import {
  TEAM_ROSTER,
  effectiveIsSupervisor,
  effectiveRole,
  pendingPrincipal,
  puedeVerTodoElEquipo,
  type Role,
  type TeamActor,
} from "./roles.ts";

// ---------------------------------------------------------------------------
// Vocabularios
// ---------------------------------------------------------------------------

/** Horizonte de una iniciativa. `Después` del CSV de John se mapea a `Parqueado`. */
export const HORIZONS = ["Ahora", "Siguiente", "Parqueado"] as const;
export type Horizon = (typeof HORIZONS)[number];

export function isHorizon(v: unknown): v is Horizon {
  return typeof v === "string" && (HORIZONS as readonly string[]).includes(v);
}

/** Prioridades, de la más urgente a la menos. Es un vocabulario, no un parámetro
 *  evolutivo del sistema: no va al genoma (el genoma versiona números que mutan). */
export const PRIORITIES = ["Urgent", "High", "Normal", "Low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export function isPriority(v: unknown): v is Priority {
  return typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  Urgent: "Urgente",
  High: "Alta",
  Normal: "Normal",
  Low: "Baja",
};

/** Orden de urgencia (0 = primero). Usado por el ORDER BY de "hoy". */
export const PRIORITY_RANK: Record<Priority, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

/** Urgencia relativa de los horizontes: una iniciativa toma el más urgente de sus filas. */
const HORIZON_RANK: Record<Horizon, number> = { Ahora: 0, Siguiente: 1, Parqueado: 2 };

export const SIZES = ["S", "M", "L"] as const;
export type Size = (typeof SIZES)[number];

// ---------------------------------------------------------------------------
// Fechas (hechos de calendario, no parámetros del sistema)
// ---------------------------------------------------------------------------

/** Día local en formato YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Lunes de la semana ISO a la que pertenece `now` (YYYY-MM-DD). "Cerradas esta
 * semana" se define contra el calendario, no contra un número configurable, así
 * que no hay parámetro nuevo que versionar en el genoma.
 */
export function weekStart(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  return today(d);
}

/** Lunes de la semana anterior (para la auto-comparación de "Tu progreso"). */
export function prevWeekStart(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow - 7);
  return today(d);
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export interface InitiativeRow {
  id: number;
  slug: string;
  name: string;
  horizon: Horizon;
  created_at: string;
}

export interface AssignmentRow {
  id: number;
  title: string;
  description: string;
  initiative_id: number | null;
  owner_wallet: string | null;
  status: TeamStatus;
  status_before_block: TeamStatus | null;
  priority: Priority;
  size: Size | null;
  horizon: Horizon;
  due_date: string | null;
  acceptance_criteria: string;
  spec_url: string | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  needs_founder: number;
  published_as_project_id: number | null;
  created_by: string | null;
  import_key: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface AssignmentView extends AssignmentRow {
  initiative_name: string | null;
  initiative_horizon: Horizon | null;
  owner_name: string | null;
}

export interface CheckinRow {
  id: number;
  wallet: string;
  day: string;
  done: string;
  doing: string;
  blocked: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class TeamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TeamError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Semilla idempotente del roster y de las iniciativas reales
// ---------------------------------------------------------------------------

export function slugify(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Siembra los 6 del roster con su principal `pending:<slug>`. IDEMPOTENTE: se puede
 * llamar en cada arranque. No escribe correos ni ningún dato personal; la identidad
 * real (correo @zelena.tech, wallet) la vincula WP13.
 *
 * También deriva role/is_supervisor de `is_founder` para las filas que ya existían
 * antes de WP14, para no cambiar el significado de ninguna de ellas.
 */
export function seedTeamRoster(db: DB): void {
  const ins = db.prepare(
    `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor)
     VALUES (?, ?, 'Bronze', NULL, 'active', 0, 0, 0, ?, ?)`
  );
  const upd = db.prepare(`UPDATE users SET role = ?, is_supervisor = ? WHERE wallet = ?`);
  const exists = db.prepare(`SELECT wallet FROM users WHERE wallet = ?`);
  for (const m of TEAM_ROSTER) {
    const principal = pendingPrincipal(m.slug);
    if (exists.get(principal)) {
      upd.run(m.role, m.isSupervisor ? 1 : 0, principal);
    } else {
      ins.run(principal, m.name, m.role, m.isSupervisor ? 1 : 0);
    }
  }
  // Retrocompatibilidad: el founder ya existente pasa a role='founder' + supervisor.
  db.prepare(`UPDATE users SET role = 'founder', is_supervisor = 1 WHERE is_founder = 1`).run();
}

/** Iniciativas reales de los CSV de John (plano 07). Idempotente. */
const SEED_INITIATIVES: Array<{ name: string; horizon: Horizon }> = [
  { name: "WMS", horizon: "Ahora" },
  { name: "Sistema Operativo", horizon: "Ahora" },
  { name: "DAO", horizon: "Ahora" },
  { name: "Harmony", horizon: "Siguiente" },
  { name: "Productos Nuevos", horizon: "Siguiente" },
  { name: "DAO / Freelancers", horizon: "Siguiente" },
];

export function seedInitiatives(db: DB): void {
  for (const i of SEED_INITIATIVES) upsertInitiative(db, i.name, i.horizon);
}

/** Roster + iniciativas. Es lo que llama lib/seed.ts en cada arranque. */
export function seedTeam(db: DB): void {
  seedTeamRoster(db);
  seedInitiatives(db);
}

// ---------------------------------------------------------------------------
// Iniciativas
// ---------------------------------------------------------------------------

/**
 * Crea la iniciativa si no existe (por slug) y devuelve su id. Si existe, NO
 * sobreescribe el nombre; el horizonte solo se hace MÁS urgente (una iniciativa con
 * trabajo "Ahora" no puede quedar marcada como "Parqueado" por otra fila del CSV).
 */
export function upsertInitiative(db: DB, name: string, horizon: Horizon = "Ahora"): number {
  const slug = slugify(name);
  if (!slug) throw new TeamError(400, "La iniciativa necesita un nombre.");
  const row = db.prepare(`SELECT id, horizon FROM initiatives WHERE slug = ?`).get(slug) as
    | { id: number; horizon: Horizon }
    | undefined;
  if (row) {
    if (HORIZON_RANK[horizon] < HORIZON_RANK[row.horizon]) {
      db.prepare(`UPDATE initiatives SET horizon = ? WHERE id = ?`).run(horizon, row.id);
    }
    return row.id;
  }
  const info = db
    .prepare(`INSERT INTO initiatives (slug, name, horizon) VALUES (?, ?, ?)`)
    .run(slug, name.trim(), horizon);
  return Number(info.lastInsertRowid);
}

export function listInitiatives(db: DB, horizon?: Horizon): InitiativeRow[] {
  const where = horizon ? `WHERE horizon = ?` : "";
  const params = horizon ? [horizon] : [];
  return db
    .prepare(`SELECT * FROM initiatives ${where} ORDER BY name`)
    .all(...params) as InitiativeRow[];
}

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

export interface CreateAssignmentInput {
  title: string;
  description?: string;
  initiativeId?: number | null;
  ownerWallet?: string | null;
  status?: TeamStatus;
  priority?: Priority;
  size?: Size | null;
  horizon?: Horizon;
  dueDate?: string | null;
  acceptanceCriteria?: string;
  specUrl?: string | null;
  needsFounder?: boolean;
  publishedAsProjectId?: number | null;
  createdBy?: string | null;
  importKey?: string | null;
}

export function createAssignment(db: DB, input: CreateAssignmentInput): number {
  const title = input.title.trim();
  if (!title) throw new TeamError(400, "La asignación necesita un título.");
  const status: TeamStatus = input.status ?? "Backlog";
  const info = db
    .prepare(
      `INSERT INTO assignments
         (title, description, initiative_id, owner_wallet, status, priority, size, horizon,
          due_date, acceptance_criteria, spec_url, needs_founder, published_as_project_id,
          created_by, import_key, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description?.trim() ?? "",
      input.initiativeId ?? null,
      input.ownerWallet ?? null,
      status,
      input.priority ?? "Normal",
      input.size ?? null,
      input.horizon ?? "Ahora",
      input.dueDate ?? null,
      input.acceptanceCriteria?.trim() ?? "",
      input.specUrl ?? null,
      input.needsFounder ? 1 : 0,
      input.publishedAsProjectId ?? null,
      input.createdBy ?? null,
      input.importKey ?? null,
      status === "Hecha" ? new Date().toISOString() : null
    );
  return Number(info.lastInsertRowid);
}

export function getAssignment(db: DB, id: number): AssignmentRow | undefined {
  return db.prepare(`SELECT * FROM assignments WHERE id = ?`).get(id) as AssignmentRow | undefined;
}

const VIEW_SELECT = `
  SELECT a.*, i.name AS initiative_name, i.horizon AS initiative_horizon, u.display_name AS owner_name
    FROM assignments a
    LEFT JOIN initiatives i ON i.id = a.initiative_id
    LEFT JOIN users u ON u.wallet = a.owner_wallet`;

/** ORDER BY de "hoy": prioridad primero, luego vencimiento (sin fecha va al final). */
const TODAY_ORDER = `
  ORDER BY CASE a.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,
           CASE WHEN a.due_date IS NULL OR a.due_date = '' THEN 1 ELSE 0 END,
           a.due_date,
           a.id`;

const OPEN_LIST = OPEN_STATUSES.map((s) => `'${s}'`).join(",");

/**
 * Asignaciones de hoy de una persona: todo lo que sigue abierto o bloqueado
 * (Hecha no aparece; el trabajo cerrado ya no pide acción).
 */
export function assignmentsForOwner(db: DB, wallet: string): AssignmentView[] {
  return db
    .prepare(
      `${VIEW_SELECT} WHERE a.owner_wallet = ? AND a.status IN (${OPEN_LIST},'Bloqueada') ${TODAY_ORDER}`
    )
    .all(wallet) as AssignmentView[];
}

/** Todo el trabajo abierto o bloqueado del equipo (founder y supervisores). */
export function assignmentsForAllTeam(db: DB): AssignmentView[] {
  return db
    .prepare(`${VIEW_SELECT} WHERE a.status IN (${OPEN_LIST},'Bloqueada') ${TODAY_ORDER}`)
    .all() as AssignmentView[];
}

/**
 * Criterio 2 de WP14: un `core`/`contributor` ve SOLO lo suyo; founder y supervisor
 * ven todo. Punto ÚNICO de la regla — WP15 y WP19 llaman aquí.
 */
export function visibleAssignments(db: DB, actor: TeamActor): AssignmentView[] {
  return puedeVerTodoElEquipo(actor) ? assignmentsForAllTeam(db) : assignmentsForOwner(db, actor.wallet);
}

export function listBlocked(db: DB): AssignmentView[] {
  return db
    .prepare(`${VIEW_SELECT} WHERE a.status = 'Bloqueada' ORDER BY a.blocked_at, a.id`)
    .all() as AssignmentView[];
}

/** Bandeja de gates de John: lo que espera una decisión suya (WP15). */
export function listNeedsFounder(db: DB): AssignmentView[] {
  return db
    .prepare(`${VIEW_SELECT} WHERE a.needs_founder = 1 AND a.status <> 'Hecha' ${TODAY_ORDER}`)
    .all() as AssignmentView[];
}

export interface InitiativeSummary {
  initiative: InitiativeRow | null;
  open: AssignmentView[];
  blocked: AssignmentView[];
  closedThisWeek: AssignmentView[];
  /** Responsables con trabajo abierto o bloqueado en la iniciativa. */
  owners: Array<{ wallet: string; name: string; openCount: number }>;
}

/**
 * Vista `/equipo/proyectos`: por iniciativa — abiertas, bloqueadas, cerradas esta
 * semana y responsables. Con filtro opcional por horizonte.
 *
 * El filtro se aplica al horizonte de la ASIGNACIÓN, no al de la iniciativa. Es una
 * decisión con dato real detrás: en los CSV del equipo una misma iniciativa tiene
 * filas en horizontes distintos (p. ej. "Productos Nuevos" con trabajo `Siguiente`
 * y `Parqueado`). Si se filtrara por el horizonte de la iniciativa, pedir
 * "Parqueado" no devolvería nada aunque haya trabajo parqueado. La iniciativa
 * conserva su propio horizonte (el más urgente de sus filas) como etiqueta.
 */
export function assignmentsByInitiative(
  db: DB,
  opts: { horizon?: Horizon; now?: Date } = {}
): InitiativeSummary[] {
  const week = weekStart(opts.now);
  const all = db.prepare(`${VIEW_SELECT} ${TODAY_ORDER}`).all() as AssignmentView[];
  const rows = opts.horizon ? all.filter((r) => r.horizon === opts.horizon) : all;

  const summaries: InitiativeSummary[] = listInitiatives(db).map((i) => buildSummary(i, rows, week));
  // Trabajo sin iniciativa: no se esconde nunca.
  if (rows.some((r) => r.initiative_id === null)) summaries.push(buildSummary(null, rows, week));
  return summaries;
}

function buildSummary(
  initiative: InitiativeRow | null,
  rows: AssignmentView[],
  week: string
): InitiativeSummary {
  const mine = rows.filter((r) => r.initiative_id === (initiative ? initiative.id : null));
  const open = mine.filter((r) => OPEN_STATUSES.includes(r.status));
  const blocked = mine.filter((r) => r.status === "Bloqueada");
  const closedThisWeek = mine.filter(
    (r) => r.status === "Hecha" && !!r.closed_at && r.closed_at.slice(0, 10) >= week
  );
  const byOwner = new Map<string, { wallet: string; name: string; openCount: number }>();
  for (const r of [...open, ...blocked]) {
    if (!r.owner_wallet) continue;
    const cur = byOwner.get(r.owner_wallet);
    if (cur) cur.openCount++;
    else
      byOwner.set(r.owner_wallet, {
        wallet: r.owner_wallet,
        name: r.owner_name ?? r.owner_wallet,
        openCount: 1,
      });
  }
  return {
    initiative,
    open,
    blocked,
    closedThisWeek,
    owners: [...byOwner.values()].sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}

// ---------------------------------------------------------------------------
// Transiciones de estado
// ---------------------------------------------------------------------------

export interface ApplyActionInput {
  assignmentId: number;
  action: TeamAction;
  reason?: string | null;
  actor: TeamActor;
  now?: Date;
}

/**
 * Aplica una acción sobre una asignación:
 *  1. autoriza (dueño, founder o supervisor),
 *  2. delega el cálculo del estado a la función PURA de la máquina,
 *  3. persiste el resultado y añade un evento append-only.
 *
 * Nunca decide el estado por su cuenta.
 */
export function applyAssignmentAction(db: DB, input: ApplyActionInput): AssignmentRow {
  const row = getAssignment(db, input.assignmentId);
  if (!row) throw new TeamError(404, "Asignación no encontrada.");
  if (!isTeamStatus(row.status)) {
    throw new TeamError(500, `Estado desconocido en la asignación #${row.id}: '${row.status}'.`);
  }

  const isOwner = !!row.owner_wallet && row.owner_wallet === input.actor.wallet;
  const seesAll = puedeVerTodoElEquipo(input.actor);
  // `asignar` (tomar del Backlog) la puede hacer cualquiera del equipo si no hay dueño.
  const takingUnowned = input.action === "asignar" && !row.owner_wallet;
  if (!isOwner && !seesAll && !takingUnowned) {
    throw new TeamError(403, "Solo el responsable de la asignación (o un supervisor) puede moverla.");
  }

  const next = teamTransition(
    {
      status: row.status,
      statusBeforeBlock: isTeamStatus(row.status_before_block) ? row.status_before_block : null,
      blockedReason: row.blocked_reason,
    },
    input.action,
    input.reason
  );

  const now = input.now ?? new Date();
  const iso = now.toISOString();
  const day = today(now);
  // Tomar del Backlog sin dueño asigna el trabajo a quien lo toma.
  const owner = takingUnowned ? input.actor.wallet : row.owner_wallet;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE assignments
          SET status = ?, status_before_block = ?, blocked_reason = ?, blocked_at = ?,
              owner_wallet = ?, closed_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      next.status,
      next.statusBeforeBlock,
      next.blockedReason,
      next.status === "Bloqueada" ? (row.blocked_at ?? iso) : null,
      owner,
      next.status === "Hecha" ? (row.closed_at ?? iso) : null,
      iso,
      row.id
    );
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, reason, actor_wallet, day)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, input.action, row.status, next.status, next.blockedReason, input.actor.wallet, day);
  });
  tx();

  return getAssignment(db, row.id) as AssignmentRow;
}

/** Eventos de estado de un día (fuente del digest de WP15). */
export function assignmentEventsOfDay(db: DB, day: string) {
  return db
    .prepare(
      `SELECT e.*, a.title, u.display_name AS actor_name
         FROM assignment_events e
         JOIN assignments a ON a.id = e.assignment_id
         LEFT JOIN users u ON u.wallet = e.actor_wallet
        WHERE e.day = ? ORDER BY e.id`
    )
    .all(day) as Array<{
    id: number;
    assignment_id: number;
    action: TeamAction;
    from_status: TeamStatus;
    to_status: TeamStatus;
    reason: string | null;
    actor_wallet: string;
    day: string;
    created_at: string;
    title: string;
    actor_name: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Check-in diario
// ---------------------------------------------------------------------------

export interface CheckinInput {
  done: string;
  doing: string;
  blocked: string;
}

/**
 * Un check-in por persona por día, editable el mismo día (criterio 5 de WP14).
 * El UNIQUE(wallet, day) del esquema es el candado real; esto solo lo respeta.
 */
export function upsertCheckin(db: DB, wallet: string, input: CheckinInput, now: Date = new Date()): CheckinRow {
  const day = today(now);
  const done = input.done.trim();
  const doing = input.doing.trim();
  const blocked = input.blocked.trim();
  if (!done && !doing && !blocked) {
    throw new TeamError(400, "Escribe al menos uno de los tres campos del check-in.");
  }
  const iso = now.toISOString();
  const existing = getCheckin(db, wallet, day);
  if (existing) {
    db.prepare(`UPDATE checkins SET done = ?, doing = ?, blocked = ?, updated_at = ? WHERE id = ?`).run(
      done,
      doing,
      blocked,
      iso,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO checkins (wallet, day, done, doing, blocked) VALUES (?, ?, ?, ?, ?)`
    ).run(wallet, day, done, doing, blocked);
  }
  return getCheckin(db, wallet, day) as CheckinRow;
}

export function getCheckin(db: DB, wallet: string, day: string): CheckinRow | undefined {
  return db.prepare(`SELECT * FROM checkins WHERE wallet = ? AND day = ?`).get(wallet, day) as
    | CheckinRow
    | undefined;
}

/** Check-ins de un día, con el nombre de cada persona (digest de WP15). */
export function checkinsOfDay(db: DB, day: string) {
  return db
    .prepare(
      `SELECT c.*, u.display_name AS name FROM checkins c
         LEFT JOIN users u ON u.wallet = c.wallet
        WHERE c.day = ? ORDER BY u.display_name`
    )
    .all(day) as Array<CheckinRow & { name: string | null }>;
}

/** Nº de check-ins propios desde el lunes (salud del rito, sin telemetría de presencia). */
export function checkinsSince(db: DB, wallet: string, fromDay: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS n FROM checkins WHERE wallet = ? AND day >= ?`)
      .get(wallet, fromDay) as { n: number }
  ).n;
}

// ---------------------------------------------------------------------------
// "Tu progreso" — auto-comparación (regla WP09 / doc 16)
// ---------------------------------------------------------------------------

export interface OwnProgress {
  weekStart: string;
  /** Entregas cerradas contra su criterio de aceptación esta semana. */
  closedThisWeek: number;
  closedPrevWeek: number;
  delta: number;
  openNow: number;
  blockedNow: number;
  checkinsThisWeek: number;
  isFirstWeek: boolean;
}

/**
 * Progreso de una persona comparada CONSIGO MISMA (nunca con otras): entregas
 * cerradas esta semana vs la anterior. Solo cuenta hacia arriba: no existe ningún
 * camino por el que este bloque reste algo ya logrado.
 */
export function ownProgress(db: DB, wallet: string, now: Date = new Date()): OwnProgress {
  const week = weekStart(now);
  const prev = prevWeekStart(now);
  const closedBetween = (from: string, to?: string) => {
    const sql = to
      ? `SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ? AND status = 'Hecha'
           AND closed_at IS NOT NULL AND substr(closed_at,1,10) >= ? AND substr(closed_at,1,10) < ?`
      : `SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ? AND status = 'Hecha'
           AND closed_at IS NOT NULL AND substr(closed_at,1,10) >= ?`;
    const params = to ? [wallet, from, to] : [wallet, from];
    return (db.prepare(sql).get(...params) as { n: number }).n;
  };
  const closedThisWeek = closedBetween(week);
  const closedPrevWeek = closedBetween(prev, week);
  const openNow = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ? AND status IN (${OPEN_LIST})`
      )
      .get(wallet) as { n: number }
  ).n;
  const blockedNow = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ? AND status = 'Bloqueada'`)
      .get(wallet) as { n: number }
  ).n;
  const firstEvent = db
    .prepare(`SELECT MIN(day) AS d FROM assignment_events WHERE actor_wallet = ?`)
    .get(wallet) as { d: string | null };
  return {
    weekStart: week,
    closedThisWeek,
    closedPrevWeek,
    delta: closedThisWeek - closedPrevWeek,
    openNow,
    blockedNow,
    checkinsThisWeek: checkinsSince(db, wallet, week),
    isFirstWeek: !firstEvent.d || firstEvent.d >= week,
  };
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

/**
 * Resuelve el actor leyendo role/is_supervisor de la DB (fuente de verdad) y usando
 * los claims de la cookie solo como fallback. Así una cookie vieja o manipulada no
 * concede visibilidad de todo el equipo por sí sola.
 */
export function actorFromSession(
  db: DB,
  session: { wallet: string; name?: string; isFounder?: boolean; role?: string; isSupervisor?: boolean }
): TeamActor {
  const row = db
    .prepare(`SELECT display_name, role, is_supervisor, is_founder FROM users WHERE wallet = ?`)
    .get(session.wallet) as
    | { display_name: string; role: string; is_supervisor: number; is_founder: number }
    | undefined;
  if (row) {
    return {
      wallet: session.wallet,
      name: row.display_name,
      role: effectiveRole({ role: row.role, isFounder: !!row.is_founder }),
      isSupervisor: !!row.is_supervisor,
    };
  }
  const role: Role = effectiveRole(session);
  return {
    wallet: session.wallet,
    name: session.name ?? session.wallet,
    role,
    isSupervisor: effectiveIsSupervisor(session),
  };
}

/** Miembros del equipo con su rol (para selects y para el dashboard de WP15). */
export function listTeamMembers(db: DB) {
  return db
    .prepare(
      `SELECT wallet, display_name, role, is_supervisor FROM users
        WHERE role IN ('founder','core') ORDER BY role DESC, display_name`
    )
    .all() as Array<{ wallet: string; display_name: string; role: Role; is_supervisor: number }>;
}

// ---------------------------------------------------------------------------
// Validación de entrada (endpoints propios del módulo)
// ---------------------------------------------------------------------------

export const assignmentActionSchema = z.object({
  assignmentId: z.number().int().positive(),
  action: z.enum(TEAM_ACTIONS),
  reason: z.string().trim().max(500).optional(),
});

export const checkinSchema = z.object({
  done: z.string().trim().max(1000).default(""),
  doing: z.string().trim().max(1000).default(""),
  blocked: z.string().trim().max(1000).default(""),
});
