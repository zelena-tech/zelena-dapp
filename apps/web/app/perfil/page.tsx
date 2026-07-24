import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  reputationByAxis,
  reputationByAxisInEpoch,
  reputationHistory,
  pointsByBucket,
  totalPoints,
  claSignature,
  getUser,
  epochProgress,
} from "@/lib/repo";
import { getDb } from "@/lib/db";
import { REPUTATION_AXES, AXIS_LABEL } from "@/lib/config";
import { getActiveGenome, currentEpoch } from "@/lib/genome";
import { ProgressBar, shortWallet } from "@/components/ui";
import InviteGenerator from "@/components/InviteGenerator";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const wallet = session.wallet;
  const user = getUser(wallet);
  const rep = reputationByAxis(wallet);
  const history = reputationHistory(wallet);
  const buckets = pointsByBucket(wallet);
  const points = totalPoints(wallet);
  const cla = claSignature(wallet);
  const tier = user?.tier ?? session.tier ?? "Bronze";
  const cap = getActiveGenome(getDb()).TIER_INVITE_CAPS[tier] ?? 2;

  const invites = getDb()
    .prepare(
      `SELECT code, used_by, expires_at FROM invites WHERE issuer_wallet = ? ORDER BY created_at DESC`
    )
    .all(wallet) as Array<{ code: string; used_by: string | null; expires_at: string }>;
  const activeInvites = invites.filter((i) => !i.used_by).length;

  const maxAxis = Math.max(10, ...REPUTATION_AXES.map((a) => rep[a]));

  // Progreso propio de la época (auto-comparación, regla de producto doc 16).
  const epoch = currentEpoch(getDb());
  const progress = epochProgress(wallet, epoch);
  // "Eje que más creció" = mayor reputación GANADA en esta época (delta), no total de por vida.
  const growth = reputationByAxisInEpoch(wallet, epoch);
  const topAxis = REPUTATION_AXES.reduce((best, a) => (growth[a] > growth[best] ? a : best), REPUTATION_AXES[0]);
  const topGrowth = growth[topAxis];

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-4xl font-bold text-white">{session.name || "Mi perfil"}</h1>
          <p className="mt-1 font-mono text-xs text-faint">{wallet}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="tag tag-sas">Tier {tier}</span>
            {session.isDemo ? <span className="tag border-line text-faint">wallet de prueba</span> : null}
            {user?.status === "alumni" ? <span className="tag border-line text-faint">alumni</span> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="font-head text-4xl font-bold text-primary glow-text">{points.toLocaleString("es")}</div>
          <div className="text-sm text-white">puntos ZWORK</div>
          <div className="text-xs text-faint">no transferibles · fase Génesis</div>
        </div>
      </header>

      {/* Tu progreso — compites contigo mismo; mismo peso visual que cualquier comparación */}
      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Tu progreso</h2>
          <span className="text-xs text-faint">
            Época {progress.epoch}
            {progress.isFirstEpoch ? " · tu primera época" : ""}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Aquí la comparación es contigo: cuánto avanzaste respecto a tu época anterior. Nunca pierdes lo ganado.
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <div>
            <div className="font-head text-3xl font-bold text-primary glow-text">
              {progress.pointsThis.toLocaleString("es")}
            </div>
            <div className="text-sm text-white">puntos esta época</div>
            <div className="text-xs text-faint">
              {progress.isFirstEpoch
                ? "sin época anterior para comparar todavía"
                : `${progress.deltaPoints >= 0 ? "+" : ""}${progress.deltaPoints.toLocaleString("es")} vs época anterior`}
            </div>
          </div>
          <div>
            <div className="font-head text-3xl font-bold text-primary glow-text">{progress.deliverables}</div>
            <div className="text-sm text-white">entregas puntuadas</div>
            <div className="text-xs text-faint">hitos y trabajos aprobados esta época</div>
          </div>
          <div>
            <div className="font-head text-3xl font-bold text-primary glow-text">
              {topGrowth > 0 ? AXIS_LABEL[topAxis] : "—"}
            </div>
            <div className="text-sm text-white">tu eje que más creció</div>
            <div className="text-xs text-faint">
              {topGrowth > 0 ? `+${topGrowth} esta época` : "sin crecimiento de reputación esta época todavía"}
            </div>
          </div>
        </div>
      </section>

      {/* Ejes de reputación */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Reputación por eje</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {REPUTATION_AXES.map((axis) => (
            <div key={axis} className="card p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{AXIS_LABEL[axis]}</span>
                <span className="font-head text-lg text-primary">{rep[axis]}</span>
              </div>
              <div className="mt-3">
                <ProgressBar value={rep[axis]} max={maxAxis} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-faint">
          Desglose de puntos: Ejecución {buckets.ejecucion.toLocaleString("es")} · Academia{" "}
          {buckets.academia.toLocaleString("es")} (pesa la mitad para futuros votos).
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* CLA badge */}
        <section className="card p-6">
          <h2 className="font-head text-xl font-bold text-white">Acuerdo de contribuidor (CLA)</h2>
          {cla ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="text-white">CLA v{cla.cla_version} firmado</span>
                {cla.anchor_status === "anchored" ? (
                  <span className="tag tag-sas">anclado</span>
                ) : cla.anchor_status === "failed" ? (
                  <span className="tag border-red-900/60 text-red-400">falló</span>
                ) : (
                  <span className="tag border-amber-700/50 text-amber-300">anclaje pendiente</span>
                )}
              </div>
              <p className="font-mono text-[11px] text-faint">hash: {cla.cla_hash.slice(0, 40)}…</p>
              {cla.tx_id ? (
                <p className="text-xs text-muted">
                  txId:{" "}
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${cla.tx_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline break-all"
                  >
                    {cla.tx_id}
                  </a>
                </p>
              ) : (
                <p className="text-xs text-faint">El worker de anclaje confirmará el txId en minutos.</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Aún no has firmado el CLA.</p>
          )}
        </section>

        {/* Invitaciones */}
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-head text-xl font-bold text-white">Invitaciones</h2>
            <span className="text-xs text-faint">{activeInvites} / {cap} activas</span>
          </div>
          <InviteGenerator activeCount={activeInvites} cap={cap} tier={tier} />
          <ul className="mt-4 space-y-2">
            {invites.length === 0 ? (
              <li className="text-sm text-faint">Aún no has generado invitaciones.</li>
            ) : (
              invites.map((i) => (
                <li key={i.code} className="flex items-center justify-between rounded-md border border-line/60 px-3 py-2 text-sm">
                  <span className="font-mono text-white">{i.code}</span>
                  {i.used_by ? (
                    <span className="text-xs text-faint">usada por {shortWallet(i.used_by)}</span>
                  ) : (
                    <span className="text-xs text-primary">disponible</span>
                  )}
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      {/* Historial append-only */}
      <section>
        <h2 className="mb-4 font-head text-2xl font-bold text-white">Historial de reputación</h2>
        {history.length === 0 ? (
          <p className="text-sm text-faint">
            Sin eventos todavía. Tu primer punto puede ser hoy: completa{" "}
            <Link href="/academia" className="text-primary hover:underline">un contenido de Academia</Link>{" "}
            (unos minutos) o{" "}
            <Link href="/agora" className="text-primary hover:underline">toma un bounty del Ágora</Link>.
          </p>
        ) : (
          <ol className="space-y-2">
            {history.map((h, i) => (
              <li key={i} className="flex items-center justify-between rounded-md border border-line/50 px-4 py-3 text-sm">
                <div>
                  <span className="text-white">{h.ref}</span>
                  <span className="ml-2 text-xs text-faint">{AXIS_LABEL[h.axis]}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={h.delta >= 0 ? "text-primary" : "text-red-400"}>
                    {h.delta >= 0 ? "+" : ""}
                    {h.delta}
                  </span>
                  <span className="text-xs text-faint">{h.created_at.slice(0, 10)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="text-center">
        <Link href="/agora" className="btn btn-ghost">Explorar el Ágora</Link>
      </div>
    </div>
  );
}
