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
import type { EquipoActor } from "./authz";
import {
  TEAM_ACTIONS,
  TEAM_STATUSES,
  isTeamStatus,
  teamTransition,
  type TeamAction,
  type TeamStatus,
  OPEN_STATUSES,
} from "./team-state-machine.ts";
import {
  PENDING_PREFIX,
  ROLES_PROYECTO,
  SIN_PERMISOS,
  TEAM_ROSTER,
  effectiveIsSupervisor,
  effectiveRole,
  esEquipoInterno,
  esGlobalProyecto,
  isPendingPrincipal,
  isRolProyecto,
  isVinculo,
  normalizeName,
  pendingPrincipal,
  permisosEnProyecto,
  puedeTransicionar,
  puedeVerTodoElEquipo,
  rolesQuePuedeConceder,
  type PermisosProyecto,
  type Role,
  type RolProyecto,
  type TeamActor,
  type Vinculo,
} from "./roles.ts";
import { identidadesDe, mismaPersona } from "./identidades.ts";
import { diaLocal, instanteDb, parseInstanteDb } from "./zona-horaria.ts";
import { getActiveGenome } from "./genome.ts";

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
  /** WP17: cliente del proyecto (NULL = interno). Solo founder o supervisor lo cambian. */
  client_id: number | null;
  /** WP31: la descripción del proyecto (iniciativa = proyecto). */
  notes: string | null;
  created_at: string;
}

export interface AssignmentRow {
  id: number;
  title: string;
  description: string;
  initiative_id: number | null;
  /** WP17: cliente al que pertenece el trabajo (NULL = interno). */
  client_id: number | null;
  owner_wallet: string | null;
  status: TeamStatus;
  status_before_block: TeamStatus | null;
  priority: Priority;
  size: Size | null;
  horizon: Horizon;
  due_date: string | null;
  acceptance_criteria: string;
  spec_url: string | null;
  /** WP20: nodo del grafo de operación, por referencia (nunca por copia). */
  graph_node_id: string | null;
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
  /** WP17: cliente (opcional; sin él, trabajo interno). */
  clientId?: number | null;
  /** WP20: nodo del grafo (opcional, por referencia). */
  graphNodeId?: string | null;
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
         (title, description, initiative_id, client_id, owner_wallet, status, priority, size, horizon,
          due_date, acceptance_criteria, spec_url, graph_node_id, needs_founder, published_as_project_id,
          created_by, import_key, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      title,
      input.description?.trim() ?? "",
      input.initiativeId ?? null,
      input.clientId ?? null,
      input.ownerWallet ?? null,
      status,
      input.priority ?? "Normal",
      input.size ?? null,
      input.horizon ?? "Ahora",
      input.dueDate ?? null,
      input.acceptanceCriteria?.trim() ?? "",
      input.specUrl ?? null,
      input.graphNodeId ?? null,
      input.needsFounder ? 1 : 0,
      input.publishedAsProjectId ?? null,
      input.createdBy ?? null,
      input.importKey ?? null,
      status === "Hecha" ? new Date().toISOString() : null
    );
  return Number(info.lastInsertRowid);
}

/**
 * Alta desde la web, con la regla de quién puede asignarle trabajo a quién.
 *
 *  - Crear exige `permisosDe(...).crear` en el proyecto (o en "sin proyecto"). Para el
 *    equipo interno capturar lo propio no requiere más: si no, la gente vuelve a
 *    apuntarlo en una libreta. Un `contributor` crea SOLO dentro de sus proyectos.
 *  - Asignárselo a OTRA persona es de quien planifica el proyecto (founder,
 *    supervisor o rol `estructura`), y el destino tiene que ser del equipo interno o
 *    miembro del proyecto. Sin dueño o consigo mismo, adelante.
 *  - El tamaño lo fija quien planifica: si quien crea no planifica, `size` es null.
 *
 * La regla es por ROL, nunca por nombre: cuando entre otra persona a ese rol, hereda
 * la capacidad sin tocar código.
 */
export function createAssignmentAs(
  db: DB,
  actor: TeamActor,
  input: CreateAssignmentInput,
  now: Date = new Date()
): number {
  const initiativeId = input.initiativeId ?? null;
  if (initiativeId !== null && !getInitiative(db, initiativeId)) {
    throw new TeamError(400, "Ese proyecto no existe.");
  }
  const permisos = permisosDe(db, actor, initiativeId);
  if (!permisos.crear) {
    throw new TeamError(
      403,
      initiativeId === null && actor.role === "contributor"
        ? "Crea el trabajo dentro de uno de tus proyectos."
        : "No puedes crear trabajo en este proyecto."
    );
  }

  const destino = (input.ownerWallet ?? "").trim() || null;
  const paraOtro = destino !== null && !mismaPersona(db, destino, actor.wallet);
  if (paraOtro && !permisos.planificar) {
    throw new TeamError(403, "Solo quien planifica el proyecto puede asignarle trabajo a otra persona.");
  }
  if (destino) {
    const u = usuarioBasico(db, destino);
    if (!u) throw new TeamError(400, "Esa persona no está en el registro.");
    if (paraOtro) validarDestino(db, u, initiativeId);
  }
  if (input.clientId != null) {
    const cliente = db.prepare(`SELECT id FROM clients WHERE id = ?`).get(input.clientId);
    if (!cliente) throw new TeamError(400, "Ese cliente no existe.");
  }
  // Con dueño, la pieza nace 'Asignada'; sin dueño, al Backlog. Así el estado no
  // miente: nada aparece como asignado a nadie.
  const status: TeamStatus = destino ? "Asignada" : "Backlog";
  const size = permisos.planificar ? (input.size ?? null) : null;
  const day = today(now);
  let id = 0;
  const tx = db.transaction(() => {
    id = createAssignment(db, { ...input, initiativeId, size, ownerWallet: destino, status, createdBy: actor.wallet });
    // Evento append-only desde el minuto cero: la historia de la entrega empieza
    // aquí, y es lo que hace que el digest del día vea las piezas creadas hoy.
    // `from_status` es NOT NULL, así que el nacimiento se registra como Backlog→X.
    // `created_at` explícito (formato del default de SQLite): el `now` inyectado es
    // el que se guarda, y es el inicio del reloj del SLA.
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, reason, actor_wallet, day, created_at)
       VALUES (?, 'crear', 'Backlog', ?, NULL, ?, ?, ?)`
    ).run(id, status, actor.wallet, day, instanteDb(now));
  });
  tx();
  return id;
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

/**
 * WP17 · Trabajo abierto o bloqueado de UN cliente (pestaña Backlog de
 * `/clientes/[slug]`). Mismo SELECT y orden de "hoy" que el resto del módulo. La
 * autorización (equipo interno + `client_members`) la aplica la página antes.
 */
export function assignmentsForClient(db: DB, clientId: number): AssignmentView[] {
  return db
    .prepare(
      `${VIEW_SELECT} WHERE a.client_id = ? AND a.status IN (${OPEN_LIST},'Bloqueada') ${TODAY_ORDER}`
    )
    .all(clientId) as AssignmentView[];
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
 *  1. autoriza con `permisosDe` + `puedeTransicionar` (cuatro ojos: quien entrega no
 *     aprueba lo suyo —con cualquiera de sus identidades—, quien la envió a revisión
 *     tampoco, ni quien invitó al dueño o fue invitado por él, salvo el founder),
 *  2. delega el cálculo del estado a la función PURA de la máquina,
 *  3. persiste el resultado y añade un evento append-only con `created_at` = `now`.
 *
 * Nunca decide el estado por su cuenta.
 */
export function applyAssignmentAction(db: DB, input: ApplyActionInput): AssignmentRow {
  const row = getAssignment(db, input.assignmentId);
  if (!row) throw new TeamError(404, "Asignación no encontrada.");
  if (!isTeamStatus(row.status)) {
    throw new TeamError(500, `Estado desconocido en la asignación #${row.id}: '${row.status}'.`);
  }

  const flags = flagsDeTransicion(db, input.actor, row, input.action);
  const veredicto = puedeTransicionar({ accion: input.action, ...flags });
  if (!veredicto.ok) throw new TeamError(403, veredicto.motivo);
  // Tomar del Backlog una pieza sin dueño se la asigna a quien la toma.
  const takingUnowned = input.action === "asignar" && !row.owner_wallet;

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
  // El "qué falta" de una devolución vive en el evento (la máquina no lo guarda en la
  // fila: la pieza no está trabada, está en manos de quien la entrega).
  const motivoEvento =
    input.action === "devolver" ? (input.reason ?? "").trim() || null : next.blockedReason;

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
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, reason, actor_wallet, day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, input.action, row.status, next.status, motivoEvento, input.actor.wallet, day, instanteDb(now));
  });
  tx();

  return getAssignment(db, row.id) as AssignmentRow;
}

