import type { Viewport } from "next";
import { metadatos } from "@/lib/seo";
import { RUTA_PORTAFOLIO } from "@/lib/menu";
import MarcoEmpresas from "../../_landing/empresas/MarcoEmpresas";
import s from "../../_landing/landing.module.css";
import { CierreEmpresas, HeroEmpresas } from "../../_landing/empresas/Comunes";
import Explorador from "../../_landing/empresas/Explorador";
import { CicloDeTrabajo, PorQue, TresLineas } from "../../_landing/empresas/SeccionesPortafolio";
import { CIERRE_PORTAFOLIO, HERO_PORTAFOLIO, META_PORTAFOLIO } from "../../_landing/copy-portafolio";

// Igual que las páginas de la landing: el layout raíz lee la sesión.
export const dynamic = "force-dynamic";

// Diseño claro de la landing: barra del navegador blanca y controles claros.
export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export const metadata = metadatos({
  ruta: RUTA_PORTAFOLIO,
  idioma: "es",
  // Sin imagen, igual que el resto de /empresas: la de public/og/ es de la comunidad.
  imagen: null,
  titulo: META_PORTAFOLIO.titulo,
  descripcion: META_PORTAFOLIO.descripcion,
});

/**
 * El portafolio de soluciones, en español y con el diseño de zelena.tech (pedido del
 * founder, 2026-11-17): qué hace Zelena en tres líneas, el buscador por situación, las
 * siete líneas con su ficha, cómo trabajamos y por qué. Todo el texto vive en
 * copy-portafolio.ts.
 */
export default function Portafolio() {
  return (
    <MarcoEmpresas pagina="portafolio">
      <HeroEmpresas id="portafolio-titulo" {...HERO_PORTAFOLIO} />
      <div className={s.anchoContenido}>
        <TresLineas />
        <Explorador />
        <CicloDeTrabajo />
        <PorQue />
        <CierreEmpresas id="cierre-titulo" {...CIERRE_PORTAFOLIO} />
      </div>
    </MarcoEmpresas>
  );
}
