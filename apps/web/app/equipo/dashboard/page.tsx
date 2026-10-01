/**
 * `/equipo/dashboard` — la vista de seguimiento (WP15).
 *
 * Tiene que responder tres preguntas en 30 segundos, en este orden vertical:
 *   1. ¿Qué está bloqueado?   → arriba, porque es lo único que exige acción.
 *   2. ¿Qué me necesita a mí? → bandeja de gates `needs_founder`.
 *   3. ¿Qué avanza?           → por iniciativa, y cómo está repartida la carga.
 * Luego: salud del rito de check-in y métricas de la época (WP07, solo lectura).
 *
 * Acceso: SOLO founder y supervisores. La regla es `puedeVerTodoElEquipo` de
 * lib/roles.ts. La página la aplica ella misma (puerta por página, WP31) y `buildDashboard`
 * la vuelve a aplicar dentro: dos capas, la misma regla.
 *
 * Doc 16, obligatorio en esta pantalla:
 *  - La carga por persona sirve para REPARTIR trabajo, no para rankear a nadie:
 *    va en orden alfabético y con su propósito escrito encima.
 *  - No existe "bajo desempeño" ni ningún juicio sobre el valor de una persona.
 *  - Nada aquí confisca ni descuenta nada de lo ya logrado.
 *  - Cero telemetría de presencia: no hay horas, ni "última conexión", ni nada
 *    parecido. El rito se mide por check-ins escritos, y eso es todo.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { ROLE_LABEL, puedeVerTodoElEquipo } from "@/lib/roles";
import { today, TeamError, type AssignmentView } from "@/lib/team";
import { buildDashboard, type BlockedItem } from "@/lib/dashboard";
import { buildDailyDigest, renderDigestText } from "@/lib/digest";
import DashboardStatusBar from "@/components/DashboardStatusBar";
import DigestPanel from "@/components/DigestPanel";
import { TeamHorizonBadge, TeamPriorityBadge, TeamStatusBadge } from "@/components/TeamStatusBadge";
import { StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Texto de los días bloqueado. Nunca inventa una antigüedad que no está registrada. */
function blockedAge(item: BlockedItem): string {
  if (item.daysBlocked === null) return "sin registro de cuándo se bloqueó";
  if (item.daysBlocked === 0) return "bloqueada hoy";
  if (item.daysBlocked === 1) return "1 día bloqueada";
  return `${item.daysBlocked} días bloqueada`;
}

function AccessDenied() {
  return (
    <div className="space-y-6">
      <h1 className="font-head text-4xl font-bold text-white">403 · Sin acceso a esta vista</h1>
      <div className="card p-6">
        <p className="text-sm text-muted">
          El dashboard de seguimiento es para el founder y los supervisores: reúne el trabajo de todo el equipo
          para destrabarlo y repartirlo. Tu vista es tu día, con tus asignaciones y tu propio progreso.
        </p>
        <p className="mt-3 text-sm text-muted">
          Esto no es un juicio sobre nadie ni un permiso de jerarquía: es la misma regla de visibilidad del módulo
          equipo, y existe para que la carga se reparta, no para clasificar a las personas.
        </p>
        <Link href="/equipo/hoy" className="btn btn-primary mt-5">
          Ir a tu día
        </Link>
      </div>
    </div>
  );
}

