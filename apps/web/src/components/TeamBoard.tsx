/**
 * Tablero de un proyecto (WP31): columnas por estado de la ENTREGA y filtros por
 * query string, renderizado en el servidor.
 *
 * Server component: sin estado propio. Las acciones de un click y la edición son
 * componentes de cliente que reciben, ya calculado en el servidor, lo que esta
 * persona puede hacer con cada pieza (`accionesPermitidas`, permisos del proyecto).
 *
 * Doc 16: las columnas dicen dónde va la pieza de trabajo, nunca cuánto vale nadie.
 * El responsable se muestra para repartir el trabajo, no para comparar a nadie.
 */
import Link from "next/link";
import {
  HECHAS_DIAS_POR_DEFECTO,
  HORIZONS,
  PARAMS_TABLERO,
  PRIORITIES,
  PRIORITY_LABEL,
  SIZES,
  esEnlaceSeguro,
  type AssignmentView,
  type FiltrosTablero,
} from "@/lib/team";
import type { TeamAction, TeamStatus } from "@/lib/team-state-machine";
import TeamAssignmentActions from "@/components/TeamAssignmentActions";
import TeamEditAssignment, { type OpcionResponsable } from "@/components/TeamEditAssignment";
import { TeamHorizonBadge, TeamPriorityBadge } from "@/components/TeamStatusBadge";

/** Orden de las columnas en pantalla: lo bloqueado antes de lo hecho. */
export const COLUMNAS_TABLERO: readonly TeamStatus[] = [
  "Backlog",
  "Asignada",
  "En curso",
  "En revisión",
  "Bloqueada",
  "Hecha",
];

export interface TarjetaTablero {
  pieza: AssignmentView;
  /** Lo que esta persona puede aplicar ahora (calculado en el servidor). */
  acciones: TeamAction[];
  /** Dueño o quien planifica: descripción y enlace. */
  puedeContexto: boolean;
  /** Quien planifica el proyecto: el resto de campos. */
  puedePlanificar: boolean;
}

function Tarjeta({ t, personas }: { t: TarjetaTablero; personas: OpcionResponsable[] }) {
  const a = t.pieza;
  return (
    <li className="rounded-md border border-line/60 bg-bg/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">{a.title}</h3>
        <TeamPriorityBadge priority={a.priority} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
        <span className="text-muted">{a.owner_name ?? "Sin responsable"}</span>
        {a.due_date ? <span>· vence {a.due_date}</span> : null}
        <span>· {a.size ? `tamaño ${a.size}` : "sin tamaño"}</span>
        {a.initiative_horizon && a.horizon !== a.initiative_horizon ? <TeamHorizonBadge horizon={a.horizon} /> : null}
        {a.needs_founder ? <span className="tag border-amber-700/50 text-amber-300">espera decisión</span> : null}
      </div>

      {a.acceptance_criteria ? (
        <p className="mt-2 line-clamp-3 text-xs text-muted">
          <span className="text-primary">Criterio:</span> {a.acceptance_criteria}
        </p>
      ) : a.status !== "Hecha" ? (
        <p className="mt-2 text-xs text-amber-300">Sin criterio de aceptación escrito todavía.</p>
      ) : null}

      {a.status === "Bloqueada" && a.blocked_reason ? (
        <p className="mt-2 rounded border border-red-900/50 bg-red-950/20 px-2 py-1 text-xs text-red-200">
          Bloqueada: {a.blocked_reason}
        </p>
      ) : null}

      {esEnlaceSeguro(a.spec_url) ? (
        <p className="mt-2 text-xs">
          <a href={a.spec_url as string} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
            Enlace de referencia
          </a>
        </p>
      ) : null}

      {a.published_as_project_id ? (
        <p className="mt-2 text-xs">
          <Link href={`/agora/${a.published_as_project_id}`} className="text-primary hover:underline">
            Publicada como proyecto en el Ágora
          </Link>
        </p>
      ) : null}

      {t.acciones.length > 0 ? (
        <div className="mt-3">
          <TeamAssignmentActions assignmentId={a.id} actions={t.acciones} />
        </div>
      ) : null}

      {a.status !== "Hecha" && (t.puedeContexto || t.puedePlanificar) ? (
        <div className="mt-2">
          <TeamEditAssignment
            pieza={{
              id: a.id,
              title: a.title,
              description: a.description,
              acceptanceCriteria: a.acceptance_criteria,
              priority: a.priority,
              size: a.size,
              horizon: a.horizon,
              dueDate: a.due_date,
              ownerWallet: a.owner_wallet,
              ownerName: a.owner_name,
              specUrl: a.spec_url,
              needsFounder: !!a.needs_founder,
              status: a.status,
            }}
            puedePlanificar={t.puedePlanificar}
            puedeContexto={t.puedeContexto}
            personas={personas}
          />
        </div>
      ) : null}
    </li>
  );
}

