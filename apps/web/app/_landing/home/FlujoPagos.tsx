"use client";
import { useEffect, useId, useRef, useState } from "react";
import s from "../landing.module.css";
import f from "./pagos.module.css";
import { useEnVista } from "../useEnVista";
import { useReducedMotion } from "../useReducedMotion";
import type { ClaveMoneda, TextosFlujoPagos } from "../copy-home";

/** Cada cuánto se enciende el siguiente nodo, como en el diseño. */
const PASO_MS = 1300;

type Estado = "espera" | "corriendo" | "pausado" | "terminado";

/**
 * El flujo de pagos (isla de cliente): las monedas como grupo de radios nativo, los cuatro
 * nodos que se encienden uno tras otro y la barra de avance.
 *
 * El servidor pinta el estado FINAL (los cuatro nodos encendidos y la barra llena): es lo
 * que ve quien no tiene JS o pidió menos movimiento. Si el movimiento está permitido, la
 * primera vez que el flujo entra en pantalla arranca desde cero y se enciende un nodo cada
 * 1,3 s, una sola vez; luego queda quieto con "replay". Fuera de pantalla o con la pestaña
 * oculta se detiene, y el botón permite pausarlo (dura algo más de 5 s).
 *
 * La moneda solo cambia el valor aproximado en moneda local del último nodo; el anuncio
 * para lectores de pantalla depende solo de la moneda, no del avance.
 */
export default function FlujoPagos({ textos }: { textos: TextosFlujoPagos }) {
  const raiz = useRef<HTMLDivElement>(null);
  const reducir = useReducedMotion();
  const enVista = useEnVista(raiz);
  const nombreGrupo = useId();
  const total = textos.nodos.length;

  const [moneda, setMoneda] = useState<ClaveMoneda>(textos.monedas[0]?.clave ?? "COP");
  const [paso, setPaso] = useState(total);
  const [estado, setEstado] = useState<Estado>("espera");

  // Arranque: la primera vez que se ve, desde cero. Con menos movimiento, estado final.
  useEffect(() => {
    if (reducir) {
      setPaso(total);
      setEstado((e) => (e === "corriendo" || e === "pausado" ? "terminado" : e));
      return;
    }
    if (enVista && estado === "espera") {
      setPaso(0);
      setEstado("corriendo");
    }
  }, [reducir, enVista, estado, total]);

  // Avance: un nodo cada PASO_MS mientras corre y se ve.
  useEffect(() => {
    if (reducir || estado !== "corriendo" || !enVista) return;
    if (paso >= total) {
      setEstado("terminado");
      return;
    }
    const t = window.setTimeout(() => setPaso((p) => Math.min(total, p + 1)), PASO_MS);
    return () => window.clearTimeout(t);
  }, [reducir, estado, enVista, paso, total]);

  const alControl = () => {
    if (estado === "corriendo") setEstado("pausado");
    else if (estado === "pausado") setEstado("corriendo");
    else {
      setPaso(0);
      setEstado("corriendo");
    }
  };
  const etiquetaControl =
    estado === "corriendo"
      ? textos.controles.pausar
      : estado === "pausado"
        ? textos.controles.seguir
        : textos.controles.repetir;

  const equivalente = textos.monedas.find((m) => m.clave === moneda)?.equivalente ?? "";
  const avance = total > 0 ? Math.round((Math.min(paso, total) / total) * 100) : 100;

  return (
    <div ref={raiz} className={f.flujo}>
      <fieldset className={f.monedas}>
        <legend className={s.srOnly}>{textos.leyendaMoneda}</legend>
        {textos.monedas.map((m) => (
          <label key={m.clave} className={f.moneda}>
            <input
              type="radio"
              name={nombreGrupo}
              value={m.clave}
              checked={moneda === m.clave}
              onChange={() => setMoneda(m.clave)}
              className={f.monedaInput}
            />
            <span className={f.monedaPildora}>{m.clave}</span>
          </label>
        ))}
      </fieldset>
      <p className={s.srOnly} aria-live="polite">
        {`${textos.anuncio} ${equivalente.replace(/^≈\s*/, "")}.`}
      </p>

      <ol className={f.nodos}>
        {textos.nodos.map((n, i) => {
          const encendido = i < paso;
          const final = encendido && i === total - 1;
          return (
            <li
              key={n.n}
              className={f.nodo}
              data-encendido={encendido ? "" : undefined}
              data-final={final ? "" : undefined}
            >
              <div className={f.nodoCabeza} aria-hidden="true">
                <span>{n.n}</span>
                <span>{n.tiempo}</span>
              </div>
              <p className={f.nodoTitulo}>
                {n.titulo}
                {n.enPruebas ? <span className={f.etiquetaPruebas}>{textos.etiquetaPruebas}</span> : null}
              </p>
              <p className={`${s.display} ${f.nodoValor}`}>{n.valor}</p>
              {i === total - 1 ? (
                <p className={f.nodoEquivalente}>
                  {equivalente} <span className={f.aproximado}>({textos.aproximado})</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className={f.avance}>
        <div className={f.barra} aria-hidden="true">
          <div className={f.barraRelleno} style={{ width: `${avance}%` }} />
        </div>
        {/* El control solo existe cuando hay movimiento (nunca en el HTML del servidor). */}
        {!reducir && estado !== "espera" ? (
          <button type="button" className={f.control} onClick={alControl}>
            {etiquetaControl}
          </button>
        ) : null}
      </div>
    </div>
  );
}
