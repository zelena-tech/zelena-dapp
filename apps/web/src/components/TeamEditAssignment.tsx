"use client";
/**
 * Editar o reasignar una entrega desde el tablero (WP31).
 *
 *  - Quien la tiene a cargo cambia el contexto (descripción y enlace de referencia).
 *  - Quien planifica el proyecto cambia también título, criterio, prioridad, tamaño,
 *    horizonte, fecha y responsable.
 *  - En revisión (o bloqueada desde En revisión), responsable, tamaño, fecha,
 *    prioridad y criterio se ven deshabilitados: una entrega en revisión no se
 *    reasigna ni se replanifica.
 *
 * Solo se envía lo que cambió. El servidor (lib/team.ts) decide de nuevo cada campo.
 * Copys de ENTREGA (doc 16): se describe el trabajo, nunca a la persona.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  HORIZONS,
  PRIORITIES,
  PRIORITY_LABEL,
  SIZES,
  type Horizon,
  type Priority,
  type Size,
} from "@/lib/team";
import type { TeamStatus } from "@/lib/team-state-machine";

export interface PiezaEditable {
  id: number;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: Priority;
  size: Size | null;
  horizon: Horizon;
  dueDate: string | null;
  ownerWallet: string | null;
  ownerName: string | null;
  specUrl: string | null;
  needsFounder: boolean;
  status: TeamStatus;
  /**
   * Lo calcula el servidor (`fijaPorRevision`): En revisión, o Bloqueada desde En
   * revisión. Sin el dato, se deduce del estado.
   */
  fijaPorRevision?: boolean;
}

export interface OpcionResponsable {
  wallet: string;
  nombre: string;
}

const COPY_REVISION = "Una entrega en revisión no se reasigna ni se replanifica: devuélvela primero.";
const COPY_SIN_TAMANO = "Sin tamaño: cuenta como S hasta que quien planifica lo defina.";

