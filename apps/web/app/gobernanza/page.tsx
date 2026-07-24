import { listDecisions, getOpenProposal, voteTally, userVote } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { EmptyState } from "@/components/ui";
import VoteForm from "@/components/VoteForm";

export const dynamic = "force-dynamic";

export default async function GobernanzaPage() {
  const decisions = listDecisions();
  const proposal = getOpenProposal();
  const session = await getSession();
  const tally = proposal ? voteTally(proposal.id) : null;
  const myVote = proposal && session ? userVote(proposal.id, session.wallet)?.choice ?? null : null;
  const total = tally ? tally.favor + tally.contra + tally.abstencion : 0;

  return (
    <div className="space-y-12">
      <header>
        <h1 className="font-head text-4xl font-bold text-white">Gobernanza</h1>
        <p className="mt-2 max-w-2xl text-muted">
          En Stage 0–1 el poder está concentrado por diseño; el riesgo no es el poder, es la opacidad. Por eso cada
          decisión fundacional se registra aquí, con su razón y su hash.
        </p>
      </header>

      {/* Votación abierta */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Votación abierta</h2>
        {proposal ? (
          <div className="card p-6 md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-head text-xl font-bold text-white">{proposal.title}</h3>
              <span className="tag tag-sas">umbral {proposal.threshold}%</span>
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
              <p className="pt-1 text-xs text-faint">{total} votos emitidos · un voto por wallet</p>
            </div>

            <div className="mt-6">
              {session ? (
                <VoteForm proposalId={proposal.id} current={myVote} />
              ) : (
                <p className="text-sm text-faint">Entra y firma el CLA para votar.</p>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="Sin votaciones abiertas" message="No hay propuestas en votación por ahora." />
        )}
      </section>

      {/* Decision log */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Decision log</h2>
        <ol className="space-y-3">
          {decisions.map((d) => (
            <li key={d.id} className="card card-hover p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-head text-lg font-bold text-white">{d.title}</h3>
                <span className="text-xs text-faint">{d.date}</span>
              </div>
              <p className="mt-2 text-sm text-muted">{d.reason}</p>
              <p className="mt-3 font-mono text-[11px] text-faint">hash: {d.hash.slice(0, 32)}…</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
