/**
 * Barra de estados de una iniciativa (WP15). Una barra basta: el NO-ALCANCE del
 * spec prohíbe gráficas complejas.
 *
 * Mide DÓNDE está cada pieza de trabajo, no quién la hace: doc 16 — se califican
 * entregas, nunca personas. Server component, sin estado.
 */
import type { TeamStatus } from "@/lib/team-state-machine";

/** Mismo lenguaje de color que TeamStatusBadge, para que la barra se lea igual. */
const SEGMENTS: Array<{ status: TeamStatus; className: string }> = [
  { status: "Backlog", className: "bg-line" },
  { status: "Asignada", className: "bg-amber-600/70" },
  { status: "En curso", className: "bg-sky-500/80" },
  { status: "En revisión", className: "bg-violet-500/80" },
  { status: "Bloqueada", className: "bg-red-600/80" },
  { status: "Hecha", className: "bg-emerald-500/80" },
];

export default function DashboardStatusBar({
  byStatus,
  closed,
  closedLabel = "Hecha",
}: {
  byStatus: Record<TeamStatus, number>;
  /** Cerradas en la ventana que muestra la vista (época o semana). */
  closed: number;
  closedLabel?: string;
}) {
  const counts = SEGMENTS.map((s) => ({
    ...s,
    n: s.status === "Hecha" ? closed : byStatus[s.status],
    label: s.status === "Hecha" ? closedLabel : s.status,
  })).filter((s) => s.n > 0);
  const total = counts.reduce((n, s) => n + s.n, 0);

  if (total === 0) {
    return <p className="text-xs text-faint">Sin trabajo registrado en esta ventana.</p>;
  }

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full border border-line/60">
        {counts.map((s) => (
          <div
            key={s.status}
            className={s.className}
            style={{ width: `${(s.n / total) * 100}%` }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {counts.map((s) => (
          <li key={s.status} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-sm ${s.className}`} aria-hidden="true" />
            {s.label} <span className="text-white">{s.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
