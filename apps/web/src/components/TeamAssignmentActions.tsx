"use client";
/**
 * Acciones de un click sobre una asignación (WP14). Bloquear abre un campo de motivo
 * y el botón de confirmar queda deshabilitado hasta que haya texto: el motivo es
 * OBLIGATORIO en la UI y también en el servidor y en la máquina de estados.
 *
 * Copys de ENTREGA (doc 16): hablan de la pieza de trabajo, nunca de la persona.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEAM_ACTION_LABEL, type TeamAction } from "@/lib/team-state-machine";

export default function TeamAssignmentActions({
  assignmentId,
  actions,
}: {
  assignmentId: number;
  actions: TeamAction[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<TeamAction | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  async function send(action: TeamAction, motivo?: string) {
    setLoading(action);
    setMsg("");
    try {
      const res = await fetch("/api/equipo/asignacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, action, reason: motivo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo actualizar la asignación.");
        return;
      }
      setBlocking(false);
      setReason("");
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(null);
    }
  }

  if (actions.length === 0) {
    return <p className="text-xs text-faint">Entrega cerrada. No queda acción pendiente.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => (a === "bloquear" ? setBlocking(true) : send(a))}
            disabled={loading !== null}
            className={`btn py-1.5 text-sm ${a === "aprobar" || a === "desbloquear" ? "btn-primary" : "btn-ghost"}`}
          >
            {loading === a ? "…" : TEAM_ACTION_LABEL[a]}
          </button>
        ))}
      </div>

      {blocking ? (
        <div className="rounded-md border border-amber-800/40 bg-amber-950/10 p-3">
          <label className="block text-xs text-amber-200" htmlFor={`motivo-${assignmentId}`}>
            ¿Qué está trabando esta entrega? El motivo es obligatorio: es lo que permite destrabarla.
          </label>
          <input
            id={`motivo-${assignmentId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Ej.: falta el acceso al tenant del cliente"
            className="mt-2 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-faint"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => send("bloquear", reason)}
              disabled={reason.trim().length === 0 || loading !== null}
              className="btn btn-primary py-1.5 text-sm disabled:opacity-40"
            >
              Registrar el bloqueo
            </button>
            <button
              type="button"
              onClick={() => {
                setBlocking(false);
                setReason("");
                setMsg("");
              }}
              className="btn btn-ghost py-1.5 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
    </div>
  );
}
