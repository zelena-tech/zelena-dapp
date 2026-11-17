/**
 * Copy común de las páginas para empresas con el cromo claro de la landing
 * (/empresas/portafolio y /empresas/incentivos): cabecera, pie y enlaces. En español:
 * a quien llega como empresa le hablamos en su idioma, con el diseño de zelena.tech
 * (pedido del founder, 2026-11-17).
 *
 * Mismas reglas que copy-comun.ts. Importa con rutas relativas (no "@/") para que los
 * tests de vitest puedan leerlo.
 */
import { RUTA_COMUNIDAD, RUTA_INCENTIVOS, RUTA_MANIFIESTO, RUTA_PORTAFOLIO } from "../../src/lib/menu";

/** Las dos páginas de este cromo: las pestañas de su cabecera. */
export type PaginaEmpresas = "portafolio" | "incentivos";

export const ENLACES_EMPRESAS = {
  inicio: "/",
  portafolio: RUTA_PORTAFOLIO,
  incentivos: RUTA_INCENTIVOS,
  empresas: "/empresas",
  servicios: "/empresas/servicios",
  /** El formulario de contacto en español; admite `?interes=<slug>`. */
  contacto: "/empresas/contacto",
  /** La parte de colaborar: la comunidad y el manifiesto (landing, en inglés), el método y los proyectos (en español). */
  comunidad: RUTA_COMUNIDAD,
  manifiesto: RUTA_MANIFIESTO,
  metodo: "/metodo",
  proyectos: "/agora",
} as const;

/** Enlace al formulario con la línea ya elegida. */
export function contactoCon(interes: string): string {
  return `${ENLACES_EMPRESAS.contacto}?interes=${encodeURIComponent(interes)}`;
}

export const CABECERA_EMPRESAS = {
  saltar: "Saltar al contenido",
  logoAria: "Inicio de Zelena",
  navAria: "Principal",
  pestanas: [
    { pagina: "portafolio", href: ENLACES_EMPRESAS.portafolio, label: "Portafolio" },
    { pagina: "incentivos", href: ENLACES_EMPRESAS.incentivos, label: "Incentivos" },
  ] as ReadonlyArray<{ pagina: PaginaEmpresas; href: string; label: string }>,
  hablemos: "Hablemos",
} as const;

export interface EnlacePieEmpresas {
  href: string;
  label: string;
  /** La página de destino está en inglés (la landing): se marca con hrefLang. */
  enIngles: boolean;
}

export const PIE_EMPRESAS = {
  linea: "© 2026 Zelena · Software e incentivos para la logística de LATAM, sobre Stellar",
  navAria: "Pie",
  enlaces: [
    { href: ENLACES_EMPRESAS.inicio, label: "Inicio", enIngles: true },
    { href: ENLACES_EMPRESAS.portafolio, label: "Portafolio", enIngles: false },
    { href: ENLACES_EMPRESAS.incentivos, label: "Incentivos", enIngles: false },
    { href: ENLACES_EMPRESAS.servicios, label: "Servicios", enIngles: false },
    { href: ENLACES_EMPRESAS.empresas, label: "Para empresas", enIngles: false },
    { href: ENLACES_EMPRESAS.contacto, label: "Contacto", enIngles: false },
  ] as readonly EnlacePieEmpresas[],
} as const;
