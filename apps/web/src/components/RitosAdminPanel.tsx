"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CandidatoRito, FechaRitoPreparable, PanelRitosAdmin, SesionRitoAdmin } from "@/lib/ritos-labels";

/**
 * Ritos en /admin (WP31-D corte 2, copy de §8.5): preparar una fecha de la cadencia
 * (con lugar y enlace), asignar anfitrión y relator, abrir dentro de la ventana y
 * cerrar con resumen y acta opcionales. Los ritos abiertos cuya ventana ya pasó se
 * marcan "Pendiente de cerrar" (no hay cierre automático).
 *
 * De cada sesión se ve solo el CONTEO de asistentes: la lista nominal existe solo
 * dentro de la huella del cierre. La autorización real la hace `/api/ritos` contra
 * la base; esto solo pinta y pregunta.
 */

type Respuesta = { ok: true } | { ok: false; error: string };

async function postRitos(body: Record<string, unknown>): Promise<Respuesta> {
  try {
    const res = await fetch("/api/ritos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "No se pudo completar la acción." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Sin conexión. Revisa tu red e intenta de nuevo." };
  }
}

function walletCorta(w: string): string {
  return w.length > 12 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
}

function Aviso({ texto, tono }: { texto: string; tono: "error" | "ok" }) {
  if (!texto) return null;
  return (
    <p className={`text-xs ${tono === "error" ? "text-red-400" : "text-primary"}`} role={tono === "error" ? "alert" : "status"}>
      {texto}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Preparar
// ---------------------------------------------------------------------------

function PrepararRito({
  tipos,
  preparables,
  zona,
}: {
  tipos: PanelRitosAdmin["tipos"];
  preparables: FechaRitoPreparable[];
  zona: string;
}) {
  const router = useRouter();
  const primero = tipos.find((t) => preparables.some((p) => p.kind === t.kind))?.kind ?? tipos[0]?.kind ?? "demo";
  const [kind, setKind] = useState<SesionRitoAdmin["kind"]>(primero);
  const [fecha, setFecha] = useState("");
  const [lugar, setLugar] = useState("");
  const [enlace, setEnlace] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState("");

  const fechas = preparables.filter((p) => p.kind === kind);
  // Tras cambiar de rito o refrescar, la fecha elegida puede dejar de estar libre.
  const elegida = fechas.some((f) => f.scheduledFor === fecha) ? fecha : (fechas[0]?.scheduledFor ?? "");

  async function preparar() {
    if (!elegida) return;
    setCargando(true);
    setError("");
    setListo("");
    const r = await postRitos({
      action: "preparar",
      kind,
      scheduledFor: elegida,
      lugar: lugar.trim() || null,
      joinUrl: enlace.trim() || null,
    });
    setCargando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setListo("Rito preparado.");
    setLugar("");
    setEnlace("");
    setFecha("");
    router.refresh();
  }

  return (
    <form
      className="space-y-4 rounded-md border border-line/50 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        preparar();
      }}
    >
      <p className="text-sm font-semibold text-white">Preparar</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rito-tipo">
            Tipo
          </label>
          <select
            id="rito-tipo"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as SesionRitoAdmin["kind"])}
          >
            {tipos.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="rito-fecha">
            Fecha de la cadencia ({zona})
          </label>
          {fechas.length > 0 ? (
            <select id="rito-fecha" className="input" value={elegida} onChange={(e) => setFecha(e.target.value)}>
              {fechas.map((f) => (
                <option key={f.scheduledFor} value={f.scheduledFor}>
                  {f.etiqueta}
                </option>
              ))}
            </select>
          ) : (
            <p className="py-2 text-xs text-faint">No quedan fechas libres de este rito en los próximos 60 días.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="rito-lugar">
            Lugar (opcional, público)
          </label>
          <input
            id="rito-lugar"
            className="input"
            value={lugar}
            onChange={(e) => setLugar(e.target.value)}
            maxLength={120}
          />
        </div>
        <div>
          <label className="label" htmlFor="rito-enlace">
            Enlace para conectarse (opcional, solo con sesión)
          </label>
          <input
            id="rito-enlace"
            type="url"
            className="input"
            placeholder="https://"
            value={enlace}
            onChange={(e) => setEnlace(e.target.value)}
            maxLength={500}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className="btn btn-primary py-1.5 text-xs" disabled={cargando || !elegida}>
          {cargando ? "Preparando…" : "Preparar"}
        </button>
        <Aviso texto={error} tono="error" />
        <Aviso texto={listo} tono="ok" />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Una sesión: quién presenta y relata, abrir, cerrar
// ---------------------------------------------------------------------------

function SelectorPersona({
  id,
  etiqueta,
  valor,
  candidatos,
  onChange,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  candidatos: CandidatoRito[];
  onChange: (v: string) => void;
}) {
  const fuera = valor && !candidatos.some((c) => c.wallet === valor);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {etiqueta}
      </label>
      <select id={id} className="input" value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Sin asignar</option>
        {fuera ? <option value={valor}>Persona asignada (su cuenta ya no puede presentar)</option> : null}
        {candidatos.map((c) => (
          <option key={c.wallet} value={c.wallet}>
            {c.nombre} · {walletCorta(c.wallet)}
          </option>
        ))}
      </select>
    </div>
  );
}

function SesionRito({ s, candidatos, margen }: { s: SesionRitoAdmin; candidatos: CandidatoRito[]; margen: string }) {
  const router = useRouter();
  const [host, setHost] = useState(s.anfitrion ?? "");
  const [relator, setRelator] = useState(s.relator ?? "");
  const [resumen, setResumen] = useState("");
  const [acta, setActa] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const cambiaron = host !== (s.anfitrion ?? "") || relator !== (s.relator ?? "");

  async function enviar(body: Record<string, unknown>) {
    setCargando(true);
    setError("");
    const r = await postRitos(body);
    setCargando(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-md border border-line/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold text-white">{s.nombre}</span>
          <span className="ml-2 text-muted">{s.cuando}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s.pendienteDeCerrar ? <span className="tag border-amber-700/50 text-amber-300">Pendiente de cerrar</span> : null}
          <span className={`tag ${s.state === "Open" ? "tag-sas" : "border-line text-muted"}`}>{s.estado}</span>
        </div>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-faint">
        <span>{s.asistentes}</span>
        {s.lugar ? <span>{s.lugar}</span> : null}
        {s.conEnlace ? <span>con enlace para conectarse</span> : null}
        <Link href={`/comunidad/ritos/${s.id}`} className="text-primary hover:underline">
          Ver el rito (código de asistencia)
        </Link>
      </p>

      {s.state !== "Closed" ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <SelectorPersona id={`rito-${s.id}-anfitrion`} etiqueta="Anfitrión" valor={host} candidatos={candidatos} onChange={setHost} />
            <SelectorPersona id={`rito-${s.id}-relator`} etiqueta="Relator" valor={relator} candidatos={candidatos} onChange={setRelator} />
            <button
              type="button"
              className="btn btn-ghost py-1.5 text-xs"
              disabled={cargando || !cambiaron}
              onClick={() => enviar({ action: "asignar", sessionId: s.id, hostWallet: host || null, recorderWallet: relator || null })}
            >
              Guardar
            </button>
          </div>

          {s.state === "Planned" ? (
            s.ventanaPasada ? (
              <p className="text-xs text-faint">La ventana de este rito pasó sin abrirse: ya no se puede abrir.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  className="btn btn-primary py-1.5 text-xs"
                  disabled={cargando}
                  onClick={() => enviar({ action: "abrir", sessionId: s.id })}
                >
                  Abrir
                </button>
                <span className="text-xs text-faint">Se abre {margen} antes de empezar.</span>
              </div>
            )
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!window.confirm("¿Cerrar el rito? Ya no se registrará más asistencia.")) return;
                enviar({
                  action: "cerrar",
                  sessionId: s.id,
                  ...(resumen.trim() ? { summary: resumen.trim() } : {}),
                  ...(acta.trim() ? { notesUrl: acta.trim() } : {}),
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor={`rito-${s.id}-resumen`}>
                    Resumen (opcional, público)
                  </label>
                  <textarea
                    id={`rito-${s.id}-resumen`}
                    className="input min-h-16"
                    value={resumen}
                    onChange={(e) => setResumen(e.target.value)}
                    maxLength={1000}
                  />
                </div>
                <div>
                  <label className="label" htmlFor={`rito-${s.id}-acta`}>
                    Enlace al acta (opcional)
                  </label>
                  <input
                    id={`rito-${s.id}-acta`}
                    type="url"
                    className="input"
                    placeholder="https://"
                    value={acta}
                    onChange={(e) => setActa(e.target.value)}
                    maxLength={500}
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-ghost py-1.5 text-xs" disabled={cargando}>
                {cargando ? "Cerrando…" : "Cerrar"}
              </button>
            </form>
          )}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Aviso texto={error} tono="error" />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function RitosAdminPanel({ sesiones, preparables, candidatos, tipos, margen, zona }: PanelRitosAdmin) {
  const pendientes = sesiones.filter((s) => s.pendienteDeCerrar).length;
  return (
    <div className="card space-y-6 p-6">
      <p className="text-xs text-faint">
        La cadencia sale del genoma. Aquí se prepara una fecha concreta, se elige quién presenta y quién relata, y se
        abre y se cierra. Estar es lo normal y faltar no resta nada: de cada rito solo se ve cuántas personas se
        registraron.
      </p>

      <PrepararRito tipos={tipos} preparables={preparables} zona={zona} />

      {pendientes > 0 ? (
        <p className="text-sm text-amber-300">
          {pendientes === 1 ? "1 rito pendiente de cerrar." : `${pendientes} ritos pendientes de cerrar.`}
        </p>
      ) : null}

      {sesiones.length === 0 ? (
        <p className="text-sm text-faint">Aún no hay ritos preparados.</p>
      ) : (
        <div className="space-y-3">
          {sesiones.map((s) => (
            <SesionRito key={s.id} s={s} candidatos={candidatos} margen={margen} />
          ))}
        </div>
      )}
    </div>
  );
}
