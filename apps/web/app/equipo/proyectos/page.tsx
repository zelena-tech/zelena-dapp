/**
 * `/equipo/proyectos` — el trabajo por iniciativa (WP14): abiertas, bloqueadas,
 * cerradas esta semana y responsables, con filtro por horizonte.
 *
 * Los bloqueos van PRIMERO dentro de cada iniciativa porque son lo único que pide
 * una acción. La columna de responsables cuenta carga, no calidad: doc 16 — carga
 * visible, no punitiva; se miden entregas, nunca personas.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { assignmentsByInitiative, HORIZONS, isHorizon, weekStart, type Horizon } from "@/lib/team";
import { TeamHorizonBadge, TeamPriorityBadge, TeamStatusBadge } from "@/components/TeamStatusBadge";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EquipoProyectosPage({
  searchParams,
}: {
  searchParams: { horizonte?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const raw = searchParams.horizonte;
  const horizon: Horizon | undefined = isHorizon(raw) ? raw : undefined;
  const summaries = assignmentsByInitiative(getDb(), { horizon });
  const week = weekStart();

  const totalOpen = summaries.reduce((n, s) => n + s.open.length, 0);
  const totalBlocked = summaries.reduce((n, s) => n + s.blocked.length, 0);
  const totalClosed = summaries.reduce((n, s) => n + s.closedThisWeek.length, 0);
  const withWork = summaries.filter(
    (s) => s.open.length + s.blocked.length + s.closedThisWeek.length > 0
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-4xl font-bold text-white">Proyectos por iniciativa</h1>
          <p className="mt-1 text-sm text-muted">
            {totalOpen} abiertas · {totalBlocked} bloqueadas · {totalClosed} cerradas desde el {week}
          </p>
        </div>
        <Link href="/equipo/hoy" className="btn btn-ghost py-1.5">
          Volver a tu día
        </Link>
      </header>

      {/* Filtro por horizonte (del trabajo, no de la iniciativa) */}
      <div>
        <nav className="flex flex-wrap gap-2" aria-label="Filtro por horizonte">
          <Link href="/equipo/proyectos" className={`btn py-1.5 text-sm ${!horizon ? "btn-primary" : "btn-ghost"}`}>
            Todos los horizontes
          </Link>
          {HORIZONS.map((h) => (
            <Link
              key={h}
              href={`/equipo/proyectos?horizonte=${encodeURIComponent(h)}`}
              className={`btn py-1.5 text-sm ${horizon === h ? "btn-primary" : "btn-ghost"}`}
            >
              {h}
            </Link>
          ))}
        </nav>
        {horizon ? (
          <p className="mt-2 text-xs text-faint">
            Mostrando solo el trabajo con horizonte <strong className="text-muted">{horizon}</strong>. La etiqueta de
            cada iniciativa refleja su horizonte más urgente, que puede ser distinto.
          </p>
        ) : null}
      </div>

      {withWork.length === 0 ? (
        <EmptyState
          title="Todavía no hay trabajo registrado aquí"
          message="Las iniciativas se llenan cuando se importa el CSV de tareas o cuando alguien crea una asignación. Sin trabajo cargado, esta vista no inventa métricas."
          cta={{ href: "/equipo/hoy", label: "Ir a tu día" }}
        />
      ) : (
        <div className="space-y-6">
          {withWork.map((s) => {
            const key = s.initiative ? `i-${s.initiative.id}` : "sin-iniciativa";
            return (
              <section key={key} className="card p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-head text-2xl font-bold text-white">
                      {s.initiative ? s.initiative.name : "Sin iniciativa"}
                    </h2>
                    <p className="mt-1 text-xs text-faint">
                      {s.open.length} abiertas · {s.blocked.length} bloqueadas · {s.closedThisWeek.length} cerradas
                      esta semana
                    </p>
                  </div>
                  {s.initiative ? <TeamHorizonBadge horizon={s.initiative.horizon} /> : null}
                </div>

                {/* Responsables: carga, no juicio */}
                {s.owners.length > 0 ? (
                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-faint">Responsables</div>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {s.owners.map((o) => (
                        <li key={o.wallet} className="tag border-line text-muted">
                          {o.name} · {o.openCount} en curso
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Bloqueadas primero: es lo único que pide acción */}
                {s.blocked.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-red-300">Bloqueadas</h3>
                    <ul className="mt-2 space-y-2">
                      {s.blocked.map((a) => (
                        <li key={a.id} className="rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm text-white">{a.title}</span>
                            <span className="text-xs text-faint">
                              {a.owner_name ?? "sin responsable"}
                              {a.blocked_at ? ` · desde ${a.blocked_at.slice(0, 10)}` : ""}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-red-200">{a.blocked_reason ?? "sin motivo registrado"}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Abiertas */}
                {s.open.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-white">Abiertas</h3>
                    <ul className="mt-2 space-y-2">
                      {s.open.map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line/60 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <span className="text-sm text-white">{a.title}</span>
                            <span className="ml-2 text-xs text-faint">
                              {a.owner_name ?? "sin responsable"}
                              {a.due_date ? ` · vence ${a.due_date}` : ""}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {a.needs_founder ? (
                              <span className="tag border-amber-700/50 text-amber-300">espera decisión</span>
                            ) : null}
                            <TeamPriorityBadge priority={a.priority} />
                            <TeamStatusBadge status={a.status} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Cerradas esta semana */}
                {s.closedThisWeek.length > 0 ? (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold text-emerald-300">Cerradas esta semana</h3>
                    <ul className="mt-2 space-y-1">
                      {s.closedThisWeek.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1 text-sm">
                          <span className="text-white">{a.title}</span>
                          <span className="text-xs text-faint">
                            {a.owner_name ?? "sin responsable"}
                            {a.closed_at ? ` · ${a.closed_at.slice(0, 10)}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-faint">
        Esta vista cuenta entregas y bloqueos por iniciativa. No puntúa a personas: la carga se muestra para
        repartirla, nunca para rankear a nadie.
      </p>
    </div>
  );
}
