/**
 * Digest diario del equipo (WP15): hecho / en curso / bloqueado, consolidado.
 *
 * Se calcula ENTERAMENTE de dos fuentes reales de WP14, sin tablas nuevas:
 *  - `assignment_events` (append-only) → los cambios de estado del día, vía
 *    `assignmentEventsOfDay`. Son hechos de la máquina de estados.
 *  - `checkins` → lo que cada persona escribió ese día, vía `checkinsOfDay`.
 *
 * Un día es exactamente la columna `day` (YYYY-MM-DD) de ambas tablas: nada de
 * otro día se puede colar, porque no se derivan fechas de `created_at` aquí.
 *
 * NO-ALCANCE explícito de v1: esto NO se envía por correo, ni a Teams, ni
 * notifica a nadie. Se muestra en el dashboard y se exporta como texto plano
 * para pegarlo a mano donde sea. El envío automático es la fase "automatizar".
 *
 * Doc 16: el digest narra ENTREGAS y bloqueos. No califica a personas, no lista
 * a quien no escribió su check-in y no produce ningún ranking.
 */
import type { DB } from "./db";
import { getDb } from "./db";
import { puedeVerTodoElEquipo, type TeamActor } from "./roles.ts";
import type { TeamAction, TeamStatus } from "./team-state-machine.ts";
import { assignmentEventsOfDay, checkinsOfDay, today, TeamError } from "./team.ts";

// ---------------------------------------------------------------------------
// Formas
// ---------------------------------------------------------------------------

export interface DigestEvent {
  assignmentId: number;
  title: string;
  action: TeamAction;
  fromStatus: TeamStatus;
  toStatus: TeamStatus;
  /** Motivo del bloqueo cuando la acción es `bloquear`. */
  reason: string | null;
  actorWallet: string;
  actorName: string;
}

export interface DigestCheckin {
  wallet: string;
  name: string;
  done: string;
  doing: string;
  blocked: string;
}

export interface DailyDigest {
  day: string;
  /** Lo que la gente escribió en su check-in de ese día. */
  checkins: DigestCheckin[];
  /** Entregas aprobadas ese día (transición a `Hecha`). */
  done: DigestEvent[];
  /** Trabajo que se movió hacia adelante sin cerrarse todavía. */
  advanced: DigestEvent[];
  /** Bloqueos NUEVOS de ese día (con su motivo). */
  blocked: DigestEvent[];
  /** Bloqueos que se destrabaron ese día. */
  unblocked: DigestEvent[];
  counts: {
    checkins: number;
    done: number;
    advanced: number;
    blocked: number;
    unblocked: number;
    events: number;
  };
  /** Sin check-ins y sin cambios de estado: se dice, no se rellena. */
  empty: boolean;
}

/** Acciones que mueven la pieza hacia adelante sin cerrarla. */
const ADVANCING: readonly TeamAction[] = ["asignar", "empezar", "enviar_a_revision"];

// ---------------------------------------------------------------------------
// Construcción
// ---------------------------------------------------------------------------

/**
 * Digest de un día concreto. `day` es `YYYY-MM-DD` y se pasa tal cual a las
 * consultas de WP14, que filtran por su columna `day`.
 */
export function buildDailyDigest(db: DB, day: string): DailyDigest {
  const checkins: DigestCheckin[] = checkinsOfDay(db, day).map((c) => ({
    wallet: c.wallet,
    name: c.name ?? c.wallet,
    done: c.done,
    doing: c.doing,
    blocked: c.blocked,
  }));

  const events: DigestEvent[] = assignmentEventsOfDay(db, day).map((e) => ({
    assignmentId: e.assignment_id,
    title: e.title,
    action: e.action,
    fromStatus: e.from_status,
    toStatus: e.to_status,
    reason: e.reason,
    actorWallet: e.actor_wallet,
    actorName: e.actor_name ?? e.actor_wallet,
  }));

  const done = events.filter((e) => e.toStatus === "Hecha");
  const blocked = events.filter((e) => e.action === "bloquear");
  const unblocked = events.filter((e) => e.action === "desbloquear");
  const advanced = events.filter((e) => ADVANCING.includes(e.action) && e.toStatus !== "Hecha");

  return {
    day,
    checkins,
    done,
    advanced,
    blocked,
    unblocked,
    counts: {
      checkins: checkins.length,
      done: done.length,
      advanced: advanced.length,
      blocked: blocked.length,
      unblocked: unblocked.length,
      events: events.length,
    },
    empty: checkins.length === 0 && events.length === 0,
  };
}

