import type { Metadata, Viewport } from "next";
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
import { getSession } from "@/lib/session";

const SITIO = process.env.SITE_URL ?? "https://www.zelena.tech";
const TITULO = "Zelena — Lo que entregas decide lo que recibes";
const DESCRIPCION =
  "Una comunidad donde lo que entregas decide lo que recibes: reglas públicas, pago por hitos y un historial que es tuyo. En la red de pruebas de Stellar.";

export const metadata: Metadata = {
  // Necesaria para que las imágenes de Open Graph se sirvan con URL absoluta.
  metadataBase: new URL(SITIO),
  title: {
    default: TITULO,
    template: "%s · Zelena",
  },
  description: DESCRIPCION,
  applicationName: "Zelena",
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "Zelena",
    title: TITULO,
    description: DESCRIPCION,
    url: SITIO,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080808",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="es">
      <body>
        {/* Glow de fondo, sutil, marca Zelena */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(60,225,9,0.08),transparent_70%)]"
        />
        <div className="relative z-10 flex min-h-screen flex-col">
          <Nav session={session} />
          <MutationBanner />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
