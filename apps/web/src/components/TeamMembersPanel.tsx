"use client";
/**
 * Quiénes están en un proyecto y con qué rol (WP31).
 *
 * Todos los que ven el proyecto ven la lista. Sumar y quitar es de quien planifica:
 * founder y supervisores (los cuatro roles) o quien estructura el proyecto (solo
 * Ejecuta y Vende). Nadie cambia sus propios roles; sumar a alguien de fuera exige que
 * haya firmado el acuerdo de contribución. El servidor (lib/team.ts) vuelve a aplicar
 * cada regla: este panel solo evita ofrecer lo que no se puede.
 *
 * Son roles, no personas: el panel describe qué hace cada quien en el proyecto, nunca
 * cuánto vale nadie.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROL_PROYECTO_LABEL, type RolProyecto, type Vinculo } from "@/lib/roles";

export interface MiembroPanel {
  /** Clave estable para la lista (no tiene por qué ser la wallet). */
  clave: string;
  nombre: string;
  roles: RolProyecto[];
  vinculo: Vinculo;
  esYo: boolean;
  /** Roles que quien mira puede quitarle (vacío si no gestiona). */
  quitables: RolProyecto[];
  /** Solo viene si quien mira puede gestionar: identifica a la persona en el servidor. */
  wallet?: string;
}

export interface CandidatoPanel {
  wallet: string;
  nombre: string;
  interno: boolean;
}

export default function TeamMembersPanel({
  initiativeId,
  miembros,
  puedeGestionar,
  concedibles,
  candidatos,
  esGlobal,
}: {
  initiativeId: number;
  miembros: MiembroPanel[];
  puedeGestionar: boolean;
  concedibles: RolProyecto[];
  candidatos: CandidatoPanel[];
  esGlobal: boolean;
}) {
  const router = useRouter();
  const [quien, setQuien] = useState("");
  const [walletPegada, setWalletPegada] = useState("");
  const [rol, setRol] = useState<RolProyecto | "">(concedibles[0] ?? "");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");

  async function enviar(cuerpo: Record<string, unknown>) {
    setEnviando(true);
    setMsg("");
    try {
      const res = await fetch("/api/equipo/miembros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initiativeId, ...cuerpo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "No se pudo actualizar el proyecto.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setMsg("Error de red.");
      return false;
    } finally {
      setEnviando(false);
    }
  }

  async function sumar(e: React.FormEvent) {
    e.preventDefault();
    const wallet = walletPegada.trim() || quien;
    if (!wallet || !rol) return;
    const ok = await enviar({ action: "agregar", wallet, rol });
    if (ok) {
      setQuien("");
      setWalletPegada("");
    }
  }

  const campo = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-faint";

  return (
    <section className="card space-y-4 p-6">
      <h2 className="font-head text-2xl font-bold text-white">Quiénes están en este proyecto</h2>

      {miembros.length === 0 ? (
        <p className="text-sm text-faint">Todavía no hay nadie con un rol en este proyecto.</p>
      ) : (
        <ul className="space-y-2">
          {miembros.map((m) => (
            <li
              key={m.clave}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line/60 px-3 py-2"
            >
              <div className="min-w-0 text-sm text-white">
                {m.nombre}
                {m.esYo ? <span className="text-faint"> (tú)</span> : null}
                <span className="ml-2 text-xs text-faint">{m.vinculo === "externo" ? "externo" : "interno"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {m.roles.map((r) => (
                  <span key={r} className="tag border-line text-muted">
                    {ROL_PROYECTO_LABEL[r]}
                    {puedeGestionar && m.quitables.includes(r) && m.wallet ? (
                      <button
                        type="button"
                        disabled={enviando}
                        onClick={() => enviar({ action: "quitar", wallet: m.wallet, rol: r })}
                        className="ml-1 text-faint hover:text-red-300"
                        aria-label={`Quitar el rol ${ROL_PROYECTO_LABEL[r]} a ${m.nombre}`}
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {puedeGestionar && concedibles.length > 0 ? (
        <form onSubmit={sumar} className="space-y-3 border-t border-line/60 pt-4">
          <h3 className="text-sm font-semibold text-white">Sumar a alguien</h3>
          {!esGlobal ? (
            <p className="text-xs text-faint">
              Puedes sumar a quien ejecuta o vende. Para revisar o estructurar, pídeselo a un supervisor.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-muted" htmlFor="miembro-quien">
                Persona
              </label>
              <select
                id="miembro-quien"
                value={quien}
                onChange={(e) => setQuien(e.target.value)}
                disabled={!!walletPegada.trim()}
                className={`mt-1 ${campo}`}
              >
                <option value="">Elige a alguien</option>
                {/* Alguien que ya está puede recibir otro rol: no se filtra a quien ya tiene uno. */}
                {candidatos.map((c) => (
                  <option key={c.wallet} value={c.wallet}>
                    {c.nombre}
                    {c.interno ? "" : " · externo"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="miembro-wallet">
                o pega su wallet
              </label>
              <input
                id="miembro-wallet"
                value={walletPegada}
                onChange={(e) => setWalletPegada(e.target.value)}
                maxLength={120}
                placeholder="G…"
                className={`mt-1 ${campo}`}
              />
            </div>
            <div>
              <label className="block text-xs text-muted" htmlFor="miembro-rol">
                Rol
              </label>
              <select
                id="miembro-rol"
                value={rol}
                onChange={(e) => setRol(e.target.value as RolProyecto)}
                className={`mt-1 ${campo}`}
              >
                {concedibles.map((r) => (
                  <option key={r} value={r}>
                    {ROL_PROYECTO_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={enviando || !(walletPegada.trim() || quien) || !rol}
              className="btn btn-primary py-1.5 text-sm disabled:opacity-40"
            >
              {enviando ? "Guardando…" : "Sumar"}
            </button>
            <p className="text-xs text-faint">
              ¿Aún no tiene cuenta? Genera una invitación{" "}
              <Link href="/perfil#invitar" className="text-primary hover:underline">
                en tu perfil
              </Link>
              ; cuando firme el acuerdo, aparecerá aquí para sumarla.
            </p>
          </div>
        </form>
      ) : null}

      {msg ? <p className="text-sm text-red-400">{msg}</p> : null}
    </section>
  );
}
