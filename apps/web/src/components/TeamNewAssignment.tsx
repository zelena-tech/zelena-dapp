"use client";
/**
 * Alta rápida de una entrega (WP14 + FB del día 1 + WP31).
 *
 * Diseñado para el caso real: acabas de salir de una reunión y tienes 5 segundos.
 * Solo el título es obligatorio; todo lo demás está plegado tras "Más detalle".
 * Un formulario con doce campos obligatorios no se usa — se vuelve a la libreta.
 *
 * WP31: en el tablero de un proyecto la entrega nace en ESE proyecto
 * (`proyectoFijo`); quien trabaja por proyecto siempre elige uno de los suyos
 * (`requiereProyecto`); y lo que se planifica (tamaño, prioridad, fecha y la bandeja
 * del founder) lo fija quien planifica (`puedePlanificar`; el servidor lo vuelve a
 * decidir en `createAssignmentAs`). Las listas que recibe salen de lo que esta
 * persona puede ver, nunca del equipo entero.
 *
 * Copys de ENTREGA (doc 16): se describe el trabajo, nunca a la persona.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { HORIZONS, PRIORITIES, PRIORITY_LABEL, SIZES, type Priority, type Horizon, type Size } from "@/lib/team";

export interface OpcionPersona {
  wallet: string;
  nombre: string;
}
export interface OpcionIniciativa {
  id: number;
  nombre: string;
}

const COPY_SIN_TAMANO = "Sin tamaño: cuenta como S hasta que quien planifica lo defina.";
const COPY_SIN_PLAN = "Nace con prioridad Normal y sin fecha: la prioridad y la fecha las fija quien planifica el proyecto.";

export default function TeamNewAssignment({
  personas,
  iniciativas,
  puedeAsignarAOtros,
  miWallet,
  proyectoFijo,
  requiereProyecto = false,
  puedeFijarTamano = true,
  puedePlanificar,
  etiqueta = "+ Añadir trabajo",
}: {
  personas: OpcionPersona[];
  iniciativas: OpcionIniciativa[];
  /** Quien planifica (founder, supervisor o estructura); el resto crea para sí o sin dueño. */
  puedeAsignarAOtros: boolean;
  miWallet: string;
  /** En el tablero de un proyecto: la entrega nace ahí y no se elige proyecto. */
  proyectoFijo?: OpcionIniciativa;
  /** Quien trabaja por proyecto no crea trabajo suelto: siempre en uno de sus proyectos. */
  requiereProyecto?: boolean;
  /** El tamaño lo fija quien planifica; si no, la entrega nace sin tamaño. */
  puedeFijarTamano?: boolean;
  /** Prioridad, fecha y bandeja del founder: de quien planifica. Por defecto, igual que el tamaño. */
  puedePlanificar?: boolean;
  etiqueta?: string;
}) {
  const router = useRouter();
  const planifica = puedePlanificar ?? puedeFijarTamano;
  const proyectoInicial = proyectoFijo
    ? String(proyectoFijo.id)
    : requiereProyecto && iniciativas.length > 0
      ? String(iniciativas[0].id)
      : "";
  const [abierto, setAbierto] = useState(false);
  const [detalle, setDetalle] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const [title, setTitle] = useState("");
  const [ownerWallet, setOwnerWallet] = useState("");
  const [initiativeId, setInitiativeId] = useState(proyectoInicial);
  const [priority, setPriority] = useState<Priority>("Normal");
  const [horizon, setHorizon] = useState<Horizon>("Ahora");
  const [size, setSize] = useState<Size | "">("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [acceptanceCriteria, setAcceptance] = useState("");
  const [needsFounder, setNeedsFounder] = useState(false);

  function limpiar() {
    setTitle("");
    setOwnerWallet("");
    setInitiativeId(proyectoInicial);
    setPriority("Normal");
    setHorizon("Ahora");
    setSize("");
    setDueDate("");
    setDescription("");
    setAcceptance("");
    setNeedsFounder(false);
    setDetalle(false);
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (requiereProyecto && !initiativeId) {
      setMsg("Elige uno de tus proyectos.");
      return;
    }
    setGuardando(true);
    setMsg("");
    try {
      const res = await fetch("/api/equipo/crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          initiativeId: initiativeId ? Number(initiativeId) : null,
          ownerWallet: ownerWallet || null,
          priority: planifica ? priority : undefined,
          horizon,
          size: puedeFijarTamano ? size || null : null,
          dueDate: planifica ? dueDate || null : null,
          acceptanceCriteria: acceptanceCriteria || undefined,
          needsFounder: planifica ? needsFounder : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo crear la entrega.");
        return;
      }
      limpiar();
      setAbierto(false);
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="btn btn-primary py-1.5">
        {etiqueta}
      </button>
    );
  }

  const campo = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-faint";
  // Quien trabaja por proyecto ve el selector de proyecto arriba: es obligatorio.
  const proyectoArriba = !proyectoFijo && requiereProyecto;

  const selectorProyecto = (
    <div>
      <label className="block text-xs text-muted" htmlFor="nueva-ini">
        Proyecto
      </label>
      <select
        id="nueva-ini"
        value={initiativeId}
        onChange={(e) => setInitiativeId(e.target.value)}
        className={`mt-1 ${campo}`}
      >
        {requiereProyecto ? null : <option value="">Sin proyecto</option>}
        {iniciativas.map((i) => (
          <option key={i.id} value={i.id}>
            {i.nombre}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={crear} className="card space-y-3 p-4">
      <div>
        <label className="block text-xs text-muted" htmlFor="nueva-title">
          ¿Qué hay que hacer? Es lo único obligatorio.
        </label>
        <input
          id="nueva-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoFocus
          placeholder="Ej.: revisar la propuesta de analítica para el cliente"
          className={`mt-1 ${campo}`}
        />
        {proyectoFijo ? <p className="mt-1 text-xs text-faint">En {proyectoFijo.nombre}</p> : null}
      </div>

      {proyectoArriba ? selectorProyecto : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="block text-xs text-muted" htmlFor="nueva-owner">
            Responsable
          </label>
          <select
            id="nueva-owner"
            value={ownerWallet}
            onChange={(e) => setOwnerWallet(e.target.value)}
            className={`mt-1 ${campo}`}
          >
            <option value="">Sin dueño todavía (al backlog)</option>
            {personas
              .filter((p) => puedeAsignarAOtros || p.wallet === miWallet)
              .map((p) => (
                <option key={p.wallet} value={p.wallet}>
                  {p.nombre}
                  {p.wallet === miWallet ? " (yo)" : ""}
                </option>
              ))}
          </select>
        </div>
        {planifica ? (
          <>
            <div>
              <label className="block text-xs text-muted" htmlFor="nueva-prio">
                Prioridad
              </label>
              <select
                id="nueva-prio"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={`mt-1 ${campo}`}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="nueva-due">
                Vence
              </label>
              <input
                id="nueva-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={`mt-1 ${campo}`}
              />
            </div>
          </>
        ) : (
          <p className="self-end text-xs text-faint sm:col-span-2">{COPY_SIN_PLAN}</p>
        )}
      </div>

      {detalle ? (
        <div className="space-y-3 border-t border-line/60 pt-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {!proyectoFijo && !proyectoArriba ? selectorProyecto : null}
            <div>
              <label className="block text-xs text-muted" htmlFor="nueva-hor">
                Horizonte
              </label>
              <select
                id="nueva-hor"
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as Horizon)}
                className={`mt-1 ${campo}`}
              >
                {HORIZONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            {puedeFijarTamano ? (
              <div>
                <label className="block text-xs text-muted" htmlFor="nueva-size">
                  Tamaño
                </label>
                <select
                  id="nueva-size"
                  value={size}
                  onChange={(e) => setSize(e.target.value as Size | "")}
                  className={`mt-1 ${campo}`}
                >
                  <option value="">Sin estimar</option>
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="self-end text-xs text-faint">{COPY_SIN_TAMANO}</p>
            )}
          </div>

          <div>
            <label className="block text-xs text-muted" htmlFor="nueva-desc">
              Contexto
            </label>
            <textarea
              id="nueva-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={4000}
              className={`mt-1 ${campo}`}
            />
          </div>

          <div>
            <label className="block text-xs text-muted" htmlFor="nueva-crit">
              Criterio de aceptación — cómo se sabrá que está lista
            </label>
            <textarea
              id="nueva-crit"
              value={acceptanceCriteria}
              onChange={(e) => setAcceptance(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Ej.: la vista carga con datos reales y pasa la revisión"
              className={`mt-1 ${campo}`}
            />
          </div>

          {planifica ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={needsFounder}
                onChange={(e) => setNeedsFounder(e.target.checked)}
                className="h-4 w-4"
              />
              Espera una decisión del founder (aparece en su bandeja del dashboard)
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={!title.trim() || guardando} className="btn btn-primary py-1.5 text-sm disabled:opacity-40">
          {guardando ? "Guardando…" : "Crear"}
        </button>
        <button type="button" onClick={() => setDetalle((v) => !v)} className="btn btn-ghost py-1.5 text-sm">
          {detalle ? "Menos detalle" : "Más detalle"}
        </button>
        <button
          type="button"
          onClick={() => {
            limpiar();
            setAbierto(false);
            setMsg("");
          }}
          className="btn btn-ghost py-1.5 text-sm"
        >
          Cancelar
        </button>
        {!puedeAsignarAOtros ? (
          <span className="text-xs text-faint">Puedes crear para ti o dejarlo sin dueño.</span>
        ) : null}
      </div>

      {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
    </form>
  );
}
