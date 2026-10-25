/**
 * Imágenes de la landing (public/landing/), con sus medidas reales para reservar el
 * espacio (sin saltos de maquetación). Mismos nombres y mismos lienzos que el diseño: las
 * posiciones del prototipo valen tal cual (la nube y el avatar sentado comparten lienzo y
 * se superponen). Recomprimidas sin pérdida visible.
 *
 * Se sirven con <img> (componente Imagen): next/image necesita `sharp` en el paquete
 * standalone (no está) y además desenfoca el pixel art al remuestrear.
 */
export interface ImagenLanding {
  src: string;
  width: number;
  height: number;
  /** Pixel art: se escala con image-rendering: pixelated. */
  pixel: boolean;
}

export const IMG = {
  /** Avatar de pie con el portátil (bento A de la home, órbita de /comunidad). 238×474, ~89 KB. */
  avatarDePie: { src: "/landing/avatar-beanie-cut.png", width: 238, height: 474, pixel: true },
  /** Avatar sentado (hero de /comunidad); mismo lienzo que la nube, encima de ella. 1320×1236, ~144 KB. */
  avatarSentado: { src: "/landing/hero-avatar-beanie.png", width: 1320, height: 1236, pixel: true },
  /** Nube del hero de /comunidad. 1320×1236, ~10 KB. */
  nube: { src: "/landing/hero-cloud-only.png", width: 1320, height: 1236, pixel: true },
  /** Sticker tecla Z (bento C de la home, 72px). 246×252. */
  stickerTeclaZ: { src: "/landing/st-teclaz.png", width: 246, height: 252, pixel: true },
  /** Sticker tecla Z recortado (tira de cifras). 216×214. */
  stickerTeclaZRecortado: { src: "/landing/st-teclaz-trim.png", width: 216, height: 214, pixel: true },
  /** Sticker corazón (tira de cifras). 156×144. */
  stickerCorazon: { src: "/landing/st-heart-trim.png", width: 156, height: 144, pixel: true },
  /** Sticker flecha (tira de cifras, rotado 14°). 187×202. */
  stickerFlecha: { src: "/landing/st-arrow-ref.png", width: 187, height: 202, pixel: true },
} as const satisfies Record<string, ImagenLanding>;