/**
 * Los flags de `puedeTransicionar` para esta pieza y este actor (spec WP31 §5.A.1):
 *  - `esDueno` = `mismaPersona(dueño, actor)`: las dos identidades del founder son una.
 *  - `esQuienEnvio` = las identidades del actor incluyen a quien hizo el último
 *    `enviar_a_revision`.
 *  - `vinculoInvitacion` (B8, en las dos direcciones) = el actor no es founder y el
 *    `invited_by` de alguna identidad del dueño es del actor, o al revés.
 *  - `duenoPendiente` = el dueño es un `pending:<slug>` cuyo slug no está vinculado.
 */
function flagsDeTransicion(
  db: DB,
  actor: TeamActor,
  row: AssignmentRow,
  accion: TeamAction
): Omit<Parameters<typeof puedeTransicionar>[0], "accion"> {
  const owner = row.owner_wallet;
  const permisos = permisosDe(db, actor, row.initiative_id);
  const esGlobal = esGlobalProyecto(actor);
  const esDueno = !!owner && mismaPersona(db, owner, actor.wallet);
  if (accion !== "aprobar" && accion !== "devolver") {
    return { esDueno, sinDueno: !owner, permisos, esGlobal };
  }

  const delActor = identidadesDe(db, actor.wallet);
  const envio = db
    .prepare(
      `SELECT actor_wallet FROM assignment_events
        WHERE assignment_id = ? AND action = 'enviar_a_revision' ORDER BY id DESC LIMIT 1`
    )
    .get(row.id) as { actor_wallet: string } | undefined;
  const esQuienEnvio = !!envio && delActor.includes(envio.actor_wallet);

  let vinculoInvitacion = false;
  if (owner && actor.role !== "founder") {
    const delDueno = identidadesDe(db, owner);
    const invitadoPor = (w: string) =>
      (db.prepare(`SELECT invited_by FROM users WHERE wallet = ?`).get(w) as { invited_by: string | null } | undefined)
        ?.invited_by ?? null;
    vinculoInvitacion =
      delDueno.some((w) => {
        const i = invitadoPor(w);
        return !!i && delActor.includes(i);
      }) ||
      delActor.some((w) => {
        const i = invitadoPor(w);
        return !!i && delDueno.includes(i);
      });
  }

  let duenoPendiente = false;
  if (owner && isPendingPrincipal(owner)) {
    const vinculado = db
      .prepare(`SELECT 1 AS x FROM roster_links WHERE slug = ?`)
      .get(owner.slice(PENDING_PREFIX.length));
    duenoPendiente = !vinculado;
  }

  return { esDueno, sinDueno: !owner, permisos, esQuienEnvio, vinculoInvitacion, duenoPendiente, esGlobal };
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

/**
 * Miembros ACTIVOS del equipo con su rol (para selects y para el dashboard de WP15).
 *
 * El filtro `status = 'active'` no es cosmético: de aquí derivan la carga por persona
 * y el DENOMINADOR de la salud de ritos. Sin él, quien se va de la organización sigue
 * contando como si le tocara hacer check-in, y el porcentaje del equipo baja para
 * siempre por alguien que ya no está.
 *
 * Salir del denominador NO borra nada: sus asignaciones, puntos e historial siguen
 * intactos (doc 16: jamás se confisca lo ganado). Sale de las métricas de lo activo,
 * no de la historia.
 *
 * `is_demo = 0` excluye al founder DEMO que crea `seed.ts`. Sin ese filtro esta
 * función devolvía 7 personas con John repetido (`pending:john` y la wallet demo),
 * lo que duplicaba su nombre en los desplegables de responsable y ponía el
 * denominador del rito en 7 en vez de 6. La causa de fondo —dos filas para el mismo
 * humano— es WP25; esto la contiene hasta que se unifique la identidad del founder.
 */
export function listTeamMembers(db: DB) {
  return db
    .prepare(
      `SELECT wallet, display_name, role, is_supervisor FROM users
        WHERE role IN ('founder','core') AND status = 'active' AND is_demo = 0
        ORDER BY role DESC, display_name`
    )
    .all() as Array<{ wallet: string; display_name: string; role: Role; is_supervisor: number }>;
}

// ---------------------------------------------------------------------------
// WP31 · Proyectos y membresías (iniciativa = proyecto)
// ---------------------------------------------------------------------------
//
// La membresía (`project_members`) define qué ve y qué puede hacer cada persona en un
// proyecto. Reglas que esta sección hace cumplir (spec WP31 §5.A.3):
//  - Sin acuerdo de contribución no hay primer trabajo: sumar a un `contributor` o con
//    vínculo `externo` exige `cla_signed = 1`.
//  - Nadie cambia sus propios roles (`mismaPersona`), y `estructura`/`revisa` (los
//    roles que dan revisión) solo los conceden el founder o un supervisor.
//  - Un proyecto de cliente solo lo ven el founder y quien participa
//    (`client_members` o `project_members`), igual que `/clientes`.
//  - Cada operación deja su línea en `talent_events` (append-only), que describe el
//    cambio y nunca juzga a la persona.

export interface ProjectMemberRow {
  id: number;
  initiative_id: number;
  wallet: string;
  rol_proyecto: RolProyecto;
  vinculo: Vinculo;
  added_by: string | null;
  created_at: string;
}

export interface MiembroProyecto extends ProjectMemberRow {
  display_name: string;
  role: Role;
}

/** Fila mínima de `users` que necesitan las reglas de esta sección. */
interface UsuarioBasico {
  wallet: string;
  display_name: string;
  role: Role;
  is_supervisor: number;
  status: string;
  is_demo: number;
  cla_signed: number;
  invited_by: string | null;
}

function usuarioBasico(db: DB, wallet: string): UsuarioBasico | undefined {
  const r = db
    .prepare(
      `SELECT wallet, display_name, role, is_supervisor, status, is_demo, cla_signed, invited_by, is_founder
         FROM users WHERE wallet = ?`
    )
    .get(wallet) as (Omit<UsuarioBasico, "role"> & { role: string; is_founder: number }) | undefined;
  if (!r) return undefined;
  return { ...r, role: effectiveRole({ role: r.role, isFounder: !!r.is_founder }) };
}

/** Activa, no demo y del equipo interno (founder, core o supervisión). */
function esInternoActivo(u: UsuarioBasico): boolean {
  return u.status === "active" && u.is_demo === 0 && esEquipoInterno({ role: u.role, isSupervisor: !!u.is_supervisor });
}

function marcas(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

function getInitiative(db: DB, id: number): InitiativeRow | undefined {
  return db.prepare(`SELECT * FROM initiatives WHERE id = ?`).get(id) as InitiativeRow | undefined;
}

function registrarTalento(
  db: DB,
  actor: TeamActor,
  e: { target?: string | null; initiativeId?: number | null; action: string; detail?: Record<string, unknown> }
): void {
  db.prepare(
    `INSERT INTO talent_events (actor_wallet, target_wallet, initiative_id, action, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(actor.wallet, e.target ?? null, e.initiativeId ?? null, e.action, e.detail ? JSON.stringify(e.detail) : null);
}

/**
 * Roles de una persona en un proyecto, sumando todas sus identidades (`identidadesDe`):
 * la fila de equipo `pending:<slug>` y la cuenta con la que entra cuentan como una.
 * En el orden canónico de `ROLES_PROYECTO`.
 */
export function rolesEnProyecto(db: DB, wallet: string, initiativeId: number): RolProyecto[] {
  const ids = identidadesDe(db, wallet);
  if (ids.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT DISTINCT rol_proyecto FROM project_members WHERE initiative_id = ? AND wallet IN (${marcas(ids.length)})`
    )
    .all(initiativeId, ...ids) as Array<{ rol_proyecto: string }>;
  return ROLES_PROYECTO.filter((r) => rows.some((x) => x.rol_proyecto === r));
}

/** Proyectos donde la persona tiene al menos un rol (todas sus identidades), con sus roles. */
export function membresiasDe(db: DB, wallet: string): Array<{ initiativeId: number; roles: RolProyecto[] }> {
  const ids = identidadesDe(db, wallet);
  if (ids.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT initiative_id, rol_proyecto FROM project_members WHERE wallet IN (${marcas(ids.length)})
        ORDER BY initiative_id, id`
    )
    .all(...ids) as Array<{ initiative_id: number; rol_proyecto: string }>;
  const por = new Map<number, Set<string>>();
  for (const r of rows) {
    const s = por.get(r.initiative_id) ?? new Set<string>();
    s.add(r.rol_proyecto);
    por.set(r.initiative_id, s);
  }
  return [...por.entries()].map(([initiativeId, s]) => ({
    initiativeId,
    roles: ROLES_PROYECTO.filter((r) => s.has(r)),
  }));
}

function esMiembroDe(db: DB, ids: string[], initiativeId: number): boolean {
  if (ids.length === 0) return false;
  return !!db
    .prepare(`SELECT 1 AS x FROM project_members WHERE initiative_id = ? AND wallet IN (${marcas(ids.length)})`)
    .get(initiativeId, ...ids);
}

/**
 * La regla de visibilidad de un proyecto, sobre cualquier actor (la exportada,
 * `puedeVerProyecto`, recibe el `EquipoActor` de la puerta):
 *  - founder: todo;
 *  - proyecto de cliente: `client_members` de ese cliente o `project_members` del proyecto;
 *  - proyecto interno: supervisor y core, sí; contributor, solo con membresía.
 */
function veIniciativa(db: DB, actor: TeamActor, ini: InitiativeRow): boolean {
  if (actor.role === "founder") return true;
  const ids = identidadesDe(db, actor.wallet);
  if (ini.client_id != null) {
    if (esMiembroDe(db, ids, ini.id)) return true;
    if (ids.length === 0) return false;
    return !!db
      .prepare(`SELECT 1 AS x FROM client_members WHERE client_id = ? AND wallet IN (${marcas(ids.length)})`)
      .get(ini.client_id, ...ids);
  }
  if (actor.isSupervisor || actor.role === "core") return true;
  return esMiembroDe(db, ids, ini.id);
}

export function puedeVerProyecto(db: DB, actor: EquipoActor, initiativeId: number): boolean {
  const ini = getInitiative(db, initiativeId);
  return !!ini && veIniciativa(db, actor, ini);
}

/**
 * Permisos del actor en un proyecto: la tabla de `permisosEnProyecto` (roles.ts) con
 * sus roles; todo en falso si no ve el proyecto. `initiativeId = null` (pieza sin
 * proyecto) son los permisos globales: founder y supervisor, todo; core,
 * `ver`/`crear`/`tomar`; contributor, nada.
 */
export function permisosDe(db: DB, actor: TeamActor, initiativeId: number | null): PermisosProyecto {
  if (initiativeId == null) return permisosEnProyecto(actor, []);
  const ini = getInitiative(db, initiativeId);
  if (!ini || !veIniciativa(db, actor, ini)) return { ...SIN_PERMISOS };
  return permisosEnProyecto(actor, rolesEnProyecto(db, actor.wallet, initiativeId));
}

/** Las filas de membresía del proyecto con nombre y rol global, por nombre. */
export function miembrosDeProyecto(db: DB, initiativeId: number): MiembroProyecto[] {
  const rows = db
    .prepare(
      `SELECT pm.*, u.display_name AS display_name, u.role AS role
         FROM project_members pm
         JOIN users u ON u.wallet = pm.wallet
        WHERE pm.initiative_id = ?
        ORDER BY pm.id`
    )
    .all(initiativeId) as MiembroProyecto[];
  return rows.sort(
    (a, b) =>
      a.display_name.localeCompare(b.display_name, "es") ||
      ROLES_PROYECTO.indexOf(a.rol_proyecto) - ROLES_PROYECTO.indexOf(b.rol_proyecto)
  );
}

/** Wallets con rol 'estructura' en el proyecto; si no hay, supervisores globales activos (no demo). */
export function supervisoresDeProyecto(db: DB, initiativeId: number | null): string[] {
  if (initiativeId != null) {
    const rows = db
      .prepare(
        `SELECT DISTINCT pm.wallet AS wallet
           FROM project_members pm
           JOIN users u ON u.wallet = pm.wallet
          WHERE pm.initiative_id = ? AND pm.rol_proyecto = 'estructura' AND u.status = 'active'
          ORDER BY pm.wallet`
      )
      .all(initiativeId) as Array<{ wallet: string }>;
    if (rows.length > 0) return rows.map((r) => r.wallet);
  }
  return (
    db
      .prepare(
        `SELECT wallet FROM users WHERE is_supervisor = 1 AND status = 'active' AND is_demo = 0 ORDER BY wallet`
      )
      .all() as Array<{ wallet: string }>
  ).map((r) => r.wallet);
}

const COPY_CONCEDER = "Puedes sumar a quien ejecuta o vende. Para revisar o estructurar, pídeselo a un supervisor.";
const COPY_SOBRE_SI = "Tus propios roles los cambia otra persona.";
const COPY_CLA = "Primero tiene que firmar el acuerdo de contribución.";
const COPY_REASIGNA = "Primero reasigna sus entregas abiertas en este proyecto.";

/** Comprobaciones comunes a sumar y quitar un rol: permiso, rol concedible y nunca sobre sí. */
function autorizarCambioDeRol(db: DB, actor: TeamActor, initiativeId: number, wallet: string, rol: unknown): RolProyecto {
  if (!getInitiative(db, initiativeId)) throw new TeamError(404, "Ese proyecto no existe.");
  if (!isRolProyecto(rol)) throw new TeamError(400, "Ese rol no existe en un proyecto.");
  if (!permisosDe(db, actor, initiativeId).planificar) {
    throw new TeamError(403, "Solo quien planifica el proyecto suma o quita personas.");
  }
  if (!wallet) throw new TeamError(400, "Falta la persona.");
  if (mismaPersona(db, actor.wallet, wallet)) throw new TeamError(403, COPY_SOBRE_SI);
  if (!rolesQuePuedeConceder(actor, rolesEnProyecto(db, actor.wallet, initiativeId)).includes(rol)) {
    throw new TeamError(403, COPY_CONCEDER);
  }
  return rol;
}

/**
 * Suma a una persona a un proyecto con un rol. Devuelve el id de la fila.
 * Vínculo por defecto: `externo` si `users.role = 'contributor'`, si no `interno`.
 */
export function agregarMiembro(
  db: DB,
  actor: TeamActor,
  input: { initiativeId: number; wallet: string; rol: RolProyecto; vinculo?: Vinculo }
): number {
  const wallet = (input.wallet ?? "").trim();
  const rol = autorizarCambioDeRol(db, actor, input.initiativeId, wallet, input.rol);
  if (input.vinculo !== undefined && !isVinculo(input.vinculo)) {
    throw new TeamError(400, "El vínculo es interno o externo.");
  }
  const u = usuarioBasico(db, wallet);
  if (!u || u.status !== "active" || u.is_demo !== 0) {
    throw new TeamError(400, "Esa persona no está activa en el registro.");
  }
  const vinculo: Vinculo = input.vinculo ?? (u.role === "contributor" ? "externo" : "interno");
  // Sin acuerdo de contribución no hay primer trabajo.
  if ((u.role === "contributor" || vinculo === "externo") && u.cla_signed !== 1) {
    throw new TeamError(409, COPY_CLA);
  }

  let id = 0;
  const tx = db.transaction(() => {
    const ya = db
      .prepare(`SELECT id FROM project_members WHERE initiative_id = ? AND wallet = ? AND rol_proyecto = ?`)
      .get(input.initiativeId, wallet, rol);
    if (ya) throw new TeamError(409, "Esa persona ya tiene ese rol en este proyecto.");
    const info = db
      .prepare(
        `INSERT INTO project_members (initiative_id, wallet, rol_proyecto, vinculo, added_by) VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.initiativeId, wallet, rol, vinculo, actor.wallet);
    id = Number(info.lastInsertRowid);
    registrarTalento(db, actor, {
      target: wallet,
      initiativeId: input.initiativeId,
      action: "miembro_alta",
      detail: { rol, vinculo },
    });
  });
  tx();
  return id;
}

