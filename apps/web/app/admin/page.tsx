import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { FOUNDER_WALLET } from "@/lib/config";
import { getDb } from "@/lib/db";
import { listAcademia, listProjects, getMilestones } from "@/lib/repo";
import { Tag, StateBadge, shortWallet, EmptyState } from "@/components/ui";
import { nextAction, type ProjectState } from "@/lib/state-machine";
import { currentEpoch, getActiveGenome } from "@/lib/genome";
import { latestEpochFitness } from "@/lib/epochs";
import { genomeLineage, pendingMutation } from "@/lib/mutation";
import { listLatentAudits } from "@/lib/audits";
import AdminAction from "@/components/AdminAction";
import GenomeMutationPanel from "@/components/GenomeMutationPanel";
import LatentAuditForm from "@/components/LatentAuditForm";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const db = getDb();
  // Acceso al panel: el fundador por configuración, o cualquier wallet marcada
  // como supervisora en la base (users.is_supervisor). Permite dar seguimiento
  // desde la wallet propia sin reconfigurar FOUNDER_WALLET ni re-sembrar.
  const supervisora =
    session.wallet === FOUNDER_WALLET ||
    (
      db.prepare(`SELECT is_supervisor FROM users WHERE wallet = ?`).get(session.wallet) as
        | { is_supervisor: number }
        | undefined
    )?.is_supervisor === 1;
  if (!supervisora) redirect("/perfil");

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
  const epoch = currentEpoch(db);
  const fitness = latestEpochFitness(db);
  const genome = getActiveGenome(db, epoch);
  const lineage = genomeLineage(db);
  const pending = pendingMutation(db);
  const latestVersion = lineage.length ? lineage[lineage.length - 1].version : 1;
  const numericGenes: Array<keyof typeof genome> = ["EPOCH_BUDGET", "ACADEMIA_BUDGET", "ACADEMIA_DAILY_CAP", "ACADEMIA_VOTE_WEIGHT"];
  const audits = listLatentAudits(db);

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-head text-4xl font-bold text-white">Admin · Founder</h1>
        <p className="mt-2 text-muted">Aprueba aplicaciones, avanza estados, aprueba hitos y modera la Academia.</p>
      </header>

      {/* Motor de épocas · Fitness (WP07) — el algoritmo propone, el founder firma */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Motor de épocas · Fitness</h2>
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white">
                Época actual: <span className="text-primary">{epoch}</span>
              </p>
              <p className="text-xs text-faint">Al cierre se mide el fitness del genoma y se recomienda mantener o revertir. Tú firmas.</p>
            </div>
            <AdminAction action="computeEpochFitness" payload={{ epoch }} label="Calcular fitness de la época" variant="primary" />
          </div>

          {fitness ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-baseline gap-4">
                <div className="font-head text-4xl font-bold text-primary glow-text">{fitness.score.toFixed(3)}</div>
                <div className="text-sm text-muted">
                  fitness de la época {fitness.epoch}
                  {fitness.prevScore !== null ? ` · anterior ${fitness.prevScore.toFixed(3)}` : " · primera época (sin comparación)"}
                </div>
                <span className={`tag ${fitness.recommendation === "keep" ? "tag-sas" : "border-amber-700/50 text-amber-300"}`}>
                  recomendación: {fitness.recommendation === "keep" ? "mantener" : "revertir"}
                </span>
                {fitness.signed ? (
                  <span className="tag border-line text-faint">
                    firmado: {fitness.signedDecision === "keep" ? "mantener" : "revertir"}
                  </span>
                ) : null}
              </div>

              {/* Desglose por componente (explicabilidad) */}
              <div className="space-y-2">
                {fitness.components.map((c) => (
                  <div key={c.key} className="flex items-center justify-between rounded-md border border-line/50 px-3 py-2 text-sm">
                    <span className="text-white">{c.label}</span>
                    {c.value === null ? (
                      <span className="text-xs text-faint">sin datos · {c.note}</span>
                    ) : (
                      <span className="text-xs text-muted">
                        valor {c.value.toFixed(2)} · peso {c.weight} · aporta {c.contribution.toFixed(3)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {!fitness.signed ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <AdminAction
                    action="signEpochDecision"
                    payload={{ epochFitnessId: fitness.id, decision: "keep" }}
                    label="Firmar: mantener genoma"
                    variant="primary"
                  />
                  <AdminAction
                    action="signEpochDecision"
                    payload={{ epochFitnessId: fitness.id, decision: "revert" }}
                    label="Firmar: revertir genoma"
                    variant="danger"
                  />
                </div>
              ) : (
                <p className="text-xs text-faint">Decisión firmada y registrada en el decision log (visible en Gobernanza).</p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-faint">Aún no has calculado el fitness de esta época.</p>
          )}
        </div>
      </section>

      {/* Genoma · Mutación por época (WP08) */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Genoma · Mutación por época</h2>
        <div className="card space-y-6 p-6">
          <div>
            <p className="text-sm text-white">Genoma activo (época {epoch}):</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {numericGenes.map((g) => (
                <div key={String(g)} className="rounded-md border border-line/50 px-3 py-2 text-sm">
                  <div className="text-xs text-faint">{String(g)}</div>
                  <div className="font-mono text-white">{Number(genome[g]).toLocaleString("es")}</div>
                </div>
              ))}
            </div>
          </div>

          {pending && pending.changes.length > 0 ? (
            <div className="rounded-md border border-primary/30 bg-primary/[0.06] p-3 text-sm">
              <span className="font-bold text-primary">Mutación anunciada</span> para la época {pending.targetEpoch}:{" "}
              {pending.changes.map((c) => `${c.key} = ${c.to.toLocaleString("es")} (antes ${c.from.toLocaleString("es")})`).join(" · ")}
            </div>
          ) : (
            <p className="text-xs text-faint">No hay mutación propuesta para la época {epoch + 1} todavía.</p>
          )}

          <GenomeMutationPanel
            current={genome as unknown as Record<string, number>}
            nextEpoch={epoch + 1}
            latestVersion={latestVersion}
          />

          {/* Linaje del genoma (auditoría) */}
          <div>
            <p className="mb-2 text-sm font-semibold text-white">Linaje del genoma</p>
            <ol className="space-y-1 text-xs">
              {lineage.map((l) => (
                <li key={l.version} className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-line/40 px-3 py-2">
                  <span className="font-mono text-primary">v{l.version}</span>
                  <span className="text-faint">efectiva época {l.effectiveFromEpoch}</span>
                  {l.reason ? <span className="text-muted">· {l.reason}</span> : null}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Auditoría de funciones latentes (WP12) */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Auditoría de funciones latentes</h2>
        <div className="card space-y-4 p-6">
          <p className="text-sm text-muted">
            Merton: toda mecánica produce consecuencias no buscadas. Pregunta por mecánica: ¿qué produce que no
            buscábamos? ¿funcional para quién? La disfunción puede entrar como propuesta de mutación.
          </p>
          <LatentAuditForm defaultPeriod={`Época ${epoch}`} />
          <p className="text-xs text-faint">
            {audits.length} auditoría(s) registrada(s). El registro completo es público en Gobernanza.
          </p>
        </div>
      </section>

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
                    {/* Se califica la propuesta, no la persona (regla de producto doc 16). */}
                    {a.status === "approved" ? "aprobada" : a.status === "rejected" ? "no seleccionada" : "en revisión"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted">{a.approach}</p>
                <p className="mt-1 text-xs text-faint">Plazo: {a.timeline}</p>
                {a.status === "pending" ? (
                  <div className="mt-3 flex gap-2">
                    <AdminAction action="approveApplication" payload={{ applicationId: a.id }} label="Aprobar y asignar" variant="primary" />
                    <AdminAction action="rejectApplication" payload={{ applicationId: a.id }} label="No seleccionar" variant="danger" />
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
