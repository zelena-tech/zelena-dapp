import Link from "next/link";
import { listProjects, getMilestones } from "@/lib/repo";
import { Tag, StateBadge, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const TYPES = ["Todos", "SAS", "DAO"];
const STATES = ["Todos", "Open", "Assigned", "Delivered", "Scored", "Distributed"];

export default function AgoraPage({ searchParams }: { searchParams: { type?: string; state?: string } }) {
  const type = searchParams.type && searchParams.type !== "Todos" ? searchParams.type : undefined;
  const state = searchParams.state && searchParams.state !== "Todos" ? searchParams.state : undefined;
  const projects = listProjects({ type, state });

  const qs = (t?: string, s?: string) => {
    const p = new URLSearchParams();
    if (t && t !== "Todos") p.set("type", t);
    if (s && s !== "Todos") p.set("state", s);
    const str = p.toString();
    return str ? `/agora?${str}` : "/agora";
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-head text-4xl font-bold text-white">Ágora</h1>
        <p className="mt-2 max-w-2xl text-muted">
          El tablero público de proyectos. Cada bounty lleva etiqueta SAS o DAO fijada en el intake, hitos con pagos y
          criterios de aceptación. Aplica con tu enfoque y tu historial.
        </p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="label mb-0">Tipo</span>
          {TYPES.map((t) => {
            const active = (type ?? "Todos") === t;
            return (
              <Link
                key={t}
                href={qs(t, state)}
                className={`tag ${active ? "border-primary text-primary" : "border-line text-muted"} hover:border-primary/60`}
              >
                {t}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0">Estado</span>
          {STATES.map((s) => {
            const active = (state ?? "Todos") === s;
            return (
              <Link
                key={s}
                href={qs(type, s)}
                className={`tag ${active ? "border-primary text-primary" : "border-line text-muted"} hover:border-primary/60`}
              >
                {s}
              </Link>
            );
          })}
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="Sin proyectos para este filtro"
          message="No hay bounties que coincidan. Prueba con otro tipo o estado, o vuelve pronto: la biblioteca de bounties se llena cada época."
          cta={{ href: "/agora", label: "Quitar filtros" }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => {
            const ms = getMilestones(p.id);
            return (
              <Link key={p.id} href={`/agora/${p.id}`} className="card card-hover flex flex-col p-6">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-faint">{p.campaign}</span>
                  <div className="flex items-center gap-2">
                    <Tag type={p.type} />
                    <StateBadge state={p.state} />
                  </div>
                </div>
                <h2 className="mt-3 font-head text-xl font-bold text-white">{p.title}</h2>
                <p className="mt-2 flex-1 text-sm text-muted">{p.summary}</p>
                <div className="mt-4 flex items-center justify-between border-t border-line/50 pt-4 text-sm">
                  <span className="text-white">
                    <span className="font-head text-lg text-primary">USD {p.budget_usd.toLocaleString("es")}</span>
                  </span>
                  <span className="text-faint">
                    {ms.length} hitos · {p.weeks} semanas
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