/**
 * Quita un rol de una persona en un proyecto. Si con eso deja el proyecto y aún tiene
 * entregas abiertas o bloqueadas en él, 409: perdería el acceso a su trabajo.
 */
export function quitarMiembro(
  db: DB,
  actor: TeamActor,
  input: { initiativeId: number; wallet: string; rol: RolProyecto }
): void {
  const wallet = (input.wallet ?? "").trim();
  const rol = autorizarCambioDeRol(db, actor, input.initiativeId, wallet, input.rol);
  const tx = db.transaction(() => {
    const fila = db
      .prepare(`SELECT id FROM project_members WHERE initiative_id = ? AND wallet = ? AND rol_proyecto = ?`)
      .get(input.initiativeId, wallet, rol) as { id: number } | undefined;
    if (!fila) throw new TeamError(404, "Esa persona no tiene ese rol en este proyecto.");
    const otros = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM project_members WHERE initiative_id = ? AND wallet = ? AND rol_proyecto <> ?`
        )
        .get(input.initiativeId, wallet, rol) as { n: number }
    ).n;
    if (otros === 0) {
      const ids = identidadesDe(db, wallet);
      const abiertas = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM assignments
              WHERE initiative_id = ? AND owner_wallet IN (${marcas(ids.length)})
                AND status IN (${OPEN_LIST},'Bloqueada')`
          )
          .get(input.initiativeId, ...ids) as { n: number }
      ).n;
      if (abiertas > 0) throw new TeamError(409, COPY_REASIGNA);
    }
    db.prepare(`DELETE FROM project_members WHERE id = ?`).run(fila.id);
    registrarTalento(db, actor, {
      target: wallet,
      initiativeId: input.initiativeId,
      action: "miembro_baja",
      detail: { rol },
    });
  });
  tx();
}

