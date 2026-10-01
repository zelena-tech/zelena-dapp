/**
 * `/equipo/proyectos/[slug]` — el tablero de un proyecto (WP31).
 *
 * Columnas Backlog · Asignada · En curso · En revisión · Bloqueada · Hecha (últimos
 * 14 días), filtros por query string (render en servidor), alta de entregas, edición
 * y reasignación, y el panel de miembros.
 *
 * Puerta propia (spec WP31 §5.A.2): `equipoActor` lee la base, nunca la cookie; y si
 * esta persona no ve el proyecto (de otro equipo, o de un cliente donde no participa)
 * la respuesta es 404, igual que una dirección que no existe.
 *
 * Doc 16: el tablero describe ENTREGAS. El responsable se muestra para repartir el
 * trabajo; nada aquí compara ni puntúa personas.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { listClientsFor } from "@/lib/clients";
import { mismaPersona } from "@/lib/identidades";
import {
  ROL_PROYECTO_LABEL,
  esGlobalProyecto,
  rolesQuePuedeConceder,
  type RolProyecto,
} from "@/lib/roles";
import {
  HECHAS_DIAS_POR_DEFECTO,
  accionesPermitidas,
  candidatosParaProyecto,
  getProyectoPorSlug,
  miembrosDeProyecto,
  parseFiltrosTablero,
  permisosDe,
  puedeVerProyecto,
  rolesEnProyecto,
  tableroDeProyecto,
  type AssignmentView,
} from "@/lib/team";
import type { TeamStatus } from "@/lib/team-state-machine";
import TeamBoard, { COLUMNAS_TABLERO, TeamBoardFilters, type TarjetaTablero } from "@/components/TeamBoard";
import TeamMembersPanel, { type MiembroPanel } from "@/components/TeamMembersPanel";
import TeamNewAssignment from "@/components/TeamNewAssignment";
import TeamProjectForm from "@/components/TeamProjectForm";
import { TeamHorizonBadge } from "@/components/TeamStatusBadge";

export const dynamic = "force-dynamic";

export default async function TableroProyectoPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) redirect("/perfil");

  const proyecto = getProyectoPorSlug(db, params.slug);
  if (!proyecto || !puedeVerProyecto(db, actor, proyecto.id)) notFound();

  const permisos = permisosDe(db, actor, proyecto.id);
  const esGlobal = esGlobalProyecto(actor);
  const misRoles = rolesEnProyecto(db, actor.wallet, proyecto.id);
  const concedibles = rolesQuePuedeConceder(actor, misRoles);

  const filtros = parseFiltrosTablero(searchParams);
  const hayFiltros = Object.keys(filtros).some((k) => k !== "hechasDias");
  const now = new Date();
  const tablero = tableroDeProyecto(db, proyecto.id, filtros, now);
  const completo = hayFiltros ? tableroDeProyecto(db, proyecto.id, {}, now) : tablero;

  // Responsables con piezas en este proyecto: lo que el tablero ya enseña.
  const responsables = new Map<string, string>();
  for (const estado of COLUMNAS_TABLERO) {
    for (const a of completo.columnas[estado]) {
      if (a.owner_wallet) responsables.set(a.owner_wallet, a.owner_name ?? "Sin nombre");
    }
  }

  const candidatos = candidatosParaProyecto(db, actor, proyecto.id);
  const personasAsignables = permisos.planificar
    ? candidatos.map((c) => ({ wallet: c.wallet, nombre: c.nombre }))
    : [{ wallet: actor.wallet, nombre: actor.name }];

  const tarjeta = (a: AssignmentView): TarjetaTablero => {
    const esDueno = !!a.owner_wallet && mismaPersona(db, a.owner_wallet, actor.wallet);
    return {
      pieza: a,
      acciones: accionesPermitidas(db, actor, a),
      puedeContexto: esDueno || permisos.planificar,
      puedePlanificar: permisos.planificar,
    };
  };
  const columnas = Object.fromEntries(
    COLUMNAS_TABLERO.map((estado) => [estado, tablero.columnas[estado].map(tarjeta)])
  ) as Record<TeamStatus, TarjetaTablero[]>;

  // Miembros agrupados por persona. La wallet solo viaja al navegador de quien gestiona.
  const porPersona = new Map<string, MiembroPanel>();
  for (const m of miembrosDeProyecto(db, proyecto.id)) {
    const esYo = mismaPersona(db, m.wallet, actor.wallet);
    const nuevo: MiembroPanel = {
      clave: `m-${m.id}`,
      nombre: m.display_name,
      roles: [] as RolProyecto[],
      vinculo: m.vinculo,
      esYo,
      quitables: [] as RolProyecto[],
      wallet: permisos.planificar ? m.wallet : undefined,
    };
    const actual = porPersona.get(m.wallet) ?? nuevo;
    actual.roles.push(m.rol_proyecto);
    if (m.vinculo === "externo") actual.vinculo = "externo";
    if (permisos.planificar && !esYo && concedibles.includes(m.rol_proyecto)) actual.quitables.push(m.rol_proyecto);
    porPersona.set(m.wallet, actual);
  }

  const clientes = esGlobal
    ? listClientsFor(db, { wallet: actor.wallet, isFounder: actor.role === "founder" }).map((c) => ({
        id: c.id,
        nombre: c.name,
      }))
    : undefined;
  const ruta = `/equipo/proyectos/${encodeURIComponent(proyecto.slug)}`;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-head text-4xl font-bold text-white">{proyecto.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <TeamHorizonBadge horizon={proyecto.horizon} />
              {proyecto.client_id ? <span className="tag border-line text-muted">proyecto de cliente</span> : null}
              {misRoles.length > 0 ? (
                <span className="text-muted">Tu rol: {misRoles.map((r) => ROL_PROYECTO_LABEL[r]).join(" · ")}</span>
              ) : null}
              <span className="text-faint">
                {tablero.total} {hayFiltros ? "con estos filtros" : "entregas en el tablero"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/equipo/proyectos" className="btn btn-ghost py-1.5 text-sm">
              Proyectos
            </Link>
            <Link href="/equipo/hoy" className="btn btn-ghost py-1.5 text-sm">
              Tu día
            </Link>
          </div>
        </div>
        {proyecto.notes ? <p className="max-w-3xl whitespace-pre-line text-sm text-muted">{proyecto.notes}</p> : null}
        <div className="flex flex-wrap items-start gap-3">
          {permisos.crear ? (
            <TeamNewAssignment
              etiqueta="Nueva entrega"
              personas={personasAsignables}
              iniciativas={[{ id: proyecto.id, nombre: proyecto.name }]}
              proyectoFijo={{ id: proyecto.id, nombre: proyecto.name }}
              puedeAsignarAOtros={permisos.planificar}
              puedeFijarTamano={permisos.planificar}
              miWallet={actor.wallet}
            />
          ) : null}
          {permisos.planificar ? (
            <TeamProjectForm
              proyecto={{
                id: proyecto.id,
                name: proyecto.name,
                horizon: proyecto.horizon,
                notes: proyecto.notes,
                clientId: proyecto.client_id,
              }}
              clientes={clientes}
            />
          ) : null}
        </div>
      </header>

      <TeamBoardFilters
        accion={ruta}
        filtros={filtros}
        responsables={[...responsables.entries()]
          .map(([wallet, nombre]) => ({ wallet, nombre }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))}
      />

      <TeamBoard
        columnas={columnas}
        total={tablero.total}
        hayFiltros={hayFiltros}
        hechasDias={filtros.hechasDias ?? HECHAS_DIAS_POR_DEFECTO}
        personas={personasAsignables}
      />

      <TeamMembersPanel
        initiativeId={proyecto.id}
        miembros={[...porPersona.values()]}
        puedeGestionar={permisos.planificar}
        concedibles={concedibles}
        candidatos={candidatos}
        esGlobal={esGlobal}
      />

      <p className="text-xs text-faint">
        El tablero sigue entregas, no personas: la revisión la hace siempre otra persona y nada de lo logrado se
        descuenta.
      </p>
    </div>
  );
}
