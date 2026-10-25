/**
 * Copy de la home en inglés ("/", para empresas). Todo el texto de la página vive aquí: las
 * secciones solo lo pintan.
 *
 * Decisiones del founder que este módulo debe respetar (se cambian aquí y en ningún otro
 * sitio, confirmadas el 2026-10-25): el H1 es "PERFORMANCE-BASED PAYROLL" / "FOR LATAM
 * LOGISTICS."; los años con operadores ("2 YEARS") y el país (Colombia) van como constantes
 * sueltas de este módulo; no se publica la cifra pagada, solo desde cuándo se paga; los
 * importes de ejemplo se rotulan como ejemplo; el pago a cuenta bancaria en moneda local es
 * lo que viene, no lo que ya funciona. El aviso legal de la página lo pinta el pie (copy-comun.ts).
 *
 * Hechos que sostienen el copy: Harmony paga bonos reales en USDC en la red principal de
 * Stellar desde septiembre de 2026, a la billetera de cada operador; el contrato de Soroban
 * que automatiza el reparto corre en la red de pruebas. Las maquetas (tabla semanal,
 * teléfono, importes) son ejemplos y lo dicen: ni nombres de personas ni "LIVE" sobre datos
 * inventados. Los textos van en minúscula normal; las mayúsculas las pone el CSS.
 */

/** Años construyendo con operadores logísticos. */
export const ANOS_CON_OPERADORES = "2 years";

/** Dónde operan hoy las bodegas con las que trabajamos. */
export const PAISES = "Colombia";

/** Título y descripción de la página (buscadores y vista previa al compartir). */
export const META_HOME = {
  titulo: "Zelena — Performance-based payroll for LATAM logistics",
  descripcion:
    "Zelena measures warehouse operators’ work and pays the bonus they earn in USDC on Stellar: a WMS and Harmony incentives for LATAM logistics SMEs.",
} as const;

/** Llamada principal (hero y cierre): el formulario de demo, con Harmony elegido. */
export const CTA_DEMO = { comando: "book_a_demo", nombre: "Book a demo" } as const;

export const HERO = {
  chip: "Real work, real rewards",
  /** H1 en dos líneas forzadas; "LATAM" con el resaltado lima. */
  h1: {
    linea1: "Performance-based payroll",
    antes: "for ",
    resaltado: "LATAM",
    despues: " logistics.",
  },
  parrafo: "Zelena measures your operators’ work and pays the bonus they earned in USDC, straight to their Stellar wallet.",
  /** Junto al CTA: un hecho verificable, sin iniciales de personas. */
  prueba: "Real bonuses paid on Stellar mainnet since Sept 2026",
} as const;

export const BENTO = {
  /** A: el avatar en el piso, su puntaje y el bono pagado (maqueta). */
  a: {
    aria: "Sample: an operator scores 96 this week, top 1 in picking, and gets a 20 USDC bonus, settled on Stellar in about 5 seconds.",
    muestra: "Sample",
    puntaje: "96",
    puntajeTitulo: "Score this week",
    puntajeDetalle: "picking · top 1",
    pagoTitulo: "Bonus paid · +20 USDC",
    pagoDetalle: "Measured on the floor, settled on Stellar in ~5\u00a0s.",
  },
  /** B: tabla semanal de ejemplo (sin nombres de personas). */
  b: {
    aria: "Sample weekly leaderboard: three operators scored 96, 91 and 88 and earned bonuses of 20, 18 and 17 USDC.",
    titulo: "This week · Sample warehouse",
    muestra: "Sample",
    filas: [
      { nombre: "Operator 01", puntaje: "96", bono: "+20 USDC" },
      { nombre: "Operator 02", puntaje: "91", bono: "+18 USDC" },
      { nombre: "Operator 03", puntaje: "88", bono: "+17 USDC" },
    ],
  },
  /** C: el lema sobre lima, en dos líneas. */
  c: { linea1: "Fair, fast", linea2: "and verifiable." },
  /** D: la cifra de años y las seis píldoras inclinadas. */
  d: {
    cifra: ANOS_CON_OPERADORES,
    texto: "building alongside real logistics operators in Colombia.",
    pastillasAria: "What Zelena is",
    pastillas: ["Logistics SMEs", "Payroll", "USDC payouts", "On Stellar mainnet", "WMS", PAISES],
  },
} as const;

