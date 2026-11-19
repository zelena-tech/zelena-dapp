/**
 * `/equipo/proyectos` — los proyectos que esta persona ve (WP14 + WP31).
 *
 * Una tarjeta por proyecto (iniciativa = proyecto) con lo abierto, lo bloqueado, lo
 * cerrado esta semana y lo que hay sin responsable para tomar; cada una lleva a su
 * tablero. El founder y los supervisores crean proyectos aquí ("Nuevo proyecto") y
 * llegan al importador de CSV, que vive en `/equipo/talento#importar`.
 *
 * Puerta propia (spec WP31 §5.A.2): `equipoActor` lee la base, nunca la cookie; y la
 * lista sale de `proyectosVisibles` (un proyecto de cliente, solo quien participa;
 * quien trabaja por proyecto, solo los suyos).
 *
 * Doc 16: los bloqueos se cuentan porque piden acción; la carga se ve para repartirla,
 * nunca para comparar a nadie.
 *
 * WP31-I2: cada tarjeta cuenta lo que pasó su plazo y lo que está por vencer (semáforo
 * en horas hábiles del genoma, `slaDeAsignaciones`), y el trabajo sin proyecto lleva su
 * `SlaBadge`. Son plazos de entregas, no de personas.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { listClientsFor } from "@/lib/clients";
import { ROL_PROYECTO_LABEL, esGlobalProyecto } from "@/lib/roles";
import { slaConfig, slaDeAsignaciones } from "@/lib/sla-db";
import {
  assignmentsByInitiative,
  HORIZONS,
  isHorizon,
  membresiasDe,
  permisosDe,
  piezasSinResponsable,
  proyectosVisibles,
  weekStart,
  type Horizon,
} from "@/lib/team";
import TeamProjectForm from "@/components/TeamProjectForm";
import { TeamHorizonBadge, TeamPriorityBadge, TeamStatusBadge } from "@/components/TeamStatusBadge";
import { EmptyState } from "@/components/ui";
import SlaBadge from "@/components/SlaBadge";

export const dynamic = "force-dynamic";

export default async function EquipoProyectosPage({
  searchParams,
}: {
  searchParams: { horizonte?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/entrar");
  // Puerta propia (spec WP31 §5.A.2): la base, nunca la cookie; y solo los proyectos
  // que esta persona ve (un proyecto de cliente, solo quien participa).
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) redirect("/perfil");
  const esGlobal = esGlobalProyecto(actor);
  const visibles = proyectosVisibles(db, actor);
  const veSinProyecto = permisosDe(db, actor, null).ver;
  const misRoles = new Map(membresiasDe(db, actor.wallet).map((m) => [m.initiativeId, m.roles]));

  const raw = searchParams.horizonte;
  const horizon: Horizon | undefined = isHorizon(raw) ? raw : undefined;
  // El filtro de horizonte se aplica al trabajo (una iniciativa tiene filas en varios
  // horizontes) y, para un proyecto sin trabajo, a su propio horizonte. Con `actor`,
  // solo lo que esta persona ve: tampoco en "Sin proyecto" entra lo de un cliente ajeno.
  const porIniciativa = assignmentsByInitiative(db, { horizon, actor });
  const resumenes = new Map(porIniciativa.filter((s) => s.initiative).map((s) => [s.initiative!.id, s]));
  const sinProyecto = veSinProyecto ? (porIniciativa.find((s) => s.initiative === null) ?? null) : null;
  const week = weekStart();

  // Semáforo de plazos de lo abierto (lo bloqueado ya se cuenta aparte): un solo instante.
  const ahora = new Date();
  const cfgSla = slaConfig(db);
  const slas = slaDeAsignaciones(
    db,
    porIniciativa.flatMap((s) => s.open.map((a) => a.id)),
    ahora,
    cfgSla
  );
  const contarSla = (ids: number[], estado: "vencida" | "por_vencer") =>
    ids.filter((id) => slas.get(id)?.estado === estado).length;

  const tarjetas = visibles
    .map((p) => {
      const s = resumenes.get(p.id);
      const abiertasIds = (s?.open ?? []).map((a) => a.id);
      return {
        p,
        vencidas: contarSla(abiertasIds, "vencida"),
        porVencer: contarSla(abiertasIds, "por_vencer"),
        abiertas: s?.open.length ?? 0,
        bloqueadas: s?.blocked.length ?? 0,
        cerradas: s?.closedThisWeek.length ?? 0,
        libres: piezasSinResponsable(db, p.id),
        roles: misRoles.get(p.id) ?? [],
      };
    })
    .filter((t) => !horizon || t.p.horizon === horizon || t.abiertas + t.bloqueadas + t.cerradas > 0);

  const totalAbiertas = tarjetas.reduce((n, t) => n + t.abiertas, 0);
  const totalBloqueadas = tarjetas.reduce((n, t) => n + t.bloqueadas, 0);
  const totalCerradas = tarjetas.reduce((n, t) => n + t.cerradas, 0);

  const clientes = esGlobal
    ? listClientsFor(db, { wallet: actor.wallet, isFounder: actor.role === "founder" }).map((c) => ({
        id: c.id,
        nombre: c.name,
      }))
    : undefined;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-4xl font-bold text-white">Proyectos</h1>
          <p className="mt-1 text-sm text-muted">
            {tarjetas.length} {tarjetas.length === 1 ? "proyecto" : "proyectos"} · {totalAbiertas} abiertas ·{" "}
            {totalBloqueadas} bloqueadas · {totalCerradas} cerradas desde el {week}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esGlobal ? (
            <Link href="/equipo/talento#importar" className="btn btn-ghost py-1.5 text-sm">
              Importar CSV
            </Link>
          ) : null}
          <Link href="/equipo/hoy" className="btn btn-ghost py-1.5 text-sm">
            Volver a tu día
          </Link>
        </div>
      </header>

      {esGlobal ? <TeamProjectForm clientes={clientes} /> : null}

      {/* Filtro por horizonte (del trabajo; para un proyecto sin trabajo, el suyo) */}
      <nav className="flex flex-wrap gap-2" aria-label="Filtro por horizonte">
        <Link href="/equipo/proyectos" className={`btn py-1.5 text-sm ${!horizon ? "btn-primary" : "btn-ghost"}`}>
          Todos los horizontes
        </Link>
        {HORIZONS.map((h) => (
          <Link
            key={h}
            href={`/equipo/proyectos?horizonte=${encodeURIComponent(h)}`}
            className={`btn py-1.5 text-sm ${horizon === h ? "btn-primary" : "btn-ghost"}`}
          >
            {h}
          </Link>
        ))}
      </nav>

      {tarjetas.length === 0 && !sinProyecto ? (
        <EmptyState
          title="Todavía no hay proyectos aquí"
          message={
            esGlobal
              ? "Crea el primero con «Nuevo proyecto» o importa el CSV de tareas. Sin trabajo cargado, esta vista no inventa métricas."
              : "Cuando te sumen a un proyecto aparecerá aquí, con su tablero."
          }
          cta={{ href: "/equipo/hoy", label: "Ir a tu día" }}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {tarjetas.map((t) => (
            <li key={t.p.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-head text-2xl font-bold text-white">
                  <Link
                    href={`/equipo/proyectos/${encodeURIComponent(t.p.slug)}`}
                    className="hover:text-primary hover:underline"
                  >
                    {t.p.name}
                  </Link>
                </h2>
                <div className="flex items-center gap-2">
                  {t.p.client_id ? <span className="tag border-line text-muted">de cliente</span> : null}
                  <TeamHorizonBadge horizon={t.p.horizon} />
                </div>
              </div>
              {t.roles.length > 0 ? (
                <p className="mt-1 text-xs text-muted">Tu rol: {t.roles.map((r) => ROL_PROYECTO_LABEL[r]).join(" · ")}</p>
              ) : null}
              {t.p.notes ? <p className="mt-2 line-clamp-2 text-sm text-muted">{t.p.notes}</p> : null}
              <p className="mt-3 text-xs text-faint">
                {t.abiertas} abiertas ·{" "}
                <span className={t.bloqueadas > 0 ? "text-red-300" : ""}>{t.bloqueadas} bloqueadas</span> ·{" "}
                {t.cerradas} cerradas esta semana · {t.libres} sin responsable para tomar
              </p>
              {t.vencidas + t.porVencer > 0 ? (
                <p className="mt-1 text-xs">
                  {t.vencidas > 0 ? (
                    <span className="text-red-300">
                      {t.vencidas} {t.vencidas === 1 ? "pasó su plazo" : "pasaron su plazo"}
                    </span>
                  ) : null}
                  {t.vencidas > 0 && t.porVencer > 0 ? <span className="text-faint"> · </span> : null}
                  {t.porVencer > 0 ? <span className="text-amber-300">{t.porVencer} por vencer</span> : null}
                </p>
              ) : null}
              <Link
                href={`/equipo/proyectos/${encodeURIComponent(t.p.slug)}`}
                className="mt-4 inline-block text-sm text-primary hover:underline"
              >
                Abrir el tablero
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Trabajo sin proyecto: no se esconde nunca (solo para quien puede verlo). */}
      {sinProyecto && sinProyecto.open.length + sinProyecto.blocked.length > 0 ? (
        <section className="card p-6">
          <h2 className="font-head text-2xl font-bold text-white">Sin proyecto</h2>
          <p className="mt-1 text-xs text-faint">
            {sinProyecto.open.length} abiertas · {sinProyecto.blocked.length} bloqueadas, todavía sin proyecto.
          </p>
          <ul className="mt-4 space-y-2">
            {[...sinProyecto.blocked, ...sinProyecto.open].map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-sm text-white">{a.title}</span>
                  <span className="ml-2 text-xs text-faint">
                    {a.owner_name ?? "sin responsable"}
                    {a.due_date ? ` · vence ${a.due_date}` : ""}
                  </span>
                  {a.status === "Bloqueada" && a.blocked_reason ? (
                    <p className="mt-1 text-xs text-red-200">{a.blocked_reason}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.status === "Bloqueada" ? null : (
                    <SlaBadge sla={slas.get(a.id)} ahora={ahora} config={cfgSla} />
                  )}
                  <TeamPriorityBadge priority={a.priority} />
                  <TeamStatusBadge status={a.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-faint">
        Esta vista cuenta entregas y bloqueos por proyecto. No puntúa a personas: la carga se muestra para
        repartirla, nunca para comparar a nadie.
      </p>
    </div>
  );
}
