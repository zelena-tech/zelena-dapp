"use client";
import { useCallback, useEffect, useState } from "react";
import { personasRegistradas } from "@/lib/ritos-labels";

/**
 * Código de asistencia para quien presenta un rito (WP31-D). Pide el código vigente
 * a `/api/ritos/codigo` (sin caché) cada 15 s y apenas vence el actual. Muestra solo
 * el CONTEO de personas registradas: la lista nominal no existe fuera de la huella
 * del cierre.
 */
export default function RitoCodigo({ sessionId, rotacionS }: { sessionId: number; rotacionS: number }) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [expira, setExpira] = useState(0);
  const [asistentes, setAsistentes] = useState(0);
  const [error, setError] = useState("");
  const [enlace, setEnlace] = useState("");

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/ritos/codigo?sesion=${sessionId}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCodigo(null);
        setError(data.error ?? "No pude traer el código.");
        return;
      }
      setError("");
      setCodigo(String(data.codigo));
      setExpira(Number(data.expiraEnS) || 0);
      setAsistentes(Number(data.asistentes) || 0);
    } catch {
      setError("Sin conexión. Reintentando…");
    }
  }, [sessionId]);

  useEffect(() => {
    setEnlace(`${window.location.host}/comunidad/ritos/${sessionId}`);
  }, [sessionId]);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15_000);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    const t = setInterval(() => setExpira((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  // Al vencer el código en pantalla, se pide el siguiente sin esperar al ciclo de 15 s.
  useEffect(() => {
    if (codigo && expira === 0) cargar();
  }, [codigo, expira, cargar]);

  return (
    <section className="card flex flex-col gap-4 border-primary/40 p-6 sm:p-8" aria-live="polite">
      <p className="label">Código de asistencia</p>
      {codigo ? (
        <p className="font-mono text-5xl tracking-[0.2em] text-paper sm:text-7xl" aria-label={`Código ${codigo.split("").join(" ")}`}>
          {codigo.slice(0, 3)} {codigo.slice(3)}
        </p>
      ) : (
        <p className="text-base text-muted">{error || "Cargando el código…"}</p>
      )}
      <p className="text-sm text-muted">
        Cambia cada {rotacionS} segundos.
        {codigo ? <span className="ml-2 text-faint">Este dura {expira} s más.</span> : null}
      </p>
      {enlace ? (
        <p className="text-sm text-muted">
          Quien asiste lo escribe en <span className="text-paper">{enlace}</span>
        </p>
      ) : null}
      <p className="text-base text-primary">{personasRegistradas(asistentes)}</p>
      {codigo && error ? <p className="text-sm text-faint">{error}</p> : null}
    </section>
  );
}
