import type { ReactNode } from "react";
import s from "./landing.module.css";

const TONOS = {
  panel: s.chipPanel, // fondo #EEF1EC, texto tinta (chip del hero de la home)
  blanco: s.chipBlanco, // fondo blanco, texto tinta (sobre paneles)
  tinta: s.chipTinta, // fondo tinta, texto lima ("LIVE NOW")
  verde: s.chipVerde, // fondo blanco, texto verde oscuro (sobre lima o verde)
  lima: s.chipLima, // fondo lima, texto tinta
} as const;

export type TonoChip = keyof typeof TONOS;

/**
 * Píldora mono del diseño ("● REAL WORK, REAL REWARDS", "● LIVE NOW"). El punto es un
 * elemento decorativo, no el glifo "●": así no se lee en voz alta.
 */
export default function Chip({
  children,
  tono = "panel",
  tamano = "md",
  punto = false,
  className,
}: {
  children: ReactNode;
  tono?: TonoChip;
  /** md: 12px (chips de hero); sm: 11px (estados dentro de tarjetas). */
  tamano?: "md" | "sm";
  punto?: boolean;
  className?: string;
}) {
  const clases = [s.chip, tamano === "sm" ? s.chipSm : "", TONOS[tono], className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={clases}>
      {punto ? <span className={s.chipPunto} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
