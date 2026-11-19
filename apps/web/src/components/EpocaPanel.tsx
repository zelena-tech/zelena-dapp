"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fechaLargaRito } from "@/lib/ritos-labels";
import { parseInstanteDb } from "@/lib/zona-horaria";

/**
 * Épocas en /admin (WP31-D corte 2, copy de §8.5). Cerrar la época actual y abrir la
 * siguiente es UNA operación: se calcula su huella (raíz Merkle), se encola para la
 * red de pruebas y se abre la siguiente. Si no hay ninguna abierta, se abre una.
 *
 * Solo pinta y pregunta: lo que falta y las reglas los decide el servidor
 * (`/api/admin/epoca` → `lib/epocas.ts`), con el rol del founder leído de la base.
 */
export interface EpocaPanelProps {
  /** Lo que devuelve `estadoCierreEpoca` (lib/epocas.ts), tal cual. */
  estado: {
    periodo: { id: number; name: string; state: string; created_at: string } | null;
    faltantes: string[];
    puedeCerrar: boolean;
    puedeAbrir: boolean;
  };
  /** Zona del genoma, para decir desde qué día está abierta. */
  tz: string;
}

const MIN_JUSTIFICACION = 10;

function corta(huella: string): string {
  return huella.length > 16 ? `${huella.slice(0, 16)}…` : huella;
}

/** "1 de octubre de 2026" en la zona del genoma; si la fecha no se lee, la de la base. */
function desdeTexto(createdAt: string, tz: string): string {
  try {
    return fechaLargaRito(parseInstanteDb(createdAt), tz);
  } catch {
    return createdAt.slice(0, 10);
  }
}

export default function EpocaPanel({ estado, tz }: EpocaPanelProps) {
  const { periodo, faltantes, puedeCerrar, puedeAbrir } = estado;
  const router = useRouter();
  const [justificacion, setJustificacion] = useState("");
  const [nombre, setNombre] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");

  const abierta = periodo?.state === "Open";
  const n = periodo?.id ?? 0;
  const justificacionOk = justificacion.trim().length >= MIN_JUSTIFICACION;

  async function enviar(body: Record<string, unknown>, exito: (data: Record<string, unknown>) => string) {
    setCargando(true);
    setError("");
    setListo("");
    try {
      const res = await fetch("/api/admin/epoca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo completar la operación.");
        return;
      }
      setListo(exito(data));
      setJustificacion("");
      setNombre("");
      router.refresh();
    } catch {
      setError("Sin conexión. Revisa tu red e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  function cerrar() {
    if (!periodo || !abierta) return;
    const ok = window.confirm(
      `¿Cerrar la época ${n}? Se calcula su huella, se encola para la red de pruebas y se abre la ${n + 1}. No se puede deshacer.`
    );
    if (!ok) return;
    enviar(
      {
        action: "cerrar",
        justificacion: justificacion.trim(),
        ...(nombre.trim() ? { nombreSiguiente: nombre.trim() } : {}),
      },
      (d) =>
        `Época ${String(d.cerrada)} cerrada. Su huella (${corta(String(d.merkleRoot ?? ""))}) quedó en la cola de la red de pruebas y ya está abierta la siguiente.`
    );
  }

  function abrir() {
    enviar(
      { action: "abrir", justificacion: justificacion.trim(), ...(nombre.trim() ? { nombre: nombre.trim() } : {}) },
      (d) => `Época ${String(d.abierta)} abierta.`
    );
  }

  const siguiente = n + 1; // sin ninguna época, la que se abre es la 1

  return (
    <div className="card space-y-5 p-6">
      {abierta && periodo ? (
        <div className="space-y-2">
          <p className="text-sm text-white">
            {periodo.name} · abierta desde {desdeTexto(periodo.created_at, tz)}
          </p>
          {faltantes.length > 0 ? (
            <>
              <ul className="space-y-1 text-xs text-amber-300">
                {faltantes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="text-xs text-faint">
                Se resuelve más abajo: el fitness en «Motor de épocas · Fitness» y la mutación en «Genoma · Mutación por
                época».
              </p>
            </>
          ) : (
            <p className="text-xs text-faint">Está lista para cerrarse: fitness firmado y mutación de la siguiente decidida.</p>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm text-white">No hay ninguna época abierta.</p>
          {periodo ? (
            <p className="text-xs text-faint">
              La última es {periodo.name} ({periodo.state === "Anchored" ? "cerrada y anclada" : "cerrada"}).
            </p>
          ) : null}
        </div>
      )}

      {abierta || puedeAbrir ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (abierta) cerrar();
            else abrir();
          }}
        >
          <div>
            <label className="label" htmlFor="epoca-justificacion">
              Justificación (obligatoria, queda en el decision log)
            </label>
            <textarea
              id="epoca-justificacion"
              className="input min-h-20"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              maxLength={2000}
              required
            />
            <p className="mt-1 text-[11px] text-faint">Mínimo {MIN_JUSTIFICACION} caracteres.</p>
          </div>
          <div>
            <label className="label" htmlFor="epoca-nombre">
              {abierta ? "Nombre de la siguiente (opcional)" : "Nombre de la época (opcional)"}
            </label>
            <input
              id="epoca-nombre"
              className="input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={`Época ${siguiente}`}
              maxLength={80}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {abierta ? (
              <button
                type="submit"
                className="btn btn-danger py-1.5 text-xs"
                disabled={cargando || !puedeCerrar || !justificacionOk}
              >
                {cargando ? "Cerrando…" : "Cerrar esta época y abrir la siguiente"}
              </button>
            ) : (
              <button type="submit" className="btn btn-primary py-1.5 text-xs" disabled={cargando || !justificacionOk}>
                {cargando ? "Abriendo…" : "Abrir época"}
              </button>
            )}
            {error ? (
              <p className="text-xs text-red-400" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </form>
      ) : null}

      {listo ? (
        <p className="text-xs text-primary" role="status">
          {listo}
        </p>
      ) : null}
    </div>
  );
}
