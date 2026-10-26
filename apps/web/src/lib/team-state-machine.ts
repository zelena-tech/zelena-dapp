/**
 * Máquina de estados ÚNICA de las asignaciones del equipo (WP14).
 *
 *   Backlog → Asignada → En curso → En revisión → Hecha
 *   rama Bloqueada (motivo OBLIGATORIO) y retorno al estado desde el que se bloqueó.
 *   SIN SALTOS.
 *
 * FUNCIÓN PURA, mismo patrón que lib/state-machine.ts (Ágora): los handlers y el
 * repositorio solo la invocan, nunca escriben `status` a mano. Son DOS máquinas
 * distintas y deliberadamente separadas — el Ágora puntúa y distribuye bounties;
 * esto sigue el trabajo interno. Compartirlas acoplaría dos ciclos de vida ajenos.
 *
 * Doc 16: los estados califican la ENTREGA (dónde va la pieza de trabajo), nunca
 * a la persona. No existe ningún estado que hable del valor de nadie.
 */

export const TEAM_STATUSES = [
  "Backlog",
  "Asignada",
  "En curso",
  "En revisión",
  "Hecha",
  "Bloqueada",
] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export const TEAM_ACTIONS = [
  "asignar",
  "empezar",
  "enviar_a_revision",
  "aprobar",
  "devolver",
  "bloquear",
  "desbloquear",
] as const;
export type TeamAction = (typeof TEAM_ACTIONS)[number];

/** Estados desde los que una pieza EN VUELO puede bloquearse. */
const BLOCKABLE: readonly TeamStatus[] = ["Asignada", "En curso", "En revisión"];

/**
 * Tabla de transiciones. `bloquear` y `desbloquear` no son un par (from, to) fijo:
 * bloquear sale de cualquier estado en vuelo y desbloquear vuelve al estado previo.
 */
const LINEAR: Record<
  Exclude<TeamAction, "bloquear" | "desbloquear">,
  { from: TeamStatus; to: TeamStatus }
> = {
  asignar: { from: "Backlog", to: "Asignada" },
  empezar: { from: "Asignada", to: "En curso" },
  enviar_a_revision: { from: "En curso", to: "En revisión" },
  aprobar: { from: "En revisión", to: "Hecha" },
  // `devolver` es el ÚNICO paso hacia atrás de la cadena, y existe porque revisar
  // sin poder devolver no es revisar. Va con motivo obligatorio: sin el "qué falta",
  // devolver una entrega es un juicio; con él, es información para terminarla.
  // NO es lo mismo que `bloquear`: bloquear dice "esto no puede avanzar por algo
  // externo"; devolver dice "esto vuelve a tus manos con algo concreto por ajustar".
  devolver: { from: "En revisión", to: "En curso" },
};

/** Acciones que exigen un motivo escrito. */
const NEEDS_REASON: readonly TeamAction[] = ["bloquear", "devolver"];

export function isTeamStatus(v: unknown): v is TeamStatus {
  return typeof v === "string" && (TEAM_STATUSES as readonly string[]).includes(v);
}

export function isTeamAction(v: unknown): v is TeamAction {
  return typeof v === "string" && (TEAM_ACTIONS as readonly string[]).includes(v);
}

export class InvalidTeamTransitionError extends Error {
  constructor(current: TeamStatus, action: TeamAction) {
    super(`Transición inválida: no se puede '${action}' desde '${current}'.`);
    this.name = "InvalidTeamTransitionError";
  }
}

export class BlockReasonRequiredError extends Error {
  constructor(action: TeamAction = "bloquear") {
    super(
      action === "devolver"
        ? "Para devolver una entrega hay que escribir qué falta ajustar."
        : "Para bloquear una asignación hay que escribir el motivo del bloqueo."
    );
    this.name = "BlockReasonRequiredError";
  }
}

/** Estado completo de la pieza de trabajo que la máquina necesita y devuelve. */
export interface TeamAssignmentState {
  status: TeamStatus;
  /** Estado desde el que se bloqueó, para poder volver. Solo relevante en 'Bloqueada'. */
  statusBeforeBlock: TeamStatus | null;
  blockedReason: string | null;
}

/** ¿La acción es válida desde este estado? (no valida el motivo del bloqueo). */
export function canTeamTransition(current: TeamStatus, action: TeamAction): boolean {
  if (action === "bloquear") return BLOCKABLE.includes(current);
  if (action === "desbloquear") return current === "Bloqueada";
  const rule = LINEAR[action];
  return !!rule && rule.from === current;
}

/** Acciones disponibles desde un estado, en el orden en que se ofrecen en la UI. */
export function availableTeamActions(current: TeamStatus): TeamAction[] {
  return TEAM_ACTIONS.filter((a) => canTeamTransition(current, a));
}

/**
 * Aplica una acción. Devuelve el estado NUEVO (no muta la entrada) o lanza:
 *  - InvalidTeamTransitionError si la acción no aplica desde el estado actual;
 *  - BlockReasonRequiredError si se bloquea sin motivo (criterio 4 de WP14).
 */
export function teamTransition(
  state: TeamAssignmentState,
  action: TeamAction,
  reason?: string | null
): TeamAssignmentState {
  if (!canTeamTransition(state.status, action)) {
    throw new InvalidTeamTransitionError(state.status, action);
  }

  if (NEEDS_REASON.includes(action) && !(reason ?? "").trim()) {
    throw new BlockReasonRequiredError(action);
  }

  if (action === "bloquear") {
    return {
      status: "Bloqueada",
      statusBeforeBlock: state.status,
      blockedReason: (reason ?? "").trim(),
    };
  }

  if (action === "devolver") {
    // Vuelve a 'En curso' SIN dejar `blockedReason`: la pieza no está trabada, está
    // en manos de quien la entrega. El "qué falta" queda en el evento append-only
    // (assignment_events), que es donde vive la historia de la entrega.
    return { status: LINEAR.devolver.to, statusBeforeBlock: null, blockedReason: null };
  }

  if (action === "desbloquear") {
    // Vuelve al estado desde el que se bloqueó. Si la fila no lo tiene (dato viejo o
    // creado fuera de la máquina), vuelve a 'Asignada': el estado en vuelo más
    // temprano, que nunca descarta trabajo ya hecho ni salta hacia adelante.
    return {
      status: state.statusBeforeBlock ?? "Asignada",
      statusBeforeBlock: null,
      blockedReason: null,
    };
  }

  return { status: LINEAR[action].to, statusBeforeBlock: null, blockedReason: null };
}

/** Estados en los que la pieza de trabajo sigue abierta (ni Hecha ni Bloqueada). */
export const OPEN_STATUSES: readonly TeamStatus[] = ["Backlog", "Asignada", "En curso", "En revisión"];

export function isOpenStatus(s: TeamStatus): boolean {
  return OPEN_STATUSES.includes(s);
}

/** Etiqueta del botón de cada acción (copys de entrega, doc 16). */
export const TEAM_ACTION_LABEL: Record<TeamAction, string> = {
  asignar: "Tomar",
  empezar: "Empezar",
  enviar_a_revision: "Enviar a revisión",
  aprobar: "Aprobar entrega",
  // Habla de la ENTREGA y de lo que falta, nunca de quien la hizo (doc 16).
  devolver: "Pedir ajustes",
  bloquear: "Bloquear",
  desbloquear: "Desbloquear",
};
