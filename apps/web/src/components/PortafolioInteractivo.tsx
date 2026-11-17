"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LINEAS, NECESIDADES, PASOS_CICLO, type Linea, type TipoLinea } from "@/lib/portafolio";

/**
 * La parte interactiva del portafolio: el buscador por situación, la rejilla de
 * líneas con su ficha de detalle y el ciclo de trabajo. El contenido viene de
 * lib/portafolio.ts; aquí solo vive el estado de la interfaz.
 */

function Icono({ trazos, className = "h-6 w-6" }: { trazos: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: trazos }}
    />
  );
}

const COLOR_TIPO: Record<TipoLinea, string> = {
  Producto: "border-primary/50 bg-glow text-primary",
  Servicio: "border-line-strong text-muted",
  Programa: "border-amber-600/50 bg-amber-950/20 text-amber-300",
};

/* ───────────────────────── Buscador + rejilla ───────────────────────── */

export function BuscadorYPortafolio() {
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [filtro, setFiltro] = useState<"Todo" | TipoLinea>("Todo");
  const [abierta, setAbierta] = useState<number | null>(null);

  const recomendadas = useMemo(() => {
    const ids = new Set<string>();
    elegidas.forEach((i) => NECESIDADES[i].lineas.forEach((l) => ids.add(l)));
    return ids;
  }, [elegidas]);

  function alternar(i: number) {
    setElegidas((prev) => {
      const sig = new Set(prev);
      if (sig.has(i)) sig.delete(i);
      else sig.add(i);
      return sig;
    });
  }

  const abrir = (id: string) => setAbierta(LINEAS.findIndex((l) => l.id === id));

  return (
    <>
      {/* ----- 01 · tu situación ----- */}
      <section id="situacion" className="space-y-8">
        <div className="space-y-5">
          <p className="label">01 · Tu situación</p>
          <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]">
            ¿Qué necesitas <em className="font-normal italic text-primary">resolver?</em>
          </h2>
          <p className="max-w-xl text-base leading-7 text-muted">
            Elige una o varias situaciones que vive tu empresa hoy y te mostramos qué solución te sirve.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {NECESIDADES.map((n, i) => {
            const activa = elegidas.has(i);
            return (
              <button
                key={n.texto}
                type="button"
                aria-pressed={activa}
                onClick={() => alternar(i)}
                className={`min-h-[44px] border px-4 py-2 text-left text-sm transition-colors duration-150 ${
                  activa
                    ? "border-primary bg-glow text-primary"
                    : "border-line-strong text-muted hover:border-primary/60 hover:text-paper"
                }`}
              >
                {n.texto}
              </button>
            );
          })}
        </div>

        <div className="min-h-[76px] border border-dashed border-line-strong bg-surface-2 p-5" aria-live="polite">
          {recomendadas.size === 0 ? (
            <span className="text-sm text-faint">{"// Tus soluciones recomendadas aparecerán aquí"}</span>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-xs uppercase tracking-[0.14em] text-muted">Te recomendamos</span>
              {[...recomendadas].map((id) => {
                const l = LINEAS.find((x) => x.id === id)!;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => abrir(id)}
                    className="inline-flex min-h-[44px] items-center gap-2 border border-primary bg-glow px-4 py-2 text-sm text-paper transition-colors hover:bg-primary hover:text-black"
                  >
                    <small className="text-[10px] uppercase tracking-[0.12em] opacity-70">{l.tipo}</small>
                    {l.nombre} <span aria-hidden>↗</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ----- 02 · portafolio ----- */}
      <section id="portafolio" className="space-y-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-5">
            <p className="label">02 · Portafolio</p>
            <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]">
              Un producto, cinco servicios y{" "}
              <em className="font-normal italic text-primary">un programa de incentivos.</em>
            </h2>
            <p className="max-w-xl text-base leading-7 text-muted">
              Contrata solo lo que necesitas. Cada línea funciona por sí sola y todas se conectan entre sí.
            </p>
          </div>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar el portafolio">
            {(["Todo", "Producto", "Servicio", "Programa"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filtro === f}
                onClick={() => setFiltro(f)}
                className={`min-h-[44px] px-3 text-sm transition-colors ${
                  filtro === f ? "bg-glow text-primary" : "text-muted hover:text-paper"
                }`}
              >
                {f === "Servicio" ? "Servicios" : f === "Programa" ? "Incentivos" : f}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {LINEAS.map((l) => {
            const atenuada = filtro !== "Todo" && l.tipo !== filtro;
            const recomendada = recomendadas.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => abrir(l.id)}
                aria-label={`${l.nombre}: ver detalle`}
                className={`group flex flex-col items-start gap-4 bg-surface-2 p-6 text-left transition-all duration-150 hover:bg-surface ${
                  atenuada ? "opacity-30" : ""
                } ${recomendada ? "shadow-[inset_0_0_0_1px_#3CE109]" : ""}`}
              >
                <span className={`tag ${COLOR_TIPO[l.tipo]}`}>{l.tipo}</span>
                <span className="text-primary">
                  <Icono trazos={l.icono} className="h-7 w-7" />
                </span>
                <h3 className="text-xl normal-case leading-tight text-paper">{l.nombre}</h3>
                <p className="flex-1 text-sm leading-6 text-muted">{l.corto}</p>
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-primary">
                  Ver detalle{" "}
                  <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {abierta !== null ? (
        <Ficha
          linea={LINEAS[abierta]}
          onCerrar={() => setAbierta(null)}
          onAnterior={() => setAbierta((abierta + LINEAS.length - 1) % LINEAS.length)}
          onSiguiente={() => setAbierta((abierta + 1) % LINEAS.length)}
        />
      ) : null}
    </>
  );
}

/* ───────────────────────── Ficha de detalle ───────────────────────── */

function Ficha({
  linea,
  onCerrar,
  onAnterior,
  onSiguiente,
}: {
  linea: Linea;
  onCerrar: () => void;
  onAnterior: () => void;
  onSiguiente: () => void;
}) {
  const pestanas = useMemo(() => {
    const p = ["Qué es", "Qué incluye"];
    if (linea.configuraciones) p.push("Configuraciones");
    p.push("Beneficios y modalidad");
    return p;
  }, [linea]);
  const [pestana, setPestana] = useState(0);
  const [config, setConfig] = useState(0);

  useEffect(() => {
    setPestana(0);
    setConfig(0);
  }, [linea.id]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
      if (e.key === "ArrowRight") onSiguiente();
      if (e.key === "ArrowLeft") onAnterior();
    };
    document.addEventListener("keydown", tecla);
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tecla);
      document.body.style.overflow = previo;
    };
  }, [onCerrar, onSiguiente, onAnterior]);

  const actual = pestanas[pestana];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={linea.nombre}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col border border-line-strong bg-bg shadow-glow">
        <header className="flex items-start justify-between gap-4 border-b border-line p-6">
          <div className="flex items-start gap-4">
            <span className="mt-1 text-primary">
              <Icono trazos={linea.icono} className="h-8 w-8" />
            </span>
            <div>
              <span className={`tag ${COLOR_TIPO[linea.tipo]}`}>{linea.tipo}</span>
              <h3 className="mt-2 font-serif text-2xl font-normal normal-case leading-tight tracking-normal text-paper sm:text-3xl">
                {linea.nombre}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted">{linea.entrada}</p>
            </div>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="btn btn-ghost shrink-0 px-3 py-1.5">
            ✕
          </button>
        </header>

        <div className="flex gap-1 overflow-x-auto border-b border-line px-4" role="tablist">
          {pestanas.map((p, i) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={pestana === i}
              onClick={() => setPestana(i)}
              className={`min-h-[44px] shrink-0 border-b-2 px-3 text-sm transition-colors ${
                pestana === i ? "border-primary text-primary" : "border-transparent text-muted hover:text-paper"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {actual === "Qué es" ? (
            <dl className="space-y-5">
              {[
                ["Qué es", linea.que],
                ["Para quién", linea.para],
                ["Qué resuelve", linea.resuelve],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="label">{k}</dt>
                  <dd className="text-sm leading-7 text-paper">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {actual === "Qué incluye" ? (
            <div className="space-y-5">
              <ul className="space-y-2.5">
                {linea.incluye.map((x) => (
                  <li key={x} className="flex gap-3 text-sm leading-6 text-paper">
                    <span className="mt-0.5 text-primary" aria-hidden>✓</span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
              {linea.extra ? (
                <div className="border-l-2 border-primary bg-glow p-4">
                  <span className="label">{linea.extra.etiqueta}</span>
                  <p className="text-sm leading-6 text-paper">{linea.extra.texto}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {actual === "Configuraciones" && linea.configuraciones ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">Puntos de partida según el tipo de empresa. Elige uno:</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Configuraciones">
                {linea.configuraciones.map((c, i) => (
                  <button
                    key={c.nombre}
                    type="button"
                    aria-pressed={config === i}
                    onClick={() => setConfig(i)}
                    className={`min-h-[44px] border px-4 text-sm transition-colors ${
                      config === i ? "border-primary bg-glow text-primary" : "border-line-strong text-muted hover:text-paper"
                    }`}
                  >
                    {c.nombre}
                  </button>
                ))}
              </div>
              <div className="card p-5">
                <span className="label">{linea.configuraciones[config].para}</span>
                <p className="text-sm leading-7 text-paper">{linea.configuraciones[config].alcance}</p>
              </div>
            </div>
          ) : null}

          {actual === "Beneficios y modalidad" ? (
            <dl className="space-y-5">
              {[
                ["Beneficios", linea.beneficios],
                ["Modalidad", linea.modalidad],
                ["Soporte", linea.soporte],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="label">{k}</dt>
                  <dd className="text-sm leading-7 text-paper">{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
          <div className="flex gap-2">
            <button type="button" onClick={onAnterior} className="btn btn-ghost px-3 py-1.5 normal-case tracking-normal">
              ← Anterior
            </button>
            <button type="button" onClick={onSiguiente} className="btn btn-ghost px-3 py-1.5 normal-case tracking-normal">
              Siguiente →
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {linea.enlace ? (
              <Link href={linea.enlace} className="btn btn-ghost normal-case tracking-normal">
                Ver la página completa
              </Link>
            ) : null}
            <Link href={`/empresas/contacto?interes=${linea.interes}`} className="btn btn-primary normal-case tracking-normal">
              Quiero esta solución
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ───────────────────────── Ciclo de trabajo ───────────────────────── */

export function CicloDeTrabajo() {
  const [paso, setPaso] = useState(0);
  return (
    <div className="space-y-6">
      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {PASOS_CICLO.map((p, i) => (
          <button
            key={p.n}
            type="button"
            aria-pressed={paso === i}
            onClick={() => setPaso(i)}
            className={`flex flex-col gap-3 p-6 text-left transition-colors duration-150 ${
              paso === i ? "bg-glow" : "bg-surface-2 hover:bg-surface"
            }`}
          >
            <span className={`text-sm ${paso === i ? "text-primary" : "text-faint"}`}>{p.n}</span>
            <h3 className="text-lg normal-case text-paper">{p.titulo}</h3>
            <p className="text-sm leading-6 text-muted">{p.corto}</p>
          </button>
        ))}
      </div>
      <div className="h-1 w-full bg-line" aria-hidden>
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${(paso + 1) * 25}%` }} />
      </div>
      <p className="max-w-2xl text-base leading-7 text-paper" aria-live="polite">
        {PASOS_CICLO[paso].detalle}
      </p>
    </div>
  );
}
