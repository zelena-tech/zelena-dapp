"use client";
/**
 * Crear o editar un proyecto (WP31 · iniciativa = proyecto).
 *
 *  - Crear: founder o supervisor. Al crear, lleva al tablero del proyecto nuevo.
 *  - Editar: founder, supervisor o quien estructura el proyecto (nombre, horizonte y
 *    descripción). El cliente asociado solo aparece para founder o supervisor.
 *
 * La dirección (`slug`) sale del nombre al crear y no cambia después. Las reglas las
 * vuelve a aplicar el servidor (lib/team.ts): este formulario no es el guardián.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { HORIZONS, type Horizon } from "@/lib/team";

export interface OpcionCliente {
  id: number;
  nombre: string;
}

export interface ProyectoEditable {
  id: number;
  name: string;
  horizon: Horizon;
  notes: string | null;
  clientId: number | null;
}

export default function TeamProjectForm({
  proyecto,
  clientes,
  abiertoAlInicio = false,
}: {
  /** Sin proyecto: formulario de alta. Con proyecto: edición. */
  proyecto?: ProyectoEditable;
  /** Solo para founder o supervisor; si no viene, no se muestra el campo Cliente. */
  clientes?: OpcionCliente[];
  abiertoAlInicio?: boolean;
}) {
  const router = useRouter();
  const editando = !!proyecto;
  const [abierto, setAbierto] = useState(abiertoAlInicio);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState("");

  const [name, setName] = useState(proyecto?.name ?? "");
  const [horizon, setHorizon] = useState<Horizon>(proyecto?.horizon ?? "Ahora");
  const [notes, setNotes] = useState(proyecto?.notes ?? "");
  const [clientId, setClientId] = useState(proyecto?.clientId ? String(proyecto.clientId) : "");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setMsg("El nombre del proyecto va de 2 a 80 caracteres.");
      return;
    }
    setGuardando(true);
    setMsg("");
    try {
      const cuerpo: Record<string, unknown> = editando
        ? { initiativeId: proyecto!.id, name, horizon, notes: notes.trim() ? notes : null }
        : { name, horizon, notes: notes.trim() ? notes : undefined };
      if (clientes) cuerpo.clientId = clientId ? Number(clientId) : null;
      const res = await fetch("/api/equipo/proyectos", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo guardar el proyecto.");
        return;
      }
      setAbierto(false);
      if (!editando && data.slug) router.push(`/equipo/proyectos/${encodeURIComponent(data.slug)}`);
      else router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`btn py-1.5 text-sm ${editando ? "btn-ghost" : "btn-primary"}`}
      >
        {editando ? "Editar proyecto" : "Nuevo proyecto"}
      </button>
    );
  }

  const campo = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-faint";

  return (
    <form onSubmit={enviar} className="card w-full space-y-3 p-4">
      <h2 className="font-head text-xl font-bold text-white">{editando ? "Editar proyecto" : "Nuevo proyecto"}</h2>
      <div>
        <label className="block text-xs text-muted" htmlFor="proyecto-nombre">
          Nombre
        </label>
        <input
          id="proyecto-nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoFocus
          className={`mt-1 ${campo}`}
        />
        <p className="mt-1 text-xs text-faint">Así se verá en el tablero. La dirección no cambia después.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-muted" htmlFor="proyecto-horizonte">
            Horizonte
          </label>
          <select
            id="proyecto-horizonte"
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
        {clientes ? (
          <div>
            <label className="block text-xs text-muted" htmlFor="proyecto-cliente">
              Cliente (opcional)
            </label>
            <select
              id="proyecto-cliente"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={`mt-1 ${campo}`}
            >
              <option value="">Sin cliente (proyecto interno)</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-faint">
              Un proyecto de cliente solo lo ve quien participa en él o en ese cliente.
            </p>
          </div>
        ) : null}
      </div>

      <div>
        <label className="block text-xs text-muted" htmlFor="proyecto-notas">
          Descripción (opcional)
        </label>
        <textarea
          id="proyecto-notas"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={4000}
          className={`mt-1 ${campo}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={guardando} className="btn btn-primary py-1.5 text-sm disabled:opacity-40">
          {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear proyecto"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setMsg("");
          }}
          className="btn btn-ghost py-1.5 text-sm"
        >
          Cancelar
        </button>
      </div>
      {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
    </form>
  );
}
