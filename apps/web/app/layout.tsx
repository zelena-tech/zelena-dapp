import type { Metadata } from "next";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource/space-mono/400-italic.css";
import "./globals.css";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import MutationBanner from "@/components/MutationBanner";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Zelena DAO — Real work, Real rewards",
  description:
    "Comunidad de contribuidores donde el valor que entregas determina lo que recibes. Del piso a la wallet. Sobre Stellar / Soroban, en testnet.",
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