/** Digest de hoy. */
export function buildTodayDigest(db: DB = getDb(), now: Date = new Date()): DailyDigest {
  return buildDailyDigest(db, today(now));
}

/**
 * Misma puerta que el dashboard: founder y supervisores. La regla vive en
 * lib/roles.ts; aquí solo se invoca. Lanza `TeamError(403)`.
 */
export function dailyDigestFor(db: DB, actor: TeamActor, day: string): DailyDigest {
  if (!puedeVerTodoElEquipo(actor)) {
    throw new TeamError(403, "El digest del equipo es para el founder y los supervisores.");
  }
  return buildDailyDigest(db, day);
}

// ---------------------------------------------------------------------------
// Render en texto plano (exportable, pegable donde sea)
// ---------------------------------------------------------------------------

function bullets(lines: string[]): string[] {
  return lines.map((l) => `- ${l}`);
}

/**
 * Texto plano del digest. Sin markdown, sin tablas, sin emoji: está hecho para
 * pegarse en un chat, un correo escrito a mano o una nota. Determinista: el
 * mismo digest produce siempre el mismo texto (útil para los tests).
 */
export function renderDigestText(d: DailyDigest): string {
  const out: string[] = [];
  out.push(`Digest del equipo - ${d.day}`);
  out.push("");

  if (d.empty) {
    out.push("Sin check-ins ni cambios de estado registrados este dia.");
    out.push("");
    out.push("Generado desde el tablero del equipo. No se envio a nadie: se copia a mano.");
    return out.join("\n");
  }

  const hecho = [
    ...d.done.map((e) => `${e.title} - entrega aprobada (${e.actorName})`),
    ...d.checkins.filter((c) => c.done).map((c) => `${c.name}: ${c.done}`),
  ];
  if (hecho.length > 0) {
    out.push("HECHO");
    out.push(...bullets(hecho));
    out.push("");
  }

  const enCurso = [
    ...d.advanced.map((e) => `${e.title} - ${e.fromStatus} -> ${e.toStatus} (${e.actorName})`),
    ...d.unblocked.map((e) => `${e.title} - desbloqueada, vuelve a ${e.toStatus} (${e.actorName})`),
    ...d.checkins.filter((c) => c.doing).map((c) => `${c.name}: ${c.doing}`),
  ];
  if (enCurso.length > 0) {
    out.push("EN CURSO");
    out.push(...bullets(enCurso));
    out.push("");
  }

  const bloqueado = [
    ...d.blocked.map(
      (e) => `${e.title} - ${e.reason ?? "sin motivo registrado"} (${e.actorName})`
    ),
    ...d.checkins.filter((c) => c.blocked).map((c) => `${c.name}: ${c.blocked}`),
  ];
  if (bloqueado.length > 0) {
    out.push("BLOQUEADO");
    out.push(...bullets(bloqueado));
    out.push("");
  }

  const c = d.counts;
  out.push(
    `${c.checkins} check-ins - ${c.done} entregas cerradas - ${c.blocked} bloqueos nuevos - ${c.unblocked} destrabados`
  );
  out.push("");
  out.push("Generado desde el tablero del equipo. No se envio a nadie: se copia a mano.");
  return out.join("\n");
}

/** Nombre de archivo sugerido para la descarga del digest. */
export function digestFilename(day: string): string {
  return `digest-equipo-${day}.txt`;
}
