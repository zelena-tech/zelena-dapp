/**
 * Copy común de la landing en inglés (WP33): enlaces, cabecera y pie.
 * Todo el texto de las páginas vive en módulos como este (copy-home.ts,
 * copy-comunidad.ts), no incrustado en el JSX.
 *
 * Reglas del copy (no negociables): ni nombres de clientes, ventures o personas, ni la
 * entidad legal, ni el documento largo que ya no existe (el manifiesto lo reemplaza), ni
 * jerga prohibida en lo público (ver sitio-publico.test.ts). El producto logístico es el
 * WMS. Los pagos de Harmony son reales en la red principal de Stellar; el contrato de
 * Soroban del reparto y la app de la comunidad corren en la red de pruebas. El pie ya no
 * lleva aviso legal ni grupo Legal (pedido del founder, 2026-10-26).
 *
 * Importa con rutas relativas (no "@/") para que los tests de vitest puedan leerlo.
 */
import { RUTA_COMUNIDAD, RUTA_DEMO, RUTA_MANIFIESTO, RUTA_RITOS, URL_LICENCIA } from "../../src/lib/menu";

/**
 * Las páginas de la landing: las dos de la cabecera (Home y Community) y dos más que no
 * tienen pestaña propia (la demo y el manifiesto).
 */
export type PaginaLanding = "home" | "comunidad" | "demo" | "manifiesto";

/** Ancla de la sección de proyectos abiertos en /comunidad (`id` de la sección). */
export const ANCLA_PROYECTOS = "open-projects";

/** Mapa de enlaces: cada CTA lleva a una ruta real del sitio. */
export const ENLACES = {
  inicio: "/",
  comunidad: RUTA_COMUNIDAD,
  /** "explore projects": la sección de proyectos de /comunidad. */
  proyectosAbiertos: `${RUTA_COMUNIDAD}#${ANCLA_PROYECTOS}`,
  /** "Book a demo": la página de la demo, en inglés, con su formulario (Harmony ya elegido). */
  reservarDemo: RUTA_DEMO,
  entrar: "/entrar",
  /** Con sesión: el trabajo del equipo, o el perfil. */
  miDia: "/equipo/hoy",
  perfil: "/perfil",
  /** Proyectos del Ágora (y su ficha: `/agora/{id}`). */
  agora: "/agora",
  /** Decisiones y votaciones (votar exige sesión y el acuerdo firmado). */
  gobernanza: "/gobernanza",
  encuentros: "/encuentros",
  avisoEncuentros: "/encuentros#aviso",
  ritos: RUTA_RITOS,
  manifiesto: RUTA_MANIFIESTO,
  metodo: "/metodo",
  /** Las pruebas verificables en la red de pruebas, dentro de /metodo. */
  metodoPruebas: "/metodo#compruebalo",
  academia: "/academia",
  empresas: "/empresas",
  servicios: "/empresas/servicios",
  comoFuncionaEmpresas: "/empresas#como-funciona",
  acuerdo: "/acuerdo",
  privacidad: "/privacidad",
  licencia: URL_LICENCIA,
} as const;

export const CABECERA = {
  saltar: "Skip to content",
  logoAria: "Zelena home",
  navAria: "Primary",
  pestanas: [
    { pagina: "home", href: ENLACES.inicio, label: "Home" },
    { pagina: "comunidad", href: ENLACES.comunidad, label: "Community" },
  ] as ReadonlyArray<{ pagina: PaginaLanding; href: string; label: string }>,
  entrar: "Log in",
  miDia: "My day",
  miPerfil: "My profile",
} as const;

export interface EnlacePie {
  href: string;
  label: string;
  /** Sale del sitio: se abre en otra pestaña. */
  externo: boolean;
}

export const PIE = {
  linea: "© 2026 Zelena · Performance-based payroll for LATAM logistics, built on Stellar",
  navAria: "Footer",
  /**
   * Las páginas enlazadas están en español: se marca con hrefLang en cada enlace, salvo
   * las que son de la landing (el manifiesto), que están en inglés.
   */
  idiomaDestino: "es",
  enlaces: [
    { href: ENLACES.manifiesto, label: "Manifesto", externo: false },
    { href: ENLACES.metodo, label: "Method", externo: false },
    { href: ENLACES.gobernanza, label: "Decision log", externo: false },
    { href: ENLACES.agora, label: "Open projects", externo: false },
    { href: ENLACES.academia, label: "Academy", externo: false },
    { href: ENLACES.encuentros, label: "Meetups", externo: false },
    { href: ENLACES.empresas, label: "For companies", externo: false },
  ] as readonly EnlacePie[],
} as const;
