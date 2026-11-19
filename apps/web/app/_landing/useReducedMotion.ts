"use client";
import { useEffect, useState } from "react";

/**
 * ¿La persona pidió menos movimiento? Para los bucles en JS de las islas (pagos, órbita,
 * ventana de código, efecto del titular).
 *
 * En el servidor y en el primer pintado devuelve `true`: la isla sale en su estado final y
 * quieto (el mismo HTML en servidor y cliente, sin desajuste al hidratar), y solo arranca
 * el movimiento cuando el navegador confirma que está permitido. Sigue los cambios de la
 * preferencia en vivo.
 */
export function useReducedMotion(): boolean {
  const [reducir, setReducir] = useState(true);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const actualizar = () => setReducir(m.matches);
    actualizar();
    m.addEventListener?.("change", actualizar);
    return () => m.removeEventListener?.("change", actualizar);
  }, []);
  return reducir;
}
