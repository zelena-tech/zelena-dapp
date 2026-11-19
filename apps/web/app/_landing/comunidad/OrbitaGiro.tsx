"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "../useReducedMotion";
import { useEnVista } from "../useEnVista";

/** Velocidad angular del anillo (rad/s) y desfase inicial, para no arrancar con una tarjeta tapando al avatar. */
const VELOCIDAD = 0.16;
const DESFASE = Math.PI / 6;
/** El giro solo desde 640px; debajo, la escena quieta en dos columnas. */
const ANCHO_MINIMO = "(min-width: 640px)";

interface Medidas {
  ancho: number;
  alto: number;
  tarjetas: Array<[number, number]>;
}

/** ¿Hay sitio para el giro? false en el servidor y hasta montar. */
function useConSitio(): boolean {
  const [si, setSi] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(ANCHO_MINIMO);
    const actualizar = () => setSi(m.matches);
    actualizar();
    m.addEventListener?.("change", actualizar);
    return () => m.removeEventListener?.("change", actualizar);
  }, []);
  return si;
}

/**
 * El giro de la órbita (revisión a11y §4.7). El servidor pinta la escena quieta (avatar
 * al centro, tarjetas a los lados) y así se queda con menos movimiento o en móvil. Si se
 * permite movimiento y hay sitio, esta isla marca la escena con `data-orbita` (el CSS la
 * pasa a una elipse en 3D) y coloca las tarjetas en su posición inicial en el mismo paso;
 * el bucle de requestAnimationFrame solo corre con la escena a la vista y la pestaña
 * visible. Medidas cacheadas con ResizeObserver; por fotograma solo se escriben
 * `transform` y `opacity` (sin desenfoques), y `z-index` cuando una tarjeta cambia de lado.
 */
export default function OrbitaGiro({ className, children }: { className: string; children: ReactNode }) {
  const escena = useRef<HTMLDivElement>(null);
  const reducir = useReducedMotion();
  const conSitio = useConSitio();
  const enVista = useEnVista(escena);
  const activa = !reducir && conSitio;

  const medidas = useRef<Medidas>({ ancho: 0, alto: 0, tarjetas: [] });
  const transcurrido = useRef(0);

  /** Coloca las tarjetas para un instante del giro (en segundos). */
  const colocar = useRef((segundos: number) => {
    const el = escena.current;
    if (!el) return;
    const { ancho: W, alto: H, tarjetas: tamanos } = medidas.current;
    const tarjetas = el.querySelectorAll<HTMLElement>("[data-ring]");
    const N = tarjetas.length;
    const base = segundos * VELOCIDAD + DESFASE;
    tarjetas.forEach((t, i) => {
      const [w, h] = tamanos[i] ?? [0, 0];
      const th = base + (i * 2 * Math.PI) / N;
      const sn = Math.sin(th);
      const z = Math.cos(th);
      const d = (z + 1) / 2;
      const x = W / 2 + W * 0.42 * sn - w / 2;
      const y = H * 0.4 + H * 0.11 * z - h / 2;
      t.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotateY(${(sn * 52).toFixed(2)}deg) scale(${(0.7 + 0.36 * d).toFixed(3)})`;
      t.style.opacity = (0.45 + 0.55 * d).toFixed(2);
      const delante = z > -0.05 ? "1" : "0";
      if (t.dataset.delante !== delante) {
        t.dataset.delante = delante;
        t.style.zIndex = delante === "1" ? "6" : "1";
      }
    });
  });

  // Modo giro: marca la escena, mide y coloca en el mismo paso (sin un fotograma con las
  // tarjetas amontonadas). Al salir (menos movimiento, pantalla estrecha), vuelve a la
  // escena quieta y limpia los estilos en línea.
  useEffect(() => {
    const el = escena.current;
    if (!el || !activa) return;
    const medir = () => {
      const tarjetas = Array.from(el.querySelectorAll<HTMLElement>("[data-ring]"));
      medidas.current = {
        ancho: el.clientWidth,
        alto: el.clientHeight,
        tarjetas: tarjetas.map((t) => [t.offsetWidth, t.offsetHeight]),
      };
    };
    el.dataset.orbita = "";
    medir();
    colocar.current(transcurrido.current);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            medir();
            colocar.current(transcurrido.current);
          });
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      delete el.dataset.orbita;
      el.querySelectorAll<HTMLElement>("[data-ring]").forEach((t) => {
        t.style.transform = "";
        t.style.opacity = "";
        t.style.zIndex = "";
        delete t.dataset.delante;
      });
    };
  }, [activa]);

  // El bucle: solo con el giro activo, la escena a la vista y la pestaña visible.
  useEffect(() => {
    if (!activa || !enVista) return;
    let raf = 0;
    let anterior = 0;
    const fotograma = (ahora: number) => {
      // Un salto grande (pestaña que vuelve) no adelanta el giro de golpe.
      transcurrido.current += Math.min(50, anterior ? ahora - anterior : 0) / 1000;
      anterior = ahora;
      colocar.current(transcurrido.current);
      raf = requestAnimationFrame(fotograma);
    };
    raf = requestAnimationFrame(fotograma);
    return () => cancelAnimationFrame(raf);
  }, [activa, enVista]);

  return (
    <div ref={escena} className={className}>
      {children}
    </div>
  );
}
