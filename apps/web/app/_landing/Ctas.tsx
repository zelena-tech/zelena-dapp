import Link from "next/link";
import s from "./landing.module.css";
import { IconoFlechaDiagonal } from "./Iconos";

// Botones de la landing con la voz de comando del diseño ("[[ book_a_demo ]]"). La
// etiqueta de comando es lo que se ve y queda oculta a los lectores de pantalla, que
// leen el nombre llano ("Book a demo"): así se cumple que el nombre accesible contenga
// las palabras visibles, sin leer corchetes ni guiones bajos. Siempre son enlaces reales.

interface PropsCta {
  href: string;
  /** Etiqueta visible en snake_case, sin corchetes: "book_a_demo". */
  comando: string;
  /** Nombre llano para lectores de pantalla: "Book a demo". */
  nombre: string;
  /** Idioma de la página de destino si no es inglés (p. ej. "es" para el formulario). */
  hrefLang?: string;
  className?: string;
}

/** Píldora de tinta: "[[ comando ]]" y el círculo lima con la flecha. */
export function PrimaryCta({ href, comando, nombre, hrefLang, className }: PropsCta) {
  return (
    <Link href={href} hrefLang={hrefLang} className={className ? `${s.ctaPrimario} ${className}` : s.ctaPrimario}>
      <span aria-hidden="true">[[ {comando} ]]</span>
      <span className={s.srOnly}>{nombre}</span>
      <span className={s.ctaFlecha} aria-hidden="true">
        <IconoFlechaDiagonal tamano={16} />
      </span>
    </Link>
  );
}

/** Píldora con contorno: "comando" tal cual. `sobreOscuro` la invierte para bloques de tinta. */
export function SecondaryCta({
  href,
  comando,
  nombre,
  hrefLang,
  sobreOscuro = false,
  className,
}: PropsCta & { sobreOscuro?: boolean }) {
  const clases = [s.ctaSecundario, sobreOscuro ? s.ctaSecundarioOscuro : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <Link href={href} hrefLang={hrefLang} className={clases}>
      <span aria-hidden="true">{comando}</span>
      <span className={s.srOnly}>{nombre}</span>
    </Link>
  );
}