/** Una fila de "esperando a John" o de un listado compacto de asignaciones. */
function AssignmentRow({ a, href }: { a: AssignmentView; href?: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line/60 px-3 py-2">
      <div className="min-w-0">
        <span className="text-sm text-white">{a.title}</span>
        <span className="ml-2 text-xs text-faint">
          {a.initiative_name ?? "sin iniciativa"} · {a.owner_name ?? "sin responsable"}
          {a.due_date ? ` · vence ${a.due_date}` : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <TeamPriorityBadge priority={a.priority} />
        <TeamStatusBadge status={a.status} />
        {href ? (
          <Link href={href} className="text-xs text-primary hover:underline">
            abrir
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export default async function EquipoDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");

  // Puerta propia (spec WP31 §5.A.2): el layout no se reevalúa en cada navegación.
  // Se lee la base, nunca la cookie; y además de entrar a /equipo hay que supervisar.
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) redirect("/perfil");
  if (!puedeVerTodoElEquipo(actor)) return <AccessDenied />;

  let data;
  try {
    data = buildDashboard(db, actor);
  } catch (e) {
    // 403 de la puerta única: se muestra la explicación, no una página en blanco.
    if (e instanceof TeamError && e.status === 403) return <AccessDenied />;
    throw e;
  }

  const day = today();
  // Como el resto del dashboard: solo lo que esta persona ve (§4.A.12).
  const digest = buildDailyDigest(db, day, actor);
  const digestText = renderDigestText(digest);

  const { blocked, waitingOnFounder, initiatives, load, rites, epoch } = data;
  const withWork = initiatives.filter((b) => b.total > 0);
  const closedLabel = epoch.period ? "Hecha en la época" : "Hecha esta semana";

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-4xl font-bold text-white">Seguimiento</h1>
          <p className="mt-1 text-sm text-muted">
            {day} · {actor.name} · <span className="tag tag-sas">{ROLE_LABEL[actor.role]}</span>
            {actor.isSupervisor ? <span className="tag ml-2 border-line text-muted">supervisión</span> : null}
          </p>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Todo lo de esta pantalla sale del trabajo real registrado por el equipo. No hay métricas estimadas ni
            de relleno: si algo no tiene dato, lo dice.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/equipo/hoy" className="btn btn-ghost py-1.5">
            Tu día
          </Link>
          <Link href="/equipo/proyectos" className="btn btn-ghost py-1.5">
            Proyectos
          </Link>
        </div>
      </header>

      {/* Las tres respuestas, sin scroll */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="bloqueadas ahora"
          value={blocked.length}
          hint={blocked.length > 0 ? "lo único que exige una acción tuya" : "nada trabado ahora mismo"}
        />
        <StatCard
          label="esperando una decisión tuya"
          value={waitingOnFounder.length}
          hint="tu bandeja de gates"
        />
        <StatCard
          label="abiertas en todo el equipo"
          value={load.totalOpen}
          hint={`${load.totalInProgress} en curso · ${load.unassignedOpen} sin responsable`}
        />
      </section>

      {/* 1 · BLOQUEOS PRIMERO */}
      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Bloqueos</h2>
          <span className="text-xs text-faint">del más viejo al más nuevo</span>
        </div>
        <p className="mb-4 text-sm text-muted">
          Primero porque es lo único que pide una acción. Los días bloqueado se cuentan desde el registro del
          bloqueo vigente en el historial del trabajo.
        </p>
        {blocked.length === 0 ? (
          <div className="card p-6">
            <p className="text-sm text-muted">
              No hay nada bloqueado. Cuando alguien bloquee una asignación en su día, con su motivo, aparecerá acá
              en el siguiente render.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {blocked.map((item) => (
              <li key={item.assignment.id} className="card border-red-900/50 bg-red-950/10 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-head text-lg font-bold text-white">{item.assignment.title}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-faint">
                      <span className="text-muted">{item.assignment.initiative_name ?? "sin iniciativa"}</span>
                      <span>·</span>
                      <span className="text-muted">{item.assignment.owner_name ?? "sin responsable"}</span>
                      {item.since ? <span>· desde {item.since}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="tag border-red-800/50 bg-red-950/20 text-red-300">{blockedAge(item)}</span>
                    <TeamPriorityBadge priority={item.assignment.priority} />
                    {item.assignment.needs_founder ? (
                      <span className="tag border-amber-700/50 text-amber-300">espera decisión</span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-3 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-200">
                  {item.reason ?? "sin motivo registrado"}
                </p>
                {item.assignment.owner_wallet === null ? (
                  <p className="mt-2 text-xs text-amber-300">
                    Sin responsable: nadie va a destrabarla sola. Asignarla es el primer paso.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2 · ESPERANDO A JOHN */}
      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Esperando una decisión tuya</h2>
          <span className="text-xs text-faint">{waitingOnFounder.length} en la bandeja</span>
        </div>
        <p className="mb-4 text-sm text-muted">
          Marcadas como que necesitan al founder: una decisión, un visual, una inversión. Mientras estén acá, el
          cuello de botella eres tú, no el equipo.
        </p>
        {waitingOnFounder.length === 0 ? (
          <div className="card p-6">
            <p className="text-sm text-muted">Nada espera una decisión tuya ahora mismo.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {waitingOnFounder.map((a) => (
              <AssignmentRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </section>

      {/* 3 · POR INICIATIVA */}
      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Por iniciativa</h2>
          <Link href="/equipo/proyectos" className="text-xs text-primary hover:underline">
            ver el detalle por iniciativa
          </Link>
        </div>
        <p className="mb-4 text-sm text-muted">
          Una barra de estados por iniciativa: dónde está el trabajo, no quién lo hace.
          {epoch.period
            ? ` Las cerradas se cuentan desde que abrió la época (${epoch.period.startDay}).`
            : " Sin época abierta, las cerradas se cuentan desde el lunes."}
        </p>
        {withWork.length === 0 ? (
          <div className="card p-6">
            <p className="text-sm text-muted">
              Todavía no hay trabajo registrado en ninguna iniciativa. Esta vista no inventa métricas para llenar el
              espacio.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {withWork.map((b) => (
              <li key={b.initiative ? `i-${b.initiative.id}` : "sin-iniciativa"} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-head text-lg font-bold text-white">{b.name}</h3>
                    <p className="mt-0.5 text-xs text-faint">
                      {b.open} abiertas · {b.blocked} bloqueadas ·{" "}
                      {b.closedThisEpoch ?? b.closedThisWeek} cerradas
                    </p>
                  </div>
                  {b.initiative ? <TeamHorizonBadge horizon={b.initiative.horizon} /> : null}
                </div>
                <div className="mt-4">
                  <DashboardStatusBar
                    byStatus={b.byStatus}
                    closed={b.closedThisEpoch ?? b.closedThisWeek}
                    closedLabel={closedLabel}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4 · CARGA POR PERSONA — repartir, no rankear (doc 16) */}
      <section>
        <h2 className="font-head text-2xl font-bold text-white">Carga por persona</h2>
        <p className="mt-2 max-w-3xl rounded-md border border-primary/30 bg-glow/30 px-4 py-3 text-sm text-white">
          {load.purpose}
        </p>
        <p className="mt-3 text-sm text-muted">
          Va en orden alfabético a propósito: no es una tabla de posiciones y no se ordena por cantidad de trabajo.
          Cada quien ve su propio progreso, comparado consigo mismo, en su día.
        </p>
        <div className="card mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-3 font-semibold">Persona</th>
                <th className="px-4 py-3 font-semibold">Abiertas</th>
                <th className="px-4 py-3 font-semibold">En curso</th>
                <th className="px-4 py-3 font-semibold">En revisión</th>
                <th className="px-4 py-3 font-semibold">Bloqueadas</th>
                <th className="px-4 py-3 font-semibold">Esperan decisión</th>
              </tr>
            </thead>
            <tbody>
              {load.people.map((p) => (
                <tr key={p.wallet} className="border-b border-line/40 last:border-0">
                  <td className="px-4 py-3">
                    <span className="text-white">{p.name}</span>
                    {p.isSupervisor ? (
                      <span className="ml-2 text-xs text-faint">supervisión</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{p.open}</td>
                  <td className="px-4 py-3 text-muted">{p.inProgress}</td>
                  <td className="px-4 py-3 text-muted">{p.inReview}</td>
                  <td className={`px-4 py-3 ${p.blocked > 0 ? "text-red-300" : "text-muted"}`}>{p.blocked}</td>
                  <td className={`px-4 py-3 ${p.needsFounder > 0 ? "text-amber-300" : "text-muted"}`}>
                    {p.needsFounder}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {load.unassignedOpen + load.unassignedBlocked > 0 ? (
          <p className="mt-3 text-sm text-amber-300">
            {load.unassignedOpen} abiertas y {load.unassignedBlocked} bloqueadas sin responsable. Es lo primero que
            se puede repartir.
          </p>
        ) : null}
        {load.outsideRosterOpen + load.outsideRosterBlocked > 0 ? (
          <p className="mt-2 text-xs text-faint">
            Además hay {load.outsideRosterOpen} abiertas y {load.outsideRosterBlocked} bloqueadas de alguien que no
            está en el roster del equipo. Se cuentan en los totales, pero no tienen fila propia acá.
          </p>
        ) : null}
      </section>

      {/* 5 · SALUD DE RITOS */}
      <section className="card p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Salud del rito de check-in</h2>
          <span className="text-xs text-faint">semana del {rites.weekStart}</span>
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          <div>
            <div className="font-head text-3xl font-bold text-primary glow-text">
              {rites.pct === null ? "—" : `${rites.pct}%`}
            </div>
            <div className="text-sm text-white">check-ins de la semana</div>
            <div className="text-xs text-faint">
              {rites.actual} de {rites.expected} posibles ({rites.members} personas × {rites.daysElapsed} días
              transcurridos)
            </div>
          </div>
          <div className="sm:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-faint">
              Participación en el rito
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {rites.perMember.map((m) => (
                <li key={m.wallet} className="tag border-line text-muted">
                  {m.name} · {m.checkins}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-faint">
              Cuenta check-ins escritos, nada más. No se registran horas, ni presencia, ni última conexión: esto
              mide si el rito está vivo, no a las personas.
            </p>
          </div>
        </div>
      </section>

      {/* 6 · MÉTRICAS DE ÉPOCA (WP07, solo lectura) */}
      <section className="card p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">La época</h2>
          <Link href="/gobernanza" className="text-xs text-primary hover:underline">
            registro público de gobernanza
          </Link>
        </div>
        <p className="mt-2 text-sm text-muted">
          El seguimiento operativo y el motor evolutivo se leen juntos: lo que el equipo cerró y lo que el fitness
          dice de la época. Esta vista solo lee — las épocas se calculan y se firman en el panel de admin.
        </p>

        {epoch.period ? (
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            <div>
              <div className="font-head text-3xl font-bold text-primary glow-text">{epoch.closedThisEpoch ?? 0}</div>
              <div className="text-sm text-white">entregas cerradas en la época</div>
              <div className="text-xs text-faint">
                {epoch.period.name} · abierta desde {epoch.period.startDay} · estado {epoch.period.state}
              </div>
            </div>
            <div>
              <div className="font-head text-3xl font-bold text-primary glow-text">{epoch.blockedNow}</div>
              <div className="text-sm text-white">bloqueadas ahora mismo</div>
              <div className="text-xs text-faint">nada de esto descuenta nada ya logrado</div>
            </div>
            <div>
              <div className="font-head text-3xl font-bold text-primary glow-text">
                {epoch.fitness ? epoch.fitness.score.toFixed(3) : "—"}
              </div>
              <div className="text-sm text-white">fitness de la época</div>
              <div className="text-xs text-faint">
                {epoch.fitness
                  ? `época ${epoch.fitness.epoch} · recomendación ${epoch.fitness.recommendation}${
                      epoch.fitness.signed ? ` · firmada (${epoch.fitness.signedDecision})` : " · sin firmar"
                    }`
                  : "todavía no se ha calculado ningún reporte de fitness"}
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-faint">No hay ninguna época abierta todavía.</p>
        )}

        {epoch.fitness ? (
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {epoch.fitness.components.map((c) => (
              <li
                key={c.key}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line/60 px-3 py-2 text-sm"
              >
                <span className="text-white">{c.label}</span>
                <span className="text-xs text-faint">
                  {c.value === null ? `sin datos${c.note ? ` · ${c.note}` : ""}` : c.value.toFixed(3)}
                  {" · peso "}
                  {c.weight}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* 7 · DIGEST DEL DÍA */}
      <section className="card p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-head text-2xl font-bold text-white">Digest de hoy</h2>
          <span className="text-xs text-faint">
            {digest.counts.checkins} check-ins · {digest.counts.events} cambios de estado
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          Hecho, en curso y bloqueado del equipo, consolidado del día. Sale de los check-ins escritos y del
          historial de cambios de estado de hoy — nada más.
        </p>
        <div className="mt-4">
          <DigestPanel text={digestText} day={day} />
        </div>
      </section>

      <p className="text-xs text-faint">
        Esta pantalla mide entregas, bloqueos y carga: dónde está el trabajo y qué lo tiene detenido. No califica a
        personas y nada de lo ya logrado se descuenta nunca. La carga se muestra para repartirla.
      </p>
    </div>
  );
}
