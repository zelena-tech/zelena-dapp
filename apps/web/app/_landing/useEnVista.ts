"use client";
import { useEffect, useState, type RefObject } from "react";

/**
 * ¿El elemento está (casi) en pantalla y la pestaña visible? Para pausar los bucles que
 * no se ven (la órbita con requestAnimationFrame, el flujo de pagos, la ventana de
 * código): fuera de pantalla o con la pestaña oculta no se gasta CPU.
 *
 * `false` en el servidor y hasta que el observador responde: una isla arranca quieta.
 * Sin IntersectionObserver devuelve `true` con la pestaña visible (degrada a "siempre").
 */
export function useEnVista(ref: RefObject<Element>, margen = "100px"): boolean {
  const [enPantalla, setEnPantalla] = useState(false);
  const [pestanaVisible, setPestanaVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setEnPantalla(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setEnPantalla(!!e?.isIntersecting), { rootMargin: margen });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margen]);

  useEffect(() => {
    const actualizar = () => setPestanaVisible(document.visibilityState === "visible");
    actualizar();
    document.addEventListener("visibilitychange", actualizar);
    return () => document.removeEventListener("visibilitychange", actualizar);
  }, []);

  return enPantalla && pestanaVisible;
}