const NOMBRE_PROYECTO_MIN = 2;
const NOMBRE_PROYECTO_MAX = 80;
const NOTAS_PROYECTO_MAX = 4000;

function validarNombreProyecto(raw: string): string {
  const name = (raw ?? "").trim();
  if (name.length < NOMBRE_PROYECTO_MIN || name.length > NOMBRE_PROYECTO_MAX) {
    throw new TeamError(400, `El nombre del proyecto va de ${NOMBRE_PROYECTO_MIN} a ${NOMBRE_PROYECTO_MAX} caracteres.`);
  }
  return name;
}

function validarNotas(raw: string | null | undefined): string | null {
  const notes = (raw ?? "").trim();
  if (notes.length > NOTAS_PROYECTO_MAX) throw new TeamError(400, "La descripción es demasiado larga.");
  return notes || null;
}

function validarCliente(db: DB, clientId: number | null): void {
  if (clientId === null) return;
  if (!db.prepare(`SELECT id FROM clients WHERE id = ?`).get(clientId)) {
    throw new TeamError(400, "Ese cliente no existe.");
  }
}

/** Crea un proyecto (founder o supervisor). El slug sale del nombre y no cambia después. */
export function crearProyecto(
  db: DB,
  actor: TeamActor,
  input: { name: string; horizon?: Horizon; notes?: string; clientId?: number | null }
): InitiativeRow {
  if (!esGlobalProyecto(actor)) throw new TeamError(403, "Solo el founder o un supervisor crean proyectos.");
  const name = validarNombreProyecto(input.name);
  const slug = slugify(name);
  if (!slug) throw new TeamError(400, "El nombre del proyecto necesita letras o números.");
  const horizon = input.horizon ?? "Ahora";
  if (!isHorizon(horizon)) throw new TeamError(400, "Horizonte inválido.");
  const notes = validarNotas(input.notes);
  const clientId = input.clientId ?? null;
  validarCliente(db, clientId);

  let id = 0;
  const tx = db.transaction(() => {
    if (db.prepare(`SELECT id FROM initiatives WHERE slug = ?`).get(slug)) {
      throw new TeamError(409, "Ya existe un proyecto con ese nombre.");
    }
    const info = db
      .prepare(`INSERT INTO initiatives (slug, name, horizon, client_id, notes) VALUES (?, ?, ?, ?, ?)`)
      .run(slug, name, horizon, clientId, notes);
    id = Number(info.lastInsertRowid);
    registrarTalento(db, actor, {
      initiativeId: id,
      action: "proyecto_crear",
      detail: { slug, conCliente: clientId !== null },
    });
  });
  tx();
  return getInitiative(db, id) as InitiativeRow;
}

