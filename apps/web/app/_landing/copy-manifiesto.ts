/**
 * Copy del manifiesto en inglés ("/manifiesto"). Desde 2026-10-26 la página va con el cromo
 * y el diseño de la landing (pedido del founder): es la traducción fiel del manifiesto en
 * español, con su misma estructura (origen, la creencia, nueve principios en tres grupos y
 * la invitación). Los titulares de los pilares dicen lo mismo que los de la home y de
 * /comunidad (copy-home.ts y copy-comunidad.ts): si uno cambia, cambian los tres.
 *
 * Valores y filosofía, no estructura: aquí no se explica la forma legal ni la mecánica de la
 * comunidad (eso vive en /metodo y /comunidad). Los textos van en minúscula normal; las
 * mayúsculas las pone el CSS.
 */
import { ENLACES } from "./copy-comun";

/** Título y descripción de la página (buscadores y vista previa al compartir). */
export const META_MANIFIESTO = {
  titulo: "Manifesto — Zelena",
  descripcion:
    "What we believe: what you deliver should decide what you get. The principles that guide Zelena at work, in the community and in the way we build.",
} as const;

export const APERTURA = {
  chip: "Manifesto",
  /** H1 en dos líneas forzadas; "collaborate." con el resaltado lima (como en /comunidad). */
  h1: { linea1: "We’re redesigning", antes: "how we ", resaltado: "collaborate." },
  origenTitulo: "Where we come from",
  origen: [
    "Zelena was born on a warehouse floor. For two years we built software side by side with logistics operators in Latin America, for companies that ran on paper, WhatsApp and Excel.",
    "There we learned something no spreadsheet showed: the work of the people who pick, pack and ship is almost never seen. And what isn’t seen isn’t recognized.",
    "Then we looked at ourselves. We weren’t measuring what each person on our own team contributed either. So we decided to take our own medicine.",
  ],
} as const;

export const CREENCIA = {
  etiqueta: "What we believe",
  frase: "We believe something simple: what you deliver should decide what you get.",
  enfasis: "Not your title. Not your seniority. Not your hours.",
  nota: "Our principles come from that idea. They aren’t rigid rules: they’re what we try to cultivate every day, in the warehouse and in the community. We group them in three.",
} as const;

export interface GrupoPrincipios {
  num: string;
  nombre: string;
  titulo: string;
  enfasis: string;
  intro: string;
  principios: ReadonlyArray<{ n: string; t: string; d: string }>;
}

export const GRUPOS: readonly GrupoPrincipios[] = [
  {
    num: "I",
    nombre: "The work",
    titulo: "So that what you do",
    enfasis: "counts.",
    intro:
      "It all starts with what someone does with their hands or their head. These principles make sure that work carries weight.",
    principios: [
      {
        n: "01",
        t: "What you deliver speaks for you.",
        d: "Your reputation shouldn’t live in a CV nobody can verify. Here every delivery is recorded under your name: what you did, how you did it and who received it. Over time, that record says more than any title.",
      },
      {
        n: "02",
        t: "We grade deliveries, not people.",
        d: "A delivery can turn out better or worse. A person is not their worst day. We measure the work, talk it through and improve it, but we don’t put labels on people. There’s no such thing as “low performance” here: there’s the next delivery.",
      },
      {
        n: "03",
        t: "What you earn can’t be taken away.",
        d: "The recognition you earned is yours. It isn’t confiscated, it doesn’t expire after a bad month and it doesn’t depend on anyone’s mood. That’s the only way effort is worth it: when what you build can’t be erased.",
      },
    ],
  },
  {
    num: "II",
    nombre: "The community",
    titulo: "Nobody builds",
    enfasis: "alone.",
    intro:
      "The community isn’t a place where work gets handed out. It’s the network of people who teach each other, push each other and look out for each other.",
    principios: [
      {
        n: "04",
        t: "Everything in the open.",
        d: "Every project is published with its scope, its budget and how it will be measured. No closed-door assignments and no favorites. When the rules are visible, trust stops being an act of faith.",
      },
      {
        n: "05",
        t: "You compete with yourself first.",
        d: "Every leaderboard shows your own progress right beside it. The goal isn’t to beat whoever is next to you: it’s to beat last month’s version of you. Others are a reference, not a threat.",
      },
      {
        n: "06",
        t: "Leaving well counts too.",
        d: "People change course, and that’s fine. Whoever leaves doesn’t lose what they built: their record stays intact and the door stays open. A community that punishes leaving teaches people to leave badly.",
      },
    ],
  },
  {
    num: "III",
    nombre: "How we build",
    titulo: "Foundations that",
    enfasis: "last.",
    intro:
      "For this to grow without breaking, we need solid foundations. These principles look after how we decide and how we move forward.",
    principios: [
      {
        n: "07",
        t: "Real comes first.",
        d: "We build from real operations, with real people, before we build from a slide deck. Whatever is still a hypothesis, we call a hypothesis, out loud. A community built on inflated expectations doesn’t last.",
      },
      {
        n: "08",
        t: "Technology you don’t notice.",
        d: "The complexity is ours, not the problem of whoever uses what we make. Nobody should have to understand how the system works to receive what they earned. If the technology needs explaining, it isn’t finished yet.",
      },
      {
        n: "09",
        t: "Trust is earned step by step.",
        d: "We don’t promise to hand out all the power from day one. We open it up as the community shows it can hold it. Autonomy is the reward for maturity, not the starting point.",
      },
    ],
  },
];

export const INVITACION = {
  /** Dos líneas forzadas. */
  titulo: { linea1: "This is only", linea2: "the beginning." },
  textos: [
    "Zelena is an experiment under continuous construction. Everyone who arrives adds something that wasn’t there and helps define what we can achieve together.",
    "If you believe work done well deserves to be seen, there’s a place for you. It doesn’t matter whether you code, design, run a warehouse or just want to build.",
  ],
  cierre: "Bring your craft and your curiosity.",
  /** Los proyectos abiertos de /comunidad (en inglés) y los encuentros (en español). */
  proyectos: { nombre: "Explore open projects", href: ENLACES.proyectosAbiertos },
  encuentros: { nombre: "Come to a meetup", href: ENLACES.encuentros },
} as const;
