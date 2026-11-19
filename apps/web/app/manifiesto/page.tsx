import type { Viewport } from "next";
import { metadatos } from "@/lib/seo";
import { RUTA_MANIFIESTO } from "@/lib/menu";
import LandingShell from "../_landing/LandingShell";
import s from "../_landing/landing.module.css";
import { META_MANIFIESTO } from "../_landing/copy-manifiesto";
import HeroManifiesto from "../_landing/manifiesto/HeroManifiesto";
import Principios from "../_landing/manifiesto/Principios";
import CierreManifiesto from "../_landing/manifiesto/CierreManifiesto";

// El layout raíz lee la sesión (la píldora de cuenta de la cabecera): la página es dinámica.
export const dynamic = "force-dynamic";

// Landing clara: barra del navegador blanca y controles claros.
export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export const metadata = metadatos({
  ruta: RUTA_MANIFIESTO,
  idioma: "en",
  titulo: META_MANIFIESTO.titulo,
  descripcion: META_MANIFIESTO.descripcion,
});

/**
 * El manifiesto, en inglés y con el cromo de la landing (pedido del founder, 2026-10-26).
 * Valores y filosofía, no estructura: la forma legal y la mecánica de la comunidad viven
 * en /metodo y /comunidad. Es el documento de fondo del sitio: la dirección vieja del
 * documento largo redirige aquí. Todo el texto vive en copy-manifiesto.ts.
 */
export default function Manifiesto() {
  return (
    <LandingShell pagina="manifiesto">
      <HeroManifiesto />
      <div className={s.anchoContenido}>
        <Principios />
        <CierreManifiesto />
      </div>
    </LandingShell>
  );
}
