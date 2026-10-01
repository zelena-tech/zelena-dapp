/**
 * Menú y pie del sitio (WP31-E1). Puro y apto para cliente: lo usa NavContextual,
 * que solo conoce la ruta en el navegador. Nada de base, sesión ni `node:` aquí.
 *
 * Regla: sin sesión, el sitio público tiene cuatro puertas y "Entrar". Las
 * herramientas internas (Mi día, Proyectos, Talento, Clientes) solo se dibujan con
 * sesión, y aun así el permiso real lo decide cada página en el servidor.
 */

export interface EnlaceMenu {
  href: string;
  label: string;
}

/**
 * Ruta de la comunidad. La usan la puerta de la landing, el menú y el cierre.
 * Si la página de comunidad no llega a tiempo, se cambia esta línea por "/encuentros".
 */
export const RUTA_COMUNIDAD: string = "/comunidad";

/** Menú público (sin sesión): cuatro puertas, en este orden. */
export const MENU_PUBLICO: readonly EnlaceMenu[] = [
  { href: "/manifiesto", label: "Manifiesto" },
  { href: "/metodo", label: "Método" },
  { href: RUTA_COMUNIDAD, label: "Comunidad" },
  { href: "/empresas", label: "Para empresas" },
];

/** Menú de /empresas: a quien llega como empresa le hablamos de su operación. */
export const MENU_EMPRESAS: readonly EnlaceMenu[] = [
  { href: "/empresas#productos", label: "Productos" },
  { href: "/empresas#como-funciona", label: "Cómo funciona" },
  { href: "/empresas/servicios", label: "Servicios" },
  { href: "/", label: "Zelena" },
];

const MENU_TRABAJO: readonly EnlaceMenu[] = [
  { href: "/equipo/hoy", label: "Mi día" },
  { href: "/equipo/proyectos", label: "Proyectos" },
];
const ENLACE_TALENTO: EnlaceMenu = { href: "/equipo/talento", label: "Talento" };
const ENLACE_CLIENTES: EnlaceMenu = { href: "/clientes", label: "Clientes" };
const MENU_COMUNIDAD: readonly EnlaceMenu[] = [
  { href: "/agora", label: "Ágora" },
  { href: "/academia", label: "Academia" },
  { href: RUTA_COMUNIDAD, label: "Comunidad" },
];

/** ¿La ruta es del sitio para empresas? */
export function esRutaEmpresas(ruta: string): boolean {
  return ruta === "/empresas" || ruta.startsWith("/empresas/");
}

/**
 * Enlaces del menú para una ruta y una sesión.
 *  - /empresas* → MENU_EMPRESAS (con o sin sesión).
 *  - sin sesión → MENU_PUBLICO.
 *  - con sesión → [Mi día, Proyectos] si tiene acceso al trabajo · [Talento] si ve
 *    todo el equipo · [Clientes] si es del equipo interno · [Ágora, Academia, Comunidad].
 * No incluye el botón de perfil ni "Admin": esos los conserva NavContextual por rol.
 */
export function menuPara(o: {
  ruta: string;
  conSesion: boolean;
  accesoEquipo: boolean;
  esInterno: boolean;
  puedeVerTodo: boolean;
}): EnlaceMenu[] {
  if (esRutaEmpresas(o.ruta)) return [...MENU_EMPRESAS];
  if (!o.conSesion) return [...MENU_PUBLICO];
  return [
    ...(o.accesoEquipo ? MENU_TRABAJO : []),
    ...(o.puedeVerTodo ? [ENLACE_TALENTO] : []),
    ...(o.esInterno ? [ENLACE_CLIENTES] : []),
    ...MENU_COMUNIDAD,
  ];
}

/** Licencia del repositorio (el archivo no se toca: se enlaza). */
export const URL_LICENCIA = "https://github.com/zelena-tech/zelena-dapp/blob/main/LICENSE";

/** Grupos del pie. El de "Legal" es obligatorio en todas las páginas. */
export const FOOTER_GRUPOS: ReadonlyArray<{ titulo: string; enlaces: readonly EnlaceMenu[] }> = [
  {
    titulo: "Comunidad",
    enlaces: [
      { href: "/agora", label: "Proyectos abiertos" },
      { href: "/academia", label: "Academia" },
      { href: "/gobernanza", label: "Decisiones" },
      { href: "/whitepaper", label: "Whitepaper" },
    ],
  },
  {
    titulo: "Empresas",
    enlaces: [
      { href: "/empresas/servicios", label: "Servicios" },
      { href: "/empresas/contacto", label: "Contacto" },
    ],
  },
  {
    titulo: "Legal",
    enlaces: [
      { href: "/acuerdo", label: "Acuerdo de contribución" },
      { href: "/privacidad", label: "Privacidad" },
      { href: URL_LICENCIA, label: "Licencia" },
    ],
  },
];

/** Aviso del pie: lo que es de prueba se dice en todas las páginas. */
export const AVISO_LEGAL =
  "Las funciones de pago de la plataforma corren en la red de pruebas de Stellar. Nada aquí es oferta de valores ni asesoría.";

/** ¿El enlace sale del sitio? (se abre en otra pestaña). */
export function esEnlaceExterno(href: string): boolean {
  return /^https?:\/\//.test(href);
}
