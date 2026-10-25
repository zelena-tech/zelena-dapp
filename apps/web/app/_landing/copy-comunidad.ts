/**
 * Copy de /comunidad en inglés (para quien contribuye).
 *
 * Reglas para este módulo: las cifras y las listas salen de la base
 * (lib/landing-datos.ts, `datosComunidad`); aquí solo van los textos, incluidas las líneas
 * de llamada a la acción que acompañan a un cero ("con todo en cero se muestra el cero").
 * "Proyectos abiertos", nunca la palabra en inglés de recompensa por tarea. La gobernanza
 * es pública y cualquiera la puede leer; no se dice que un contrato ejecuta lo votado. El
 * pago de quien contribuye sigue lo que dice /metodo (por hito aprobado, 20/70/10). En la
 * red de pruebas de Stellar se anclan las firmas del acuerdo, los totales de puntos de cada
 * época y los ritos (nada más): nunca se presentan como red principal. Lo que es maqueta lleva su rótulo de ejemplo ("Sample").
 *
 * Los textos van en minúscula de frase: las mayúsculas del diseño las pone el CSS.
 * Importa con rutas relativas (no "@/") para que los tests de vitest puedan leerlo.
 */
import { ENLACES } from "./copy-comun";

/** Número en formato inglés: 3,100. */
export const numero = (n: number): string => n.toLocaleString("en-US");

const plural = (n: number, uno: string, varios: string): string => `${numero(n)} ${n === 1 ? uno : varios}`;

/** Metadatos de la página (SEO): el lema de la marca en el título, como lo posiciona hoy "/". */
export const META = {
  titulo: "Zelena Community — The value you deliver decides what you get",
  descripcion:
    "Zelena’s contributor community: public rules, milestone-based work and a reputation that is yours. Open projects, public decisions, Academy and meetups.",
} as const;

// ---------------------------------------------------------------------------
// 1 · Hero
// ---------------------------------------------------------------------------

export const HERO = {
  chip: "Real work, real rewards",
  /** El H1 en dos líneas forzadas. */
  titulo: ["The value you deliver", "decides what you get."],
  // No "Stellar lo registra todo": en la red de pruebas solo se anclan las firmas del
  // acuerdo, los totales de puntos de cada época y los ritos; el resto vive en la base.
  lead: "A community of contributors with public rules, milestone-based pay and a reputation that belongs to you. The record stays open; you just deliver.",
  ctaPrincipal: { comando: "explore_projects", nombre: "Explore open projects" },
  /** Lleva a la llamada a participar (encuentro, rito preparado o aviso por correo). */
  ctaSecundario: { comando: "join_the_community", nombre: "Join the community" },
  /** Tarjetas de vidrio sobre la nube (ilustración; las cifras reales están en la tira). */
  tarjetas: {
    prueba: {
      etiqueta: "Proof of contribution",
      conFirmas: (n: number) => `Agreement #${numero(n)} recorded`,
      sinFirmas: "Every delivery gets a fingerprint",
      red: "Stellar testnet",
    },
    pago: {
      muestra: "Sample",
      titulo: "Milestone approved",
      monto: "+400",
      moneda: "USD",
      pie: "paid against the approved milestone",
    },
    voto: {
      conVotacion: (id: number) => `Open vote #${id}`,
      conVotos: (pct: number) => `${pct}% in favor`,
      sinVotos: "No votes yet",
      sinVotacion: "Decisions",
      sinVotacionPie: "every one is public",
    },
  },
} as const;

// ---------------------------------------------------------------------------
// 2 · Tira de cifras (en vivo)
// ---------------------------------------------------------------------------

export interface LineaCero {
  texto: string;
  /** Destino de la llamada; null si la línea solo explica. */
  href: string | null;
}

export const CIFRAS = {
  aria: "The community in numbers",
  firmas: {
    comando: "clas_signed",
    nombre: "contribution agreements signed",
    cero: { texto: "Be the first", href: ENLACES.entrar } as LineaCero,
  },
  proyectos: {
    comando: "open_projects",
    nombre: "open projects",
    cero: { texto: "New ones post in the Agora first", href: ENLACES.agora } as LineaCero,
  },
  puntos: {
    comando: "points_awarded",
    nombre: "points awarded",
    // También los da la Academia (bucket 'academia' en points_ledger), no solo una entrega.
    cero: { texto: "Earn the first ones in the Academy or with an approved delivery", href: ENLACES.academia } as LineaCero,
  },
  nota: "We only count what’s real: no test accounts.",
} as const;

