/** WP14 · /equipo/proyectos — el backlog por iniciativa. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listInitiatives, listBacklog, loadByPerson, blockedAssignments } from "@/lib/assignments";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const COLOR_ESTADO: Record<string, string> = {
  Backlog: "text-muted border-line",
  Asignada: "text-amber-300 border-amber-700/40 bg-amber-950/20",
  "En curso": "text-primary border-primary/40 bg-glow",
  "En revisión": "text-sky-300 border-sky-700/40 bg-sky-950/20",
  Hecha: "text-emerald-300 border-emerald-700/40 bg-emerald-950/20",
  Bloqueada: "text-red-300 border-red-700/40 bg-red-950/20",
};

export default async function ProyectosPage({ searchParams }: { searchParams: { horizonte?: string } }) {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const db = getDb();
  const horizonte = searchParams.horizonte;
  const iniciativas = listInitiatives(db, horizonte);
  const bloqueadas = blockedAssignments(db);
  const carga = loadByPerson(db);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-3xl font-bold text-white">Proyectos</h1>
          <p className="mt-1 text-sm text-muted">El trabajo abierto por iniciativa. Sin sprints: el ritmo lo da la época.</p>
        </div>
        <Link href="/equipo/hoy" className="btn btn-ghost py-1.5 text-sm">Lo mío de hoy</Link>
      </div>

      <div className="mb-6 flex gap-1">
        {[undefined, "ahora", "siguiente", "parqueado"].map((h) => (
          <Link
            key={h ?? "todos"}
            href={h ? `/equipo/proyectos?horizonte=${h}` : "/equipo/proyectos"}
            className={`rounded-md px-3 py-1.5 text-sm ${horizonte === h ? "bg-glow text-primary" : "text-muted hover:text-white"}`}
          >
            {h ?? "todos"}
          </Link>
        ))}
      </div>

      {bloqueadas.length > 0 ? (
        <section className="card mb-8 border-red-700/40 bg-red-950/10 p-5">
          <h2 className="mb-2 font-head text-lg font-bold text-red-300">Bloqueado ({bloqueadas.length})</h2>
          <ul className="space-y-1 text-sm">
            {bloqueadas.map((a) => (
              <li key={a.id} className="text-white">
                {a.title} <span className="text-muted">— {a.blockedReason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-1 font-head text-lg font-bold text-white">Carga del equipo</h2>
        <p className="mb-3 text-sm text-muted">
          Trabajo abierto por persona, para detectar sobrecarga. Se miden cargas y entregas, jamás personas.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {carga.map((c) => (
            <div key={c.wallet} className="card flex items-center justify-between p-4">
              <span className="text-white">{c.wallet}</span>
              <span className="flex gap-3 text-xs text-faint">
                <span className="text-primary">{c.en_curso} en curso</span>
                <span>{c.asignadas} asignadas</span>
                {c.bloqueadas > 0 ? <span className="text-red-300">{c.bloqueadas} bloqueadas</span> : null}
              </span>
            </div>
          ))}
        </div>
      </section>

      {iniciativas.length === 0 ? (
        <EmptyState title="Sin iniciativas" message="Importa el CSV de tareas o crea la primera iniciativa." />
      ) : (
        iniciativas.map((ini) => {
          const items = listBacklog(db, { initiativeId: ini.id });
          return (
            <section key={ini.id} className="mb-8">
              <h2 className="mb-2 font-head text-xl font-bold text-white">
                {ini.name} <span className="text-sm font-normal text-faint">· {ini.horizon} · {items.length}</span>
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-faint">Sin trabajo abierto.</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((a) => (
                    <li key={a.id} className="card flex flex-wrap items-center gap-2 p-3">
                      <span className={`tag ${COLOR_ESTADO[a.status] ?? ""}`}>{a.status}</span>
                      <span className="text-white">{a.title}</span>
                      {a.clientName ? <span className="tag border-primary/40 bg-glow text-primary">{a.clientName}</span> : null}
                      <span className="ml-auto text-xs text-faint">{a.ownerWallet ?? "sin responsable"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </main>
  );
}
