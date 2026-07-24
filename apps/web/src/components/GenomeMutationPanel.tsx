"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const GENES = ["EPOCH_BUDGET", "ACADEMIA_BUDGET", "ACADEMIA_DAILY_CAP", "ACADEMIA_VOTE_WEIGHT"] as const;

export default function GenomeMutationPanel({
  current,
  nextEpoch,
  latestVersion,
}: {
  current: Record<string, number>;
  nextEpoch: number;
  latestVersion: number;
}) {
  const router = useRouter();
  const [gene, setGene] = useState<string>(GENES[0]);
  const [value, setValue] = useState("");
  const [justification, setJustification] = useState("");
  const [revertTo, setRevertTo] = useState(String(Math.max(1, latestVersion - 1)));
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const cur = current[gene] ?? 0;
  const parsed = parseFloat(value);
  const pct = value && cur ? ((parsed - cur) / cur) * 100 : 0;
  const overLimit = Math.abs(pct) > 15;

  async function post(body: Record<string, unknown>) {
    setLoading(true);
    setErr("");
    setMsg("");
    try {
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
      setMsg("Decisión registrada. Se anuncia a la cohorte y aplica desde la época siguiente.");
      setValue("");
      setJustification("");
      router.refresh();
    } catch {
      setErr("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="label" htmlFor="just">Justificación (obligatoria, aplica a la decisión)</label>
        <textarea
          id="just"
          className="input min-h-[64px]"
          placeholder="Por qué este cambio (o por qué ninguno)…"
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
        />
      </div>

      {/* Proponer mutación */}
      <div className="rounded-md border border-line/60 p-4">
        <p className="mb-3 text-sm font-semibold text-white">Proponer mutación (1 gen, ±15% máx.)</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="gene">Gen</label>
            <select id="gene" className="input" value={gene} onChange={(e) => { setGene(e.target.value); setValue(""); }}>
              {GENES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="val">Nuevo valor (actual: {cur.toLocaleString("es")})</label>
            <input id="val" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          {value ? (
            <span className={`text-xs ${overLimit ? "text-red-400" : "text-faint"}`}>
              cambio {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%{overLimit ? " · excede 15%" : ""}
            </span>
          ) : null}
          <button
            className="btn btn-primary py-1.5 text-xs"
            disabled={loading || !value || overLimit || justification.trim().length < 10}
            onClick={() => post({ action: "proposeMutation", genes: [{ key: gene, value: parsed }], justification })}
          >
            Proponer para época {nextEpoch}
          </button>
        </div>
      </div>

      {/* Revertir / sin cambios */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="rev">Revertir a versión</label>
          <input id="rev" className="input w-24" inputMode="numeric" value={revertTo} onChange={(e) => setRevertTo(e.target.value)} />
        </div>
        <button
          className="btn btn-danger py-1.5 text-xs"
          disabled={loading || justification.trim().length < 10}
          onClick={() => post({ action: "revertGenome", targetVersion: parseInt(revertTo, 10), justification })}
        >
          Revertir genoma
        </button>
        <button
          className="btn btn-ghost py-1.5 text-xs"
          disabled={loading}
          onClick={() => post({ action: "recordNoMutation", epoch: nextEpoch, justification })}
          title="Registra explícitamente que la época siguiente no muta el genoma"
        >
          Registrar “sin cambios” para época {nextEpoch}
        </button>
      </div>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {msg ? <p className="text-sm text-primary">{msg}</p> : null}
    </div>
  );
}
