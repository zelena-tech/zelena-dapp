import type { Metadata } from "next";
import { listDecisions, getOpenProposal, voteTally, userVote } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { listLatentAudits } from "@/lib/audits";
import { REEMPLAZO_DECISION, esActaDeRito, esDecisionReemplazada, huellaCorta } from "@/lib/agora-labels";
import { EmptyState } from "@/components/ui";
import VoteForm from "@/components/VoteForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Decisiones", // el layout le añade "· Zelena"
  description: "Cada decisión de Zelena, con su razón y su huella, para que cualquiera pueda revisarla.",
};

const TITULAR_H2 =
  "font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl";

export default async function GobernanzaPage() {
  // Las actas de cierre de los ritos se ven en Comunidad, no aquí. Lo más reciente, primero.
  const decisions = listDecisions()
    .filter((d) => !esActaDeRito(d.title))
    .reverse();
  const reemplazo = decisions.find((d) => d.title === REEMPLAZO_DECISION) ?? null;
  const proposal = getOpenProposal();
  const audits = listLatentAudits(getDb());
  const session = await getSession();
  const tally = proposal ? voteTally(proposal.id) : null;
  const myVote = proposal && session ? userVote(proposal.id, session.wallet)?.choice ?? null : null;
  const total = tally ? tally.favor + tally.contra + tally.abstencion : 0;

  return (
    <div className="space-y-20 md:space-y-24">
      <header className="flex flex-col gap-8 pt-6 md:pt-14">
        <p className="label">Gobernanza</p>
        <h1 className="max-w-4xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[68px] lg:leading-[1.08]">
          Decisiones
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted lg:text-lg">
          Cada decisión se registra aquí con su razón y su huella, para que cualquiera pueda revisarla.
        </p>
      </header>

      {/* Votación abierta */}
      <section className="space-y-6">
        <h2 className={TITULAR_H2}>Votación abierta</h2>
        {proposal ? (
          <div className="card p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-head text-xl font-bold text-white">{proposal.title}</h3>
              <span className="tag tag-sas">se aprueba con {proposal.threshold} %</span>
            </div>
            <p className="mt-3 max-w-3xl text-sm text-muted">{proposal.description}</p>

            {/* Resultados en vivo */}
            <div className="mt-6 space-y-3">
              {(["favor", "contra", "abstencion"] as const).map((k) => {
                const n = tally ? tally[k] : 0;
                const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                const label = k === "favor" ? "A favor" : k === "contra" ? "En contra" : "Abstención";
                const color = k === "favor" ? "bg-primary" : k === "contra" ? "bg-red-500" : "bg-faint";
                return (
                  <div key={k}>
                    <div className="flex justify-between text-sm">
                      <span className="text-white">{label}</span>
                      <span className="text-muted">{n} · {pct}%</span>
                    </div>
                    <div className="bar-track mt-1 h-2 w-full overflow-hidden rounded-full">
                      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-xs text-faint">{total} votos emitidos · un voto por persona</p>
            </div>

            <div className="mt-6">
              {session ? (
                <VoteForm proposalId={proposal.id} current={myVote} />
              ) : (
                <p className="text-sm text-faint">Para votar, entra y firma el acuerdo de contribución.</p>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="Sin votaciones abiertas" message="No hay propuestas en votación por ahora." />
        )}
      </section>

      {/* Lo que aprendimos de cada regla (auditoría pública de efectos no buscados, WP12) */}
      <section className="space-y-6">
        <div className="space-y-4">
          <h2 className={TITULAR_H2}>Lo que aprendimos de cada regla</h2>
          <p className="max-w-2xl text-base leading-7 text-muted">
            A cada regla le preguntamos qué produce que no buscábamos, a quién le sirve y a quién no. Lo publicamos
            aquí, aunque no nos deje bien.
          </p>
        </div>
        {audits.length === 0 ? (
          <EmptyState
            title="Todavía no hay revisiones"
            message="La primera se publica al cierre de la tercera temporada. Volverá aquí, pública y cada trimestre."
          />
        ) : (
          <ol className="space-y-3">
            {audits.map((a) => (
              <li key={a.id} className="card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-head text-lg font-bold text-white">
                    <span className="tag border-line text-muted">{a.mechanism}</span>{" "}
                    <span className="ml-1 text-sm text-faint">{a.period}</span>
                  </h3>
                  <span
                    className={`tag ${
                      a.action === "mutation_proposed"
                        ? "tag-sas"
                        : a.action === "mechanism_change"
                        ? "border-amber-700/50 text-amber-300"
                        : "border-line text-faint"
                    }`}
                  >
                    {a.action === "mutation_proposed"
                      ? "cambio propuesto"
                      : a.action === "mechanism_change"
                      ? "cambio de regla"
                      : "solo registro"}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-faint">Lo que buscaba</dt>
                    <dd className="text-muted">{a.manifestFunction}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">Lo que produjo sin buscarlo</dt>
                    <dd className="text-muted">{a.latentObserved}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">A quién le sirve</dt>
                    <dd className="text-muted">{a.functionalFor}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-faint">A quién no le sirve</dt>
                    <dd className="text-muted">{a.dysfunctionalFor}</dd>
                  </div>
                </dl>
                {a.action === "mutation_proposed" && a.decisionLogId ? (
                  <p className="mt-3 text-xs">
                    <a href={`#dec-${a.decisionLogId}`} className="text-primary hover:underline">
                      → Ver la decisión{a.decisionTitle ? `: ${a.decisionTitle}` : ""}
                    </a>
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Decisiones */}
      <section className="space-y-6">
        <h2 className={TITULAR_H2}>Todas las decisiones</h2>
        {decisions.length === 0 ? (
          <EmptyState title="Todavía no hay decisiones publicadas" message="La primera aparecerá aquí, con su razón y su huella." />
        ) : (
          <ol className="space-y-3">
            {decisions.map((d) => (
              <li key={d.id} id={`dec-${d.id}`} className="card card-hover p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-serif text-xl font-normal normal-case leading-snug tracking-normal text-paper">{d.title}</h3>
                  <span className="text-xs text-faint">{d.date}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">{d.reason}</p>
                {esDecisionReemplazada(d.reason) ? (
                  <p className="mt-3 border-l-2 border-primary pl-3 text-sm text-paper">
                    Reemplazada por:{" "}
                    {reemplazo ? (
                      <a href={`#dec-${reemplazo.id}`} className="text-primary hover:underline">
                        {REEMPLAZO_DECISION}
                      </a>
                    ) : (
                      REEMPLAZO_DECISION
                    )}
                  </p>
                ) : null}
                <p className="mt-3 font-mono text-[11px] text-faint">huella: {huellaCorta(d, 32)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
