/**
 * Copy común de las páginas en español con el cromo claro de la landing (la inicio, los
 * incentivos y el contacto): cabecera, pie y enlaces. A quien llega como empresa le
 * hablamos en su idioma, con el diseño de zelena.tech (pedido del founder, 2026-11-17).
 *
 * Todos los enlaces llevan a páginas con ese diseño: nada del diseño oscuro viejo (pedido
 * del founder). /empresas y /empresas/servicios redirigen a la inicio (next.config.mjs).
 *
 * Mismas reglas que copy-comun.ts. Importa con rutas relativas (no "@/") para que los
 * tests de vitest puedan leerlo.
 */
import {
  RUTA_COMUNIDAD,
  RUTA_CONTACTO,
  RUTA_INCENTIVOS,
  RUTA_INICIO_EN,
  RUTA_MANIFIESTO,
  RUTA_PORTAFOLIO,
} from "../../src/lib/menu";

/** Las páginas de este cromo (para marcar la pestaña de la página en la cabecera). */
export type PaginaEmpresas = "portafolio" | "incentivos" | "contacto";

export const ENLACES_EMPRESAS = {
  /** La inicio (el portafolio) desde el 2026-11-17. */
  inicio: "/",
  /** La home en inglés. */
  ingles: RUTA_INICIO_EN,
  portafolio: RUTA_PORTAFOLIO,
  incentivos: RUTA_INCENTIVOS,
  /** Las secciones de la inicio. */
  servicios: `${RUTA_PORTAFOLIO}#servicios`,
  colaborar: `${RUTA_PORTAFOLIO}#colaborar`,
  /** El formulario de contacto en español; admite `?interes=<slug>`. */
  contacto: RUTA_CONTACTO,
  /** La comunidad y el manifiesto: páginas de la landing, en inglés. */
  comunidad: RUTA_COMUNIDAD,
  manifiesto: RUTA_MANIFIESTO,
} as const;

/** Enlace al formulario con la línea ya elegida. */
export function contactoCon(interes: string): string {
  return `${ENLACES_EMPRESAS.contacto}?interes=${encodeURIComponent(interes)}`;
}

export interface PestanaEmpresas {
  href: string;
  label: string;
  /** La pestaña que se marca como la página actual (las que llevan a una sección, ninguna). */
  pagina?: PaginaEmpresas;
  /** La página de destino está en inglés (la landing): se marca con hrefLang. */
  enIngles?: boolean;
}

export const CABECERA_EMPRESAS = {
  saltar: "Saltar al contenido",
  logoAria: "Inicio de Zelena",
  navAria: "Principal",
  /** Servicios | Incentivos | Colaborar | Manifiesto (pedido del founder: faltaban colaborar y el manifiesto). */
  pestanas: [
    { pagina: "portafolio", href: ENLACES_EMPRESAS.servicios, label: "Servicios" },
    { pagina: "incentivos", href: ENLACES_EMPRESAS.incentivos, label: "Incentivos" },
    { href: ENLACES_EMPRESAS.colaborar, label: "Colaborar" },
    { href: ENLACES_EMPRESAS.manifiesto, label: "Manifiesto", enIngles: true },
  ] as readonly PestanaEmpresas[],
  hablemos: "Hablemos",
} as const;

export interface EnlacePieEmpresas {
  href: string;
  label: string;
  /** La página de destino está en inglés (la landing): se marca con hrefLang. */
  enIngles: boolean;
}

export const PIE_EMPRESAS = {
  linea: "© 2026 Zelena · Tecnología para mejorar tu negocio",
  navAria: "Pie",
  enlaces: [
    { href: ENLACES_EMPRESAS.portafolio, label: "Inicio", enIngles: false },
    { href: ENLACES_EMPRESAS.servicios, label: "Servicios", enIngles: false },
    { href: ENLACES_EMPRESAS.incentivos, label: "Incentivos", enIngles: false },
    { href: ENLACES_EMPRESAS.colaborar, label: "Colaborar", enIngles: false },
    { href: ENLACES_EMPRESAS.manifiesto, label: "Manifiesto", enIngles: true },
    { href: ENLACES_EMPRESAS.contacto, label: "Contacto", enIngles: false },
    { href: ENLACES_EMPRESAS.ingles, label: "In English", enIngles: true },
  ] as readonly EnlacePieEmpresas[],
} as const;
