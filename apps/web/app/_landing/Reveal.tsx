"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Aparición progresiva al hacer scroll (revisión a11y §4.4). La monta LandingShell una
 * vez; las secciones solo marcan sus elementos con atributos, sin envolverlos:
 *
 *   data-reveal                el elemento sube 32px y aparece
 *   data-reveal="seccion"      un bloque de color: sube 40px y crece de .97 a 1
 *   data-reveal="titulo"       un titular: sube 28px (sin desenfoque)
 *   data-reveal="escalonado"   cada hijo directo sube 36px, uno tras otro (90 ms)
 *   data-reveal-delay="120"    retraso extra en ms (opcional)
 *   (también acepta "section", "heading" y "stagger")
 *
 * Reglas, para que nunca esconda contenido:
 *  - El HTML del servidor sale visible: el estado oculto lo pone este efecto, después de
 *    hidratar, y solo a lo que todavía está por debajo del borde de la pantalla. Lo que ya
 *    se ve al cargar (el hero, o lo que muestra un enlace con #ancla) no se toca.
 *  - Nada con `prefers-reduced-motion: reduce`, al imprimir, en una pestaña oculta ni sin
 *    IntersectionObserver o sin animaciones Web.
 *  - Al ocultar la pestaña, antes de imprimir o si se pide menos movimiento a mitad de
 *    camino, todo termina en su estado final.
 *  - Solo opacidad y `translate`/`scale` (propiedades sueltas que se suman al `transform`
 *    del elemento: una tarjeta rotada no salta al terminar). Sin desenfoques.
 * No anidar marcas: un hijo de un "escalonado" no lleva su propio data-reveal.
 */

const CURVA = "cubic-bezier(.2,.7,.2,1)";
const DURACION_MS = 750;
const PASO_ESCALONADO_MS = 90;
const INICIO_ESCALONADO_MS = 120;

const CUADROS: Record<"elemento" | "seccion" | "titulo" | "hijo", Keyframe[]> = {
  elemento: [
    { opacity: 0, translate: "0 32px" },
    { opacity: 1, translate: "0 0" },
  ],
  seccion: [
    { opacity: 0, translate: "0 40px", scale: "0.97" },
    { opacity: 1, translate: "0 0", scale: "1" },
  ],
  titulo: [
    { opacity: 0, translate: "0 28px" },
    { opacity: 1, translate: "0 0" },
  ],
  hijo: [
    { opacity: 0, translate: "0 36px" },
    { opacity: 1, translate: "0 0" },
  ],
};

function modoDe(valor: string | undefined): "elemento" | "seccion" | "titulo" | "escalonado" {
  switch (valor) {
    case "seccion":
    case "section":
      return "seccion";
    case "titulo":
    case "heading":
      return "titulo";
    case "escalonado":
    case "stagger":
      return "escalonado";
    default:
      return "elemento";
  }
}

export default function Reveal() {
  // Una pasada por ruta: al ir de / a /comunidad la página nueva trae sus propias marcas.
  const ruta = usePathname();

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || typeof Element.prototype.animate !== "function") return;
    const menosMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (menosMovimiento.matches || window.matchMedia("print").matches || document.visibilityState !== "visible") return;

    const pendientes = new Map<Element, Animation[]>();
    const io = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          pendientes.get(e.target)?.forEach((a) => a.play());
          pendientes.delete(e.target);
          io.unobserve(e.target);
        }
      },
      // Umbral 0: un bloque más alto que la pantalla también se dispara.
      { threshold: 0, rootMargin: "0px 0px -8% 0px" }
    );

    const crear = (el: Element, cuadros: Keyframe[], retraso: number): Animation => {
      const a = el.animate(cuadros, { duration: DURACION_MS, delay: retraso, easing: CURVA, fill: "backwards" });
      a.pause();
      return a;
    };

    const alto = window.innerHeight;
    document.querySelectorAll<HTMLElement>("[data-landing] [data-reveal]").forEach((el) => {
      // Lo que ya está en pantalla (o más arriba) al montar, nunca se esconde.
      if (el.getBoundingClientRect().top < alto) return;
      const modo = modoDe(el.dataset.reveal);
      const retraso = Math.max(0, Number(el.dataset.revealDelay ?? 0) || 0);
      const animaciones =
        modo === "escalonado"
          ? Array.from(el.children).map((h, i) => crear(h, CUADROS.hijo, retraso + INICIO_ESCALONADO_MS + i * PASO_ESCALONADO_MS))
          : [crear(el, CUADROS[modo], modo === "titulo" ? retraso + 80 : retraso)];
      if (animaciones.length === 0) return;
      pendientes.set(el, animaciones);
      io.observe(el);
    });

    const terminarTodo = () => {
      pendientes.forEach((animaciones) =>
        animaciones.forEach((a) => {
          try {
            a.finish();
          } catch {
            a.cancel();
          }
        })
      );
      pendientes.clear();
      io.disconnect();
    };
    const alCambiarVisibilidad = () => {
      if (document.visibilityState !== "visible") terminarTodo();
    };
    const alCambiarMovimiento = () => {
      if (menosMovimiento.matches) terminarTodo();
    };
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    window.addEventListener("beforeprint", terminarTodo);
    menosMovimiento.addEventListener?.("change", alCambiarMovimiento);
    return () => {
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
      window.removeEventListener("beforeprint", terminarTodo);
      menosMovimiento.removeEventListener?.("change", alCambiarMovimiento);
      terminarTodo();
    };
  }, [ruta]);

  return null;
}
