import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { telegramStatus } from "@/lib/config";
import { adminActor } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { listAcademia, listProjects, getMilestones } from "@/lib/repo";
import { Tag, StateBadge, shortWallet, EmptyState } from "@/components/ui";
import { nextAction, type ProjectState } from "@/lib/state-machine";
import { currentEpoch, getActiveGenome } from "@/lib/genome";
import { latestEpochFitness } from "@/lib/epochs";
import { genomeLineage, pendingMutation } from "@/lib/mutation";
import { listLatentAudits } from "@/lib/audits";
import { founderTeamWallet, linkForWallet, listBotActions } from "@/lib/bot-store";
import AdminAction from "@/components/AdminAction";
import BotLinkPanel from "@/components/BotLinkPanel";
import GenomeMutationPanel from "@/components/GenomeMutationPanel";
import LatentAuditForm from "@/components/LatentAuditForm";
import { INTERES_ENCUENTROS, nombreInteres } from "@/lib/servicios";
import { estadoCierreEpoca } from "@/lib/epocas";
import { panelRitosAdmin, zonaRitos } from "@/lib/ritos";
import EpocaPanel from "@/components/EpocaPanel";
import RitosAdminPanel from "@/components/RitosAdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const db = getDb();
  // Gate por ROL contra la base (no por la wallet de una persona): así el founder
  // que entra por la puerta corporativa (principal `pending:*`) conserva su panel.
  if (!adminActor(session, db)) redirect("/perfil");

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
  // WP19: log del asistente de Telegram + estado del alta.
  const botActions = listBotActions(db, 50);
  const botLink = linkForWallet(db, founderTeamWallet(db, session.wallet));
  const botStatus = telegramStatus();
  const leads = db
    .prepare(`SELECT * FROM leads ORDER BY id DESC LIMIT 100`)
    .all() as Array<{
    id: number;
    nombre: string;
    email: string;
    empresa: string | null;
    interes: string;
    mensaje: string | null;
    created_at: string;
  }>;
  // La misma tabla guarda dos cosas distintas: pedidos de demo y avisos de /encuentros.
  const avisos = leads.filter((l) => l.interes === INTERES_ENCUENTROS);
  const solicitudes = leads.filter((l) => l.interes !== INTERES_ENCUENTROS);

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-head text-4xl font-bold text-white">Admin · Founder</h1>
        <p className="mt-2 text-muted">Aprueba aplicaciones, avanza estados, aprueba hitos y modera la Academia.</p>
      </header>

      {/* Épocas (WP31-D) — cerrar la actual y abrir la siguiente es UNA operación */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Épocas</h2>
        <EpocaPanel estado={estadoCierreEpoca(db)} tz={zonaRitos(db)} />
      </section>

      {/* Ritos (WP31-D) — preparar, quién presenta y relata, abrir y cerrar; solo el conteo */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Ritos</h2>
        <RitosAdminPanel {...panelRitosAdmin(db)} />
      </section>

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

      {/* Asistente de Telegram (WP19) — alta + log de todo lo que hizo el bot */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Asistente de Telegram</h2>
        <div className="card space-y-5 p-6">
          <BotLinkPanel
            linked={!!botLink?.telegram_user_id}
            linkedAt={botLink?.linked_at ?? null}
            enabled={botStatus.enabled}
            missing={botStatus.missing}
            optional={botStatus.optional}
          />

          <div>
            <p className="mb-2 text-sm font-semibold text-white">Log del bot</p>
            <p className="mb-3 text-xs text-faint">
              Toda acción del asistente queda aquí. Se registra qué se hizo y sobre qué pieza, nunca el texto del
              mensaje ni el audio: solo se conserva la nota o la asignación resultante.
            </p>
            {botActions.length === 0 ? (
              <EmptyState title="Sin actividad" message="Cuando el bot atienda un mensaje, aparecerá aquí." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-faint">
                    <tr>
                      <th className="py-1 pr-3">Cuándo</th>
                      <th className="py-1 pr-3">Acción</th>
                      <th className="py-1 pr-3">Resultado</th>
                      <th className="py-1 pr-3">Sobre</th>
                      <th className="py-1">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {botActions.map((a) => (
                      <tr key={a.id} className="border-t border-line/40">
                        <td className="py-1 pr-3 text-faint">{a.created_at}</td>
                        <td className="py-1 pr-3 font-mono text-white">{a.action}</td>
                        <td className="py-1 pr-3">
                          <span
                            className={`tag ${
                              a.outcome === "ok"
                                ? "tag-sas"
                                : a.outcome === "error"
                                  ? "border-red-900/60 text-red-400"
                                  : "border-line text-muted"
                            }`}
                          >
                            {a.outcome}
                          </span>
                        </td>
                        <td className="py-1 pr-3 text-muted">{a.target ?? "—"}</td>
                        <td className="py-1 text-muted">{a.detail ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Solicitudes comerciales desde /empresas/contacto */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Solicitudes de empresas</h2>
        {solicitudes.length === 0 ? (
          <EmptyState
            title="Sin solicitudes"
            message="Cuando alguien pida una demostración desde /empresas, aparecerá aquí."
          />
        ) : (
          <div className="space-y-3">
            {solicitudes.map((l) => (
              <div key={l.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-semibold text-white">{l.nombre}</span>
                    {l.empresa ? <span className="ml-2 text-sm text-muted">· {l.empresa}</span> : null}
                  </div>
                  <span className="tag border-line text-muted">{nombreInteres(l.interes)}</span>
                </div>
                <a href={`mailto:${l.email}`} className="mt-1 inline-block text-sm text-primary hover:underline">
                  {l.email}
                </a>
                {l.mensaje ? <p className="mt-2 text-sm text-muted">{l.mensaje}</p> : null}
                <p className="mt-2 text-xs text-faint">{l.created_at} UTC</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Avisos desde /encuentros */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Avisos de encuentros</h2>
        {avisos.length === 0 ? (
          <EmptyState
            title="Sin avisos"
            message="Cuando alguien deje su correo en /encuentros para enterarse de la próxima fecha, aparecerá aquí."
          />
        ) : (
          <div className="card divide-y divide-line p-0">
            {avisos.map((l) => (
              <div key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
                <div className="text-sm">
                  <span className="text-white">{l.nombre}</span>{" "}
                  <a href={`mailto:${l.email}`} className="text-primary hover:underline">{l.email}</a>
                  {l.mensaje ? <span className="ml-2 text-muted">· {l.mensaje.replace(/^Ciudad: /, "")}</span> : null}
                </div>
                <span className="text-xs text-faint">{l.created_at} UTC</span>
              </div>
            ))}
          </div>
        )}
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
