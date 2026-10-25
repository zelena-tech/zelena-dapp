import Link from "next/link";
import s from "./landing.module.css";
import { IconoFlechaDiagonal } from "./Iconos";

// Botones de la landing: dicen su nombre llano ("Book a demo"). Los corchetes de la voz
// de comando del diseño se quitaron a pedido del founder (2026-10-25): no se veían bien en
// el botón. Siempre son enlaces reales.

interface PropsCta {
  href: string;
  /** Lo que dice el botón: "Book a demo". */
  nombre: string;
  /** Idioma de la página de destino si no es inglés (p. ej. "es" para el formulario). */
  hrefLang?: string;
  className?: string;
}

/** Píldora de tinta con el nombre y el círculo lima con la flecha. */
export function PrimaryCta({ href, nombre, hrefLang, className }: PropsCta) {
  return (
    <Link href={href} hrefLang={hrefLang} className={className ? `${s.ctaPrimario} ${className}` : s.ctaPrimario}>
      <span>{nombre}</span>
      <span className={s.ctaFlecha} aria-hidden="true">
        <IconoFlechaDiagonal tamano={16} />
      </span>
    </Link>
  );
}

/** Píldora con contorno. `sobreOscuro` la invierte para bloques de tinta. */
export function SecondaryCta({
  href,
  nombre,
  hrefLang,
  sobreOscuro = false,
  className,
}: PropsCta & { sobreOscuro?: boolean }) {
  const clases = [s.ctaSecundario, sobreOscuro ? s.ctaSecundarioOscuro : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <Link href={href} hrefLang={hrefLang} className={clases}>
      {nombre}
    </Link>
  );
}
