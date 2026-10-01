/**
 * `/equipo/hoy` — la pantalla que abre cada persona (WP14).
 *
 *  - "Tus asignaciones de hoy" ordenadas por prioridad y vencimiento, con acciones
 *    de un click (empezar / a revisión / bloquear con motivo obligatorio).
 *  - Bloque "Tu progreso": la comparación es CONTIGO (regla WP09 / doc 16).
 *  - Formulario de check-in diario.
 *
 * Visibilidad: un `core` ve SOLO lo suyo; founder y supervisores ven todo el equipo
 * (regla única en `puedeVerTodoElEquipo` de lib/roles.ts).
 *
 * WP31: la página es su propia puerta (`equipoActor`, nunca la cookie). Quien trabaja
 * por proyecto (alcance `proyectos`) no ve el check-in diario —no se mide jornada— y
 * las listas de sus formularios salen de SUS proyectos (`proyectosVisibles`), nunca
 * del equipo completo.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { ROLE_LABEL, puedeVerTodoElEquipo, rosterByPrincipal } from "@/lib/roles";
import { availableTeamActions } from "@/lib/team-state-machine";
import {
  assignmentsForOwner,
  getCheckin,
  listTeamMembers,
  ownProgress,
  proyectosVisibles,
  today,
  visibleAssignments,
  type AssignmentView,
} from "@/lib/team";
import TeamAssignmentActions from "@/components/TeamAssignmentActions";
import TeamNewAssignment from "@/components/TeamNewAssignment";
import TeamCheckinForm from "@/components/TeamCheckinForm";
import { TeamHorizonBadge, TeamPriorityBadge, TeamStatusBadge } from "@/components/TeamStatusBadge";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

function AssignmentCard({ a, showOwner }: { a: AssignmentView; showOwner: boolean }) {
  const actions = availableTeamActions(a.status);
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-head text-lg font-bold text-white">{a.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
            {a.initiative_name ? <span className="text-muted">{a.initiative_name}</span> : <span>sin iniciativa</span>}
            {a.initiative_horizon && a.horizon !== a.initiative_horizon ? (
              <TeamHorizonBadge horizon={a.horizon} />
            ) : null}
            {a.due_date ? <span>vence {a.due_date}</span> : <span>sin fecha de vencimiento</span>}
            {showOwner ? <span className="text-muted">· {a.owner_name ?? "sin responsable"}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TeamPriorityBadge priority={a.priority} />
          <TeamStatusBadge status={a.status} />
          {a.needs_founder ? <span className="tag border-amber-700/50 text-amber-300">espera decisión</span> : null}
        </div>
      </div>

      {a.description ? <p className="mt-3 text-sm text-muted">{a.description}</p> : null}

      {a.acceptance_criteria ? (
        <div className="mt-3 rounded-md border border-line/60 bg-glow/30 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Criterio de aceptación</div>
          <p className="mt-1 text-sm text-white">{a.acceptance_criteria}</p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-amber-300">
          Esta asignación aún no tiene criterio de aceptación escrito: sin criterio no hay forma de decir que está lista.
        </p>
      )}

      {a.status === "Bloqueada" && a.blocked_reason ? (
        <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          Bloqueada: {a.blocked_reason}
          {a.blocked_at ? <span className="text-xs text-faint"> · desde {a.blocked_at.slice(0, 10)}</span> : null}
        </p>
      ) : null}

      {a.spec_url ? (
        <p className="mt-3 text-xs">
          <a href={a.spec_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            Spec / PR de referencia
          </a>
        </p>
      ) : null}

      {a.published_as_project_id ? (
        <p className="mt-3 text-xs">
          <Link href={`/agora/${a.published_as_project_id}`} className="text-primary hover:underline">
            Publicada como bounty en el Ágora
          </Link>{" "}
          <span className="text-faint">· misma pieza de trabajo, dos vistas</span>
        </p>
      ) : null}

      <div className="mt-4">
        <TeamAssignmentActions assignmentId={a.id} actions={actions} />
      </div>
    </li>
  );
}

export default async function EquipoHoyPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");

  // Puerta propia: el layout no se reevalúa en cada navegación (spec WP31 §5.A.2).
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) redirect("/perfil");
  const seesAll = puedeVerTodoElEquipo(actor);
  const esEquipo = actor.alcance === "equipo";
  const day = today();
  // Las listas del alta salen de lo que esta persona puede ver, nunca del equipo entero.
  const proyectos = proyectosVisibles(db, actor);
  const personas = seesAll
    ? listTeamMembers(db).map((m) => ({ wallet: m.wallet, nombre: m.display_name }))
    : [{ wallet: actor.wallet, nombre: actor.name }];

  const mine = assignmentsForOwner(db, actor.wallet);
  const all = seesAll ? visibleAssignments(db, actor) : mine;
  const others = seesAll ? all.filter((a) => a.owner_wallet !== actor.wallet) : [];

  const progress = ownProgress(db, actor.wallet);
  const checkin = esEquipo ? getCheckin(db, actor.wallet, day) : undefined;
  const member = rosterByPrincipal(actor.wallet);

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-4xl font-bold text-white">Tu día</h1>
          <p className="mt-1 text-sm text-muted">
            {day} · {actor.name}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="tag tag-sas">{ROLE_LABEL[actor.role]}</span>
            {actor.isSupervisor ? <span className="tag border-line text-muted">supervisión</span> : null}
            {member ? <span className="text-xs text-faint">{member.domain}</span> : null}
          </div>
        </div>
        <Link href="/equipo/proyectos" className="btn btn-ghost py-1.5">
          Ver proyectos por iniciativa
        </Link>
      </header>

      {/* Alta rápida: capturar lo que acaba de salir en una reunión, sin salir de aquí. */}
      <TeamNewAssignment
        personas={personas}
        iniciativas={proyectos.map((i) => ({ id: i.id, nombre: i.name }))}
        puedeAsignarAOtros={seesAll}
        miWallet={actor.wallet}
      />

      {/* Tu progreso — compites contigo mismo, con el mismo peso visual que el resto */}
      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Tu progreso</h2>
          <span className="text-xs text-faint">
            Semana del {progress.weekStart}
            {progress.isFirstWeek ? " · tu primera semana" : ""}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Aquí la comparación es contigo: cuántas entregas cerraste contra su criterio de aceptación esta semana
          frente a la anterior. No se compara a personas entre sí y nada de lo logrado se descuenta nunca.
        </p>
        <div className={`mt-5 grid gap-5 ${esEquipo ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div>
            <div className="font-head text-3xl font-bold text-primary glow-text">{progress.closedThisWeek}</div>
            <div className="text-sm text-white">entregas cerradas esta semana</div>
            <div className="text-xs text-faint">
              {progress.isFirstWeek
                ? "sin semana anterior para comparar todavía"
                : `${progress.delta >= 0 ? "+" : ""}${progress.delta} vs la semana pasada (${progress.closedPrevWeek})`}
            </div>
          </div>
          <div>
            <div className="font-head text-3xl font-bold text-primary glow-text">{progress.openNow}</div>
            <div className="text-sm text-white">asignaciones abiertas</div>
            <div className="text-xs text-faint">
              {progress.blockedNow > 0
                ? `${progress.blockedNow} bloqueada${progress.blockedNow === 1 ? "" : "s"} esperando que algo se destrabe`
                : "ninguna bloqueada ahora mismo"}
            </div>
          </div>
          {esEquipo ? (
            <div>
              <div className="font-head text-3xl font-bold text-primary glow-text">{progress.checkinsThisWeek}</div>
              <div className="text-sm text-white">check-ins esta semana</div>
              <div className="text-xs text-faint">participación en el rito, no control de horas</div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Tus asignaciones de hoy */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Tus asignaciones de hoy</h2>
          <span className="text-xs text-faint">ordenadas por prioridad y vencimiento</span>
        </div>
        {mine.length === 0 ? (
          <EmptyState
            title="No tienes asignaciones abiertas"
            message="Cuando tengas trabajo asignado aparecerá aquí, con su criterio de aceptación y sus acciones de un click. Mientras tanto puedes revisar qué hay abierto por iniciativa."
            cta={{ href: "/equipo/proyectos", label: "Ver proyectos" }}
          />
        ) : (
          <ul className="space-y-4">
            {mine.map((a) => (
              <AssignmentCard key={a.id} a={a} showOwner={false} />
            ))}
          </ul>
        )}
      </section>

      {/* Check-in diario: solo del equipo interno. Quien trabaja por proyecto no lo ve. */}
      {esEquipo ? (
        <section className="card p-6">
          <h2 className="font-head text-2xl font-bold text-white">Tu check-in de hoy</h2>
          <div className="mt-3">
            <TeamCheckinForm
              initial={{ done: checkin?.done ?? "", doing: checkin?.doing ?? "", blocked: checkin?.blocked ?? "" }}
              alreadySent={!!checkin}
            />
          </div>
        </section>
      ) : null}

      {/* Resto del equipo: solo founder y supervisores */}
      {seesAll ? (
        <section>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-head text-2xl font-bold text-white">Resto del equipo</h2>
            <span className="text-xs text-faint">{others.length} asignaciones abiertas o bloqueadas</span>
          </div>
          <p className="mb-4 text-sm text-muted">
            Esta vista existe para destrabar entregas y repartir la carga, no para comparar a nadie: mide trabajo,
            no personas.
          </p>
          {others.length === 0 ? (
            <p className="text-sm text-faint">No hay más trabajo abierto en el equipo ahora mismo.</p>
          ) : (
            <ul className="space-y-4">
              {others.map((a) => (
                <AssignmentCard key={a.id} a={a} showOwner />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
