/**
 * Agregaciones del dashboard de seguimiento (WP15).
 *
 * La pantalla tiene que responder tres preguntas en 30 segundos:
 *   1. ¿Qué está bloqueado?  (lo único que exige acción → va arriba)
 *   2. ¿Qué me necesita a mí? (bandeja `needs_founder`)
 *   3. ¿Qué avanza?          (por iniciativa, y cómo está repartida la carga)
 *
 * Reglas que este archivo hace cumplir:
 *  - CERO tablas nuevas y cero métricas inventadas: todo se deriva por COUNT()/
 *    agregación sobre `assignments`, `assignment_events` y `checkins` de WP14.
 *  - Los días bloqueado NO son una columna: salen del evento `bloquear` más
 *    reciente en `assignment_events` (append-only), con `blocked_at` solo como
 *    respaldo para filas creadas fuera de la máquina de estados.
 *  - La visibilidad se decide con `puedeVerTodoElEquipo` de lib/roles.ts. Regla
 *    ÚNICA: aquí no se reimplementa ni se relaja.
 *  - Doc 16: la carga por persona existe para REPARTIR trabajo, no para rankear.
 *    Ninguna función de este archivo ordena personas por cantidad de trabajo, y
 *    ninguna produce un juicio sobre nadie. Lo que se ordena son BLOQUEOS (por
 *    antigüedad), porque el bloqueo viejo es el que más cuesta.
 *
 * SQL deliberadamente simple: en producción lo traduce lib/sql-dialect.ts a
 * T-SQL (nada de LIMIT en subconsulta, nada de INSERT OR REPLACE).
 */
import type { DB } from "./db";
import { getDb } from "./db";
import { latestEpochFitness, type EpochFitnessReport } from "./epochs.ts";
import { puedeVerTodoElEquipo, type Role, type TeamActor } from "./roles.ts";
import { OPEN_STATUSES, type TeamStatus } from "./team-state-machine.ts";
import {
  assignmentsByInitiative,
  checkinsSince,
  listBlocked,
  listNeedsFounder,
  listTeamMembers,
  piezasVisiblesPara,
  today,
  weekStart,
  TeamError,
  type AssignmentView,
  type InitiativeRow,
} from "./team.ts";

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/**
 * Días de calendario entre dos días `YYYY-MM-DD` (`to` - `from`). Se compara a
 * mediodía UTC para que ningún cambio de horario de verano convierta un día en
 * cero o en dos. Devuelve `null` si alguna fecha no es un día válido: preferimos
 * "sin registro" a un número inventado.
 */
