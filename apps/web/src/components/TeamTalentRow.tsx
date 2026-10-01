"use client";
/**
 * Una persona del directorio de talento (`/equipo/talento`, WP31-A2).
 *
 * Muestra rol, supervisión, proyectos y su carga abierta (para repartir trabajo,
 * nunca para evaluar). Las acciones del founder van en dos pasos: primero se lee lo
 * que va a pasar y después se confirma. Vincular una fila del roster simula antes
 * (cuántos registros se mueven) y solo entonces ofrece confirmar, con la cuenta de
 * destino escrita completa. Si la fila tiene historia en una época o un rito ya
 * cerrados, ofrece vincular sin tocar lo cerrado (`conservarSellado`).
 *
 * Sin `db.ts` ni nada de servidor: recibe datos planos y habla con
 * `/api/equipo/talento`. La autorización real vive en la ruta y en lib/talento.ts.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface PersonaTalento {
  wallet: string;
  nombre: string;
  role: "founder" | "core" | "contributor";
  rolLabel: string;
  isSupervisor: boolean;
  status: string;
  pendiente: boolean;
  tieneCla: boolean;
  vinculo: "interno" | "externo" | "mixto" | null;
  abiertas: number;
  /** Slug del roster cuando la fila es `pending:<slug>` sin vincular. */
  slug: string | null;
  membresias: Array<{ slug: string; nombre: string; roles: string[] }>;
}

export interface CandidatoVinculo {
  wallet: string;
  nombre: string;
}

const VINCULO_LABEL: Record<"interno" | "externo" | "mixto", string> = {
  interno: "Interno",
  externo: "Externo",
  mixto: "Interno y externo",
};

/** Nombre del rol en las confirmaciones (copy de spec §8.5). */
const ROL_DESTINO: Record<"core" | "contributor", string> = { core: "Core", contributor: "Contributor" };

const ROL_PROYECTO: Record<string, string> = {
  estructura: "Estructura",
  ejecuta: "Ejecuta",
  revisa: "Revisa",
  vende: "Vende",
};

function corta(w: string): string {
  return w.length > 12 ? `${w.slice(0, 5)}…${w.slice(-4)}` : w;
}

type Pendiente =
  | { tipo: "rol"; role: "core" | "contributor" }
  | { tipo: "supervisor"; isSupervisor: boolean }
  | {
      tipo: "vincular";
      wallet: string;
      total: number;
      detalle: string;
      descartadas: number;
      /** Vincular sin mover lo ya cerrado (épocas o ritos cerrados se quedan en la fila del equipo). */
      conservar: boolean;
      conservadas: number;
      detalleConservadas: string;
    };

type Respuesta = { ok: boolean; data: Record<string, unknown> };