/**
 * Edita un proyecto: founder, supervisor o `estructura` del proyecto. Nunca cambia el
 * `slug` (es la URL). El cliente asociado solo lo cambian el founder o un supervisor.
 */
export function editarProyecto(
  db: DB,
  actor: TeamActor,
  input: { initiativeId: number; name?: string; horizon?: Horizon; notes?: string | null; clientId?: number | null }
): InitiativeRow {
  const ini = getInitiative(db, input.initiativeId);
  if (!ini) throw new TeamError(404, "Ese proyecto no existe.");
  if (!permisosDe(db, actor, ini.id).planificar) {
    throw new TeamError(403, "Este proyecto lo editan el founder, un supervisor o quien lo estructura.");
  }
  const cambios: Record<string, string | number | null> = {};
  if (input.name !== undefined) {
    const name = validarNombreProyecto(input.name);
    if (name !== ini.name) cambios.name = name;
  }
  if (input.horizon !== undefined) {
    if (!isHorizon(input.horizon)) throw new TeamError(400, "Horizonte inválido.");
    if (input.horizon !== ini.horizon) cambios.horizon = input.horizon;
  }
  if (input.notes !== undefined) {
    const notes = validarNotas(input.notes);
    if (notes !== (ini.notes ?? null)) cambios.notes = notes;
  }
  if (input.clientId !== undefined) {
    const clientId = input.clientId ?? null;
    if (clientId !== (ini.client_id ?? null)) {
      if (!esGlobalProyecto(actor)) {
        throw new TeamError(403, "El cliente del proyecto lo cambian el founder o un supervisor.");
      }
      validarCliente(db, clientId);
      cambios.client_id = clientId;
    }
  }
  const campos = Object.keys(cambios);
  if (campos.length === 0) return ini;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE initiatives SET ${campos.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
      ...campos.map((c) => cambios[c]),
      ini.id
    );
    registrarTalento(db, actor, { initiativeId: ini.id, action: "proyecto_editar", detail: { campos } });
  });
  tx();
  return getInitiative(db, ini.id) as InitiativeRow;
}

export function getProyectoPorSlug(db: DB, slug: string): InitiativeRow | undefined {
  return db.prepare(`SELECT * FROM initiatives WHERE slug = ?`).get(slug) as InitiativeRow | undefined;
}

/** Proyectos que el actor puede ver, por nombre. Para el alcance `proyectos`, solo los suyos. */
export function proyectosVisibles(db: DB, actor: EquipoActor): InitiativeRow[] {
  return listInitiatives(db).filter((i) => veIniciativa(db, actor, i));
}

/**
 * Personas que el actor puede sumar o asignar en el proyecto (para los selects).
 *  - Founder/supervisor: activas no demo del equipo interno + contributors con CLA.
 *  - `estructura` sin ser founder/supervisor: el equipo interno y los miembros
 *    actuales; a un externo lo suma por su wallet exacta.
 *  - Quien no planifica el proyecto: nadie.
 */