export function daysBetween(fromDay: string, toDay: string): number | null {
  const a = Date.parse(`${fromDay}T12:00:00Z`);
  const b = Date.parse(`${toDay}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// 1. Bloqueos (sección superior)
// ---------------------------------------------------------------------------

export interface BlockedItem {
  assignment: AssignmentView;
  /** Motivo del bloqueo. Obligatorio en la máquina de estados, pero una fila
   *  antigua podría no tenerlo: se dice, no se inventa. */
  reason: string | null;
  /** Día (YYYY-MM-DD) del bloqueo vigente, del evento `bloquear` más reciente. */
  since: string | null;
  /** Días que lleva bloqueada. `null` si no hay ningún registro de cuándo. */
  daysBlocked: number | null;
  /** De dónde salió `since`: del historial append-only o del respaldo de la fila. */
  sinceSource: "evento" | "columna" | "sin-registro";
}

/**
 * Día del bloqueo vigente de cada asignación, derivado del historial.
 *
 * `MAX(day)` agrupado por asignación en vez de un `LIMIT 1` por fila: una sola
 * consulta, sin subconsulta con LIMIT (que el dialecto T-SQL no acepta).
 */
function lastBlockDayByAssignment(db: DB): Map<number, string> {
  const rows = db
    .prepare(
      `SELECT assignment_id, MAX(day) AS day
         FROM assignment_events
        WHERE action = 'bloquear'
        GROUP BY assignment_id`
    )
    .all() as Array<{ assignment_id: number; day: string }>;
  return new Map(rows.map((r) => [r.assignment_id, r.day]));
}

/**
 * Todo lo bloqueado, con motivo, responsable y días bloqueado. Ordenado del
 * bloqueo más viejo al más nuevo: la antigüedad es el costo real.
 *
 * Es la sección superior del dashboard porque es lo único que pide una acción.
 * Con `actor` (WP31 §4.A.12), solo lo que esa persona ve: nada de un proyecto de
 * cliente donde no participa.
 */
export function blockedWithAge(db: DB, now: Date = new Date(), actor?: TeamActor): BlockedItem[] {
  const day = today(now);
  const lastBlock = lastBlockDayByAssignment(db);
  const items: BlockedItem[] = listBlocked(db, actor).map((a) => {
    const fromEvent = lastBlock.get(a.id) ?? null;
    // Respaldo: filas creadas directamente como 'Bloqueada' (importador, datos
    // previos) no tienen evento. Nunca se inventa una fecha.
    const fromColumn = a.blocked_at ? a.blocked_at.slice(0, 10) : null;
    const since = fromEvent ?? fromColumn;
    return {
      assignment: a,
      reason: a.blocked_reason,
      since,
      daysBlocked: since ? daysBetween(since, day) : null,
      sinceSource: fromEvent ? "evento" : fromColumn ? "columna" : "sin-registro",
    };
  });
  // Sin registro al final: no se le puede asignar antigüedad.
  return items.sort((x, y) => {
    if (x.daysBlocked === null && y.daysBlocked === null) return x.assignment.id - y.assignment.id;
    if (x.daysBlocked === null) return 1;
    if (y.daysBlocked === null) return -1;
    if (y.daysBlocked !== x.daysBlocked) return y.daysBlocked - x.daysBlocked;
    return x.assignment.id - y.assignment.id;
  });
}

// ---------------------------------------------------------------------------
// 2. Esperando a John
// ---------------------------------------------------------------------------

/**
 * Bandeja de gates del founder: lo marcado `needs_founder` y aún no cerrado.
 * Delega en WP14 (`listNeedsFounder`), que ya ordena por prioridad y vencimiento.
 * Con `actor`, solo lo que esa persona ve (§4.A.12).
 */
export function founderInbox(db: DB, actor?: TeamActor): AssignmentView[] {
  return listNeedsFounder(db, actor);
}

// ---------------------------------------------------------------------------
// 3. Por iniciativa
// ---------------------------------------------------------------------------

export interface InitiativeBar {
  initiative: InitiativeRow | null;
  name: string;
  /** Abiertas = los cuatro estados en vuelo (incluye Backlog). */
  open: number;
  /** Desglose de las abiertas, para la barra de estados. */
  byStatus: Record<TeamStatus, number>;
  blocked: number;
  closedThisWeek: number;
  /** Cerradas desde que abrió la época en curso. `null` si no hay época. */
  closedThisEpoch: number | null;
  /** open + blocked + cerradas de la época: para no dibujar barras vacías. */
  total: number;
}

function emptyByStatus(): Record<TeamStatus, number> {
  return {
    Backlog: 0,
    Asignada: 0,
    "En curso": 0,
    "En revisión": 0,
    Hecha: 0,
    Bloqueada: 0,
  };
}

/** Inicio de la época en curso (el `created_at` del último periodo abierto). */
export function epochStartDay(db: DB): string | null {
  const row = db
    .prepare(`SELECT id, name, created_at FROM periods ORDER BY id DESC LIMIT 1`)
    .get() as { id: number; name: string; created_at: string } | undefined;
  return row ? row.created_at.slice(0, 10) : null;
}

function closedThisEpochByInitiative(db: DB, fromDay: string, actor?: TeamActor): Map<number | null, number> {
  const rows = db
    .prepare(
      `SELECT initiative_id, client_id, COUNT(*) AS n
         FROM assignments
        WHERE status = 'Hecha' AND closed_at IS NOT NULL AND substr(closed_at,1,10) >= ?
        GROUP BY initiative_id, client_id`
    )
    .all(fromDay) as Array<{ initiative_id: number | null; client_id: number | null; n: number }>;
  const out = new Map<number | null, number>();
  for (const r of actor ? piezasVisiblesPara(db, actor, rows) : rows) {
    out.set(r.initiative_id, (out.get(r.initiative_id) ?? 0) + r.n);
  }
  return out;
}

/**
 * Una barra de estados por iniciativa (el NO-alcance prohíbe gráficas complejas).
 * Reusa `assignmentsByInitiative` de WP14 y solo agrega el desglose por estado y
 * el cierre de la época. Con `actor`, solo los proyectos y las piezas que ve (§4.A.12).
 */
export function initiativeBars(db: DB, now: Date = new Date(), actor?: TeamActor): InitiativeBar[] {
  const epochFrom = epochStartDay(db);
  const closedEpoch = epochFrom ? closedThisEpochByInitiative(db, epochFrom, actor) : null;

  return assignmentsByInitiative(db, { now, actor }).map((s) => {
    const byStatus = emptyByStatus();
    for (const a of s.open) byStatus[a.status]++;
    byStatus.Bloqueada = s.blocked.length;
    const key = s.initiative ? s.initiative.id : null;
    const closedThisEpoch = closedEpoch ? (closedEpoch.get(key) ?? 0) : null;
    return {
      initiative: s.initiative,
      name: s.initiative ? s.initiative.name : "Sin iniciativa",
      open: s.open.length,
      byStatus,
      blocked: s.blocked.length,
      closedThisWeek: s.closedThisWeek.length,
      closedThisEpoch,
      total: s.open.length + s.blocked.length + (closedThisEpoch ?? s.closedThisWeek.length),
    };
  });
}

// ---------------------------------------------------------------------------
// 4. Carga por persona — para REPARTIR, no para rankear (doc 16)
// ---------------------------------------------------------------------------

/**
 * Propósito de la sección, explícito en el código y en la UI. Doc 16: se miden
 * entregas y cargas, jamás el "rendimiento" de una persona.
 */
export const LOAD_PURPOSE =
  "Esta tabla existe para detectar sobrecarga y repartir trabajo, no para rankear personas. " +
  "Un número alto no dice nada del valor de nadie: dice que hay que repartir.";

/**
 * Miembros REALES del equipo: parte de `listTeamMembers` (WP14) y descarta las
 * filas de la cohorte demo (`is_demo = 1`).
 *
 * Por qué hace falta el filtro: el seed de la cohorte demo crea un founder de
 * demostración ("John (Founder)", `is_demo = 1`) y `seedTeamRoster` lo promueve a
 * `role='founder'` por su `is_founder`. Sin filtrar, John aparece DOS VECES en la
 * carga —su fila demo y su fila real `pending:john`— y el denominador de la salud
 * del rito cuenta 7 personas donde hay 6. Una fila de demostración no escribe
 * check-ins ni recibe asignaciones.
 *
 * Se resuelve acá y no en lib/team.ts (WP14, ajeno): es una decisión de esta
 * vista. Cuando WP13 vincule la identidad real, este filtro seguirá siendo
 * correcto — sigue habiendo una fila demo que no es una persona del equipo.
 */
function realTeamMembers(db: DB) {
  const demo = new Set(
    (db.prepare(`SELECT wallet FROM users WHERE is_demo = 1`).all() as Array<{ wallet: string }>).map(
      (r) => r.wallet
    )
  );
  return listTeamMembers(db).filter((m) => !demo.has(m.wallet));
}

export interface PersonLoad {
  wallet: string;
  name: string;
  role: Role;
  isSupervisor: boolean;
  /** Abiertas: los cuatro estados en vuelo. */
  open: number;
  inProgress: number;
  inReview: number;
  assigned: number;
  backlog: number;
  blocked: number;
  needsFounder: number;
}

export interface TeamLoad {
  /** Orden ALFABÉTICO, nunca por carga: la lista no es un ranking. */
  people: PersonLoad[];
  /** Trabajo abierto sin responsable: lo primero que se puede repartir. */
  unassignedOpen: number;
  unassignedBlocked: number;
  /**
   * Trabajo de alguien que NO está en el roster del equipo (una cuenta demo, o un
   * contribuidor del Ágora). No se dibuja como fila de persona, pero SÍ se cuenta
   * en los totales: si se descartara en silencio, los totales mentirían.
   */
  outsideRosterOpen: number;
  outsideRosterBlocked: number;
  totalOpen: number;
  totalInProgress: number;
  purpose: string;
}

const OPEN_LIST = OPEN_STATUSES.map((s) => `'${s}'`).join(",");

/**
 * Abiertas y en curso por miembro. Incluye a quien tiene cero (es el roster, no
 * una tabla de posiciones) y ordena por nombre. Con `actor` (WP31 §4.A.12), solo
 * cuenta las piezas que esa persona ve.
 */
export function loadByPerson(db: DB, actor?: TeamActor): TeamLoad {
  const filas = db
    .prepare(
      `SELECT owner_wallet, status, initiative_id, client_id, COUNT(*) AS n, SUM(needs_founder) AS gates
         FROM assignments
        WHERE status IN (${OPEN_LIST},'Bloqueada')
        GROUP BY owner_wallet, status, initiative_id, client_id`
    )
    .all() as Array<{
    owner_wallet: string | null;
    status: TeamStatus;
    initiative_id: number | null;
    client_id: number | null;
    n: number;
    gates: number;
  }>;
  const counts = actor ? piezasVisiblesPara(db, actor, filas) : filas;

  const people: PersonLoad[] = realTeamMembers(db).map((m) => ({
    wallet: m.wallet,
    name: m.display_name,
    role: m.role,
    isSupervisor: !!m.is_supervisor,
    open: 0,
    inProgress: 0,
    inReview: 0,
    assigned: 0,
    backlog: 0,
    blocked: 0,
    needsFounder: 0,
  }));
  const byWallet = new Map(people.map((p) => [p.wallet, p]));

  let unassignedOpen = 0;
  let unassignedBlocked = 0;
  let outsideRosterOpen = 0;
  let outsideRosterBlocked = 0;
  for (const c of counts) {
    if (c.owner_wallet === null) {
      if (c.status === "Bloqueada") unassignedBlocked += c.n;
      else unassignedOpen += c.n;
      continue;
    }
    const p = byWallet.get(c.owner_wallet);
    if (!p) {
      // Dueño fuera del roster del equipo: no se dibuja como fila de persona,
      // pero se cuenta, para que los totales no mientan.
      if (c.status === "Bloqueada") outsideRosterBlocked += c.n;
      else outsideRosterOpen += c.n;
      continue;
    }
    p.needsFounder += Number(c.gates ?? 0);
    if (c.status === "Bloqueada") {
      p.blocked += c.n;
      continue;
    }
    p.open += c.n;
    if (c.status === "En curso") p.inProgress += c.n;
    else if (c.status === "En revisión") p.inReview += c.n;
    else if (c.status === "Asignada") p.assigned += c.n;
    else if (c.status === "Backlog") p.backlog += c.n;
  }

  people.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return {
    people,
    unassignedOpen,
    unassignedBlocked,
    outsideRosterOpen,
    outsideRosterBlocked,
    totalOpen: people.reduce((n, p) => n + p.open, 0) + unassignedOpen + outsideRosterOpen,
    totalInProgress: people.reduce((n, p) => n + p.inProgress, 0),
    purpose: LOAD_PURPOSE,
  };
}

// ---------------------------------------------------------------------------
// 5. Salud de ritos — participación en el rito, NO telemetría de presencia
// ---------------------------------------------------------------------------

export interface RiteMember {
  wallet: string;
  name: string;
  checkins: number;
}

export interface RiteHealth {
  weekStart: string;
  /** Días de la semana ya transcurridos, lunes → hoy incluido (1..7). */
  daysElapsed: number;
  members: number;
  /** miembros × días transcurridos. Es aritmética de calendario, no una meta
   *  configurable: no hay parámetro nuevo que versionar en el genoma. */
  expected: number;
  actual: number;
  /** Porcentaje 0..100 redondeado. `null` si todavía no hay nada que dividir. */
  pct: number | null;
  /** Orden alfabético. Cuenta participación en un rito, no horas ni presencia. */
  perMember: RiteMember[];
}

export function riteHealth(db: DB, now: Date = new Date()): RiteHealth {
  const week = weekStart(now);
  const day = today(now);
  const elapsed = Math.min(7, Math.max(1, (daysBetween(week, day) ?? 0) + 1));

  const perMember: RiteMember[] = realTeamMembers(db)
    .map((m) => ({
      wallet: m.wallet,
      name: m.display_name,
      checkins: checkinsSince(db, m.wallet, week),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const members = perMember.length;
  const expected = members * elapsed;
  const actual = perMember.reduce((n, m) => n + m.checkins, 0);
  return {
    weekStart: week,
    daysElapsed: elapsed,
    members,
    expected,
    actual,
    pct: expected > 0 ? Math.round((actual / expected) * 100) : null,
    perMember,
  };
}

// ---------------------------------------------------------------------------
// 6. Métricas de época (solo LECTURA de WP07)
// ---------------------------------------------------------------------------

export interface EpochSnapshot {
  period: { id: number; name: string; state: string; startDay: string } | null;
  /** Último reporte de fitness. Solo lectura: WP15 no calcula ni cierra épocas. */
  fitness: EpochFitnessReport | null;
  /** Entregas cerradas desde que abrió la época. `null` si no hay época. */
  closedThisEpoch: number | null;
  blockedNow: number;
}

/** Con `actor` (WP31 §4.A.12), los conteos solo incluyen las piezas que esa persona ve. */
export function epochSnapshot(db: DB, actor?: TeamActor): EpochSnapshot {
  const row = db
    .prepare(`SELECT id, name, state, created_at FROM periods ORDER BY id DESC LIMIT 1`)
    .get() as { id: number; name: string; state: string; created_at: string } | undefined;
  const startDay = row ? row.created_at.slice(0, 10) : null;
  type Conteo = { initiative_id: number | null; client_id: number | null; n: number };
  const contar = (filas: Conteo[]) => (actor ? piezasVisiblesPara(db, actor, filas) : filas).reduce((t, f) => t + f.n, 0);
  const closedThisEpoch = startDay
    ? contar(
        db
          .prepare(
            `SELECT initiative_id, client_id, COUNT(*) AS n FROM assignments
              WHERE status = 'Hecha' AND closed_at IS NOT NULL AND substr(closed_at,1,10) >= ?
              GROUP BY initiative_id, client_id`
          )
          .all(startDay) as Conteo[]
      )
    : null;
  const blockedNow = contar(
    db
      .prepare(
        `SELECT initiative_id, client_id, COUNT(*) AS n FROM assignments
          WHERE status = 'Bloqueada'
          GROUP BY initiative_id, client_id`
      )
      .all() as Conteo[]
  );
  return {
    period: row && startDay ? { id: row.id, name: row.name, state: row.state, startDay } : null,
    fitness: latestEpochFitness(db),
    closedThisEpoch,
    blockedNow,
  };
}

// ---------------------------------------------------------------------------
// Ensamblado + puerta de acceso
// ---------------------------------------------------------------------------

export interface DashboardData {
  day: string;
  actor: TeamActor;
  blocked: BlockedItem[];
  waitingOnFounder: AssignmentView[];
  initiatives: InitiativeBar[];
  load: TeamLoad;
  rites: RiteHealth;
  epoch: EpochSnapshot;
}

/**
 * PUERTA ÚNICA del dashboard: solo founder y supervisores. La regla es la de
 * lib/roles.ts (`puedeVerTodoElEquipo`), no una copia: un `core` normal ve su
 * propio día en `/equipo/hoy`, no el tablero de todo el equipo.
 *
 * Lanza `TeamError(403)` en vez de devolver datos recortados, para que la página
 * y el endpoint de exportación fallen igual y por el mismo motivo.
 *
 * WP31 §4.A.12: todo lo que arma sale filtrado por lo que `actor` ve (un proyecto de
 * cliente, solo si participa; el founder, todo).
 */
export function buildDashboard(db: DB = getDb(), actor: TeamActor, now: Date = new Date()): DashboardData {
  if (!puedeVerTodoElEquipo(actor)) {
    throw new TeamError(403, "El dashboard de seguimiento es para el founder y los supervisores.");
  }
  return {
    day: today(now),
    actor,
    blocked: blockedWithAge(db, now, actor),
    waitingOnFounder: founderInbox(db, actor),
    initiatives: initiativeBars(db, now, actor),
    load: loadByPerson(db, actor),
    rites: riteHealth(db, now),
    epoch: epochSnapshot(db, actor),
  };
}
