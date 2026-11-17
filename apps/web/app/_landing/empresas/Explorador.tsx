"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import s from "../landing.module.css";
import m from "../manifiesto/manifiesto.module.css";
import e from "./empresas.module.css";
import Chip, { type TonoChip } from "../Chip";
import { IconoCheck, IconoFlechaDerecha, IconoFlechaDiagonal } from "../Iconos";
import { Titular } from "./Comunes";
import { contactoCon } from "../copy-empresas";
import { FICHA, LINEAS, NECESIDADES, PORTAFOLIO, SITUACION, type Linea, type TipoLinea } from "../copy-portafolio";

/**
 * La parte interactiva del portafolio: el buscador por situación, la rejilla de líneas
 * con su filtro y la ficha de detalle. El contenido viene de copy-portafolio.ts; aquí
 * solo vive el estado de la interfaz. Sin JavaScript se ven igual las situaciones y las
 * siete tarjetas, con su nombre y su resumen.
 */

type Filtro = "Todo" | TipoLinea;

/** Color de cada tarjeta según lo que es: el producto en tinta, los servicios en gris, el programa en lima. */
const TARJETA: Record<TipoLinea, { clase: string; chip: TonoChip }> = {
  Producto: { clase: e.tarjetaTinta, chip: "lima" },
  Servicio: { clase: e.tarjetaPanel, chip: "blanco" },
  Programa: { clase: e.tarjetaLima, chip: "verde" },
};

function Icono({ trazos, tamano = 22 }: { trazos: string; tamano?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamano}
      height={tamano}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: trazos }}
    />
  );
}

