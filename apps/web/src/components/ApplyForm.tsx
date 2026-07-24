"use client";
import { useState } from "react";

export default function ApplyForm({ projectId }: { projectId: number }) {
  const [approach, setApproach] = useState("");
  const [timeline, setTimeline] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setMsg("");
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, approach, timeline }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState("error");
        setMsg(data.error ?? "No se pudo enviar la aplicación.");
        return;
      }
      setState("ok");
      setMsg("Aplicación enviada. El supervisor la revisará.");
    } catch {
      setState("error");
      setMsg("Error de red. Intenta de nuevo.");
    }
  }

  if (state === "ok") {
    return (
      <div className="card border-primary/40 p-6 text-center">
        <div className="font-head text-lg font-bold text-primary">Aplicación enviada</div>
        <p className="mt-2 text-sm text-muted">{msg}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card p-6">
      <h3 className="font-head text-lg font-bold text-white">Aplicar</h3>
      <div className="mt-4 space-y-3">
        <div>
          <label className="label" htmlFor="approach">Tu enfoque</label>
          <textarea
            id="approach"
            className="input min-h-[120px]"
            placeholder="Cómo lo resolverías, tu experiencia relevante y por qué eres buen fit."
            value={approach}
            onChange={(e) => setApproach(e.target.value)}
            minLength={20}
            maxLength={2000}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="timeline">Plazo propuesto</label>
          <input
            id="timeline"
            className="input"
            placeholder="Ej. 6 semanas, entregas semanales"
            value={timeline}
            onChange={(e) => setTimeline(e.target.value)}
            minLength={3}
            maxLength={200}
            required
          />
        </div>
        {msg && state === "error" ? <p className="text-sm text-red-400">{msg}</p> : null}
        <button className="btn btn-primary w-full" disabled={state === "loading"}>
          {state === "loading" ? "Enviando…" : "Enviar aplicación"}
        </button>
      </div>
    </form>
  );
}
