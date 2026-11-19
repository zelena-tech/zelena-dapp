/**
 * Copy del contacto en español (/empresas/contacto), con el diseño de zelena.tech: a donde
 * llevan "Hablemos" y cada "Quiero esta solución" de la inicio y de los incentivos. Antes
 * era la página del diseño oscuro viejo (pedido del founder, 2026-11-17: nada del diseño
 * viejo). Mismas piezas que "Book a demo" (HeroDemo, FormularioDemo y PasosDemo), con el
 * texto en español; la solicitud entra por la misma API (POST /api/empresas/contacto).
 *
 * Sin plazos inventados: prometer "respuesta en 24 h" es un SLA público que el equipo
 * tendría que sostener. Los intereses son los de lib/servicios.ts (la API los valida).
 * Importa con rutas relativas (no "@/") para que los tests de vitest puedan leerlo.
 */
import { INTERESES } from "../../src/lib/servicios";
import { ENLACES_EMPRESAS } from "./copy-empresas";
import type { TextosFormularioDemo, TextosHeroDemo, TextosPasosDemo } from "./copy-demo";

/** Título y descripción de la página (buscadores y vista previa al compartir). */
export const META_CONTACTO = {
  titulo: "Hablemos · Zelena",
  descripcion:
    "Cuéntanos qué está pasando en tu empresa y te proponemos por dónde empezar: productos propios, incentivos para tu equipo y servicios de tecnología.",
} as const;

export const HERO_CONTACTO: TextosHeroDemo = {
  chip: "Hablemos",
  /** H1 en dos líneas forzadas; "empresa" con el resaltado lima. */
  h1: {
    linea1: "Cuéntanos qué",
    antes: "pasa en tu ",
    resaltado: "empresa",
    despues: ".",
  },
  parrafo:
    "Primero te escuchamos. Después te proponemos por dónde empezar, sobre tu caso y no con una presentación genérica.",
  agendaTitulo: "En la conversación",
  agenda: [
    "Entendemos cómo opera tu empresa hoy y qué sistemas usa.",
    "Te mostramos solo lo que aplica a tu caso: productos, servicios o incentivos.",
    "Te proponemos un primer paso, por etapas y con alcance claro.",
  ],
};

/** Qué pasa después de enviar: los mismos tres pasos que "Book a demo". */
export const PASOS_CONTACTO: TextosPasosDemo = {
  titulo: "Qué pasa después",
  pasos: [
    { n: "01", titulo: "Nos cuentas", texto: "Qué hace tu empresa, cuántas personas son y qué sistemas usan hoy." },
    { n: "02", titulo: "Conversamos", texto: "Una llamada corta para entender la operación antes de proponer nada." },
    { n: "03", titulo: "Te proponemos", texto: "Por dónde empezar, sobre tu caso, con lo que de verdad aplica." },
  ],
  /** Para quien todavía no quiere escribir: los servicios de la inicio. */
  enlace: { nombre: "Ver los servicios primero", href: ENLACES_EMPRESAS.servicios },
};

export const FORMULARIO_CONTACTO: TextosFormularioDemo = {
  titulo: "Escríbenos",
  nombre: "Nombre completo",
  email: "Correo de trabajo",
  empresa: "Empresa",
  opcional: "opcional",
  interes: "¿Qué te interesa?",
  intereses: INTERESES.map((i) => ({ slug: i.slug, etiqueta: i.nombre })),
  mensaje: "Cuéntanos qué está pasando",
  mensajeAyuda: "Qué hace tu empresa, cuántas personas son, qué sistemas usan hoy…",
  trampa: "Sitio web",
  consentimiento: {
    antes: "Autorizo el tratamiento de mis datos personales según el ",
    enlace: "aviso de privacidad",
    despues: ".",
  },
  enviar: "Enviar",
  enviando: "Enviando…",
  errores: {
    datos: "Revisa tu nombre, tu correo y la casilla de autorización.",
    aviso: "El aviso de privacidad se acaba de actualizar. Recarga la página e inténtalo de nuevo.",
    muchos: "Demasiados intentos seguidos. Inténtalo de nuevo en unos minutos.",
    red: "Sin conexión. Revisa tu red e inténtalo de nuevo.",
    otro: "No pudimos enviar tu mensaje. Inténtalo de nuevo.",
  },
  exito: {
    etiqueta: "Mensaje recibido",
    saludo: "Gracias",
    antes: "Te escribimos a ",
    despues: " para coordinar la conversación.",
  },
};

/** El interés que pide el enlace (?interes=wms), si el formulario lo ofrece; si no, ninguno. */
export function interesContacto(pedido: string | undefined): string {
  return FORMULARIO_CONTACTO.intereses.some((i) => i.slug === pedido) ? (pedido as string) : "";
}
