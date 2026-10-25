import type { CSSProperties } from "react";
import type { ImagenLanding } from "./assets";

/**
 * <img> de la landing con lo que pide la revisión de rendimiento: ancho y alto reales
 * (reservan el espacio), pixel art nítido, `alt=""` por defecto (decorativa) y carga
 * perezosa salvo que sea la imagen principal del hero (`prioridad`), la única que lleva
 * fetchpriority="high". Nada de next/image: en el paquete standalone no hay `sharp`.
 */
export default function Imagen({
  img,
  alt = "",
  prioridad = false,
  perezosa = !prioridad,
  className,
  style,
}: {
  img: ImagenLanding;
  /** Texto alternativo; vacío si la imagen es decorativa (el caso normal en la landing). */
  alt?: string;
  /** Imagen principal del hero (candidata a LCP): carga ya y con prioridad alta. */
  prioridad?: boolean;
  /** `loading="lazy"`; por defecto, todo lo que no es prioridad. */
  perezosa?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  // React 18 no conoce `fetchPriority` en camelCase: se pasa el atributo HTML tal cual.
  const prioridadAlta = prioridad ? ({ fetchpriority: "high" } as Record<string, string>) : {};
  return (
    <img
      src={img.src}
      width={img.width}
      height={img.height}
      alt={alt}
      loading={perezosa ? "lazy" : "eager"}
      decoding="async"
      draggable={false}
      className={className}
      style={img.pixel ? { imageRendering: "pixelated", ...style } : style}
      {...prioridadAlta}
    />
  );
}
