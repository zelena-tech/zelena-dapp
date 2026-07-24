import Link from "next/link";
import { listAcademia, academiaAwardsToday, academiaAlreadyAwarded } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { getActiveGenome } from "@/lib/genome";

export const dynamic = "force-dynamic";

export default async function AcademiaPage() {
  const content = listAcademia();
  const session = await getSession();
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = session ? academiaAwardsToday(session.wallet, today) : 0;
  const genome = getActiveGenome(getDb());

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-head text-4xl font-bold text-white">Academia</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Aprende cómo funciona Zelena y gana puntos en el eje Investigación / Contenido. Lee de verdad: hay tiempo
          mínimo, un quiz al final y rendimientos decrecientes. El conocimiento se premia, el farmeo no.
        </p>
      </header>

      {session ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span className="text-muted">
            Contenidos con puntos hoy: <span className="text-primary">{usedToday}</span> / {genome.ACADEMIA_DAILY_CAP}
          </span>
          <span className="text-faint">
            2º del día 75% · 3º 50% · presupuesto de época Academia: {genome.ACADEMIA_BUDGET.toLocaleString("es")} pts
          </span>
        </div>
      ) : (
        <div className="card p-4 text-sm text-faint">
          Puedes leer sin entrar, pero para ganar puntos necesitas{" "}
          <Link href="/entrar" className="text-primary hover:underline">firmar el CLA</Link>.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {content.map((c) => {
          const awarded = session ? academiaAlreadyAwarded(session.wallet, c.id) : false;
          return (
            <Link key={c.id} href={`/academia/${c.slug}`} className="card card-hover flex flex-col p-6">
              <div className="flex items-center justify-between">
                <span className="tag border-line text-muted">{c.kind === "video" ? "Video" : "Artículo"}</span>
                <span className="font-head text-lg text-primary">+{c.points} pts</span>
              </div>
              <h2 className="mt-3 font-head text-xl font-bold text-white">{c.title}</h2>
              <p className="mt-2 flex-1 text-sm text-muted">{c.summary}</p>
              <div className="mt-4 flex items-center justify-between border-t border-line/50 pt-3 text-xs text-faint">
                <span>Tiempo mínimo {c.min_seconds}s · quiz 2/3</span>
                {awarded ? <span className="text-emerald-400">completado</span> : <span className="text-primary">disponible</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
