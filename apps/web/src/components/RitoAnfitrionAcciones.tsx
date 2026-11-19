"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Acciones de quien presenta un rito (WP31-D): abrirlo dentro de su ventana y
 * cerrarlo con un resumen y un acta opcionales. La autorización real la hace la
 * ruta `/api/ritos` contra la base; esto solo pinta los botones.
 */
export default function RitoAnfitrionAcciones({
  sessionId,
  state,
  margen,
}: {
  sessionId: number;
  state: "Planned" | "Open" | "Closed";
  margen: string;
}) {
  const router = useRouter();
  const [resumen, setResumen] = useState("");
  const [acta, setActa] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function enviar(body: Record<string, unknown>) {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/ritos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar la acción.");
        return;
      }
      router.refresh();
    } catch {
      setError("Sin conexión. Revisa tu red e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  if (state === "Closed") return null;

  if (state === "Planned") {
    return (
      <div className="card flex flex-col gap-3 p-6">
        <p className="label">Quien presenta</p>
        <p className="text-sm text-muted">El rito se abre {margen} antes de empezar. Al abrirlo aparece el código.</p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="btn btn-primary normal-case tracking-normal"
            disabled={cargando}
            onClick={() => enviar({ action: "abrir", sessionId })}
          >
            {cargando ? "Abriendo…" : "Abrir el rito"}
          </button>
          {error ? (
            <p className="text-sm text-amber-300" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className="card flex flex-col gap-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm("¿Cerrar el rito? Ya no se registrará más asistencia.")) return;
        enviar({
          action: "cerrar",
          sessionId,
          ...(resumen.trim() ? { summary: resumen.trim() } : {}),
          ...(acta.trim() ? { notesUrl: acta.trim() } : {}),
        });
      }}
    >
      <p className="label">Cerrar el rito</p>
      <div>
        <label className="label" htmlFor="rito-resumen">
          Resumen (opcional, público)
        </label>
        <textarea
          id="rito-resumen"
          className="input min-h-24"
          value={resumen}
          onChange={(e) => setResumen(e.target.value)}
          maxLength={1000}
        />
      </div>
      <div>
        <label className="label" htmlFor="rito-acta">
          Enlace al acta (opcional)
        </label>
        <input
          id="rito-acta"
          type="url"
          className="input"
          placeholder="https://"
          value={acta}
          onChange={(e) => setActa(e.target.value)}
          maxLength={500}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-ghost normal-case tracking-normal" disabled={cargando}>
          {cargando ? "Cerrando…" : "Cerrar el rito"}
        </button>
        {error ? (
          <p className="text-sm text-amber-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
