/**
 * WP14 · /equipo/hoy — la pantalla que abre cada persona.
 *
 * Regla doc 16: se califican ENTREGAS, nunca personas. Aquí no hay ranking de
 * gente ni semáforos de "desempeño": hay trabajo, prioridad y bloqueos.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listForOwner, getCheckin, actorDesdeWallet } from "@/lib/assignments";
import { availableActions, puedeActuar, WIP_MAX, type AssignmentAction } from "@/lib/assignment-state";
import { FOUNDER_WALLET } from "@/lib/config";
import { EmptyState } from "@/components/ui";
import AssignmentActions from "@/components/AssignmentActions";
import CheckinForm from "@/components/CheckinForm";

export const dynamic = "force-dynamic";

const ETIQUETA: Record<AssignmentAction, string> = {
  asignar: "Asignar",
  empezar: "Empezar",
  a_revision: "A revisión",
  aprobar: "Aprobar",
  devolver: "Devolver",
  bloquear: "Bloquear",
  desbloquear: "Desbloquear",
};

const COLOR_ESTADO: Record<string, string> = {
  Backlog: "text-muted border-line",
  Asignada: "text-amber-300 border-amber-700/40 bg-amber-950/20",
  "En curso": "text-primary border-primary/40 bg-glow",
  "En revisión": "text-sky-300 border-sky-700/40 bg-sky-950/20",
  Hecha: "text-emerald-300 border-emerald-700/40 bg-emerald-950/20",
  Bloqueada: "text-red-300 border-red-700/40 bg-red-950/20",
};

const COLOR_PRIORIDAD: Record<string, string> = {
  alta: "text-red-300 border-red-700/40",
  media: "text-amber-300 border-amber-700/40",
  baja: "text-muted border-line",
};

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function EquipoHoyPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const db = getDb();
  const actor = actorDesdeWallet(db, session.wallet, session.wallet === FOUNDER_WALLET);
  const asignaciones = listForOwner(db, session.wallet);
  const enCurso = asignaciones.filter((a) => a.status === "En curso").length;
  const bloqueadas = asignaciones.filter((a) => a.status === "Bloqueada");
  const dia = hoyISO();
  const checkin = getCheckin(db, session.wallet, dia) ?? null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-3xl font-bold text-white">Tus asignaciones de hoy</h1>
          <p className="mt-1 text-sm text-muted">
            {asignaciones.length === 0
              ? "Nada abierto a tu nombre."
              : `${asignaciones.length} abiertas · ${enCurso} de ${WIP_MAX} en curso`}
          </p>
        </div>
        <Link href="/equipo/proyectos" className="btn btn-ghost py-1.5 text-sm">
          Ver todos los proyectos
        </Link>
      </div>

      {enCurso >= WIP_MAX ? (
        <div className="card mb-6 border-amber-700/40 bg-amber-950/10 p-4 text-sm text-amber-200">
          Llegaste al límite de {WIP_MAX} en curso. El multitasking es el impuesto invisible: cierra o
          devuelve algo antes de empezar otra cosa.
        </div>
      ) : null}

      {bloqueadas.length > 0 ? (
        <div className="card mb-6 border-red-700/40 bg-red-950/10 p-4">
          <div className="mb-2 text-xs uppercase tracking-widest text-red-300">
            Bloqueado — necesita a alguien más
          </div>
          <ul className="space-y-1 text-sm text-white">
            {bloqueadas.map((a) => (
              <li key={a.id}>
                {a.title} <span className="text-muted">— {a.blockedReason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {asignaciones.length === 0 ? (
        <EmptyState
          title="Sin asignaciones abiertas"
          message="Cuando alguien te asigne trabajo aparecerá aquí, ordenado por prioridad y vencimiento."
          cta={{ href: "/equipo/proyectos", label: "Ver el backlog" }}
        />
      ) : (
        <ul className="space-y-3">
          {asignaciones.map((a) => (
            <li key={a.id} className="card card-hover p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`tag ${COLOR_ESTADO[a.status] ?? "text-muted border-line"}`}>{a.status}</span>
                    <span className={`tag ${COLOR_PRIORIDAD[a.priority] ?? ""}`}>{a.priority}</span>
                    <span className="tag text-muted border-line">{a.size}</span>
                    {a.initiativeName ? <span className="tag text-muted border-line">{a.initiativeName}</span> : null}
                    {a.clientName ? (
                      <span className="tag border-primary/40 bg-glow text-primary">{a.clientName}</span>
                    ) : null}
                    {a.dueDate ? <span className="text-xs text-faint">vence {a.dueDate}</span> : null}
                  </div>
                  <h2 className="font-head text-lg font-bold text-white">{a.title}</h2>
                  {a.description ? <p className="mt-1 text-sm text-muted">{a.description}</p> : null}

                  {a.acceptanceCriteria ? (
                    <div className="mt-3 rounded-md border border-line bg-glow/40 p-3">
                      <div className="mb-1 text-xs uppercase tracking-widest text-faint">
                        Criterio de aceptación
                      </div>
                      <p className="text-sm text-white">{a.acceptanceCriteria}</p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    {a.specUrl ? (
                      <a href={a.specUrl} className="text-primary hover:underline" target="_blank" rel="noreferrer">
                        Spec / PR ↗
                      </a>
                    ) : null}
                    {a.graphNodeId ? (
                      <Link
                        href={`/clientes/${encodeURIComponent(a.clientName ?? "")}?nodo=${encodeURIComponent(a.graphNodeId)}`}
                        className="text-primary hover:underline"
                      >
                        Contexto en el grafo →
                      </Link>
                    ) : null}
                  </div>
                </div>

                <AssignmentActions
                  assignmentId={a.id}
                  actions={availableActions(a.status)
                    // Misma regla pura que aplica el servidor: si no puede, no se pinta.
                    .filter((x) => puedeActuar(x, actor, a.ownerWallet))
                    .map((x) => ({ action: x, label: ETIQUETA[x] }))}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-10">
        <h2 className="font-head text-xl font-bold text-white">Check-in de hoy</h2>
        <p className="mb-3 text-sm text-muted">
          Tres campos, una vez al día. Reemplaza la reunión de estado, no la suma.
        </p>
        <CheckinForm day={dia} initial={checkin} />
      </section>
    </main>
  );
}
