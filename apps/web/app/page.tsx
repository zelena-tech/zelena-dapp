import type { Viewport } from "next";
import { metadatos } from "@/lib/seo";
import { RUTA_PORTAFOLIO } from "@/lib/menu";
import MarcoEmpresas from "./_landing/empresas/MarcoEmpresas";
import s from "./_landing/landing.module.css";
import { CierreEmpresas } from "./_landing/empresas/Comunes";
import Explorador from "./_landing/empresas/Explorador";
import {
  CicloDeTrabajo,
  Colaborar,
  CuatroLineas,
  HeroPortafolio,
  Impacto,
} from "./_landing/empresas/SeccionesPortafolio";
import { CIERRE_PORTAFOLIO, META_PORTAFOLIO } from "./_landing/copy-portafolio";

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
 * La inicio (zelena.tech/): el portafolio de soluciones, en español y con el diseño de la
 * landing. Desde el 2026-11-17 es la página de inicio (pedido del founder; la landing en
 * inglés vive en /en y /empresas/portafolio redirige aquí) y cuenta una historia (pedido del founder): la tecnología de las grandes
 * empresas, al alcance de una pyme. Titular, la creencia y la prueba (empresas reales),
 * tacha lo que te pasa, un solo aliado, todo lo que hacemos, cómo trabajamos, colaborar y
 * el cierre. Todo el texto vive en copy-portafolio.ts.
 */
export default function Portafolio() {
  return (
    <MarcoEmpresas pagina="portafolio">
      <HeroPortafolio />
      <div className={s.anchoContenido}>
        <Impacto />
        <Explorador entre={<CuatroLineas />} />
        <CicloDeTrabajo />
        <Colaborar />
        <CierreEmpresas id="cierre-titulo" {...CIERRE_PORTAFOLIO} />
      </div>
    </MarcoEmpresas>
  );
}