export default function TeamTalentRow({
  persona,
  editable,
  vinculable,
  candidatos,
}: {
  persona: PersonaTalento;
  /** El actor es founder y la persona no es él mismo ni otro founder. */
  editable: boolean;
  /** El actor es founder y la fila es del roster sin vincular. */
  vinculable: boolean;
  candidatos: CandidatoVinculo[];
}) {
  const router = useRouter();
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [cuenta, setCuenta] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  /** La simulación chocó con historia sellada: se puede vincular sin mover lo cerrado. */
  const [sellada, setSellada] = useState(false);

  async function enviar(cuerpo: Record<string, unknown>): Promise<Respuesta> {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/equipo/talento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo guardar el cambio.");
        return { ok: false, data };
      }
      return { ok: true, data };
    } catch {
      setError("Error de red.");
      return { ok: false, data: {} };
    } finally {
      setCargando(false);
    }
  }

  async function confirmar() {
    if (!pendiente) return;
    const cuerpo =
      pendiente.tipo === "rol"
        ? { action: "rol", wallet: persona.wallet, role: pendiente.role }
        : pendiente.tipo === "supervisor"
          ? { action: "supervisor", wallet: persona.wallet, isSupervisor: pendiente.isSupervisor }
          : {
              action: "vincular",
              slug: persona.slug,
              wallet: pendiente.wallet,
              ...(pendiente.conservar ? { conservarSellado: true } : {}),
            };
    const { ok } = await enviar(cuerpo);
    if (ok) {
      setPendiente(null);
      setSellada(false);
      router.refresh();
    }
  }

  async function simularVinculo(conservar: boolean) {
    if (!cuenta || !persona.slug) return;
    const { ok, data } = await enviar({
      action: "vincular",
      slug: persona.slug,
      wallet: cuenta,
      simular: true,
      ...(conservar ? { conservarSellado: true } : {}),
    });
    if (!ok) {
      setSellada(data.historiaSellada === true);
      return;
    }
    setSellada(false);
    const resumen = (data.resumen ?? {}) as {
      total?: number;
      detalle?: string;
      descartadas?: number;
      conservadas?: number;
      detalleConservadas?: string;
    };
    setPendiente({
      tipo: "vincular",
      wallet: cuenta,
      total: resumen.total ?? 0,
      detalle: resumen.detalle ?? "",
      descartadas: resumen.descartadas ?? 0,
      conservar,
      conservadas: resumen.conservadas ?? 0,
      detalleConservadas: resumen.detalleConservadas ?? "",
    });
  }

  const otroRol: "core" | "contributor" = persona.role === "contributor" ? "core" : "contributor";

  let pregunta = "";
  if (pendiente?.tipo === "rol") {
    pregunta = `¿Pasar a ${persona.nombre} a ${ROL_DESTINO[pendiente.role]}? Cambia lo que puede ver en /equipo.`;
  } else if (pendiente?.tipo === "supervisor") {
    pregunta = pendiente.isSupervisor
      ? `¿Dar supervisión a ${persona.nombre}? Podrá ver todo el equipo y aprobar entregas ajenas.`
      : `¿Quitar la supervisión a ${persona.nombre}? Dejará de ver todo el equipo; su trabajo no cambia.`;
  } else if (pendiente?.tipo === "vincular") {
    pregunta =
      pendiente.conservar && pendiente.conservadas > 0
        ? `Se moverán ${pendiente.total} registros (${pendiente.detalle}). Lo ya cerrado (${pendiente.detalleConservadas}) se queda como está, unido a esta cuenta. No se puede deshacer.`
        : `Se moverán ${pendiente.total} registros (${pendiente.detalle}). No se puede deshacer.`;
  }
  // La confirmación siempre nombra la cuenta COMPLETA de destino: un mal clic en la
  // lista no puede pasar el trabajo de alguien a otra persona sin que se vea.
  const destino =
    pendiente?.tipo === "vincular"
      ? { nombre: candidatos.find((c) => c.wallet === pendiente.wallet)?.nombre ?? "", cuenta: pendiente.wallet }
      : null;

  return (
    <li className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-head text-lg font-bold text-white">{persona.nombre}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="tag border-line text-muted">{persona.rolLabel}</span>
            {persona.isSupervisor ? (
              <span className="tag border-sky-700/40 bg-sky-950/20 text-sky-300">Supervisa</span>
            ) : null}
            {persona.vinculo ? (
              <span className="tag border-line text-faint">{VINCULO_LABEL[persona.vinculo]}</span>
            ) : null}
            {persona.pendiente ? (
              <span className="tag border-amber-700/40 bg-amber-950/20 text-amber-300">Sin cuenta vinculada</span>
            ) : !persona.tieneCla ? (
              <span className="tag border-line text-faint">Sin acuerdo firmado</span>
            ) : null}
            {persona.status !== "active" ? <span className="tag border-line text-faint">{persona.status}</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-head text-2xl font-bold text-white">{persona.abiertas}</div>
          <div className="text-xs text-faint">{persona.abiertas === 1 ? "abierta" : "abiertas"}</div>
        </div>
      </div>

      {persona.membresias.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {persona.membresias.map((m) => (
            <li key={m.slug}>
              <Link
                href={`/equipo/proyectos/${encodeURIComponent(m.slug)}`}
                className="tag border-line text-muted hover:border-primary/60"
              >
                {m.nombre} · {m.roles.map((r) => ROL_PROYECTO[r] ?? r).join(", ")}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-faint">Todavía sin proyectos.</p>
      )}

      {editable && !pendiente ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {persona.role !== "founder" ? (
            <button
              type="button"
              className="btn btn-ghost py-1.5 text-xs"
              disabled={cargando}
              onClick={() => setPendiente({ tipo: "rol", role: otroRol })}
            >
              Pasar a {ROL_DESTINO[otroRol]}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost py-1.5 text-xs"
            disabled={cargando}
            onClick={() => setPendiente({ tipo: "supervisor", isSupervisor: !persona.isSupervisor })}
          >
            {persona.isSupervisor ? "Quitar supervisión" : "Dar supervisión"}
          </button>
        </div>
      ) : null}

      {vinculable && !pendiente ? (
        <div className="mt-4 space-y-2 border-t border-line/60 pt-4">
          <p className="text-sm text-muted">
            Esta fila del equipo aún no tiene cuenta. Vincúlala con la cuenta con la que ya entró la persona: su
            trabajo, sus puntos y su historial pasan a esa cuenta.
          </p>
          {candidatos.length === 0 ? (
            <p className="text-xs text-faint">
              Todavía no hay cuentas para vincular: la persona tiene que entrar y firmar el acuerdo primero.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`vincular-${persona.wallet}`}>
                Cuenta con la que entró
              </label>
              <select
                id={`vincular-${persona.wallet}`}
                value={cuenta}
                onChange={(e) => {
                  setCuenta(e.target.value);
                  setSellada(false);
                  setError("");
                }}
                className="input max-w-xs py-1.5 text-sm"
              >
                <option value="">Elige la cuenta con la que entró</option>
                {candidatos.map((c) => (
                  <option key={c.wallet} value={c.wallet}>
                    {c.nombre} · {corta(c.wallet)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost py-1.5 text-xs"
                disabled={!cuenta || cargando}
                onClick={() => simularVinculo(false)}
              >
                {cargando ? "…" : "Ver qué se mueve"}
              </button>
            </div>
          )}
          {sellada && cuenta ? (
            <div className="space-y-2">
              <p className="text-xs text-faint">
                Puedes vincularla sin tocar lo ya cerrado: eso se queda como está en la fila del equipo, unido a esta
                cuenta, y todo lo demás pasa a la cuenta. Nada se pierde.
              </p>
              <button
                type="button"
                className="btn btn-ghost py-1.5 text-xs"
                disabled={cargando}
                onClick={() => simularVinculo(true)}
              >
                {cargando ? "…" : "Ver qué se mueve sin tocar lo cerrado"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {pendiente ? (
        <div className="mt-4 space-y-3 border-t border-line/60 pt-4">
          <p className="text-sm text-white">{pregunta}</p>
          {destino ? (
            <p className="text-xs text-muted">
              {"Cuenta de destino: "}
              {destino.nombre ? `${destino.nombre} · ` : null}
              <span className="break-all font-mono text-white">{destino.cuenta}</span>
            </p>
          ) : null}
          {pendiente.tipo === "vincular" && pendiente.descartadas > 0 ? (
            <p className="text-xs text-faint">
              {pendiente.descartadas} registros repetidos se quedan como ya están en la cuenta (por ejemplo, un
              check-in del mismo día).
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary py-1.5 text-xs" disabled={cargando} onClick={confirmar}>
              {cargando ? "…" : pendiente.tipo === "vincular" ? "Vincular" : "Confirmar"}
            </button>
            <button
              type="button"
              className="btn btn-ghost py-1.5 text-xs"
              disabled={cargando}
              onClick={() => {
                setPendiente(null);
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </li>
  );
}
