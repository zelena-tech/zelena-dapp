/**
 * `/perfil` — lo tuyo: puntos, reputación, acuerdo de contribución e invitaciones.
 *
 * WP31-I2:
 *  - "Tu progreso" suma, además, los puntos y la reputación de la temporada por entregas
 *    aprobadas (`progresoDeTareas`, todas tus identidades) y tus insignias (`Insignias`,
 *    metas del genoma). La comparación es contigo; nada se pierde ni se compara con nadie.
 *  - La firma del acuerdo solo enlaza al explorador una transacción verificable
 *    (`txVerificable`: 64 hexadecimales); las semillas de prueba no se enlazan.
 *  - Quien entra por la comunidad y aún no está en ningún proyecto (la puerta de
 *    `/equipo` lo trae aquí) ve qué le falta para empezar, sin jerga.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
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
import { insignias, progresoDeTareas, senalesProgreso } from "@/lib/gamificacion";
import { EXPLORADOR_TX, txVerificable } from "@/lib/pruebas-testnet";
import { ProgressBar, shortWallet } from "@/components/ui";
import InviteGenerator from "@/components/InviteGenerator";
import Insignias from "@/components/Insignias";

/** Qué fue cada evento de reputación, en palabras (el `ref` técnico queda en el title). */
function etiquetaRef(ref: string): string {
  const entrega = /^assignment:(\d+)$/.exec(ref);
  if (entrega) return `Entrega aprobada #${entrega[1]}`;
  const rito = /^rito:\d+:(asistencia|anfitrion|relator)$/.exec(ref);
  if (rito) {
    if (rito[1] === "asistencia") return "Asistencia a un rito";
    return rito[1] === "anfitrion" ? "Anfitrión de un rito" : "Relator de un rito";
  }
  return ref;
}

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const wallet = session.wallet;
  const db = getDb();
  const user = getUser(wallet);
  const rep = reputationByAxis(wallet);
  const history = reputationHistory(wallet);
  const buckets = pointsByBucket(wallet);
  const points = totalPoints(wallet);
  const cla = claSignature(wallet);
  const tier = user?.tier ?? session.tier ?? "Bronze";
  const cap = getActiveGenome(db).TIER_INVITE_CAPS[tier] ?? 2;

  const invites = db
    .prepare(
      `SELECT code, used_by, expires_at FROM invites WHERE issuer_wallet = ? ORDER BY created_at DESC`
    )
    .all(wallet) as Array<{ code: string; used_by: string | null; expires_at: string }>;
  const activeInvites = invites.filter((i) => !i.used_by).length;

  const maxAxis = Math.max(10, ...REPUTATION_AXES.map((a) => rep[a]));

  // Progreso propio de la época (auto-comparación, regla de producto doc 16).
  const epoch = currentEpoch(db);
  const progress = epochProgress(wallet, epoch);
  // Entregas aprobadas por otra persona: temporada e insignias (todas tus identidades).
  const temporada = progresoDeTareas(db, wallet, epoch);
  const senales = senalesProgreso(db, wallet);
  const misInsignias = insignias(senales, getActiveGenome(db, epoch).BADGE_GOALS);

  // ¿Entra a /equipo? La misma puerta que el trabajo (lee la base, nunca la cookie).
  const trabajo = equipoActor(session, db);
  const fila = db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(wallet) as { role: string | null } | undefined;
  const esComunidadSinProyecto = !trabajo && fila?.role === "contributor" && user?.status !== "alumni";
  const firmoAcuerdo = user?.cla_signed === 1;
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
        <p className="mt-3 text-sm text-white">
          Esta temporada sumaste{" "}
          <span className="font-bold text-primary">{temporada.puntos.toLocaleString("es")}</span> puntos y{" "}
          <span className="font-bold text-primary">{temporada.reputacion.toLocaleString("es")}</span> de reputación
          en ejecución por entregas aprobadas.
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
        <p className="mt-5 text-xs text-faint">
          {senales.entregasAprobadas === 0
            ? "Cuando otra persona apruebe tu primera entrega, empieza a contar aquí."
            : `Desde que empezaste: ${senales.entregasAprobadas} ${
                senales.entregasAprobadas === 1 ? "entrega aprobada" : "entregas aprobadas"
              } por otra persona, ${senales.entregasATiempo} dentro de su plazo.`}
        </p>
        <div className="mt-5 border-t border-line/60 pt-5">
          <Insignias insignias={misInsignias} />
        </div>
      </section>

      {/* Quien entra por la comunidad y aún no tiene proyecto: qué le falta para empezar */}
      {esComunidadSinProyecto ? (
        <section className="card p-6">
          <h2 className="font-head text-2xl font-bold text-white">Tus proyectos</h2>
          {firmoAcuerdo ? (
            <>
              <p className="mt-2 text-sm text-muted">
                Todavía no estás en ningún proyecto. Cuando quien estructura un proyecto te sume, en el menú
                aparecerá {"«Mi día»"}, con tus entregas y el tablero del proyecto.
              </p>
              <p className="mt-2 text-sm text-muted">
                Mientras tanto, los proyectos abiertos del Ágora están a la vista de todos: aplica con tu enfoque.
              </p>
              <Link href="/agora" className="btn btn-primary mt-4">
                Ver proyectos abiertos
              </Link>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                Antes del primer trabajo hay un paso: firmar el acuerdo de contribución. Tu autoría sigue siendo tuya.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/entrar" className="btn btn-primary">
                  Firmar el acuerdo
                </Link>
                <Link href="/acuerdo" className="btn btn-ghost">
                  Leer el acuerdo
                </Link>
              </div>
            </>
          )}
        </section>
      ) : null}

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
              {/* Solo se enlaza una transacción verificable (64 hex); una semilla de prueba no. */}
              {cla.tx_id && txVerificable(cla.tx_id) ? (
                <p className="text-xs text-muted">
                  Transacción en la red de pruebas:{" "}
                  <a
                    href={`${EXPLORADOR_TX}${cla.tx_id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary hover:underline break-all"
                  >
                    {cla.tx_id}
                  </a>
                </p>
              ) : cla.tx_id ? (
                <p className="text-xs text-faint">
                  Esta firma es de prueba: no tiene una transacción pública que se pueda abrir en el explorador.
                </p>
              ) : (
                <p className="text-xs text-faint">El anclaje en la red de pruebas se confirma en unos minutos.</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Aún no has firmado el CLA.</p>
          )}
        </section>

        {/* Invitaciones */}
        <section id="invitar" className="card scroll-mt-24 p-6">
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
            <Link href="/agora" className="text-primary hover:underline">toma un proyecto del Ágora</Link>.
          </p>
        ) : (
          <ol className="space-y-2">
            {history.map((h, i) => (
              <li key={i} className="flex items-center justify-between rounded-md border border-line/50 px-4 py-3 text-sm">
                <div>
                  <span className="text-white" title={h.ref}>
                    {etiquetaRef(h.ref)}
                  </span>
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