export function candidatosParaProyecto(
  db: DB,
  actor: TeamActor,
  initiativeId: number
): Array<{ wallet: string; nombre: string; interno: boolean }> {
  if (!permisosDe(db, actor, initiativeId).planificar) return [];
  const out = new Map<string, { wallet: string; nombre: string; interno: boolean }>();
  const internos = db
    .prepare(
      `SELECT wallet, display_name FROM users
        WHERE status = 'active' AND is_demo = 0 AND (role IN ('founder','core') OR is_supervisor = 1)`
    )
    .all() as Array<{ wallet: string; display_name: string }>;
  for (const u of internos) out.set(u.wallet, { wallet: u.wallet, nombre: u.display_name, interno: true });

  if (esGlobalProyecto(actor)) {
    const externos = db
      .prepare(
        `SELECT wallet, display_name FROM users
          WHERE status = 'active' AND is_demo = 0 AND role = 'contributor' AND is_supervisor = 0 AND cla_signed = 1`
      )
      .all() as Array<{ wallet: string; display_name: string }>;
    for (const u of externos) {
      if (!out.has(u.wallet)) out.set(u.wallet, { wallet: u.wallet, nombre: u.display_name, interno: false });
    }
  } else {
    for (const m of miembrosDeProyecto(db, initiativeId)) {
      if (!out.has(m.wallet)) out.set(m.wallet, { wallet: m.wallet, nombre: m.display_name, interno: false });
    }
  }
  return [...out.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es") || a.wallet.localeCompare(b.wallet));
}

/**
 * ¿Puede `u` recibir trabajo en este proyecto? Del equipo interno (activo, no demo) o
 * miembro del proyecto. Lanza 400 con el paso a seguir si no.
 */
function validarDestino(db: DB, u: UsuarioBasico, initiativeId: number | null): void {
  if (u.status !== "active" || u.is_demo !== 0) {
    throw new TeamError(400, "Esa persona no está activa en el registro.");
  }
  if (esInternoActivo(u)) return;
  if (initiativeId !== null && esMiembroDe(db, identidadesDe(db, u.wallet), initiativeId)) return;
  throw new TeamError(400, "Primero súmale al proyecto.");
}

// ---------------------------------------------------------------------------
// WP31 · Tablero del proyecto y edición de entregas
// ---------------------------------------------------------------------------

export interface FiltrosTablero {
  owner?: string | "sin";
  priority?: Priority;
  size?: Size | "sin";
  horizon?: Horizon;
  vence?: "vencidas" | "semana";
  q?: string;
  /** Días de "Hecha" que se muestran; por defecto 14. */
  hechasDias?: number;
}

/** Nombre de cada filtro en la query string del tablero (render en servidor). */
export const PARAMS_TABLERO: Readonly<Record<keyof FiltrosTablero, string>> = {
  owner: "responsable",
  priority: "prioridad",
  size: "tamano",
  horizon: "horizonte",
  vence: "vence",
  q: "q",
  hechasDias: "hechas",
};

export const HECHAS_DIAS_POR_DEFECTO = 14;

function primero(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s.trim() : undefined;
}

/** Puro: de la query string a filtros válidos. Ignora lo que no es válido. */
export function parseFiltrosTablero(sp: Record<string, string | string[] | undefined>): FiltrosTablero {
  const f: FiltrosTablero = {};
  const owner = primero(sp[PARAMS_TABLERO.owner]);
  if (owner && owner.length <= 120) f.owner = owner;
  const priority = primero(sp[PARAMS_TABLERO.priority]);
  if (isPriority(priority)) f.priority = priority;
  const size = primero(sp[PARAMS_TABLERO.size]);
  if (size === "sin" || (SIZES as readonly string[]).includes(size ?? "")) f.size = size as Size | "sin";
  const horizon = primero(sp[PARAMS_TABLERO.horizon]);
  if (isHorizon(horizon)) f.horizon = horizon;
  const vence = primero(sp[PARAMS_TABLERO.vence]);
  if (vence === "vencidas" || vence === "semana") f.vence = vence;
  const q = primero(sp[PARAMS_TABLERO.q]);
  if (q) f.q = q.slice(0, 100);
  const hechas = primero(sp[PARAMS_TABLERO.hechasDias]);
  if (hechas && /^\d{1,3}$/.test(hechas)) {
    const n = Number(hechas);
    if (n >= 1 && n <= 365) f.hechasDias = n;
  }
  return f;
}

/** Las columnas vacías del tablero, en el orden de la máquina de estados. */
function columnasVacias(): Record<TeamStatus, AssignmentView[]> {
  return Object.fromEntries(TEAM_STATUSES.map((s) => [s, [] as AssignmentView[]])) as Record<
    TeamStatus,
    AssignmentView[]
  >;
}

/**
 * Tablero de un proyecto: sus piezas por columna de estado, con los filtros aplicados.
 * "Hecha" solo trae lo cerrado en los últimos `hechasDias` (14 por defecto). Las
 * fechas locales salen de la zona del genoma (`BUSINESS_TZ`), nunca del servidor.
 * No autoriza: la página comprueba `puedeVerProyecto` antes de llamar.
 */
export function tableroDeProyecto(
  db: DB,
  initiativeId: number,
  filtros: FiltrosTablero,
  now: Date = new Date()
): { columnas: Record<TeamStatus, AssignmentView[]>; total: number } {
  const tz = getActiveGenome(db).BUSINESS_TZ;
  const hoy = diaLocal(now, tz);
  const enUnaSemana = diaLocal(new Date(now.getTime() + 7 * 86_400_000), tz);
  const desdeHechas = now.getTime() - (filtros.hechasDias ?? HECHAS_DIAS_POR_DEFECTO) * 86_400_000;
  const q = filtros.q ? normalizeName(filtros.q) : "";

  const rows = db.prepare(`${VIEW_SELECT} WHERE a.initiative_id = ? ${TODAY_ORDER}`).all(initiativeId) as AssignmentView[];
  const columnas = columnasVacias();
  let total = 0;
  for (const a of rows) {
    if (!isTeamStatus(a.status)) continue;
    if (a.status === "Hecha") {
      const cierre = parseInstanteDb(a.closed_at ?? a.updated_at).getTime();
      if (!(cierre >= desdeHechas)) continue;
    }
    if (filtros.owner === "sin" ? a.owner_wallet !== null : filtros.owner && a.owner_wallet !== filtros.owner) continue;
    if (filtros.priority && a.priority !== filtros.priority) continue;
    if (filtros.size === "sin" ? a.size !== null : filtros.size && a.size !== filtros.size) continue;
    if (filtros.horizon && a.horizon !== filtros.horizon) continue;
    if (filtros.vence) {
      if (a.status === "Hecha" || !a.due_date) continue;
      if (filtros.vence === "vencidas" && !(a.due_date < hoy)) continue;
      if (filtros.vence === "semana" && !(a.due_date >= hoy && a.due_date <= enUnaSemana)) continue;
    }
    if (q) {
      const texto = normalizeName(`${a.title} ${a.description} ${a.acceptance_criteria}`);
      if (!texto.includes(q)) continue;
    }
    columnas[a.status].push(a);
    total++;
  }
  return { columnas, total };
}

export interface EditarAsignacionInput {
  assignmentId: number;
  // contexto (dueño o planificador)
  description?: string;
  specUrl?: string | null;
  // planificación (solo planificador del proyecto actual y, si cambia, del destino)
  title?: string;
  acceptanceCriteria?: string;
  priority?: Priority;
  size?: Size | null;
  horizon?: Horizon;
  dueDate?: string | null;
  initiativeId?: number | null;
  ownerWallet?: string | null;
  needsFounder?: boolean;
  /** Opcional, ≤ 300; va al evento. */
  motivo?: string;
}

/** Campos que quedan fijos mientras la entrega está En revisión (cuatro ojos). */
export const CAMPOS_FIJOS_EN_REVISION = ["ownerWallet", "size", "dueDate", "priority", "acceptanceCriteria"] as const;
const CAMPOS_CONTEXTO = ["description", "specUrl"] as const;

export const COPY_EN_REVISION = "Una entrega en revisión no se reasigna ni se replanifica: devuélvela primero.";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Un enlace de referencia solo puede ser http(s): se pinta como `href`. */
export function esEnlaceSeguro(v: string | null | undefined): boolean {
  return typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v.trim());
}