export default function Explorador() {
  const [elegidas, setElegidas] = useState<ReadonlySet<number>>(new Set());
  const [filtro, setFiltro] = useState<Filtro>("Todo");
  const [abierta, setAbierta] = useState<number | null>(null);
  // Quién abrió la ficha: al cerrarla, el foco vuelve ahí.
  const origen = useRef<HTMLElement | null>(null);

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

  function abrir(id: string) {
    origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAbierta(LINEAS.findIndex((l) => l.id === id));
  }

  const cerrar = useCallback(() => {
    setAbierta(null);
    origen.current?.focus();
  }, []);
  const anterior = useCallback(() => setAbierta((a) => (a === null ? a : (a + LINEAS.length - 1) % LINEAS.length)), []);
  const siguiente = useCallback(() => setAbierta((a) => (a === null ? a : (a + 1) % LINEAS.length)), []);

  return (
    <>
      {/* ----- 01 · tu situación ----- */}
      <section
        id={SITUACION.ancla}
        className={`${m.grupo} ${e.bloque} ${e.bloquePrimero} ${s.ancla}`}
        aria-labelledby="situacion-titulo"
        data-reveal="seccion"
      >
        <Titular id="situacion-titulo" etiqueta={SITUACION.etiqueta} h2={SITUACION.h2} intro={SITUACION.intro} enBloque />
        <ul className={e.situaciones}>
          {NECESIDADES.map((n, i) => (
            <li key={n.texto}>
              <button type="button" className={e.situacion} aria-pressed={elegidas.has(i)} onClick={() => alternar(i)}>
                {n.texto}
              </button>
            </li>
          ))}
        </ul>
        <div className={e.resultado} aria-live="polite">
          {recomendadas.size === 0 ? (
            <p className={e.resultadoVacio}>{SITUACION.vacio}</p>
          ) : (
            <>
              <p className={m.etiqueta}>{SITUACION.recomendamos}</p>
              <ul className={e.recomendadas}>
                {[...recomendadas].map((id) => {
                  const l = LINEAS.find((x) => x.id === id);
                  if (!l) return null;
                  return (
                    <li key={id}>
                      <button type="button" className={e.recomendada} onClick={() => abrir(id)}>
                        <span>{l.nombre}</span>
                        <span className={e.recomendadaFlecha} aria-hidden="true">
                          <IconoFlechaDiagonal tamano={13} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>

      {/* ----- 02 · portafolio ----- */}
      <section id={PORTAFOLIO.ancla} className={`${s.seccion} ${s.ancla}`} aria-labelledby="portafolio-titulo">
        <div className={e.cabezaPortafolio}>
          <Titular id="portafolio-titulo" etiqueta={PORTAFOLIO.etiqueta} h2={PORTAFOLIO.h2} intro={PORTAFOLIO.intro} />
          <div className={e.filtros} role="group" aria-label={PORTAFOLIO.filtroAria} data-reveal="">
            {PORTAFOLIO.filtros.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={e.filtro}
                aria-pressed={filtro === f.valor}
                onClick={() => setFiltro(f.valor as Filtro)}
              >
                {f.nombre}
              </button>
            ))}
          </div>
        </div>

        <ul className={e.tarjetas} data-reveal="escalonado">
          {LINEAS.map((l) => {
            const atenuada = filtro !== "Todo" && l.tipo !== filtro;
            const estilo = TARJETA[l.tipo];
            return (
              <li key={l.id} className={atenuada ? `${e.tarjetaItem} ${e.atenuada}` : e.tarjetaItem}>
                <button
                  type="button"
                  className={`${e.tarjeta} ${estilo.clase} ${s.elevable}`}
                  onClick={() => abrir(l.id)}
                  aria-label={`${l.nombre}: ${PORTAFOLIO.verDetalle.toLowerCase()}`}
                >
                  <span className={e.tarjetaCabeza}>
                    <span className={e.tarjetaIcono}>
                      <Icono trazos={l.icono} />
                    </span>
                    <span className={e.tarjetaChips}>
                      {recomendadas.has(l.id) ? (
                        <Chip tono="tinta" tamano="sm" punto className={e.mayus}>
                          {PORTAFOLIO.recomendada}
                        </Chip>
                      ) : null}
                      <Chip tono={estilo.chip} tamano="sm" className={e.mayus}>
                        {l.tipo}
                      </Chip>
                    </span>
                  </span>
                  <span className={e.tarjetaNombre}>{l.nombre}</span>
                  <span className={e.tarjetaCorto}>{l.corto}</span>
                  <span className={e.tarjetaVer}>
                    {PORTAFOLIO.verDetalle}
                    <IconoFlechaDerecha tamano={14} trazo={2.5} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {abierta !== null ? (
        <Ficha linea={LINEAS[abierta]} onCerrar={cerrar} onAnterior={anterior} onSiguiente={siguiente} />
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
    const p: string[] = [FICHA.que, FICHA.incluye];
    if (linea.configuraciones) p.push(FICHA.configuraciones);
    p.push(FICHA.beneficiosYModalidad);
    return p;
  }, [linea]);
  const [pestana, setPestana] = useState(0);
  const [config, setConfig] = useState(0);
  const botonCerrar = useRef<HTMLButtonElement>(null);

  // Otra línea (Anterior / Siguiente): la ficha vuelve a su primera pestaña.
  useEffect(() => {
    setPestana(0);
    setConfig(0);
  }, [linea.id]);

  // Al abrir, el foco entra a la ficha.
  useEffect(() => {
    botonCerrar.current?.focus();
  }, []);

  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCerrar();
      if (ev.key === "ArrowRight") onSiguiente();
      if (ev.key === "ArrowLeft") onAnterior();
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
  const definiciones = (pares: ReadonlyArray<readonly [string, string]>) => (
    <dl className={e.definiciones}>
      {pares.map(([k, v]) => (
        <div key={k}>
          <dt className={m.etiqueta}>{k}</dt>
          <dd className={e.definicion}>{v}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div
      className={e.velo}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ficha-titulo"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onCerrar();
      }}
    >
      <div className={e.ficha}>
        <header className={e.fichaCabeza}>
          <span className={e.fichaIcono}>
            <Icono trazos={linea.icono} tamano={26} />
          </span>
          <div className={e.fichaTitulos}>
            <Chip tono="panel" tamano="sm" className={e.mayus}>
              {linea.tipo}
            </Chip>
            <h3 id="ficha-titulo" className={`${s.display} ${e.fichaTitulo}`}>
              {linea.nombre}
            </h3>
            <p className={e.fichaEntrada}>{linea.entrada}</p>
          </div>
          <button ref={botonCerrar} type="button" className={e.fichaCerrar} onClick={onCerrar} aria-label={FICHA.cerrar}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className={e.fichaPestanas} role="group" aria-label={FICHA.pestanasAria}>
          {pestanas.map((p, i) => (
            <button key={p} type="button" className={e.filtro} aria-pressed={pestana === i} onClick={() => setPestana(i)}>
              {p}
            </button>
          ))}
        </div>

        <div className={e.fichaCuerpo}>
          {actual === FICHA.que
            ? definiciones([
                [FICHA.que, linea.que],
                [FICHA.paraQuien, linea.para],
                [FICHA.resuelve, linea.resuelve],
              ])
            : null}

          {actual === FICHA.incluye ? (
            <>
              <ul className={e.incluye}>
                {linea.incluye.map((x) => (
                  <li key={x} className={e.incluyeItem}>
                    <span className={e.vinieta} aria-hidden="true">
                      <IconoCheck tamano={11} trazo={3.25} />
                    </span>
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
              {linea.extra ? (
                <div className={e.nota}>
                  <p className={m.etiqueta}>{linea.extra.etiqueta}</p>
                  <p className={e.definicion}>{linea.extra.texto}</p>
                </div>
              ) : null}
            </>
          ) : null}

          {actual === FICHA.configuraciones && linea.configuraciones ? (
            <>
              <p className={e.definicion}>{FICHA.configuracionesIntro}</p>
              <div className={e.configuraciones} role="group" aria-label={FICHA.configuraciones}>
                {linea.configuraciones.map((c, i) => (
                  <button key={c.nombre} type="button" className={e.situacion} aria-pressed={config === i} onClick={() => setConfig(i)}>
                    {c.nombre}
                  </button>
                ))}
              </div>
              <div className={e.nota} aria-live="polite">
                <p className={m.etiqueta}>{linea.configuraciones[config].para}</p>
                <p className={e.definicion}>{linea.configuraciones[config].alcance}</p>
              </div>
            </>
          ) : null}

          {actual === FICHA.beneficiosYModalidad
            ? definiciones([
                [FICHA.beneficios, linea.beneficios],
                [FICHA.modalidad, linea.modalidad],
                [FICHA.soporte, linea.soporte],
              ])
            : null}
        </div>

        <footer className={e.fichaPie}>
          <div className={e.fichaNav}>
            <button type="button" className={e.fichaPaso} onClick={onAnterior} aria-label={FICHA.anterior}>
              <span className={e.girada} aria-hidden="true">
                <IconoFlechaDerecha tamano={16} trazo={2.5} />
              </span>
            </button>
            <button type="button" className={e.fichaPaso} onClick={onSiguiente} aria-label={FICHA.siguiente}>
              <IconoFlechaDerecha tamano={16} trazo={2.5} />
            </button>
          </div>
          <div className={e.fichaAcciones}>
            {linea.enlace ? (
              <Link href={linea.enlace} className={e.fichaEnlace}>
                {FICHA.paginaCompleta}
              </Link>
            ) : null}
            <Link href={contactoCon(linea.interes)} className={s.ctaPrimario}>
              <span>{FICHA.quiero}</span>
              <span className={s.ctaFlecha} aria-hidden="true">
                <IconoFlechaDiagonal tamano={16} />
              </span>
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
