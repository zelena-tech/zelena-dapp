/**
 * `/equipo/hoy` — la pantalla que abre cada persona (WP14).
 *
 *  - "Tus asignaciones de hoy" ordenadas por prioridad y vencimiento, con acciones
 *    de un click (empezar / a revisión / bloquear con motivo obligatorio).
 *  - Bloque "Tu progreso": la comparación es CONTIGO (regla WP09 / doc 16).
 *  - Formulario de check-in diario.
 *  - WP31-I2: cada tarjeta lleva su semáforo de plazo (`SlaBadge`, horas hábiles del
 *    genoma) y "Tu progreso" suma los puntos y la reputación de la temporada por
 *    entregas aprobadas, con las insignias (`Insignias`). Califica la entrega, nunca a
 *    la persona: sin comparaciones con nadie y lo ganado no se quita.
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
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { ROLE_LABEL, ROL_PROYECTO_LABEL, puedeVerTodoElEquipo, rosterByPrincipal } from "@/lib/roles";
import type { TeamAction } from "@/lib/team-state-machine";
import {
  accionesPermitidas,
  assignmentsForOwner,
  esEnlaceSeguro,
  getCheckin,
  listTeamMembers,
  membresiasDe,
  ownProgress,
  permisosDe,
  piezasSinResponsable,
  proyectosVisibles,
  today,
  visibleAssignments,
  type AssignmentView,
} from "@/lib/team";
import { currentEpoch, getActiveGenome } from "@/lib/genome";
import { insignias, progresoDeTareas, senalesProgreso } from "@/lib/gamificacion";
import { slaConfig, slaDeAsignaciones } from "@/lib/sla-db";
import TeamAssignmentActions from "@/components/TeamAssignmentActions";
import TeamNewAssignment from "@/components/TeamNewAssignment";
import TeamCheckinForm from "@/components/TeamCheckinForm";
import { TeamHorizonBadge, TeamPriorityBadge, TeamStatusBadge } from "@/components/TeamStatusBadge";
import { EmptyState } from "@/components/ui";
import SlaBadge from "@/components/SlaBadge";
import Insignias from "@/components/Insignias";

export const dynamic = "force-dynamic";

function AssignmentCard({
  a,
  showOwner,
  actions,
  semaforo,
}: {
  a: AssignmentView;
  showOwner: boolean;
  actions: TeamAction[];
  /** Semáforo de plazo de la pieza (`SlaBadge`), ya calculado en el servidor. */
  semaforo: ReactNode;
}) {
  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-head text-lg font-bold text-white">{a.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
            {a.initiative_name ? <span className="text-muted">{a.initiative_name}</span> : <span>sin proyecto</span>}
            {a.initiative_horizon && a.horizon !== a.initiative_horizon ? (
              <TeamHorizonBadge horizon={a.horizon} />
            ) : null}
            {a.due_date ? <span>vence {a.due_date}</span> : <span>sin fecha de vencimiento</span>}
            {showOwner ? <span className="text-muted">· {a.owner_name ?? "sin responsable"}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {semaforo}
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

      {/* Solo enlaces http(s): el texto lo escribe la gente y se pinta como href. */}
      {esEnlaceSeguro(a.spec_url) ? (
        <p className="mt-3 text-xs">
          <a href={a.spec_url as string} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
            Enlace de referencia
          </a>
        </p>
      ) : null}

      {a.published_as_project_id ? (
        <p className="mt-3 text-xs">
          <Link href={`/agora/${a.published_as_project_id}`} className="text-primary hover:underline">
            Publicada como proyecto en el Ágora
          </Link>{" "}
          <span className="text-faint">· misma pieza de trabajo, dos vistas</span>
        </p>
      ) : null}

      {/* Solo las acciones que esta persona puede aplicar (cuatro ojos: lo propio lo revisa otra). */}
      {actions.length > 0 ? (
        <div className="mt-4">
          <TeamAssignmentActions assignmentId={a.id} actions={actions} />
        </div>
      ) : null}
      {a.status === "En revisión" && !actions.includes("aprobar") ? (
        <p className="mt-2 text-xs text-faint">La revisa otra persona del proyecto.</p>
      ) : null}
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
  const dondeCrea = proyectos.filter((p) => permisosDe(db, actor, p.id).crear);
  const personas = seesAll
    ? listTeamMembers(db).map((m) => ({ wallet: m.wallet, nombre: m.display_name }))
    : [{ wallet: actor.wallet, nombre: actor.name }];
  const acciones = (a: AssignmentView) => accionesPermitidas(db, actor, a);

  // "Tus proyectos" (quien trabaja por proyecto): nombre, su rol y lo que hay para tomar.
  const nombres = new Map(proyectos.map((p) => [p.id, p]));
  const tusProyectos = esEquipo
    ? []
    : membresiasDe(db, actor.wallet)
        .filter((m) => nombres.has(m.initiativeId))
        .map((m) => ({
          proyecto: nombres.get(m.initiativeId)!,
          roles: m.roles,
          libres: piezasSinResponsable(db, m.initiativeId),
        }))
        .sort((a, b) => a.proyecto.name.localeCompare(b.proyecto.name, "es"));

  const mine = assignmentsForOwner(db, actor.wallet);
  const all = seesAll ? visibleAssignments(db, actor) : mine;
  const others = seesAll ? all.filter((a) => a.owner_wallet !== actor.wallet) : [];

  // Semáforo de plazos: un solo instante y la configuración del genoma para todas las tarjetas.
  const ahora = new Date();
  const cfgSla = slaConfig(db);
  const slas = slaDeAsignaciones(
    db,
    [...mine, ...others].map((a) => a.id),
    ahora,
    cfgSla
  );
  const semaforo = (a: AssignmentView) => <SlaBadge sla={slas.get(a.id)} ahora={ahora} config={cfgSla} />;

  // Tu progreso de la temporada (todas tus identidades) y tus insignias, con metas del genoma.
  const epoca = currentEpoch(db);
  const temporada = progresoDeTareas(db, actor.wallet, epoca);
  const senales = senalesProgreso(db, actor.wallet);
  const misInsignias = insignias(senales, getActiveGenome(db, epoca).BADGE_GOALS);

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
          Ver proyectos
        </Link>
      </header>

      {/* Tus proyectos: la entrada de quien trabaja por proyecto. Sin check-in. */}
      {!esEquipo ? (
        <section>
          <h2 className="mb-4 font-head text-2xl font-bold text-white">Tus proyectos</h2>
          {tusProyectos.length === 0 ? (
            <p className="text-sm text-faint">Todavía no tienes un rol en ningún proyecto.</p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {tusProyectos.map((t) => (
                <li key={t.proyecto.id} className="card p-5">
                  <h3 className="font-head text-xl font-bold text-white">
                    <Link
                      href={`/equipo/proyectos/${encodeURIComponent(t.proyecto.slug)}`}
                      className="hover:text-primary hover:underline"
                    >
                      {t.proyecto.name}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-muted">
                    Tu rol: {t.roles.map((r) => ROL_PROYECTO_LABEL[r]).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-faint">
                    {t.libres} {t.libres === 1 ? "pieza sin responsable" : "piezas sin responsable"} para tomar
                  </p>
                  <Link
                    href={`/equipo/proyectos/${encodeURIComponent(t.proyecto.slug)}`}
                    className="mt-3 inline-block text-sm text-primary hover:underline"
                  >
                    Abrir el tablero
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* Alta rápida: capturar lo que acaba de salir en una reunión, sin salir de aquí. */}
      {esEquipo || dondeCrea.length > 0 ? (
        <TeamNewAssignment
          personas={personas}
          iniciativas={dondeCrea.map((i) => ({ id: i.id, nombre: i.name }))}
          puedeAsignarAOtros={seesAll}
          puedeFijarTamano={seesAll}
          requiereProyecto={!esEquipo}
          miWallet={actor.wallet}
        />
      ) : null}

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
        <p className="mt-3 text-sm text-white">
          Esta temporada sumaste{" "}
          <span className="font-bold text-primary">{temporada.puntos.toLocaleString("es")}</span> puntos y{" "}
          <span className="font-bold text-primary">{temporada.reputacion.toLocaleString("es")}</span> de reputación
          en ejecución por entregas aprobadas.
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

      {/* Tus asignaciones de hoy */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Tus asignaciones de hoy</h2>
          <span className="text-xs text-faint">ordenadas por prioridad y vencimiento</span>
        </div>
        {mine.length === 0 ? (
          <EmptyState
            title="No tienes asignaciones abiertas"
            message="Cuando tengas trabajo asignado aparecerá aquí, con su criterio de aceptación y sus acciones de un click. Mientras tanto puedes revisar qué hay abierto en tus proyectos."
            cta={{ href: "/equipo/proyectos", label: "Ver proyectos" }}
          />
        ) : (
          <ul className="space-y-4">
            {mine.map((a) => (
              <AssignmentCard key={a.id} a={a} showOwner={false} actions={acciones(a)} semaforo={semaforo(a)} />
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
                <AssignmentCard key={a.id} a={a} showOwner actions={acciones(a)} semaforo={semaforo(a)} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
