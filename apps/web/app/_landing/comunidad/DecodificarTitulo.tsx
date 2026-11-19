"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../useReducedMotion";

/** Glifos de la "decodificación" (los del prototipo). */
const GLIFOS = "01<>/#_$%{}[]=+*";
/** Letras que se ven revueltas a la vez. */
const VENTANA = 3;
/** Duración total del barrido: corto, para no retrasar la lectura (revisión a11y §4.6). */
const DURACION_MS = 900;
const ESPERA_MS = 250;

/**
 * ¿La capa calza con el H1? Mismo alto (mismo número de líneas) y, en cada línea, la
 * última letra en el mismo sitio (±2px). Lo comprueba con los nodos de texto reales.
 */
function calza(capa: HTMLElement, titulo: HTMLElement): boolean {
  if (Math.abs(capa.offsetHeight - titulo.offsetHeight) > 2) return false;
  const reales = Array.from(titulo.childNodes).filter(
    (n): n is Text => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
  );
  const letras = Array.from(capa.querySelectorAll<HTMLElement>("[data-c]"));
  let fin = 0;
  for (const nodo of reales) {
    // El espacio antes del <br> puede venir pegado a la línea en el mismo nodo.
    const largo = (nodo.textContent ?? "").trimEnd().length;
    fin += largo;
    const ultima = letras[fin - 1];
    if (!ultima || largo === 0) return false;
    const r = document.createRange();
    r.setStart(nodo, largo - 1);
    r.setEnd(nodo, largo);
    const a = r.getBoundingClientRect();
    const b = ultima.getBoundingClientRect();
    if (Math.abs(a.right - b.right) > 2 || Math.abs(a.top - b.top) > 2) return false;
  }
  return reales.length > 0 && fin === letras.length;
}

/**
 * Efecto de consola sobre el H1 de /comunidad, como CAPA aparte (revisión a11y §4.6 y
 * SEO §6.2). El H1 real lo pinta el servidor, visible y completo, y nunca se toca: ni
 * texto transparente ni aria-label. Esta capa no existe en el HTML del servidor; se monta
 * después de hidratar, solo si se permite movimiento y la pestaña está a la vista, y se
 * coloca encima del H1 con su misma tipografía. Una ventana de tres letras la recorre una
 * sola vez (menos de un segundo): cada letra de la ventana tapa la real con el fondo del
 * hero y muestra un glifo verde. Al terminar, la capa desaparece. Es `aria-hidden` y va
 * como hermana del H1 (no dentro), para que su texto nunca se sume al del titular.
 */
export default function DecodificarTitulo({
  lineas,
  className,
}: {
  /** Las mismas líneas que el H1, en el mismo orden. */
  lineas: readonly string[];
  /** Clases de la capa: la tipografía del H1 más la de la capa. */
  className: string;
}) {
  const reducir = useReducedMotion();
  const [activa, setActiva] = useState(false);
  const yaCorrio = useRef(false);
  const capa = useRef<HTMLDivElement>(null);

  // Una sola vez por visita, y nunca con menos movimiento ni con la pestaña oculta.
  useEffect(() => {
    if (reducir || yaCorrio.current || document.visibilityState !== "visible") return;
    yaCorrio.current = true;
    setActiva(true);
  }, [reducir]);

  useEffect(() => {
    if (!activa) return;
    const el = capa.current;
    if (!el) return;
    // La capa debe calzar con el H1 (su hermano anterior): mismo alto (mismas líneas) y,
    // letra a letra, la última en el mismo sitio. Si no (otro corte de línea, otra forma
    // del texto), no hay efecto: mejor nada que un titular movido.
    const titulo = el.previousElementSibling;
    if (!(titulo instanceof HTMLElement) || !calza(el, titulo)) {
      setActiva(false);
      return;
    }
    const letras = Array.from(el.querySelectorAll<HTMLElement>("[data-c]"));
    const paso = Math.max(18, Math.round(DURACION_MS / Math.max(1, letras.length)));
    let k = 0;
    let t = 0;
    const terminar = () => {
      window.clearTimeout(t);
      setActiva(false);
    };
    const avanzar = () => {
      letras.forEach((c, i) => {
        if (i >= k && i < k + VENTANA && c.textContent !== " ") {
          c.dataset.g = GLIFOS[(i * 7 + k * 5) % GLIFOS.length];
        } else {
          delete c.dataset.g;
        }
      });
      k += 1;
      if (k > letras.length) {
        terminar();
        return;
      }
      t = window.setTimeout(avanzar, paso);
    };
    // Si a mitad de camino se pide menos movimiento o se oculta la pestaña, se corta.
    const menos = window.matchMedia("(prefers-reduced-motion: reduce)");
    const alCambiar = () => {
      if (menos.matches || document.visibilityState !== "visible") terminar();
    };
    menos.addEventListener?.("change", alCambiar);
    document.addEventListener("visibilitychange", alCambiar);
    t = window.setTimeout(avanzar, ESPERA_MS);
    return () => {
      window.clearTimeout(t);
      menos.removeEventListener?.("change", alCambiar);
      document.removeEventListener("visibilitychange", alCambiar);
    };
  }, [activa]);

  if (!activa) return null;
  return (
    <div ref={capa} aria-hidden="true" className={className}>
      {lineas.map((linea, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <>
              {" "}
              <br />
            </>
          ) : null}
          {Array.from(linea).map((letra, j) => (
            <span key={j} data-c="">
              {letra}
            </span>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