export const editarAsignacionSchema: z.ZodType<EditarAsignacionInput> = z.object({
  assignmentId: z.number().int().positive(),
  description: z.string().max(4000).optional(),
  specUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || esEnlaceSeguro(v), "El enlace debe empezar por https://")
    .nullable()
    .optional(),
  title: z.string().trim().min(1, "La entrega necesita un título.").max(200).optional(),
  acceptanceCriteria: z.string().max(4000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  size: z.enum(SIZES).nullable().optional(),
  horizon: z.enum(HORIZONS).optional(),
  dueDate: z
    .string()
    .refine((v) => v === "" || FECHA_RE.test(v), "La fecha debe ser AAAA-MM-DD.")
    .nullable()
    .optional(),
  initiativeId: z.number().int().positive().nullable().optional(),
  ownerWallet: z.string().trim().max(120).nullable().optional(),
  needsFounder: z.boolean().optional(),
  motivo: z.string().trim().max(300).optional(),
});

/**
 * Edita una entrega (spec WP31 §5.A.4). Solo cuenta lo que CAMBIA de verdad: un
 * formulario que reenvía un campo igual no pide permiso para él.
 *  - `Hecha` no se edita (409).
 *  - `En revisión`: responsable, tamaño, fecha, prioridad y criterio quedan fijos (409).
 *    Así nadie se queda con los puntos de otra persona, ni se fabrica o se quita el
 *    bono, ni se infla el tamaño después de entregar.
 *  - El dueño solo cambia el contexto (`description`, `specUrl`); el resto es de quien
 *    planifica el proyecto (y, si la pieza cambia de proyecto, también del destino).
 *  - Un responsable nuevo es del equipo interno o miembro del proyecto (400 si no);
 *    `null` solo en Backlog. Una pieza en Backlog que recibe dueño pasa a Asignada
 *    por la máquina de estados (`asignar`).
 *  - Un evento por llamada (`asignar`, `reasignar` o `editar`) con `created_at` = `now`;
 *    su motivo es el que se escribió o la lista de campos cambiados (nunca valores).
 */
export function editarAsignacion(
  db: DB,
  actor: TeamActor,
  input: EditarAsignacionInput,
  now: Date = new Date()
): AssignmentRow {
  const row = getAssignment(db, input.assignmentId);
  if (!row) throw new TeamError(404, "Asignación no encontrada.");
  if (!isTeamStatus(row.status)) {
    throw new TeamError(500, `Estado desconocido en la asignación #${row.id}: '${row.status}'.`);
  }
  const permisos = permisosDe(db, actor, row.initiative_id);
  const esDueno = !!row.owner_wallet && mismaPersona(db, row.owner_wallet, actor.wallet);
  // Quien no ve la pieza no sabe que existe.
  if (!permisos.ver && !esDueno) throw new TeamError(404, "Asignación no encontrada.");
  if (row.status === "Hecha") throw new TeamError(409, "Una entrega aprobada no se edita.");

  // 1. Lo que cambia de verdad, normalizado.
  const cambios: Partial<Record<keyof EditarAsignacionInput, unknown>> = {};
  if (input.description !== undefined && input.description.trim() !== row.description) {
    cambios.description = input.description.trim();
  }
  if (input.specUrl !== undefined) {
    const v = (input.specUrl ?? "").trim() || null;
    if (v !== null && !esEnlaceSeguro(v)) throw new TeamError(400, "El enlace debe empezar por https://");
    if (v !== row.spec_url) cambios.specUrl = v;
  }
  if (input.title !== undefined) {
    const v = input.title.trim();
    if (!v) throw new TeamError(400, "La entrega necesita un título.");
    if (v !== row.title) cambios.title = v;
  }
  if (input.acceptanceCriteria !== undefined && input.acceptanceCriteria.trim() !== row.acceptance_criteria) {
    cambios.acceptanceCriteria = input.acceptanceCriteria.trim();
  }
  if (input.priority !== undefined) {
    if (!isPriority(input.priority)) throw new TeamError(400, "Prioridad inválida.");
    if (input.priority !== row.priority) cambios.priority = input.priority;
  }
  if (input.size !== undefined) {
    const v = input.size ?? null;
    if (v !== null && !(SIZES as readonly string[]).includes(v)) throw new TeamError(400, "Tamaño inválido.");
    if (v !== row.size) cambios.size = v;
  }
  if (input.horizon !== undefined) {
    if (!isHorizon(input.horizon)) throw new TeamError(400, "Horizonte inválido.");
    if (input.horizon !== row.horizon) cambios.horizon = input.horizon;
  }
  if (input.dueDate !== undefined) {
    const v = (input.dueDate ?? "").trim() || null;
    if (v !== null && !FECHA_RE.test(v)) throw new TeamError(400, "La fecha debe ser AAAA-MM-DD.");
    if (v !== row.due_date) cambios.dueDate = v;
  }
  if (input.initiativeId !== undefined) {
    const v = input.initiativeId ?? null;
    if (v !== row.initiative_id) cambios.initiativeId = v;
  }
  if (input.ownerWallet !== undefined) {
    const v = (input.ownerWallet ?? "").trim() || null;
    if (v !== row.owner_wallet) cambios.ownerWallet = v;
  }
  if (input.needsFounder !== undefined && (input.needsFounder ? 1 : 0) !== row.needs_founder) {
    cambios.needsFounder = !!input.needsFounder;
  }
  const campos = Object.keys(cambios) as Array<keyof EditarAsignacionInput>;
  if (campos.length === 0) return row;

  // 2. En revisión, lo que define la entrega queda fijo hasta que se devuelva o se apruebe.
  if (row.status === "En revisión" && campos.some((c) => (CAMPOS_FIJOS_EN_REVISION as readonly string[]).includes(c))) {
    throw new TeamError(409, COPY_EN_REVISION);
  }

  // 3. Permisos por clase de campo.
  const deContexto = campos.filter((c) => (CAMPOS_CONTEXTO as readonly string[]).includes(c));
  const dePlan = campos.filter((c) => !(CAMPOS_CONTEXTO as readonly string[]).includes(c));
  if (deContexto.length > 0 && !(esDueno || permisos.planificar)) {
    throw new TeamError(403, "El contexto lo cambia quien tiene la pieza a cargo o quien planifica el proyecto.");
  }
  if (dePlan.length > 0 && !permisos.planificar) {
    throw new TeamError(
      403,
      esDueno
        ? "Eso lo cambia quien planifica el proyecto. Tú puedes cambiar el contexto y el enlace de referencia."
        : "Eso lo cambia quien planifica el proyecto."
    );
  }

  // 4. Cambio de proyecto: también hay que planificar en el destino.
  const destino = "initiativeId" in cambios ? (cambios.initiativeId as number | null) : row.initiative_id;
  if ("initiativeId" in cambios) {
    if (destino === null) {
      if (!esGlobalProyecto(actor)) {
        throw new TeamError(403, "Solo el founder o un supervisor dejan una pieza sin proyecto.");
      }
    } else {
      if (!getInitiative(db, destino)) throw new TeamError(400, "Ese proyecto no existe.");
      if (!permisosDe(db, actor, destino).planificar) {
        throw new TeamError(403, "Para mover la pieza a otro proyecto también tienes que planificar en el destino.");
      }
    }
  }

  // 5. Responsable nuevo (o el de siempre, si la pieza cambia de proyecto: tiene que
  //    poder trabajar en el destino).
  let status: TeamStatus = row.status;
  let accion: "asignar" | "reasignar" | "editar" = "editar";
  if ("initiativeId" in cambios && !("ownerWallet" in cambios) && row.owner_wallet) {
    const actual = usuarioBasico(db, row.owner_wallet);
    if (actual) validarDestino(db, actual, destino);
  }
  if ("ownerWallet" in cambios) {
    const nuevo = cambios.ownerWallet as string | null;
    if (nuevo === null) {
      if (row.status !== "Backlog") {
        throw new TeamError(409, "Solo una pieza en Backlog puede quedar sin responsable.");
      }
      accion = "reasignar";
    } else {
      const u = usuarioBasico(db, nuevo);
      if (!u) throw new TeamError(400, "Esa persona no está en el registro.");
      validarDestino(db, u, destino);
      if (row.status === "Backlog") {
        // Recibir dueño en Backlog es la transición `asignar` de la máquina, no un atajo.
        status = teamTransition(
          { status: row.status, statusBeforeBlock: null, blockedReason: row.blocked_reason },
          "asignar"
        ).status;
        accion = "asignar";
      } else {
        accion = "reasignar";
      }
    }
  }

  // 6. Persistir: UPDATE de lo que cambió + un evento.
  const COLUMNA: Record<string, string> = {
    description: "description",
    specUrl: "spec_url",
    title: "title",
    acceptanceCriteria: "acceptance_criteria",
    priority: "priority",
    size: "size",
    horizon: "horizon",
    dueDate: "due_date",
    initiativeId: "initiative_id",
    ownerWallet: "owner_wallet",
    needsFounder: "needs_founder",
  };
  const sets = campos.map((c) => `${COLUMNA[c]} = ?`);
  const valores = campos.map((c) => (c === "needsFounder" ? (cambios[c] ? 1 : 0) : cambios[c])) as Array<
    string | number | null
  >;
  const motivo = (input.motivo ?? "").trim().slice(0, 300);
  const reason = motivo || `campos: ${campos.join(", ")}`;

  const tx = db.transaction(() => {
    db.prepare(`UPDATE assignments SET ${sets.join(", ")}, status = ?, updated_at = ? WHERE id = ?`).run(
      ...valores,
      status,
      now.toISOString(),
      row.id
    );
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, reason, actor_wallet, day, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, accion, row.status, status, reason, actor.wallet, today(now), instanteDb(now));
  });
  tx();
  return getAssignment(db, row.id) as AssignmentRow;
}

