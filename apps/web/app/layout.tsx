import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/space-mono/400-italic.css";
// Serif editorial para los titulares comerciales. Auto-hospedada: la CSP
// de esta app es font-src 'self' data:, que bloquea Google Fonts.
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/400-italic.css";
import "@fontsource/playfair-display/700-italic.css";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import MutationBanner from "@/components/MutationBanner";
import MarcoSitio from "@/components/MarcoSitio";
import { getSession } from "@/lib/session";
import { IMAGEN_OG_ES, SITIO } from "@/lib/seo";
import { CABECERA_IDIOMA } from "@/lib/menu";

const TITULO = "Zelena — Lo que entregas decide lo que recibes";
const DESCRIPCION =
  "Una comunidad donde lo que entregas decide lo que recibes: reglas públicas, pago por hitos y un historial que es tuyo. En la red de pruebas de Stellar.";

// Valores por defecto para las páginas en español que no traen los suyos. A propósito
// NO van aquí ni la canónica, ni `og:url`, ni `og:title`/`og:description`, ni `robots`:
// lo que pone un layout lo heredan todas sus páginas, y así todo el sitio decía ser la
// home. Cada página arma los suyos con `metadatos()` (lib/seo.ts); sin ellos, Next toma
// el título y la descripción de la propia página para Open Graph.
export const metadata: Metadata = {
  // Necesaria para que las imágenes de Open Graph y las canónicas salgan con URL absoluta.
  metadataBase: new URL(SITIO),
  title: {
    default: TITULO,
    template: "%s · Zelena",
  },
  description: DESCRIPCION,
  applicationName: "Zelena",
  // La imagen va por configuración (public/og/): un opengraph-image.* en app/ le ganaría
  // a la página "/", que en inglés no lleva imagen. Las páginas con `metadatos()` traen
  // su propio openGraph y esto no les llega; solo cubre las internas que no lo traen.
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "Zelena",
    images: [IMAGEN_OG_ES],
  },
  twitter: { card: "summary_large_image", images: [IMAGEN_OG_ES.url] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080808",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // El idioma del documento sigue al de la página (WCAG 3.1.1): la landing ("/" y
  // "/comunidad") está en inglés y el resto en español. La ruta solo la sabe el
  // middleware, que marca la petición con esta cabecera.
  const idioma = headers().get(CABECERA_IDIOMA) === "en" ? "en" : "es";
  return (
    <html lang={idioma}>
      <body>
        {/* El cromo depende de la ruta: la landing en inglés trae el suyo (MarcoSitio). */}
        <MarcoSitio nav={<Nav session={session} />} banner={<MutationBanner />} footer={<Footer />}>
          {children}
        </MarcoSitio>
      </body>
    </html>
  );
}
