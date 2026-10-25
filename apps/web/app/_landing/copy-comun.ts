/**
 * Copy común de la landing en inglés (WP33): enlaces, cabecera, pie y avisos legales.
 * Todo el texto de las páginas vive en módulos como este (copy-home.ts,
 * copy-comunidad.ts), no incrustado en el JSX.
 *
 * Reglas del copy (no negociables): ni nombres de clientes, ventures o personas, ni la
 * entidad legal, ni el documento largo que ya no existe (el manifiesto lo reemplaza), ni
 * jerga prohibida en lo público (ver sitio-publico.test.ts). El producto logístico es el
 * WMS. Los pagos de Harmony son reales en la red principal de Stellar; el contrato que
 * automatiza el reparto y la app de la comunidad corren en la red de pruebas.
 *
 * Importa con rutas relativas (no "@/") para que los tests de vitest puedan leerlo.
 */
import { FOOTER_GRUPOS, RUTA_COMUNIDAD, RUTA_RITOS, URL_LICENCIA, esEnlaceExterno } from "../../src/lib/menu";

/** Las dos páginas de la landing. */
export type PaginaLanding = "home" | "comunidad";

/** Ancla de la sección de proyectos abiertos en /comunidad (`id` de la sección). */
export const ANCLA_PROYECTOS = "open-projects";

/** Mapa de enlaces: cada CTA lleva a una ruta real del sitio. */
export const ENLACES = {
  inicio: "/",
  comunidad: RUTA_COMUNIDAD,
  /** "explore projects": la sección de proyectos de /comunidad. */
  proyectosAbiertos: `${RUTA_COMUNIDAD}#${ANCLA_PROYECTOS}`,
  /** "Book a demo": el formulario (en español) con Harmony ya elegido. */
  reservarDemo: "/empresas/contacto?interes=harmony",
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
  manifiesto: "/manifiesto",
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

/** Etiquetas en inglés del grupo "Legal" del pie del sitio (lib/menu.ts), por href. */
const LEGAL_EN: Readonly<Record<string, string>> = {
  "/acuerdo": "Contribution agreement",
  "/privacidad": "Privacy",
  [URL_LICENCIA]: "License",
};

/**
 * Los enlaces legales salen del grupo "Legal" de FOOTER_GRUPOS: mismos destinos y mismo
 * orden que en el resto del sitio, para que no se desvíen (es obligatorio en todas las
 * páginas). Solo cambia la etiqueta.
 */
export const PIE_LEGAL: readonly EnlacePie[] = (FOOTER_GRUPOS.find((g) => g.titulo === "Legal")?.enlaces ?? []).map(
  (e) => ({ href: e.href, label: LEGAL_EN[e.href] ?? e.label, externo: esEnlaceExterno(e.href) })
);

export const PIE = {
  linea: "© 2026 Zelena · Performance-based payroll for LATAM logistics, built on Stellar",
  navAria: "Footer",
  legalAria: "Legal",
  /** Las páginas enlazadas están en español: se marca con hrefLang en cada enlace. */
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
  legal: PIE_LEGAL,
} as const;

/**
 * Aviso legal del pie, por página. En la home: los bonos se liquidan en la red principal
 * y el contrato del reparto está en la red de pruebas. En la comunidad: la plataforma
 * corre en la red de pruebas (alineado con AVISO_LEGAL del pie en español).
 */
export const AVISOS_LEGALES: Readonly<Record<PaginaLanding, string>> = {
  home: "Bonus payouts settle in USDC on Stellar mainnet. The automatic split contract runs on the Stellar testnet. Nothing here is a securities offering or investment advice.",
  comunidad:
    "The community platform and its payment features run on the Stellar testnet; points and records there have no monetary value. Nothing here is a securities offering or investment advice.",
};
