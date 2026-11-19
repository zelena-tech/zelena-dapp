"use client";
/**
 * Check-in diario async (rito 1 del playbook): hecho / haciendo / bloqueado.
 * Uno por persona por día y editable el mismo día — si ya existe, el formulario
 * llega relleno y guardar lo actualiza.
 *
 * Copys de doc 16: se habla del trabajo, nunca del valor de quien lo hace. Y no se
 * pide ni se muestra nada sobre horas ni presencia.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TeamCheckinForm({
  initial,
  alreadySent,
}: {
  initial: { done: string; doing: string; blocked: string };
  alreadySent: boolean;
}) {
  const router = useRouter();
  const [done, setDone] = useState(initial.done);
  const [doing, setDoing] = useState(initial.doing);
  const [blocked, setBlocked] = useState(initial.blocked);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  const empty = !done.trim() && !doing.trim() && !blocked.trim();

  async function save() {
    setLoading(true);
    setMsg("");
    setOk(false);
    try {
      const res = await fetch("/api/equipo/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done, doing, blocked }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo guardar el check-in.");
        return;
      }
      setOk(true);
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  const fields: Array<{ id: string; label: string; hint: string; value: string; set: (v: string) => void }> = [
    { id: "done", label: "Hecho", hint: "Qué quedó terminado", value: done, set: setDone },
    { id: "doing", label: "Haciendo", hint: "En qué estás ahora", value: doing, set: setDoing },
    { id: "blocked", label: "Bloqueado", hint: "Qué te está trabando (o nada)", value: blocked, set: setBlocked },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {alreadySent
          ? "Ya registraste tu check-in de hoy. Puedes corregirlo cuantas veces quieras durante el día."
          : "Tres líneas y listo. Sirve para que nadie tenga que preguntar por el estado del trabajo."}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {fields.map((f) => (
          <div key={f.id}>
            <label htmlFor={`checkin-${f.id}`} className="block text-sm font-semibold text-white">
              {f.label}
            </label>
            <span className="text-xs text-faint">{f.hint}</span>
            <textarea
              id={`checkin-${f.id}`}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-faint"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={loading || empty} className="btn btn-primary disabled:opacity-40">
          {loading ? "Guardando…" : alreadySent ? "Actualizar mi check-in" : "Guardar mi check-in"}
        </button>
        {ok ? <span className="text-sm text-primary">Guardado.</span> : null}
        {msg ? <span className="text-sm text-red-400">{msg}</span> : null}
      </div>
    </div>
  );
}
