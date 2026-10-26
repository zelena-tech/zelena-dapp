"use client";
import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { esRutaLanding } from "@/lib/menu";

/**
 * El cromo del sitio según la ruta (WP33). Un solo layout raíz: en las rutas de la
 * landing en inglés (`RUTAS_LANDING`: "/", "/comunidad", la demo y el manifiesto) la página trae su propio
 * cromo claro (cabecera, `<main>` y pie) y aquí no se pinta nada alrededor; en el resto,
 * el de siempre: glow, menú, aviso de mutación, `<main>` y pie.
 *
 * `usePathname` también responde en el servidor, así que el HTML ya sale con el cromo
 * correcto (sin parpadeo). Menú, aviso y pie llegan ya pintados desde el servidor.
 */
export default function MarcoSitio({
  nav,
  banner,
  footer,
  children,
}: {
  nav: ReactNode;
  banner: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const ruta = usePathname();
  const landing = esRutaLanding(ruta);
  // El HTML del servidor ya trae el `<html lang>` de la ruta (middleware + layout raíz).
  // Al navegar dentro del sitio el layout raíz no se vuelve a pintar: aquí se corrige.
  useEffect(() => {
    document.documentElement.lang = landing ? "en" : "es";
  }, [landing]);
  if (landing) return <>{children}</>;
  return (
    <>
      {/* Glow de fondo, sutil, marca Zelena */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(60,225,9,0.08),transparent_70%)]"
      />
      <div className="relative z-10 flex min-h-screen flex-col">
        {nav}
        {banner}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8">{children}</main>
        {footer}
      </div>
    </>
  );
}