// ---------------------------------------------------------------------------
// 3 · Tecnología que no se nota
// ---------------------------------------------------------------------------

export const TECNOLOGIA = {
  eyebrow: "$ principle --08",
  titulo: ["Technology", "you don’t notice."],
  intro:
    "No crypto jargon. You deliver; the record stays open, and signed agreements and point totals get a fingerprint on Stellar (testnet for now).",
  /** Las pruebas verificables en la red de pruebas (en /metodo). */
  enlace: { texto: "Check it yourself", href: ENLACES.metodoPruebas },
  registro: {
    etiqueta: "Proof of contribution",
    numero: "01",
    titulo: "A record that stays",
    texto:
      "Every approved delivery is sealed into a fingerprint anchored on Stellar testnet. Append-only: if anyone rewrites it, the fingerprint shows it.",
    /** Maqueta del registro: filas de ejemplo, rotuladas como tal. */
    visual: {
      cabecera: "deliveries",
      muestra: "Sample",
      filas: [
        { n: "Delivery 03", huella: "a3f9…12c" },
        { n: "Delivery 02", huella: "7be0…9d4" },
        { n: "Delivery 01", huella: "c21d…e07" },
      ],
    },
  },
  pago: {
    etiqueta: "Milestone pay",
    numero: "02",
    titulo: "Paid by milestone",
    texto: "Milestone approved, milestone paid. 20% when you start, 70% against approved deliveries, 10% at close.",
    /** Maqueta de dos avisos de pago, rotulados como ejemplo (sin clientes ni tiempos). */
    visual: {
      muestra: "Sample",
      avisos: [
        { monto: "+US$ 400", detalle: "Milestone 1" },
        { monto: "+US$ 200", detalle: "Upfront" },
      ],
    },
  },
  decisiones: {
    etiqueta: "Decisions",
    numero: "03",
    titulo: "Governance in the open",
    texto: "Every published decision is recorded with its reason and its fingerprint, so anyone can review it.",
    /** Con una votación abierta, su barra real; sin ella, una barra neutra sin porcentaje. */
    visual: {
      votacion: (id: number) => `vote #${id}`,
      favor: (pct: number) => `${pct}% yes`,
      sinVotos: "no votes yet",
      umbral: (u: number) => `needs ${u}% to pass`,
      sinVotacion: "decisions",
      publicadas: (n: number) => `${numero(n)} published`,
      pie: "with its reason",
    },
  },
} as const;

// ---------------------------------------------------------------------------
// 4 · Órbita (decorativa: repite cifras reales de la tira)
// ---------------------------------------------------------------------------

export const ORBITA = {
  firmas: { titulo: (n: number) => plural(n, "agreement", "agreements"), pie: "signed on Stellar testnet" },
  proyectos: { titulo: "Projects", pie: (n: number) => `${numero(n)} open` },
  puntos: { titulo: "Points", pie: (n: number) => `${numero(n)} awarded` },
  entregas: { titulo: "Deliveries", pie: (n: number) => `${numero(n)} approved` },
  red: { titulo: "Stellar network", pie: "fees under 1¢" },
  decisiones: {
    titulo: "Decisions",
    votos: (n: number) => plural(n, "open vote", "open votes"),
    publicadas: (n: number) => `${numero(n)} published`,
  },
} as const;

// ---------------------------------------------------------------------------
// 5 · Manifiesto
// ---------------------------------------------------------------------------

export const MANIFIESTO = {
  eyebrow: "$ cat manifesto.md",
  /** Dos líneas; la última palabra va resaltada. */
  titulo: { linea1: "We’re redesigning", linea2: "how we", resaltado: "collaborate." },
  pilares: [
    {
      n: "I · The work",
      t: "We grade deliveries, not people.",
      d: "What you deliver speaks for you, and what you earn can’t be taken away.",
    },
    {
      n: "II · The community",
      t: "Everything in the open.",
      d: "Budgets, criteria and decisions. You compete with yourself first, and leaving well counts too.",
    },
    {
      n: "III · How we build",
      t: "Real comes first.",
      d: "Technology you don’t notice. Trust is earned step by step.",
    },
  ],
  cta: { comando: "read_the_manifesto", nombre: "Read the manifesto" },
} as const;