export default function TeamEditAssignment({
  pieza,
  puedePlanificar,
  puedeContexto,
  personas,
}: {
  pieza: PiezaEditable;
  puedePlanificar: boolean;
  puedeContexto: boolean;
  /** Personas a quienes se puede asignar en este proyecto (vacío si no planifica). */
  personas: OpcionResponsable[];
}) {
  const router = useRouter();
  const [modo, setModo] = useState<"cerrado" | "editar" | "reasignar">("cerrado");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const [title, setTitle] = useState(pieza.title);
  const [description, setDescription] = useState(pieza.description);
  const [acceptanceCriteria, setAcceptance] = useState(pieza.acceptanceCriteria);
  const [priority, setPriority] = useState<Priority>(pieza.priority);
  const [size, setSize] = useState<Size | "">(pieza.size ?? "");
  const [horizon, setHorizon] = useState<Horizon>(pieza.horizon);
  const [dueDate, setDueDate] = useState(pieza.dueDate ?? "");
  const [ownerWallet, setOwner] = useState(pieza.ownerWallet ?? "");
  const [specUrl, setSpecUrl] = useState(pieza.specUrl ?? "");
  const [needsFounder, setNeedsFounder] = useState(pieza.needsFounder);
  const [motivo, setMotivo] = useState("");

  const enRevision = pieza.fijaPorRevision ?? pieza.status === "En revisión";
  const fijo = enRevision || !puedePlanificar;

  function reiniciar() {
    setTitle(pieza.title);
    setDescription(pieza.description);
    setAcceptance(pieza.acceptanceCriteria);
    setPriority(pieza.priority);
    setSize(pieza.size ?? "");
    setHorizon(pieza.horizon);
    setDueDate(pieza.dueDate ?? "");
    setOwner(pieza.ownerWallet ?? "");
    setSpecUrl(pieza.specUrl ?? "");
    setNeedsFounder(pieza.needsFounder);
    setMotivo("");
    setMsg("");
  }

  /** Solo lo que cambió respecto a la pieza: así no se pide permiso por un campo igual. */
  function cambios(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    if (puedeContexto) {
      if (description !== pieza.description) c.description = description;
      if ((specUrl.trim() || null) !== pieza.specUrl) c.specUrl = specUrl.trim() || null;
    }
    if (puedePlanificar) {
      if (title.trim() !== pieza.title) c.title = title;
      if (horizon !== pieza.horizon) c.horizon = horizon;
      if (needsFounder !== pieza.needsFounder) c.needsFounder = needsFounder;
      if (!enRevision) {
        if (acceptanceCriteria.trim() !== pieza.acceptanceCriteria) c.acceptanceCriteria = acceptanceCriteria;
        if (priority !== pieza.priority) c.priority = priority;
        if ((size || null) !== pieza.size) c.size = size || null;
        if ((dueDate || null) !== pieza.dueDate) c.dueDate = dueDate || null;
        if ((ownerWallet || null) !== pieza.ownerWallet) c.ownerWallet = ownerWallet || null;
      }
    }
    return c;
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const c = cambios();
    if (Object.keys(c).length === 0) {
      setModo("cerrado");
      return;
    }
    setGuardando(true);
    setMsg("");
    try {
      const res = await fetch("/api/equipo/asignacion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: pieza.id, ...c, motivo: motivo.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo editar la entrega.");
        return;
      }
      setModo("cerrado");
      setMotivo("");
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  if (!puedeContexto && !puedePlanificar) return null;

  if (modo === "cerrado") {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            reiniciar();
            setModo("editar");
          }}
          className="btn btn-ghost py-1 text-xs"
        >
          Editar
        </button>
        {puedePlanificar && !enRevision && pieza.status !== "Hecha" ? (
          <button
            type="button"
            onClick={() => {
              reiniciar();
              setModo("reasignar");
            }}
            className="btn btn-ghost py-1 text-xs"
          >
            {pieza.ownerWallet ? "Reasignar" : "Asignar"}
          </button>
        ) : null}
      </div>
    );
  }

  const campo =
    "w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-white placeholder:text-faint disabled:opacity-50";
  const id = (s: string) => `editar-${pieza.id}-${s}`;

  const selectorResponsable = (
    <div>
      <label className="block text-xs text-muted" htmlFor={id("owner")}>
        Responsable
      </label>
      <select
        id={id("owner")}
        value={ownerWallet}
        onChange={(e) => setOwner(e.target.value)}
        disabled={fijo}
        className={`mt-1 ${campo}`}
      >
        {pieza.status === "Backlog" || !pieza.ownerWallet ? <option value="">Sin responsable</option> : null}
        {pieza.ownerWallet && !personas.some((p) => p.wallet === pieza.ownerWallet) ? (
          <option value={pieza.ownerWallet}>{pieza.ownerName ?? "Responsable actual"}</option>
        ) : null}
        {personas.map((p) => (
          <option key={p.wallet} value={p.wallet}>
            {p.nombre}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={guardar} className="space-y-3 rounded-md border border-line/60 p-3">
      {enRevision ? <p className="text-xs text-amber-300">{COPY_REVISION}</p> : null}

      {modo === "reasignar" ? (
        selectorResponsable
      ) : (
        <>
          <div>
            <label className="block text-xs text-muted" htmlFor={id("title")}>
              Título
            </label>
            <input
              id={id("title")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={!puedePlanificar}
              className={`mt-1 ${campo}`}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {selectorResponsable}
            <div>
              <label className="block text-xs text-muted" htmlFor={id("prio")}>
                Prioridad
              </label>
              <select
                id={id("prio")}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                disabled={fijo}
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
              <label className="block text-xs text-muted" htmlFor={id("size")}>
                Tamaño
              </label>
              <select
                id={id("size")}
                value={size}
                onChange={(e) => setSize(e.target.value as Size | "")}
                disabled={fijo}
                className={`mt-1 ${campo}`}
              >
                <option value="">Sin tamaño</option>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {!size ? <p className="mt-1 text-xs text-faint">{COPY_SIN_TAMANO}</p> : null}
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor={id("due")}>
                Vence
              </label>
              <input
                id={id("due")}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={fijo}
                className={`mt-1 ${campo}`}
              />
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor={id("hor")}>
                Horizonte
              </label>
              <select
                id={id("hor")}
                value={horizon}
                onChange={(e) => setHorizon(e.target.value as Horizon)}
                disabled={!puedePlanificar}
                className={`mt-1 ${campo}`}
              >
                {HORIZONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted" htmlFor={id("crit")}>
              Criterio de aceptación
            </label>
            <textarea
              id={id("crit")}
              value={acceptanceCriteria}
              onChange={(e) => setAcceptance(e.target.value)}
              rows={2}
              maxLength={4000}
              disabled={fijo}
              className={`mt-1 ${campo}`}
            />
          </div>
          <div>
            <label className="block text-xs text-muted" htmlFor={id("desc")}>
              Contexto
            </label>
            <textarea
              id={id("desc")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={4000}
              disabled={!puedeContexto}
              className={`mt-1 ${campo}`}
            />
          </div>
          <div>
            <label className="block text-xs text-muted" htmlFor={id("spec")}>
              Enlace de referencia (https://…)
            </label>
            <input
              id={id("spec")}
              value={specUrl}
              onChange={(e) => setSpecUrl(e.target.value)}
              maxLength={500}
              disabled={!puedeContexto}
              className={`mt-1 ${campo}`}
            />
          </div>
          {puedePlanificar ? (
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={needsFounder}
                onChange={(e) => setNeedsFounder(e.target.checked)}
                className="h-4 w-4"
              />
              Espera una decisión del founder
            </label>
          ) : null}
        </>
      )}

      <div>
        <label className="block text-xs text-muted" htmlFor={id("motivo")}>
          Motivo del cambio (opcional)
        </label>
        <input
          id={id("motivo")}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={300}
          className={`mt-1 ${campo}`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={guardando} className="btn btn-primary py-1 text-xs disabled:opacity-40">
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => {
            reiniciar();
            setModo("cerrado");
          }}
          className="btn btn-ghost py-1 text-xs"
        >
          Cancelar
        </button>
      </div>
      {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
    </form>
  );
}
