"use client";
/**
 * Lista de la bandeja de avisos (WP31-C1). Solo pinta lo que le pasa la página y marca
 * como leídos los avisos propios contra `/api/avisos` (la ruta comprueba que sean de
 * quien pregunta).
 *
 * Límite cliente/servidor: este componente no importa la base, `crypto`, la sesión ni
 * nada de `node:`. Copys sobre la entrega, nunca sobre la persona; sin horas ni fechas
 * de lectura.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface AvisoVista {
  id: number;
  texto: string;
  enlace: string;
  leido: boolean;
}

export default function AvisosLista({ avisos }: { avisos: AvisoVista[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const noLeidos = avisos.filter((a) => !a.leido).map((a) => a.id);

  async function marcar(ids: number[]) {
    if (ids.length === 0) return;
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch("/api/avisos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error ?? "No se pudieron marcar los avisos.");
        return;
      }
      router.refresh();
    } catch {
      setMsg("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {noLeidos.length === 0
            ? "Ya leíste todo lo de tu bandeja."
            : noLeidos.length === 1
              ? "1 aviso sin leer."
              : `${noLeidos.length} avisos sin leer.`}
        </p>
        <button
          type="button"
          className="btn btn-ghost py-1.5 text-sm"
          disabled={loading || noLeidos.length === 0}
          onClick={() => marcar(noLeidos)}
        >
          Marcar como leídos
        </button>
      </div>
      {msg ? <p className="text-sm text-amber-300">{msg}</p> : null}
      <ul className="space-y-3">
        {avisos.map((a) => (
          <li key={a.id} className={`card p-4 ${a.leido ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="min-w-0 flex-1 whitespace-pre-line text-sm text-white">{a.texto}</p>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {a.leido ? null : <span className="tag border-primary/50 text-primary">nuevo</span>}
                <Link href={a.enlace} className="btn btn-ghost py-1 text-xs">
                  Ver la entrega
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