// ---------------------------------------------------------------------------
// Validación de entrada (endpoints propios del módulo)
// ---------------------------------------------------------------------------

export const assignmentActionSchema = z.object({
  assignmentId: z.number().int().positive(),
  action: z.enum(TEAM_ACTIONS),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Alta de una asignación desde la web.
 *
 * Los campos opcionales se omiten en vez de exigir vacíos: crear una tarea en 5
 * segundos durante una reunión es el caso que importa; el detalle se completa
 * después. Solo el título es obligatorio.
 */
export const createAssignmentSchema = z.object({
  title: z.string().trim().min(1, "La asignación necesita un título.").max(200),
  description: z.string().max(4000).optional(),
  initiativeId: z.coerce.number().int().positive().nullable().optional(),
  clientId: z.coerce.number().int().positive().nullable().optional(),
  graphNodeId: z.string().trim().max(200).nullable().optional(),
  ownerWallet: z.string().trim().max(120).nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  size: z.enum(SIZES).nullable().optional(),
  horizon: z.enum(HORIZONS).optional(),
  // `YYYY-MM-DD` o vacío. No se acepta texto libre: alimenta el orden del día.
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe ser AAAA-MM-DD.")
    .nullable()
    .optional(),
  acceptanceCriteria: z.string().max(4000).optional(),
  specUrl: z.string().trim().max(500).nullable().optional(),
  needsFounder: z.boolean().optional(),
});

export const checkinSchema = z.object({
  done: z.string().trim().max(1000).default(""),
  doing: z.string().trim().max(1000).default(""),
  blocked: z.string().trim().max(1000).default(""),
});

/** `POST /api/equipo/proyectos` (founder o supervisor). */
export const crearProyectoSchema = z.object({
  name: z.string().trim().min(2, "El nombre del proyecto va de 2 a 80 caracteres.").max(80, "El nombre del proyecto va de 2 a 80 caracteres."),
  horizon: z.enum(HORIZONS).optional(),
  notes: z.string().max(4000).optional(),
  clientId: z.number().int().positive().nullable().optional(),
});

/** `PATCH /api/equipo/proyectos` (founder, supervisor o `estructura`; el cliente, solo F/S). */
export const editarProyectoSchema = z.object({
  initiativeId: z.number().int().positive(),
  name: z.string().trim().min(2, "El nombre del proyecto va de 2 a 80 caracteres.").max(80, "El nombre del proyecto va de 2 a 80 caracteres.").optional(),
  horizon: z.enum(HORIZONS).optional(),
  notes: z.string().max(4000).nullable().optional(),
  clientId: z.number().int().positive().nullable().optional(),
});

/** `POST /api/equipo/miembros`: sumar o quitar un rol de proyecto. */
export const miembroSchema = z.object({
  action: z.enum(["agregar", "quitar"]),
  initiativeId: z.number().int().positive(),
  wallet: z.string().trim().min(1, "Falta la persona.").max(120),
  rol: z.enum(ROLES_PROYECTO),
  vinculo: z.enum(["interno", "externo"]).optional(),
});
