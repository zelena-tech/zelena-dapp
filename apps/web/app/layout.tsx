import type { Metadata, Viewport } from "next";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/space-mono/400-italic.css";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import MutationBanner from "@/components/MutationBanner";
import { getSession } from "@/lib/session";

const SITIO = process.env.SITE_URL ?? "https://zelena-dao.azurewebsites.net";
const DESCRIPCION =
  "Comunidad de contribuidores donde el valor que entregas determina lo que recibes: reglas públicas, pago por hitos y una reputación que te pertenece. Sobre Stellar, en testnet.";

export const metadata: Metadata = {
  // Necesaria para que las imágenes de Open Graph se sirvan con URL absoluta.
  metadataBase: new URL(SITIO),
  title: {
    default: "Zelena DAO — El valor que entregas decide lo que recibes",
    template: "%s · Zelena DAO",
  },
  description: DESCRIPCION,
  applicationName: "Zelena DAO",
  openGraph: {
    type: "website",
    locale: "es_CO",
    siteName: "Zelena DAO",
    title: "Zelena DAO — El valor que entregas decide lo que recibes",
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
