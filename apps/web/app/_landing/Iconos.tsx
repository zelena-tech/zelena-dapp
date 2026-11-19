// Íconos de la landing como SVG en línea (trazos de 24×24, al estilo lucide). Sustituyen a
// los glifos del diseño (↗ → ↑ ✓ ●): esos se leen en voz alta y no están en Archivo, así
// que cada sistema los pinta con otra fuente (▶ puede salir como emoji en iOS). Todos son
// decorativos (aria-hidden): el texto de al lado ya dice lo que significan.

interface PropsIcono {
  /** Lado en px (por defecto 16). */
  tamano?: number;
  className?: string;
  /** Grosor del trazo (por defecto 2.25). */
  trazo?: number;
}

function Svg({ tamano = 16, className, trazo = 2.25, children }: PropsIcono & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={tamano}
      height={tamano}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={trazo}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

/** ↗ (el de los CTA primarios). */
export function IconoFlechaDiagonal(p: PropsIcono) {
  return (
    <Svg {...p}>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </Svg>
  );
}

/** → */
export function IconoFlechaDerecha(p: PropsIcono) {
  return (
    <Svg {...p}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Svg>
  );
}

/** ↑ */
export function IconoFlechaArriba(p: PropsIcono) {
  return (
    <Svg {...p}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </Svg>
  );
}

/** ✓ */
export function IconoCheck(p: PropsIcono) {
  return (
    <Svg {...p}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

/** ● (punto de estado). Relleno, del color del texto. */
export function IconoPunto({ tamano = 8, className }: { tamano?: number; className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width={tamano} height={tamano} viewBox="0 0 8 8" className={className}>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}
