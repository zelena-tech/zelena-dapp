/**
 * Metadatos de cada página (SEO). Puro: sin base ni sesión.
 *
 * Next mezcla los metadatos de forma SUPERFICIAL: un `openGraph` de la página reemplaza
 * entero el del layout, y lo que un layout pone en `canonical` u `og:url` lo heredan
 * todas sus hijas (así nació el bug de que todo el sitio decía ser la home). Por eso el
 * layout raíz no fija ni canónica, ni `og:url`, ni `og:title`, y cada página arma los
 * suyos con `metadatos()`: canónica propia, `og:url`, título, descripción e idioma.
 */
import type { Metadata } from "next";

/** Dominio canónico. Lo comparten el layout raíz, el sitemap, robots y el JSON-LD. */
export const SITIO: string = process.env.SITE_URL ?? "https://www.zelena.tech";

export type Idioma = "es" | "en";

/** `og:locale` por idioma: el inglés de la landing y el español de Colombia del resto. */
export const LOCALE_OG: Readonly<Record<Idioma, string>> = { en: "en_US", es: "es_CO" };

export interface ImagenOg {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

/**
 * La imagen de Open Graph de las páginas de la comunidad en español (1200×630, oscura).
 * Vive en `public/og/` y va por configuración, nunca como `opengraph-image.*` o
 * `twitter-image.*` dentro de `app/`: esos archivos le ganan a lo que diga cada página, y
 * así la home en inglés salía con la tarjeta vieja en español (la de la red de pruebas y
 * sin dinero real). Esta no nombra la red: va en páginas que hablan de las dos. Las páginas en
 * inglés y las de empresas (`imagen: null`) no llevan imagen hasta que tengan una propia.
 */
export const IMAGEN_OG_ES: ImagenOg = {
  url: "/og/sitio-es.png",
  alt: "Zelena: el valor que entregas decide lo que recibes",
  width: 1200,
  height: 630,
};

export interface OpcionesMetadatos {
  /** Ruta propia, empezando por "/" (sin dominio): canónica y `og:url`. */
  ruta: string;
  /** Título COMPLETO, con la marca (no pasa por la plantilla del layout). */
  titulo: string;
  descripcion: string;
  idioma: Idioma;
  /** Imagen de Open Graph. Si falta: la del sitio en español; en inglés, ninguna. `null`: ninguna. */
  imagen?: ImagenOg | null;
  /** `false` → `noindex, follow` (p. ej. /entrar). Por defecto se indexa. */
  indexar?: boolean;
}

/** Metadatos de una página: canónica propia, Open Graph y Twitter coherentes con su idioma. */
export function metadatos(o: OpcionesMetadatos): Metadata {
  if (!o.ruta.startsWith("/")) throw new Error(`metadatos: la ruta debe empezar por "/" (${o.ruta})`);
  const imagen = o.imagen === undefined ? (o.idioma === "es" ? IMAGEN_OG_ES : null) : o.imagen;
  const imagenes = imagen ? [{ width: 1200, height: 630, ...imagen }] : undefined;
  return {
    title: { absolute: o.titulo },
    description: o.descripcion,
    alternates: { canonical: o.ruta },
    openGraph: {
      type: "website",
      siteName: "Zelena",
      locale: LOCALE_OG[o.idioma],
      url: o.ruta,
      title: o.titulo,
      description: o.descripcion,
      ...(imagenes ? { images: imagenes } : {}),
    },
    twitter: {
      card: imagen ? "summary_large_image" : "summary",
      title: o.titulo,
      description: o.descripcion,
      ...(imagen ? { images: [imagen.url] } : {}),
    },
    ...(o.indexar === false ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * Rutas públicas que van al sitemap, además de las fichas del Ágora y la Academia.
 * Fuera a propósito: /entrar (noindex), las rutas que solo redirigen (next.config.mjs),
 * las herramientas internas y la API, y las fichas de cada rito (duran poco).
 */
export const RUTAS_SITEMAP: readonly string[] = [
  "/",
  "/comunidad",
  "/book-a-demo",
  "/manifiesto",
  "/metodo",
  "/empresas",
  "/empresas/servicios",
  "/empresas/contacto",
  "/encuentros",
  "/agora",
  "/academia",
  "/gobernanza",
  "/comunidad/ritos",
  "/acuerdo",
  "/privacidad",
];

/** Zonas que los buscadores no deben recorrer (ya responden 307 a /entrar sin sesión). */
export const RUTAS_FUERA_DE_ROBOTS: readonly string[] = ["/api/", "/equipo", "/admin", "/perfil", "/clientes"];

/**
 * JSON-LD de la home ("/"): Organization + WebSite. Sin entidad legal, dirección, NIT ni
 * personas; sin SearchAction (Google lo retiró) ni Event/JobPosting (no hay reales).
 * El logo es el ícono cuadrado del sitio mientras no exista uno hecho del wordmark.
 */
export const JSON_LD_INICIO = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITIO}/#organization`,
      name: "Zelena",
      alternateName: ["ZELENA", "Zelena Tech"],
      url: `${SITIO}/`,
      logo: { "@type": "ImageObject", url: `${SITIO}/icon.png`, width: 512, height: 512 },
      description:
        "Zelena brings performance-based payroll and incentives to logistics SMEs in Latin America: a WMS that measures warehouse work and Harmony, which pays operators their performance bonus in USDC on the Stellar network.",
      sameAs: ["https://github.com/zelena-tech"],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "sales",
        url: `${SITIO}/empresas/contacto`,
        availableLanguage: ["en", "es"],
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITIO}/#website`,
      url: `${SITIO}/`,
      name: "Zelena",
      alternateName: ["ZELENA", "zelena.tech"],
      inLanguage: ["en", "es"],
      publisher: { "@id": `${SITIO}/#organization` },
    },
  ],
} as const;

/**
 * Serializa un JSON-LD para `<script type="application/ld+json">`. Escapa `<` para que
 * ningún texto pueda cerrar la etiqueta. Uso:
 *   <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(JSON_LD_INICIO) }} />
 */
export function jsonLd(datos: unknown): string {
  return JSON.stringify(datos).replace(/</g, "\\u003c");
}
