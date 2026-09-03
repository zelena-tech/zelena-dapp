"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function CheckinForm({
  day,
  initial,
}: {
  day: string;
  initial: { done: string; doing: string; blocked: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(initial?.done ?? "");
  const [doing, setDoing] = useState(initial?.doing ?? "");
  const [blocked, setBlocked] = useState(initial?.blocked ?? "");
  const [msg, setMsg] = useState<string | null>(null);

  async function guardar() {
    const res = await fetch("/api/equipo/accion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "checkin", day, done, doing, blocked }),
    });
    setMsg(res.ok ? "Guardado." : "No se pudo guardar.");
    if (res.ok) start(() => router.refresh());
  }

  const campo = "w-full rounded-md border border-line bg-bg p-2 text-sm text-white focus:border-primary focus:outline-none";
  return (
    <div className="card space-y-3 p-5">
      <div>
        <label className="mb-1 block text-xs uppercase tracking-widest text-faint">Hecho</label>
        <textarea className={campo} rows={2} value={done} onChange={(e) => setDone(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase tracking-widest text-faint">Haciendo</label>
        <textarea className={campo} rows={2} value={doing} onChange={(e) => setDoing(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs uppercase tracking-widest text-faint">Bloqueado</label>
        <textarea className={campo} rows={2} value={blocked} onChange={(e) => setBlocked(e.target.value)} />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => void guardar()} disabled={pending} className="btn btn-primary py-1.5 text-sm disabled:opacity-50">
          Guardar check-in
        </button>
        {msg ? <span className="text-xs text-muted">{msg}</span> : null}
      </div>
    </div>
  );
}
