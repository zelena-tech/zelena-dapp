/**
 * Máquina de estados ÚNICA de proyectos del Ágora.
 * Open → Assigned → Delivered → Scored → Distributed. Sin saltos.
 * Función pura; los handlers solo la invocan (wargame M5).
 */
export const PROJECT_STATES = [
  "Open",
  "Assigned",
  "Delivered",
  "Scored",
  "Distributed",
] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export type ProjectAction = "assign" | "deliver" | "score" | "distribute";

const TRANSITIONS: Record<ProjectAction, { from: ProjectState; to: ProjectState }> = {
  assign: { from: "Open", to: "Assigned" },
  deliver: { from: "Assigned", to: "Delivered" },
  score: { from: "Delivered", to: "Scored" },
  distribute: { from: "Scored", to: "Distributed" },
};

export class InvalidTransitionError extends Error {
  constructor(current: ProjectState, action: ProjectAction) {
    super(`Transición inválida: no se puede '${action}' desde '${current}'.`);
    this.name = "InvalidTransitionError";
  }
}

/** Devuelve el siguiente estado o lanza InvalidTransitionError. */
export function transition(current: ProjectState, action: ProjectAction): ProjectState {
  const rule = TRANSITIONS[action];
  if (!rule || rule.from !== current) {
    throw new InvalidTransitionError(current, action);
  }
  return rule.to;
}

export function canTransition(current: ProjectState, action: ProjectAction): boolean {
  const rule = TRANSITIONS[action];
  return !!rule && rule.from === current;
}

export function nextAction(current: ProjectState): ProjectAction | null {
  switch (current) {
    case "Open":
      return "assign";
    case "Assigned":
      return "deliver";
    case "Delivered":
      return "score";
    case "Scored":
      return "distribute";
    default:
      return null;
  }
}
