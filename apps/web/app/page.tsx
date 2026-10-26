import type { Viewport } from "next";
import { metadatos, jsonLd, JSON_LD_INICIO } from "@/lib/seo";
import LandingShell from "./_landing/LandingShell";
import s from "./_landing/landing.module.css";
import { META_HOME } from "./_landing/copy-home";
import HeroBento from "./_landing/home/HeroBento";
import Productos from "./_landing/home/Productos";
import Harmony from "./_landing/home/Harmony";
import ComoFunciona from "./_landing/home/ComoFunciona";
import Pagos from "./_landing/home/Pagos";
import Manifiesto from "./_landing/home/Manifiesto";
import CierreHome from "./_landing/home/CierreHome";

// El layout raíz lee la sesión (la píldora de cuenta de la cabecera): la página es dinámica.
export const dynamic = "force-dynamic";

// Landing clara: barra del navegador blanca y controles claros.
export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export const metadata = metadatos({
  ruta: "/",
  idioma: "en",
  titulo: META_HOME.titulo,
  descripcion: META_HOME.descripcion,
});

/**
 * Home en inglés, para empresas (WP33, diseño "Zelena Stellar Web", hero Bento): medir el
 * trabajo, pagar el bono en USDC en Stellar. Sin cifras en vivo: las de la comunidad
 * (firmas, proyectos, encuentros y la llamada a participar) viven en /comunidad.
 */
export default function Inicio() {
  return (
    <LandingShell pagina="home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(JSON_LD_INICIO) }} />
      <HeroBento />
      <div className={s.anchoContenido}>
        <Productos />
        <Harmony />
        <ComoFunciona />
        <Pagos />
        <Manifiesto />
        <CierreHome />
      </div>
    </LandingShell>
  );
}