export default function TeamBoard({
  columnas,
  total,
  hayFiltros,
  hechasDias,
  personas,
}: {
  columnas: Record<TeamStatus, TarjetaTablero[]>;
  total: number;
  hayFiltros: boolean;
  hechasDias: number;
  /** Para reasignar (solo se usan si la tarjeta deja planificar). */
  personas: OpcionResponsable[];
}) {
  if (total === 0) {
    return (
      <p className="card p-6 text-sm text-muted">
        {hayFiltros ? "Nada por aquí con estos filtros." : "Este proyecto todavía no tiene entregas. Crea la primera."}
      </p>
    );
  }
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {COLUMNAS_TABLERO.map((estado) => {
        const tarjetas = columnas[estado] ?? [];
        return (
          <section key={estado} className="w-72 shrink-0" aria-label={estado}>
            <h2 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold text-white">
              <span>{estado === "Hecha" ? `Hecha (últimos ${hechasDias} días)` : estado}</span>
              <span className="text-xs font-normal text-faint">{tarjetas.length}</span>
            </h2>
            {tarjetas.length === 0 ? (
              <p className="rounded-md border border-dashed border-line/60 px-3 py-4 text-center text-xs text-faint">—</p>
            ) : (
              <ul className="space-y-3">
                {tarjetas.map((t) => (
                  <Tarjeta key={t.pieza.id} t={t} personas={personas} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Filtros del tablero: un formulario GET (sin JavaScript) que arma la query string que
 * lee `parseFiltrosTablero`. Responsable · Prioridad · Tamaño · Horizonte · Vence.
 */
export function TeamBoardFilters({
  accion,
  filtros,
  responsables,
}: {
  /** Ruta del tablero (el formulario vuelve a ella). */
  accion: string;
  filtros: FiltrosTablero;
  /** Responsables con piezas en este proyecto (lo que el tablero ya muestra). */
  responsables: Array<{ wallet: string; nombre: string }>;
}) {
  const campo = "w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-white";
  const etiqueta = "block text-xs text-muted";
  return (
    <form method="get" action={accion} className="card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-7">
      <div>
        <label className={etiqueta} htmlFor="f-responsable">
          Responsable
        </label>
        <select id="f-responsable" name={PARAMS_TABLERO.owner} defaultValue={filtros.owner ?? ""} className={campo}>
          <option value="">Todos</option>
          <option value="sin">Sin responsable</option>
          {responsables.map((r) => (
            <option key={r.wallet} value={r.wallet}>
              {r.nombre}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={etiqueta} htmlFor="f-prioridad">
          Prioridad
        </label>
        <select id="f-prioridad" name={PARAMS_TABLERO.priority} defaultValue={filtros.priority ?? ""} className={campo}>
          <option value="">Todas</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={etiqueta} htmlFor="f-tamano">
          Tamaño
        </label>
        <select id="f-tamano" name={PARAMS_TABLERO.size} defaultValue={filtros.size ?? ""} className={campo}>
          <option value="">Todos</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
          <option value="sin">Sin tamaño</option>
        </select>
      </div>
      <div>
        <label className={etiqueta} htmlFor="f-horizonte">
          Horizonte
        </label>
        <select id="f-horizonte" name={PARAMS_TABLERO.horizon} defaultValue={filtros.horizon ?? ""} className={campo}>
          <option value="">Todos</option>
          {HORIZONS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={etiqueta} htmlFor="f-vence">
          Vence
        </label>
        <select id="f-vence" name={PARAMS_TABLERO.vence} defaultValue={filtros.vence ?? ""} className={campo}>
          <option value="">Cuando sea</option>
          <option value="vencidas">Ya pasó la fecha</option>
          <option value="semana">En los próximos 7 días</option>
        </select>
      </div>
      <div>
        <label className={etiqueta} htmlFor="f-q">
          Texto
        </label>
        <input id="f-q" name={PARAMS_TABLERO.q} defaultValue={filtros.q ?? ""} maxLength={100} className={campo} />
      </div>
      <div className="flex items-end gap-2">
        {filtros.hechasDias && filtros.hechasDias !== HECHAS_DIAS_POR_DEFECTO ? (
          <input type="hidden" name={PARAMS_TABLERO.hechasDias} value={filtros.hechasDias} />
        ) : null}
        <button type="submit" className="btn btn-primary py-1.5 text-sm">
          Filtrar
        </button>
        <Link href={accion} className="btn btn-ghost py-1.5 text-sm">
          Limpiar
        </Link>
      </div>
    </form>
  );
}
