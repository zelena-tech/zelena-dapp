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

/**
 * Borrador (decisión del founder, 2026-10-21). Es una marca APARTE del ciclo: un
 * proyecto en borrador conserva su estado (`Open`, `Assigned`…) y, al publicarlo,
 * sigue exactamente donde estaba. Mientras está en borrador no se ve en público
 * (`/agora`, `/agora/[id]` responde 404, la landing no lo cuenta), no recibe
 * aplicaciones y no se asigna. Publicarlo es del founder, desde /admin.
 */
export interface VisibilidadProyecto {
  state: string;
  /** `projects.draft`: 1 = borrador. */
  draft: number | boolean | null | undefined;
}

export function esBorrador(p: Pick<VisibilidadProyecto, "draft">): boolean {
  return Number(p.draft ?? 0) === 1;
}

/** ¿Recibe aplicaciones? Solo un proyecto publicado (no borrador) y `Open`. */
export function recibeAplicaciones(p: VisibilidadProyecto): boolean {
  return !esBorrador(p) && p.state === "Open";
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
