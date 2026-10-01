import Link from "next/link";
import { listProjects, getMilestones } from "@/lib/repo";
import { Tag, StateBadge, EmptyState } from "@/components/ui";
import { PROJECT_STATES } from "@/lib/state-machine";
import { etiquetaEstado, queryDesdeTipo, tipoDesdeQuery, type TipoProyecto } from "@/lib/agora-labels";

export const dynamic = "force-dynamic";

// Filtro "Para quién". El valor interno vive en lib/agora-labels.ts; en la URL va
// `?tipo=cliente|comunidad` (se sigue aceptando el `?type=` de los enlaces viejos).
const TIPOS: ReadonlyArray<{ tipo: TipoProyecto | undefined; label: string }> = [
  { tipo: undefined, label: "Todos" },
  { tipo: tipoDesdeQuery("cliente"), label: "Clientes" },
  { tipo: tipoDesdeQuery("comunidad"), label: "Comunidad" },
];
const ESTADOS = ["Todos", ...PROJECT_STATES];

export default function AgoraPage({
  searchParams,
}: {
  searchParams: { tipo?: string; type?: string; state?: string };
}) {
  const tipo = tipoDesdeQuery(searchParams.tipo ?? searchParams.type);
  const state = searchParams.state && searchParams.state !== "Todos" ? searchParams.state : undefined;
  const projects = listProjects({ type: tipo, state });

  const qs = (t?: TipoProyecto, s?: string) => {
    const p = new URLSearchParams();
    if (t) p.set("tipo", queryDesdeTipo(t));
    if (s && s !== "Todos") p.set("state", s);
    const str = p.toString();
    return str ? `/agora?${str}` : "/agora";
  };

  return (
    <div className="space-y-10">
      <header className="flex flex-col gap-6 pt-4 md:pt-8">
        <p className="label">Proyectos abiertos</p>
        <h1 className="font-serif text-4xl font-normal normal-case leading-[1.1] tracking-normal text-paper sm:text-5xl lg:text-[64px]">
          Ágora
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Cada proyecto dice si es para un cliente o para la comunidad, con sus hitos, sus pagos y cómo se va a evaluar
          la entrega. Aplica con tu enfoque y tu historial.
        </p>
      </header>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0">Para quién</span>
          {TIPOS.map((t) => {
            const active = tipo === t.tipo;
            return (
              <Link
                key={t.label}
                href={qs(t.tipo, state)}
                className={`tag ${active ? "border-primary text-primary" : "border-line text-muted"} hover:border-primary/60`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label mb-0">Estado</span>
          {ESTADOS.map((s) => {
            const active = (state ?? "Todos") === s;
            return (
              <Link
                key={s}
                href={qs(tipo, s)}
                className={`tag ${active ? "border-primary text-primary" : "border-line text-muted"} hover:border-primary/60`}
              >
                {s === "Todos" ? s : etiquetaEstado(s)}
              </Link>
            );
          })}
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="Sin proyectos para este filtro"
          message="No hay proyectos con este filtro. Vuelve pronto: se abren nuevos cada temporada."
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
                <h2 className="mt-3 font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper">
                  {p.title}
                </h2>
                <p className="mt-2 flex-1 text-sm text-muted">{p.summary}</p>
                <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-line/50 pt-4 text-sm">
                  <span className="text-white">
                    <span className="font-head text-lg text-primary">USD {p.budget_usd.toLocaleString("es")}</span>{" "}
                    <span className="text-xs text-faint">· Red de pruebas</span>
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
