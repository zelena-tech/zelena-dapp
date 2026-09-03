/**
 * Máquina de estados ÚNICA de las asignaciones del equipo (WP14).
 * Backlog → Asignada → En curso → En revisión → Hecha. Sin saltos.
 * Rama transversal: Bloqueada (con motivo obligatorio) y regreso al estado previo.
 *
 * Función pura; los handlers solo la invocan. Mismo patrón que state-machine.ts.
 */
export const ASSIGNMENT_STATES = [
  "Backlog",
  "Asignada",
  "En curso",
  "En revisión",
  "Hecha",
  "Bloqueada",
] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

export const ASSIGNMENT_ACTIONS = [
  "asignar",
  "empezar",
  "a_revision",
  "aprobar",
  "devolver",
  "bloquear",
  "desbloquear",
] as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTIONS)[number];

/** Transiciones lineales. `bloquear` y `desbloquear` se resuelven aparte. */
const TRANSITIONS: Partial<Record<AssignmentAction, { from: AssignmentState; to: AssignmentState }>> = {
  asignar: { from: "Backlog", to: "Asignada" },
  empezar: { from: "Asignada", to: "En curso" },
  a_revision: { from: "En curso", to: "En revisión" },
  aprobar: { from: "En revisión", to: "Hecha" },
  devolver: { from: "En revisión", to: "En curso" },
};

/** Estados desde los que se puede bloquear. No se bloquea lo ya hecho. */
const BLOQUEABLES: readonly AssignmentState[] = ["Asignada", "En curso", "En revisión"];

export class InvalidAssignmentTransitionError extends Error {
  constructor(current: AssignmentState, action: AssignmentAction, detail?: string) {
    super(detail ?? `Transición inválida: no se puede '${action}' desde '${current}'.`);
    this.name = "InvalidAssignmentTransitionError";
  }
}

export interface TransitionInput {
  current: AssignmentState;
  action: AssignmentAction;
  /** Estado al que volver tras desbloquear (el que tenía antes de bloquearse). */
  previous?: AssignmentState | null;
  /** Obligatorio para `bloquear`. */
  reason?: string | null;
}

/**
 * Devuelve el siguiente estado o lanza. Pura: no toca la base de datos.
 */
export function transitionAssignment(input: TransitionInput): AssignmentState {
  const { current, action } = input;

  if (action === "bloquear") {
    if (!BLOQUEABLES.includes(current)) {
      throw new InvalidAssignmentTransitionError(current, action);
    }
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3) {
      // Regla del playbook: un bloqueo sin motivo es información perdida.
      throw new InvalidAssignmentTransitionError(current, action, "Bloquear exige un motivo.");
    }
    return "Bloqueada";
  }

  if (action === "desbloquear") {
    if (current !== "Bloqueada") throw new InvalidAssignmentTransitionError(current, action);
    const prev = input.previous;
    if (!prev || !BLOQUEABLES.includes(prev)) {
      throw new InvalidAssignmentTransitionError(
        current,
        action,
        "Desbloquear necesita el estado previo (Asignada, En curso o En revisión)."
      );
    }
    return prev;
  }

  const rule = TRANSITIONS[action];
  if (!rule || rule.from !== current) throw new InvalidAssignmentTransitionError(current, action);
  return rule.to;
}

export function canTransitionAssignment(input: TransitionInput): boolean {
  try {
    transitionAssignment(input);
    return true;
  } catch {
    return false;
  }
}

/** Acciones disponibles desde un estado (para pintar botones sin duplicar reglas). */
export function availableActions(current: AssignmentState): AssignmentAction[] {
  const out: AssignmentAction[] = [];
  for (const a of ASSIGNMENT_ACTIONS) {
    if (a === "bloquear") {
      if (BLOQUEABLES.includes(current)) out.push(a);
      continue;
    }
    if (a === "desbloquear") {
      if (current === "Bloqueada") out.push(a);
      continue;
    }
    const rule = TRANSITIONS[a];
    if (rule && rule.from === current) out.push(a);
  }
  return out;
}

/** Estados que cuentan como trabajo abierto (para carga y WIP). */
export const ESTADOS_ABIERTOS: readonly AssignmentState[] = [
  "Asignada",
  "En curso",
  "En revisión",
  "Bloqueada",
];

/** Límite de WIP personal (plano 07): máximo 2 en curso por persona. */
export const WIP_MAX = 2;

// ─── Autorización: quién puede aplicar qué ────────────────────────────────

/**
 * Quién actúa. `isSupervisor` = rol de supervisión del tablero (plano 07: John
 * y Vale). El founder es supervisor por definición.
 */
export interface ActorAsignacion {
  wallet: string;
  isFounder: boolean;
  isSupervisor: boolean;
}

export class AssignmentPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentPermissionError";
  }
}

/**
 * Decide si `actor` puede aplicar `action` a una asignación cuyo dueño es
 * `ownerWallet`. Función pura: la misma regla vale en la API, en la UI y en los
 * tests, y no hay forma de que se desincronicen.
 *
 * Reglas:
 *  - `asignar` es un acto de gestión → solo supervisión.
 *  - `aprobar` / `devolver` cierran el criterio de aceptación → solo supervisión,
 *    y **nunca el propio dueño**: nadie aprueba su propio trabajo. Es la misma
 *    disciplina de "el algoritmo propone, el humano firma" aplicada a entregas.
 *  - El resto (`empezar`, `a_revision`, `bloquear`, `desbloquear`) las hace quien
 *    ejecuta el trabajo, o la supervisión en su nombre.
 */
export function puedeActuar(
  action: AssignmentAction,
  actor: ActorAsignacion,
  ownerWallet: string | null
): boolean {
  const supervisa = actor.isFounder || actor.isSupervisor;
  const esDueno = ownerWallet !== null && ownerWallet === actor.wallet;

  if (action === "asignar") return supervisa;

  if (action === "aprobar" || action === "devolver") {
    // Sin autoaprobación, ni siquiera para un supervisor sobre su propio trabajo.
    return supervisa && !esDueno;
  }

  return esDueno || supervisa;
}

/** Igual que la anterior pero lanza, con el motivo escrito para la API. */
export function assertPuedeActuar(
  action: AssignmentAction,
  actor: ActorAsignacion,
  ownerWallet: string | null
): void {
  if (puedeActuar(action, actor, ownerWallet)) return;
  if (action === "asignar") {
    throw new AssignmentPermissionError("Asignar trabajo requiere rol de supervisión.");
  }
  if (action === "aprobar" || action === "devolver") {
    const propio = ownerWallet === actor.wallet;
    throw new AssignmentPermissionError(
      propio
        ? "Nadie aprueba su propio trabajo. Lo cierra la supervisión."
        : `'${action}' requiere rol de supervisión.`
    );
  }
  throw new AssignmentPermissionError(
    "Solo el responsable de la asignación (o la supervisión) puede hacer esto."
  );
}
