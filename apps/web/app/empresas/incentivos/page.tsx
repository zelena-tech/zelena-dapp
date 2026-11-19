import type { Viewport } from "next";
import { metadatos } from "@/lib/seo";
import { RUTA_INCENTIVOS } from "@/lib/menu";
import MarcoEmpresas from "../../_landing/empresas/MarcoEmpresas";
import s from "../../_landing/landing.module.css";
import { CierreEmpresas, HeroEmpresas } from "../../_landing/empresas/Comunes";
import { Beneficios, DolarDigital, ParaQuien, PasosIncentivos, ReglasClaras } from "../../_landing/empresas/SeccionesIncentivos";
import { CIERRE_INCENTIVOS, HERO_INCENTIVOS, META_INCENTIVOS } from "../../_landing/copy-incentivos";

// Igual que las páginas de la landing: el layout raíz lee la sesión.
export const dynamic = "force-dynamic";

// Diseño claro de la landing: barra del navegador blanca y controles claros.
export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export const metadata = metadatos({
  ruta: RUTA_INCENTIVOS,
  idioma: "es",
  // Sin imagen, igual que el resto de /empresas: la de public/og/ es de la comunidad.
  imagen: null,
  titulo: META_INCENTIVOS.titulo,
  descripcion: META_INCENTIVOS.descripcion,
});

/**
 * Incentivos en dólares digitales (Harmony), en español y con el diseño de zelena.tech
 * (pedido del founder, 2026-11-17): qué es un dólar digital, los tres beneficios (ahorro,
 * productividad y pertenencia), cómo funciona y las reglas claras. Dice lo mismo que
 * /empresas sobre lo que ya es real y lo que es meta. El texto vive en copy-incentivos.ts.
 */
export default function Incentivos() {
  return (
    <MarcoEmpresas pagina="incentivos">
      <HeroEmpresas id="incentivos-titulo" {...HERO_INCENTIVOS} />
      <div className={s.anchoContenido}>
        <DolarDigital />
        <Beneficios />
        <PasosIncentivos />
        <ParaQuien />
        <ReglasClaras />
        <CierreEmpresas id="cierre-titulo" {...CIERRE_INCENTIVOS} />
      </div>
    </MarcoEmpresas>
  );
}