export interface PuntoProducto {
  texto: string;
  /** Lo que todavía no funciona: se pinta con otra viñeta, como lo que viene. */
  siguiente?: boolean;
}

export const PRODUCTOS = {
  eyebrow: "$ zelena products",
  h2: { linea1: "Measure the work.", linea2: "Pay the bonus." },
  intro: "One clear loop: what your operators do gets measured, and what gets measured gets paid.",
  medir: {
    n: "01",
    estado: "Live now",
    titulo: "We measure the work",
    puntos: [
      { texto: "Our WMS tracks every order, task and operator in real time." },
      { texto: "Performance scored from real work, not opinions." },
      { texto: "Built with real warehouses in Colombia." },
    ] as readonly PuntoProducto[],
  },
  pagar: {
    n: "02",
    estado: "Live on Stellar mainnet",
    titulo: "We pay the bonus",
    puntos: [
      { texto: "The bonus is calculated automatically from the score." },
      { texto: "Paid in USDC straight to each operator’s Stellar wallet." },
      { texto: "Next: bank cash-out in local currency, via Stellar anchors.", siguiente: true },
    ] as readonly PuntoProducto[],
  },
} as const;

export const HARMONY = {
  eyebrow: "The heart of Zelena",
  h2: "Harmony",
  subtitulo: "Performance-based payroll your team can see.",
  texto:
    "Operators see their score and their bonus grow with every task. Owners see exactly what they pay and why. Same numbers, for everyone.",
  etiquetas: ["real_work", "real_rewards"],
  telefono: {
    aria: "Sample screen of the operator app: score 96 this week, top 1 in picking, a 20 USDC bonus sent to the operator’s Stellar wallet, 412 orders picked and 99.2% accuracy.",
    saludo: "Hi, operator",
    marca: "Harmony",
    puntaje: "96",
    puntajeTitulo: "Score this week",
    puntajeDetalle: "Top 1 · Picking",
    bonoTitulo: "Bonus earned",
    bonoCifra: "20",
    bonoUnidad: "USDC",
    bonoDestino: "sent to your Stellar wallet",
    filas: [
      { clave: "Orders picked", valor: "412" },
      { clave: "Accuracy", valor: "99.2%" },
    ],
  },
  pieTelefono: "Sample screen · illustrative data",
} as const;

export const COMO_FUNCIONA = {
  /** id de la sección (enlazable como /#how-it-works). */
  ancla: "how-it-works",
  etiqueta: "how it works",
  h2: { linea1: "From measured work", linea2: "to a paid bonus." },
  intro: "Four steps, one story: set the rules, fund the bonus, measure the work, pay in USDC.",
  pasos: [
    { n: "01", titulo: "Set the rules", texto: "The company decides what performance earns a bonus, and for which period." },
    { n: "02", titulo: "Fund the bonus", texto: "The company commits the bonus for the period up front. No one works for a promise." },
    { n: "03", titulo: "Measure the work", texto: "Every task is tracked and scored by quantity and quality." },
    { n: "04", titulo: "Pay in USDC", texto: "Each bonus lands in the worker’s Stellar wallet, in USDC, in seconds." },
  ],
  /** La nota manuscrita del tablero (decorativa). */
  nota: "ready to get paid!",
} as const;

export type ClaveMoneda = "COP" | "MXN" | "ARS";

