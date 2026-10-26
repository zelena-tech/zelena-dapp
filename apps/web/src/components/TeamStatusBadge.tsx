/**
 * Etiquetas visuales del módulo equipo. Califican la ENTREGA (dónde va la pieza de
 * trabajo) y la urgencia del trabajo — nunca a la persona (doc 16).
 * Server component: sin estado ni interacción.
 */
import type { TeamStatus } from "@/lib/team-state-machine";
import { PRIORITY_LABEL, type Horizon, type Priority } from "@/lib/team";

const STATUS_STYLE: Record<TeamStatus, string> = {
  Backlog: "text-muted border-line",
  Asignada: "text-amber-300 border-amber-700/40 bg-amber-950/20",
  "En curso": "text-sky-300 border-sky-700/40 bg-sky-950/20",
  "En revisión": "text-violet-300 border-violet-700/40 bg-violet-950/20",
  Hecha: "text-emerald-300 border-emerald-700/40 bg-emerald-950/20",
  Bloqueada: "text-red-300 border-red-800/50 bg-red-950/20",
};

export function TeamStatusBadge({ status }: { status: TeamStatus }) {
  return <span className={`tag ${STATUS_STYLE[status] ?? "text-muted border-line"}`}>{status}</span>;
}

const PRIORITY_STYLE: Record<Priority, string> = {
  Urgent: "text-red-300 border-red-800/50 bg-red-950/20",
  High: "text-amber-300 border-amber-700/40 bg-amber-950/20",
  Normal: "text-muted border-line",
  Low: "text-faint border-line",
};

export function TeamPriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`tag ${PRIORITY_STYLE[priority] ?? "text-muted border-line"}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function TeamHorizonBadge({ horizon }: { horizon: Horizon }) {
  const style =
    horizon === "Ahora"
      ? "text-primary border-primary/40 bg-glow"
      : horizon === "Siguiente"
        ? "text-sky-300 border-sky-700/40 bg-sky-950/20"
        : "text-faint border-line";
  return <span className={`tag ${style}`}>{horizon}</span>;
}
