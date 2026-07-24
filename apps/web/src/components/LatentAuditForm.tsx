"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const MECHANISMS = ["invitaciones", "academia", "rankings", "scoring", "ritos", "gobernanza"];
const ACTIONS: Array<{ value: string; label: string }> = [
  { value: "none", label: "Ninguna (solo registro)" },
  { value: "mutation_proposed", label: "Mutación propuesta (WP08)" },
  { value: "mechanism_change", label: "Cambio de mecánica" },
];

export default function LatentAuditForm({ defaultPeriod }: { defaultPeriod: string }) {
  const router = useRouter();
  const [f, setF] = useState({
    mechanism: MECHANISMS[0],
    period: defaultPeriod,
    manifestFunction: "",
    latentObserved: "",
    functionalFor: "",
    dysfunctionalFor: "",
    auditAction: "none",
    auditDecisionLogId: "",
  });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
      const body: Record<string, unknown> = { action: "createLatentAudit", ...f };
      if (f.auditDecisionLogId) body.auditDecisionLogId = parseInt(f.auditDecisionLogId, 10);
      else delete body.auditDecisionLogId;
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Error");
        return;
      }
      setMsg("Auditoría registrada. Visible públicamente en Gobernanza.");
      setF((p) => ({ ...p, manifestFunction: "", latentObserved: "", functionalFor: "", dysfunctionalFor: "", auditDecisionLogId: "" }));
      router.refresh();
    } catch {
      setErr("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="label" htmlFor="mech">Mecánica</label>
          <select id="mech" className="input" value={f.mechanism} onChange={(e) => set("mechanism", e.target.value)}>
            {MECHANISMS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="per">Periodo</label>
          <input id="per" className="input" value={f.period} onChange={(e) => set("period", e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">Función manifiesta (para qué se diseñó)</label>
        <textarea className="input" value={f.manifestFunction} onChange={(e) => set("manifestFunction", e.target.value)} />
      </div>
      <div>
        <label className="label">¿Qué observamos que no buscábamos? (función latente)</label>
        <textarea className="input" value={f.latentObserved} onChange={(e) => set("latentObserved", e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">¿Funcional para quién?</label>
          <textarea className="input" value={f.functionalFor} onChange={(e) => set("functionalFor", e.target.value)} />
        </div>
        <div>
          <label className="label">¿Disfuncional para quién?</label>
          <textarea className="input" value={f.dysfunctionalFor} onChange={(e) => set("dysfunctionalFor", e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="act">Acción</label>
          <select id="act" className="input" value={f.auditAction} onChange={(e) => set("auditAction", e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </select>
        </div>
        {f.auditAction === "mutation_proposed" ? (
          <div>
            <label className="label" htmlFor="decid">ID de decisión vinculada (decision log)</label>
            <input
              id="decid"
              className="input w-40"
              inputMode="numeric"
              placeholder="p.ej. 12"
              value={f.auditDecisionLogId}
              onChange={(e) => set("auditDecisionLogId", e.target.value)}
            />
          </div>
        ) : null}
        <button className="btn btn-primary py-1.5 text-xs" disabled={loading} onClick={submit}>
          Registrar auditoría
        </button>
      </div>
      {f.auditAction === "mutation_proposed" ? (
        <p className="text-xs text-faint">
          Propón la mutación arriba (sección Genoma) y pega aquí el ID de su entrada del decision log para enlazarla.
        </p>
      ) : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {msg ? <p className="text-sm text-primary">{msg}</p> : null}
    </div>
  );
}