/** Textos del flujo de pagos (isla de cliente): solo cadenas, se pasan como props. */
export interface TextosFlujoPagos {
  leyendaMoneda: string;
  monedas: ReadonlyArray<{ clave: ClaveMoneda; equivalente: string }>;
  aproximado: string;
  etiquetaPruebas: string;
  nodos: ReadonlyArray<{ n: string; titulo: string; valor: string; tiempo: string; enPruebas?: boolean }>;
  /** Anuncio para lectores de pantalla al cambiar de moneda: "{anuncio} {equivalente}." */
  anuncio: string;
  controles: { pausar: string; seguir: string; repetir: string };
}

export const PAGOS = {
  eyebrow: "$ zelena pay --network stellar",
  h2: { linea1: "From score to wallet", linea2: "in seconds." },
  intro:
    "The bonus leaves in digital dollars (USDC) and settles in the worker’s Stellar wallet in seconds, with network fees under a cent.",
  flujo: {
    leyendaMoneda: "Approximate local value",
    // Tasas de ejemplo (unos 4.100 COP, 18,5 MXN y 1.450 ARS por dólar): se rotulan como aproximadas.
    monedas: [
      { clave: "COP", equivalente: "≈ COP 82,000" },
      { clave: "MXN", equivalente: "≈ MXN 370" },
      { clave: "ARS", equivalente: "≈ ARS 29,000" },
    ],
    aproximado: "approx.",
    etiquetaPruebas: "Testnet",
    nodos: [
      { n: "01", titulo: "Company pool", valor: "US$ 800", tiempo: "0 s" },
      { n: "02", titulo: "Soroban splits", valor: "40 people", tiempo: "+1 s", enPruebas: true },
      { n: "03", titulo: "Stellar settles", valor: "USDC", tiempo: "+3 s" },
      { n: "04", titulo: "Worker’s wallet", valor: "20 USDC", tiempo: "+5 s" },
    ],
    anuncio: "Each worker receives 20 USDC, worth about",
    controles: { pausar: "pause", seguir: "play", repetir: "replay" },
  } satisfies TextosFlujoPagos,
  siguiente: {
    etiqueta: "Next",
    texto: "Cash-out to a bank account in local currency, via Stellar anchors.",
  },
  comparacion: {
    antes: {
      titulo: "Traditional bonus run",
      datos: [
        { valor: "Weeks", texto: "until payday" },
        { valor: "Spreadsheets", texto: "nobody can check" },
      ],
    },
    despues: {
      titulo: "With Zelena + Stellar",
      datos: [
        { valor: "~5\u00a0sec", texto: "to settle on Stellar" },
        { valor: "<\u00a01¢", texto: "network fee" },
      ],
    },
  },
  nota: "Sample amounts and approximate exchange rates. Bonus payouts run in USDC on Stellar mainnet since September 2026; the automatic split contract runs on the Stellar testnet.",
  notaEnlace: "See our testnet contracts and transactions",
} as const;

export const MANIFIESTO = {
  eyebrow: "$ cat manifesto.md",
  h2: { linea1: "We’re redesigning", antes: "how we ", resaltado: "collaborate." },
  pilares: [
    {
      n: "I · The work",
      titulo: "We grade deliveries, not people.",
      texto: "What you deliver speaks for you, and what you earn can’t be taken away.",
    },
    {
      n: "II · The community",
      titulo: "Everything in the open.",
      texto: "Budgets, criteria and decisions. You compete with yourself first, and leaving well counts too.",
    },
    {
      n: "III · How we build",
      titulo: "Real comes first.",
      texto: "Technology you don’t notice. Trust is earned in stages.",
    },
  ],
  cta: { comando: "read_the_manifesto", nombre: "Read the manifesto" },
  comunidad: "Meet the community",
} as const;

export const CIERRE = {
  eyebrow: "$ zelena demo --book",
  h2: "Bring performance-based payroll to your warehouse.",
  texto: "Book a demo and see how Zelena measures the work and pays the bonus in USDC on Stellar.",
} as const;
