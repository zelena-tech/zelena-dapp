import Link from "next/link";
import { notFound } from "next/navigation";
import { getAcademiaBySlug, academiaAlreadyAwarded } from "@/lib/repo";
import { getSession } from "@/lib/session";
import { Markdown } from "@/components/Markdown";
import Reader from "@/components/Reader";

export const dynamic = "force-dynamic";

export default async function AcademiaDetail({ params }: { params: { slug: string } }) {
  const content = getAcademiaBySlug(params.slug);
  if (!content) notFound();
  const session = await getSession();
  const alreadyAwarded = session ? academiaAlreadyAwarded(session.wallet, content.id) : false;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link href="/academia" className="text-sm text-muted hover:text-primary">
        ← Volver a la Academia
      </Link>

      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="tag border-line text-muted">{content.kind === "video" ? "Video" : "Artículo"}</span>
          <span className="font-head text-lg text-primary">+{content.points} pts · eje Investigación</span>
        </div>
        <h1 className="font-head text-4xl font-bold text-white">{content.title}</h1>
        <p className="text-muted">{content.summary}</p>
      </header>

      {content.kind === "video" && content.video_id ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-line">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${content.video_id}`}
            title={content.title}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
          />
        </div>
      ) : content.body ? (
        <article className="card p-6 md:p-8">
          <Markdown source={content.body} />
        </article>
      ) : null}

      <Reader
        contentId={content.id}
        minSeconds={content.min_seconds}
        points={content.points}
        loggedIn={!!session}
        alreadyAwarded={alreadyAwarded}
      />
    </div>
  );
}
