import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { FOUNDER_WALLET } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listAcademia, listProjects, getMilestones } from "@/lib/repo";
import { Tag, StateBadge, shortWallet, EmptyState } from "@/components/ui";
import { nextAction, type ProjectState } from "@/lib/state-machine";
import AdminAction from "@/components/AdminAction";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  if (session.wallet !== FOUNDER_WALLET) redirect("/perfil");

  const db = getDb();
  const applications = db
    .prepare(
      `SELECT a.*, p.title AS project_title FROM applications a
       JOIN projects p ON p.id = a.project_id ORDER BY a.id DESC`
    )
    .all() as Array<{
    id: number;
    project_id: number;
    wallet: string;
    approach: string;
    timeline: string;
    status: string;
    project_title: string;
  }>;
  const projects = listProjects();
  const academia = listAcademia(true);

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-head text-4xl font-bold text-white">Admin · Founder</h1>
        <p className="mt-2 text-muted">Aprueba aplicaciones, avanza estados, aprueba hitos y modera la Academia.</p>
      </header>

      {/* Aplicaciones */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Aplicaciones</h2>
        {applications.length === 0 ? (
          <EmptyState title="Sin aplicaciones" message="Cuando alguien aplique a un bounty, aparecerá aquí." />
        ) : (
          <div className="space-y-3">
            {applications.map((a) => (
              <div key={a.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold text-white">{a.project_title}</span>
                    <span className="ml-2 text-xs text-faint">{shortWallet(a.wallet)}</span>
                  </div>
                  <span className={`tag ${a.status === "approved" ? "tag-sas" : a.status === "rejected" ? "border-red-900/60 text-red-400" : "border-line text-muted"}`}>
                    {a.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted">{a.approach}</p>
                <p className="mt-1 text-xs text-faint">Plazo: {a.timeline}</p>
                {a.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <AdminAction action="approveApplication" payload={{ applicationId: a.id }} label="Aprobar y asignar" variant="primary" />
                    <AdminAction action="rejectApplication" payload={{ applicationId: a.id }} label="Rechazar" variant="danger" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Proyectos: avanzar estado + aprobar hitos */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Proyectos</h2>
        <div className="space-y-3">
          {projects.map((p) => {
            const na = nextAction(p.state as ProjectState);
            const ms = getMilestones(p.id);
            return (
              <div key={p.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{p.title}</span>
                    <Tag type={p.type} />
                    <StateBadge state={p.state} />
                  </div>
                  <div className="flex items-center gap-2">
                    {p.assignee_wallet ? (
                      <span className="text-xs text-faint">ejecutor: {shortWallet(p.assignee_wallet)}</span>
                    ) : null}
                    {na ? (
                      <AdminAction
                        action="advanceState"
                        payload={{ projectId: p.id }}
                        label={`Avanzar → ${na}`}
                        variant="ghost"
                      />
                    ) : (
                      <span className="tag tag-sas">final</span>
                    )}
                  </div>
                </div>
                {p.assignee_wallet ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ms.map((m) => (
                      <AdminAction
                        key={m.id}
                        action="approveMilestone"
                        payload={{ milestoneId: m.id }}
                        label={m.approved ? `${m.code} ✓` : `Aprobar ${m.code} ($${m.amount_usd})`}
                        variant={m.approved ? "done" : "ghost"}
                        disabled={!!m.approved}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* Academia */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Moderación de Academia</h2>
        <div className="space-y-2">
          {academia.map((c) => (
            <div key={c.id} className="card flex items-center justify-between p-4">
              <div>
                <span className="text-sm text-white">{c.title}</span>
                <span className="ml-2 text-xs text-faint">{c.kind}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`tag ${c.enabled ? "tag-sas" : "border-line text-faint"}`}>
                  {c.enabled ? "publicado" : "despublicado"}
                </span>
                <AdminAction
                  action="toggleContent"
                  payload={{ contentId: c.id }}
                  label={c.enabled ? "Despublicar" : "Publicar"}
                  variant="ghost"
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
