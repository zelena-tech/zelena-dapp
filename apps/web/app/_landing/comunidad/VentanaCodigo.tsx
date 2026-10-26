"use client";
import { useEffect, useRef } from "react";
import s from "../landing.module.css";
import c from "./comunidad.module.css";
import { IconoCheck } from "../Iconos";
import { useReducedMotion } from "../useReducedMotion";
import { useEnVista } from "../useEnVista";
import type { TonoCodigo } from "../copy-comunidad";

const TONO: Record<TonoCodigo, string> = { lima: c.tonoLima, claro: c.tonoClaro, gris: c.tonoGris };
const PUNTOS = ["var(--lima)", "var(--verde)", "#4a5550"];

/**
 * La ventana de código del cierre y el aviso de ejemplo (decorativos: `aria-hidden`; el
 * h2 y el párrafo de al lado ya lo dicen). El HTML del servidor sale en su estado final:
 * el código completo y el aviso visible. Si se permite movimiento, la primera vez que la
 * ventana entra en pantalla se borra y se teclea una sola vez (40–90 ms por letra) y el
 * aviso aparece al terminar. Fuera de pantalla o con la pestaña oculta, se pausa; si a
 * mitad se pide menos movimiento, salta al final. Escribe en el DOM por refs: nada de
 * estado de React por letra.
 */
export default function VentanaCodigo({
  archivo,
  lineas,
  aviso,
  muestra,
}: {
  archivo: string;
  lineas: ReadonlyArray<{ texto: string; tono: TonoCodigo }>;
  aviso: string;
  muestra: string;
}) {
  const ventana = useRef<HTMLDivElement>(null);
  const textos = useRef<Array<HTMLSpanElement | null>>([]);
  const cursores = useRef<Array<HTMLSpanElement | null>>([]);
  const avisoRef = useRef<HTMLDivElement>(null);
  const reducir = useReducedMotion();
  const enVista = useEnVista(ventana, "0px");
  /** Letras escritas; null = todavía no empezó (se ve el estado final del servidor). */
  const escritas = useRef<number | null>(null);
  const terminado = useRef(false);

  const total = lineas.reduce((n, l) => n + l.texto.length, 0);

  /** Pinta n letras repartidas por las líneas, con el cursor al final de lo escrito. */
  const pintar = useRef((n: number) => {
    let quedan = n;
    let cursorPuesto = false;
    lineas.forEach((l, i) => {
      const k = Math.max(0, Math.min(l.texto.length, quedan));
      quedan -= l.texto.length;
      const t = textos.current[i];
      if (t) t.textContent = l.texto.slice(0, k);
      const cur = cursores.current[i];
      const aqui = !cursorPuesto && k < l.texto.length;
      if (aqui) cursorPuesto = true;
      if (cur) cur.style.display = aqui ? "" : "none";
    });
    if (avisoRef.current) avisoRef.current.style.opacity = n >= total ? "1" : "0";
  });

  // Con menos movimiento a mitad de camino: todo al estado final.
  useEffect(() => {
    if (!reducir || escritas.current === null || terminado.current) return;
    terminado.current = true;
    escritas.current = total;
    pintar.current(total);
  }, [reducir, total]);

  useEffect(() => {
    if (reducir || !enVista || terminado.current) return;
    if (escritas.current === null) {
      escritas.current = 0;
      pintar.current(0);
    }
    let t = 0;
    const paso = () => {
      const n = (escritas.current ?? 0) + 1;
      escritas.current = n;
      pintar.current(n);
      if (n >= total) {
        terminado.current = true;
        return;
      }
      t = window.setTimeout(paso, 40 + Math.random() * 50);
    };
    t = window.setTimeout(paso, 400);
    return () => window.clearTimeout(t);
  }, [reducir, enVista, total]);

  return (
    <div className={c.cierreArte} aria-hidden="true">
      <div ref={ventana} className={`${c.codigo} ${s.flota}`}>
        <div className={c.codigoBarra}>
          {PUNTOS.map((color) => (
            <span key={color} className={c.codigoPunto} style={{ background: color }} />
          ))}
          <span className={c.codigoArchivo}>{archivo}</span>
        </div>
        <div className={c.codigoCuerpo}>
          {lineas.map((l, i) => (
            <div key={i} className={`${c.codigoLinea} ${TONO[l.tono]}`}>
              <span
                ref={(el) => {
                  textos.current[i] = el;
                }}
              >
                {l.texto}
              </span>
              <span
                ref={(el) => {
                  cursores.current[i] = el;
                }}
                className={c.cursor}
                style={{ display: "none" }}
              />
            </div>
          ))}
        </div>
      </div>
      <div ref={avisoRef} className={`${c.avisoCierre} ${s.flota}`}>
        <span className={c.avisoCheck}>
          <IconoCheck tamano={14} trazo={3} />
        </span>
        {aviso}
        <span className={c.muestra}>{muestra}</span>
      </div>
    </div>
  );
}
