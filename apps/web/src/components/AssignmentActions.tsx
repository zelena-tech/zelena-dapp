"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function AssignmentActions({
  assignmentId,
  actions,
}: {
  assignmentId: number;
  actions: Array<{ action: string; label: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function ejecutar(action: string) {
    setError(null);
    let reason: string | undefined;
    if (action === "bloquear") {
      // Bloquear sin motivo es información perdida: la regla se aplica también aquí,
      // pero la fuente de verdad sigue siendo la máquina de estados del servidor.
      const r = window.prompt("¿Qué lo está bloqueando? (obligatorio)");
      if (!r || r.trim().length < 3) return;
      reason = r.trim();
    }
    const res = await fetch("/api/equipo/accion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assignmentId, action, reason }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "No se pudo aplicar la acción.");
      return;
    }
    start(() => router.refresh());
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {actions.map((a) => (
          <button
            key={a.action}
            onClick={() => void ejecutar(a.action)}
            disabled={pending}
            className="btn btn-ghost px-3 py-1 text-xs disabled:opacity-50"
          >
            {a.label}
          </button>
        ))}
      </div>
      {error ? <span className="max-w-[16rem] text-right text-xs text-red-300">{error}</span> : null}
    </div>
  );
}