// ---------------------------------------------------------------------------
// 6 · Proyectos abiertos (#open-projects)
// ---------------------------------------------------------------------------

export const PROYECTOS = {
  eyebrow: "$ zelena projects --open",
  titulo: "Open projects.",
  filtrosAria: "Filter projects",
  todos: "All",
  mostrados: (n: number) => plural(n, "project shown", "projects shown"),
  semanas: (n: number) => `${numero(n)} wks`,
  monto: (n: number) => `USD ${numero(n)}`,
  /** Junto a cada monto: es la red de pruebas (WP31, regla 7). */
  red: "Testnet",
  verTodos: { comando: "see_all_in_the_agora", nombre: "See all projects in the Agora" },
  vacio: {
    texto: "No open projects right now. New ones are published in the Agora.",
    comando: "open_the_agora",
    nombre: "Open the Agora",
  },
} as const;

// ---------------------------------------------------------------------------
// 7 · Decisiones y votaciones (solo lectura; se vota en /gobernanza)
// ---------------------------------------------------------------------------

export const DECISIONES = {
  eyebrow: "$ ls decisions --open",
  titulo: "Decisions",
  intro: "Votes and decisions are public: anyone can read them, with their reasons.",
  meta: (id: number) => `#${id} · open vote`,
  conVotos: (pct: number, total: number, umbral: number) =>
    `${pct}% in favor · ${plural(total, "vote", "votes")} · passes at ${umbral}%`,
  sinVotos: (umbral: number) => `0 votes yet · passes at ${umbral}%`,
  votar: "Vote",
  votarEn: (id: number) => ` on proposal #${id}`,
  nota: "To vote, log in and sign the contribution agreement.",
  publicadas: (n: number) => `${plural(n, "decision", "decisions")} published so far.`,
  leerTodas: "Read every decision and why",
  vacio: "No votes open right now.",
} as const;

// ---------------------------------------------------------------------------
// 8 · Encuentros y ritos
// ---------------------------------------------------------------------------

export const ENCUENTROS = {
  eyebrow: "$ cal meetups",
  titulo: "Meetups",
  tipo: { encuentro: "Meetup", rito: "Ritual" },
  comando: { encuentro: "$ meetup --join", rito: "$ ritual --join" },
  /** Palabra grande del cartel cuando no hay lugar publicado. */
  sinLugar: { encuentro: "Soon", rito: "Community" },
  sinDetalles: "Details on the page",
  vacio: {
    comando: "$ notify --me",
    lugar: "Soon",
    tipo: "Meetups",
    titulo: "No dates yet.",
    texto: "Leave your email and we’ll tell you first.",
  },
  ritos: { texto: "All rituals and how to attend", href: ENLACES.ritos },
} as const;

// ---------------------------------------------------------------------------
// 9 · Cierre
// ---------------------------------------------------------------------------

export const CIERRE = {
  eyebrow: "$ zelena join",
  titulo: ["Real work.", "Real rewards."],
  texto: "Deliver the milestone. Once it’s approved, it gets paid and stays on your record.",
  cta: { comando: "explore_projects", nombre: "Explore open projects" },
  /** Ventana de código (decorativa): aprobar, registrar y pagar contra la aprobación. */
  archivo: "milestone_02.rs",
  codigo: [
    { texto: "fn approve(m: Milestone) {", tono: "lima" },
    { texto: "  review(&m)?;", tono: "claro" },
    { texto: "  record(m.id);", tono: "claro" },
    { texto: "  pay(m.amount); // on approval", tono: "gris" },
    { texto: "}", tono: "lima" },
  ],
  aviso: { texto: "Milestone approved · +400 USD", muestra: "Sample" },
} as const;

export type TonoCodigo = (typeof CIERRE.codigo)[number]["tono"];
