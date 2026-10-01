"use client";
import { useState } from "react";
import { normalizarCodigo } from "@/lib/ritos-labels";

/**
 * Registrar asistencia a un rito (WP31-D): la persona escribe el código que ve en
 * pantalla. El error de la API se muestra tal cual (copy de §8.4); el éxito
 * reemplaza al formulario.
 */
export default function RitoAsistenciaForm({ sessionId }: { sessionId: number }) {
  const [codigo, setCodigo] = useState("");
  const [estado, setEstado] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [mensaje, setMensaje] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const limpio = normalizarCodigo(codigo);
    if (!limpio) {
      setEstado("error");
      setMensaje("El código tiene 6 dígitos.");
      return;
    }
    setEstado("loading");
    setMensaje("");
    try {
      const res = await fetch("/api/ritos/asistir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, codigo: limpio }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEstado("error");
        setMensaje(data.error ?? "No se pudo registrar la asistencia.");
        return;
      }
      setEstado("ok");
      setMensaje(data.mensaje ?? "Listo. Quedó registrada tu asistencia.");
    } catch {
      setEstado("error");
      setMensaje("Sin conexión. Revisa tu red e intenta de nuevo.");
    }
  }

  if (estado === "ok") {
    return (
      <div className="card flex flex-col gap-2 border-primary/40 p-6" role="status" aria-live="polite">
        <p className="font-serif text-2xl normal-case leading-snug text-paper">{mensaje}</p>
        <p className="text-sm text-muted">Estar es suficiente. Faltar no resta nada.</p>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="card flex flex-col gap-4 p-6">
      <label className="label" htmlFor="rito-codigo">
        Escribe el código que ves en pantalla.
      </label>
      <input
        id="rito-codigo"
        className="input font-mono text-2xl tracking-[0.3em]"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000 000"
        value={codigo}
        onChange={(e) => setCodigo(e.target.value)}
        maxLength={12}
        required
      />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary normal-case tracking-normal" disabled={estado === "loading"}>
          {estado === "loading" ? "Registrando…" : "Registrar mi asistencia"}
        </button>
        {estado === "error" ? (
          <p className="text-sm text-amber-300" role="alert">
            {mensaje}
          </p>
        ) : null}
      </div>
    </form>
  );
}
