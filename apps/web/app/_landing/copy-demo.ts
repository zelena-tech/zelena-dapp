/**
 * Copy de la página de la demo en inglés ("/book-a-demo"), a la que llevan los "Book a
 * demo" de la landing (pedido del founder, 2026-10-26: antes llevaban al formulario en
 * español, con el diseño viejo). Todo el texto de la página vive aquí: las secciones y el
 * formulario solo lo pintan.
 *
 * Mismos hechos que la home (copy-home.ts): el WMS mide en producción, Harmony paga bonos
 * reales en USDC en la red principal de Stellar desde septiembre de 2026, y el pago a cuenta
 * bancaria en moneda local es lo que viene. Sin plazos inventados: prometer "respuesta en
 * 24 h" es un SLA público que el equipo tendría que sostener.
 *
 * La solicitud entra por el mismo camino que el formulario en español
 * (POST /api/empresas/contacto), con su casilla de autorización (Ley 1581) y el aviso de
 * privacidad vigente, que está en español: el enlace lo dice.
 */
import { ENLACES } from "./copy-comun";
import { COMO_FUNCIONA, HERO as HERO_INICIO } from "./copy-home";

/** Título y descripción de la página (buscadores y vista previa al compartir). */
export const META_DEMO = {
  titulo: "Book a demo — Zelena",
  descripcion:
    "Tell us how your warehouse runs and we’ll show you how Zelena measures your operators’ work and pays the bonus they earn in USDC, on Stellar.",
} as const;

export const HERO_DEMO = {
  chip: "Book a demo",
  /** H1 en dos líneas forzadas; "warehouse" con el resaltado lima. */
  h1: {
    linea1: "See Zelena",
    antes: "in your ",
    resaltado: "warehouse",
    despues: ".",
  },
  parrafo:
    "Tell us how your operation runs. We’ll walk you through how Zelena measures the work and pays the bonus, on your case, not on a generic deck.",
  /** Lo que se ve en la demo: lo mismo que la home dice que ya funciona. */
  agendaTitulo: "In the demo",
  agenda: [
    "Our WMS tracking every order, task and operator in real time.",
    "How Harmony turns measured work into a score and a bonus.",
    "How the bonus lands in USDC in each operator’s Stellar wallet, in seconds.",
  ],
  /** El mismo hecho verificable que acompaña al CTA de la home. */
  prueba: HERO_INICIO.prueba,
} as const;

/** Qué pasa después de enviar (las mismas tres etapas que el formulario en español). */
export const PASOS_DEMO = {
  titulo: "What happens next",
  pasos: [
    { n: "01", titulo: "You tell us", texto: "What you run, how many people work the floor and which system you use today." },
    { n: "02", titulo: "We talk", texto: "A short call to understand your operation before we propose anything." },
    { n: "03", titulo: "We show you", texto: "The demo, on your case, with only what actually applies to it." },
  ],
  /** Para quien todavía no quiere escribir: la sección "how it works" de la home. */
  enlace: { nombre: "See how it works first", href: `${ENLACES.inicio}#${COMO_FUNCIONA.ancla}` },
} as const;

/**
 * Textos del formulario (isla de cliente): solo cadenas, se pasan como props. Los `slug`
 * de los intereses son los de lib/servicios.ts (la API los valida).
 */
export interface TextosFormularioDemo {
  titulo: string;
  nombre: string;
  email: string;
  empresa: string;
  opcional: string;
  interes: string;
  intereses: ReadonlyArray<{ slug: string; etiqueta: string }>;
  mensaje: string;
  mensajeAyuda: string;
  /** Etiqueta del campo trampa (invisible para personas). */
  trampa: string;
  consentimiento: { antes: string; enlace: string; despues: string };
  enviar: string;
  enviando: string;
  errores: { datos: string; aviso: string; muchos: string; red: string; otro: string };
  exito: { etiqueta: string; saludo: string; antes: string; despues: string };
}

export const FORMULARIO_DEMO = {
  titulo: "Request your demo",
  nombre: "Full name",
  email: "Work email",
  empresa: "Company",
  opcional: "optional",
  interes: "What do you want to see?",
  intereses: [
    { slug: "harmony", etiqueta: "Harmony · performance bonuses" },
    { slug: "wms", etiqueta: "Zelena WMS" },
    { slug: "otro", etiqueta: "Not sure yet" },
  ],
  mensaje: "Tell us about your operation",
  mensajeAyuda: "How many warehouses, how many people on the floor, which system you use today…",
  trampa: "Website",
  consentimiento: {
    antes: "I agree to the processing of my personal data under the ",
    enlace: "privacy notice",
    despues: " (in Spanish).",
  },
  enviar: "Book my demo",
  enviando: "Sending…",
  errores: {
    datos: "Check your name, your email and the consent box.",
    aviso: "Our privacy notice was just updated. Reload the page and try again.",
    muchos: "Too many attempts in a row. Try again in a few minutes.",
    red: "No connection. Check your network and try again.",
    otro: "We couldn’t send your request. Please try again.",
  },
  exito: {
    etiqueta: "Request received",
    saludo: "Thanks",
    antes: "We’ll write to ",
    despues: " to set up the call.",
  },
} as const satisfies TextosFormularioDemo;
