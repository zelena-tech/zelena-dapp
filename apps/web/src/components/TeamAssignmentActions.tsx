"use client";
/**
 * Acciones de un click sobre una asignación (WP14).
 *
 * Dos acciones exigen texto escrito y abren un campo antes de ejecutarse:
 *  - **bloquear**: "¿qué está trabando esto?" — sin el motivo nadie puede destrabarlo.
 *  - **devolver** ("Pedir ajustes"): "¿qué falta para aprobarla?" — sin el qué falta,
 *    devolver una entrega es un juicio; con él, es información para terminarla.
 * El botón de confirmar queda deshabilitado hasta que haya texto, y la misma regla
 * se aplica en el servidor y en la máquina de estados pura: la UI no es el guardián.
 *
 * Copys de ENTREGA (doc 16): hablan de la pieza de trabajo, nunca de la persona.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TEAM_ACTION_LABEL, type TeamAction } from "@/lib/team-state-machine";

/** Acciones que abren el campo de texto, con su copy propio. */
const CON_MOTIVO: Partial<
  Record<TeamAction, { pregunta: string; placeholder: string; confirmar: string; tono: string }>
> = {
  bloquear: {
    pregunta: "¿Qué está trabando esta entrega? El motivo es obligatorio: es lo que permite destrabarla.",
    placeholder: "Ej.: falta el acceso al tenant del cliente",
    confirmar: "Registrar el bloqueo",
    tono: "border-amber-800/40 bg-amber-950/10 text-amber-200",
  },
  devolver: {
    pregunta: "¿Qué falta para poder aprobarla? Se le devuelve a quien la entregó con esta nota.",
    placeholder: "Ej.: falta cubrir el caso de wallet vacía en el test",
    confirmar: "Devolver con la nota",
    tono: "border-sky-800/40 bg-sky-950/10 text-sky-200",
  },
};

export default function TeamAssignmentActions({
  assignmentId,
  actions,
}: {
  assignmentId: number;
  actions: TeamAction[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<TeamAction | null>(null);
  const [pidiendo, setPidiendo] = useState<TeamAction | null>(null);
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
      setPidiendo(null);
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

  const campo = pidiendo ? CON_MOTIVO[pidiendo] : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => (CON_MOTIVO[a] ? (setPidiendo(a), setReason(""), setMsg("")) : send(a))}
            disabled={loading !== null}
            className={`btn py-1.5 text-sm ${
              a === "aprobar" || a === "desbloquear" ? "btn-primary" : "btn-ghost"
            }`}
          >
            {loading === a ? "…" : TEAM_ACTION_LABEL[a]}
          </button>
        ))}
      </div>

      {pidiendo && campo ? (
        <div className={`rounded-md border p-3 ${campo.tono}`}>
          <label className="block text-xs" htmlFor={`motivo-${assignmentId}`}>
            {campo.pregunta}
          </label>
          <input
            id={`motivo-${assignmentId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={campo.placeholder}
            className="mt-2 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-faint"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => send(pidiendo, reason)}
              disabled={reason.trim().length === 0 || loading !== null}
              className="btn btn-primary py-1.5 text-sm disabled:opacity-40"
            >
              {campo.confirmar}
            </button>
            <button
              type="button"
              onClick={() => {
                setPidiendo(null);
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
