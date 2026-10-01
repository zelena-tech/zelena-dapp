import Link from "next/link";
import { listAcademia, academiaAwardsToday, academiaAlreadyAwarded } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { getDb } from "@/lib/db";
import { getActiveGenome } from "@/lib/genome";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AcademiaPage() {
  const content = listAcademia();
  const session = await getSession();
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = session ? academiaAwardsToday(session.wallet, today) : 0;
  const genome = getActiveGenome(getDb());

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-6 pt-4 md:pt-8">
        <p className="label">Academia</p>
        <h1 className="max-w-4xl font-serif text-4xl font-normal normal-case leading-[1.1] tracking-normal text-paper sm:text-5xl lg:text-[64px]">
          Aprende haciendo.
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Aprende cómo funciona Zelena y gana puntos y reputación en investigación. Cada lectura tiene un tiempo
          mínimo y unas preguntas al final, y cada contenido extra del mismo día vale un poco menos.
        </p>
        <p className="max-w-2xl font-serif text-xl normal-case italic leading-snug text-primary">
          Se premia aprender, no acumular sin aprender.
        </p>
      </header>

      {session ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span className="text-muted">
            Contenidos con puntos hoy: <span className="text-primary">{usedToday}</span> / {genome.ACADEMIA_DAILY_CAP}
          </span>
          <span className="text-faint">
            El 2.º del día vale 75 % y el 3.º, 50 % · presupuesto de la Academia esta temporada:{" "}
            {genome.ACADEMIA_BUDGET.toLocaleString("es")} pts
          </span>
        </div>
      ) : (
        <div className="card p-4 text-sm text-faint">
          Puedes leer sin entrar, pero para ganar puntos necesitas{" "}
          <Link href="/entrar" className="text-primary hover:underline">firmar el acuerdo de contribución</Link>.
        </div>
      )}

      {content.length === 0 ? (
        <EmptyState
          title="Aún no hay contenidos publicados"
          message="La Academia se está preparando. Mientras tanto, explora el Ágora y toma tu primer proyecto: tu reputación puede empezar hoy."
          cta={{ href: "/agora", label: "Ir al Ágora" }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {content.map((c) => {
          const awarded = session ? academiaAlreadyAwarded(session.wallet, c.id) : false;
          return (
            <Link key={c.id} href={`/academia/${c.slug}`} className="card card-hover flex flex-col p-6">
              <div className="flex items-center justify-between">
                <span className="tag border-line text-muted">{c.kind === "video" ? "Video" : "Artículo"}</span>
                <span className="font-head text-lg text-primary">+{c.points} pts</span>
              </div>
              <h2 className="mt-3 font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper">{c.title}</h2>
              <p className="mt-2 flex-1 text-sm text-muted">{c.summary}</p>
              <div className="mt-4 flex items-center justify-between border-t border-line/50 pt-3 text-xs text-faint">
                <span>Lectura mínima {c.min_seconds} s · 2 de 3 respuestas</span>
                {awarded ? <span className="text-emerald-400">completado</span> : <span className="text-primary">disponible</span>}
              </div>
            </Link>
          );
          })}
        </div>
      )}
    </div>
  );
}
