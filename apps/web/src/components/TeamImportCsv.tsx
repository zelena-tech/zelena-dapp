"use client";
/**
 * Importar CSV desde la web (`/equipo/talento#importar`, WP31-A2).
 *
 * Se pega el texto o se sube el archivo; el servidor (`/api/equipo/importar`)
 * resuelve cada Assignee por datos y responde el resumen. Importar no da puntos.
 * Solo tipos de lib/team-import: nada de servidor viaja al navegador.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportSummary } from "@/lib/team-import";

const MAX_BYTES = 500 * 1024;

export default function TeamImportCsv() {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<ImportSummary | null>(null);

  async function leerArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    e.target.value = "";
    if (!archivo) return;
    if (archivo.size > MAX_BYTES) {
      setError("El CSV pasa de 500 KB: pártelo en dos.");
      return;
    }
    setError("");
    setResultado(null);
    setCsv(await archivo.text());
  }

  async function importar(e: React.FormEvent) {
    e.preventDefault();
    if (!csv.trim()) {
      setError("Pega el CSV o sube el archivo.");
      return;
    }
    if (new TextEncoder().encode(csv).length > MAX_BYTES) {
      setError("El CSV pasa de 500 KB: pártelo en dos.");
      return;
    }
    setCargando(true);
    setError("");
    setResultado(null);
    try {
      const res = await fetch("/api/equipo/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo importar el CSV.");
        return;
      }
      setResultado(data as ImportSummary);
      router.refresh();
    } catch {
      setError("Error de red.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <form onSubmit={importar} className="card space-y-4 p-5">
      <p className="text-sm text-muted">
        Pega el CSV con columnas Initiative, Title, Assignee, Status, Priority, Size, Due. Importar no da puntos.
      </p>
      <div>
        <label className="label" htmlFor="importar-csv">
          CSV
        </label>
        <textarea
          id="importar-csv"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={"Initiative,Title,Assignee,Status,Priority,Size,Due\nHuerto Demo,Regar el huerto,Vale,Asignada,Normal,S,2026-10-09"}
          className="input font-mono text-sm"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn btn-ghost cursor-pointer py-1.5 text-xs">
          Subir archivo
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={leerArchivo} />
        </label>
        <button type="submit" className="btn btn-primary py-1.5" disabled={cargando || !csv.trim()}>
          {cargando ? "Importando…" : "Importar"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {resultado ? (
        <div className="space-y-2 border-t border-line/60 pt-4" aria-live="polite">
          <p className="text-sm text-white">
            {resultado.created} creadas · {resultado.updated} ya estaban · {resultado.errors.length} con error
          </p>
          {resultado.errors.length > 0 ? (
            <ul className="space-y-1 text-sm text-red-200">
              {resultado.errors.map((e) => (
                <li key={`e-${e.line}`}>
                  Fila {e.line}: {e.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {resultado.warnings.length > 0 ? (
            <ul className="space-y-1 text-xs text-faint">
              {resultado.warnings.map((w, i) => (
                <li key={`w-${w.line}-${i}`}>
                  Fila {w.line}: {w.warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
