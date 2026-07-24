import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject, getMilestones } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { Tag, StateBadge, shortWallet } from "@/components/ui";
import ApplyForm from "@/components/ApplyForm";
import { PROJECT_STATES, type ProjectState } from "@/lib/state-machine";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();
  const project = getProject(id);
  if (!project) notFound();
  const milestones = getMilestones(id);
  const session = await getSession();

  let cumulativePct = 0;
  let cumulativeUsd = 0;

  return (
    <div className="space-y-8">
      <Link href="/agora" className="text-sm text-muted hover:text-primary">
        ← Volver al Ágora
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">{project.campaign}</span>
          <Tag type={project.type} />
          <StateBadge state={project.state} />
        </div>
        <h1 className="font-head text-4xl font-bold text-white">{project.title}</h1>
        <p className="max-w-2xl text-muted">{project.description}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          {/* Tabla de hitos */}
          <section className="card p-6">
            <h2 className="font-head text-xl font-bold text-white">Pagos por hitos</h2>
            <p className="mt-1 text-sm text-faint">Presupuesto total: USD {project.budget_usd.toLocaleString("es")}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-2 py-2">Hito</th>
                    <th className="px-2 py-2">Semana</th>
                    <th className="px-2 py-2 text-right">%</th>
                    <th className="px-2 py-2 text-right">Pago</th>
                    <th className="px-2 py-2 text-right">Acumulado</th>
                    <th className="px-2 py-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones.map((m) => {
                    cumulativePct += m.pct;
                    cumulativeUsd += m.amount_usd;
                    return (
                      <tr key={m.id} className="border-b border-line/40">
                        <td className="px-2 py-2">
                          <span className="font-semibold text-white">{m.code}</span>{" "}
                          <span className="text-muted">{m.name}</span>
                        </td>
                        <td className="px-2 py-2 text-faint">{m.week}</td>
                        <td className="px-2 py-2 text-right text-muted">{m.pct}%</td>
                        <td className="px-2 py-2 text-right text-white">${m.amount_usd}</td>
                        <td className="px-2 py-2 text-right text-primary">
                          {cumulativePct}% · ${cumulativeUsd}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {m.approved ? (
                            <span className="text-xs text-emerald-400">aprobado</span>
                          ) : (
                            <span className="text-xs text-faint">pendiente</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Criterios de aceptación */}
          <section className="card p-6">
            <h2 className="font-head text-xl font-bold text-white">Criterios de aceptación</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{project.acceptance}</p>
          </section>
        </div>

        {/* Sidebar: aplicar */}
        <aside className="space-y-4">
          <div className="card p-6">
            <h3 className="font-head text-lg font-bold text-white">Ficha</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Tipo de PI</dt>
                <dd><Tag type={project.type} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Presupuesto</dt>
                <dd className="text-white">USD {project.budget_usd.toLocaleString("es")}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Duración</dt>
                <dd className="text-white">{project.weeks} semanas</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Supervisor</dt>
                <dd className="text-white">{shortWallet(project.supervisor_wallet)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Estado</dt>
                <dd><StateBadge state={project.state} /></dd>
              </div>
            </dl>
            {/* Progreso de la máquina de estados */}
            <div className="mt-4 flex items-center gap-1 text-[10px]">
              {PROJECT_STATES.map((s, i) => {
                const done = PROJECT_STATES.indexOf(project.state as ProjectState) >= i;
                return (
                  <div key={s} className="flex flex-1 flex-col items-center gap-1">
                    <div className={`h-1 w-full rounded ${done ? "bg-primary" : "bg-line"}`} />
                    <span className={done ? "text-primary" : "text-faint"}>{s}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {project.state === "Open" ? (
            session ? (
              <ApplyForm projectId={project.id} />
            ) : (
              <div className="card p-6 text-center">
                <p className="text-sm text-muted">Necesitas entrar y firmar el CLA para aplicar.</p>
                <Link href="/entrar" className="btn btn-primary mt-3 w-full">
                  Tengo una invitación
                </Link>
              </div>
            )
          ) : (
            <div className="card p-6 text-center text-sm text-faint">
              Este bounty ya no recibe aplicaciones (estado: {project.state}).
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
