"use client";
/**
 * Correo corporativo para entrar con Microsoft (`/equipo/talento`, solo founder).
 *
 * La puerta corporativa reconoce a una persona SOLO por su cuenta de Microsoft ya
 * vinculada (oid) o por su correo EXACTO vinculado aquí: nunca por su nombre ni por
 * un correo parecido. Antes de que alguien del equipo entre con Microsoft, el founder
 * escribe aquí su correo corporativo en su fila. Sin `db.ts`: habla con
 * `/api/equipo/talento` (acción `correo`), que autoriza y valida.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CuentaCorreo {
  wallet: string;
  nombre: string;
}

export interface CorreoVinculado {
  wallet: string;
  nombre: string;
  email: string;
  conMicrosoft: boolean;
}

function corta(w: string): string {
  return w.length > 14 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

export default function CorreoCorporativoForm({
  cuentas,
  vinculados,
  dominio,
}: {
  cuentas: CuentaCorreo[];
  vinculados: CorreoVinculado[];
  dominio: string;
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState("");
  const [email, setEmail] = useState("");
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");

  async function guardar() {
    setCargando(true);
    setError("");
    setMensaje("");
    try {
      const res = await fetch("/api/equipo/talento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "correo", wallet, email }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "No se pudo guardar el correo.");
        return;
      }
      setMensaje("Listo: con ese correo entrará a su fila con Microsoft.");
      setEmail("");
      setWallet("");
      router.refresh();
    } catch {
      setError("Error de red.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card space-y-4 p-6">
      <p className="text-sm text-muted">
        Para entrar con Microsoft, cada persona necesita su correo @{dominio} vinculado a su fila. La app nunca la
        reconoce por su nombre ni por un correo parecido: escribe el correo exacto.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="correo-cuenta">
            Persona
          </label>
          <select id="correo-cuenta" className="input" value={wallet} onChange={(e) => setWallet(e.target.value)}>
            <option value="">Elige una fila…</option>
            {cuentas.map((c) => (
              <option key={c.wallet} value={c.wallet}>
                {c.nombre} · {corta(c.wallet)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="correo-email">
            Correo corporativo
          </label>
          <input
            id="correo-email"
            className="input"
            type="email"
            placeholder={`nombre@${dominio}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
          />
        </div>
      </div>
      <button
        className="btn btn-primary"
        onClick={() => void guardar()}
        disabled={cargando || !wallet || email.trim().length < 3}
      >
        {cargando ? "Guardando…" : "Vincular correo"}
      </button>
      {mensaje ? <p className="text-sm text-primary">{mensaje}</p> : null}
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {vinculados.length > 0 ? (
        <ul className="space-y-1 border-t border-line pt-3 text-sm">
          {vinculados.map((v) => (
            <li key={v.email} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-white">
                {v.nombre} <span className="text-faint">· {v.email}</span>
              </span>
              <span className="text-xs text-faint">{v.conMicrosoft ? "ya entró con Microsoft" : "aún no entra"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
