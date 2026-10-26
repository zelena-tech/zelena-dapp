/**
 * Copy de la home en inglés ("/", para empresas). Todo el texto de la página vive aquí: las
 * secciones solo lo pintan.
 *
 * Decisiones del founder que este módulo debe respetar (se cambian aquí y en ningún otro
 * sitio, confirmadas el 2026-10-25): el H1 es "PERFORMANCE-BASED PAYROLL" / "FOR LATAM
 * LOGISTICS."; los años con operadores ("2 YEARS") y el país (Colombia) van como constantes
 * sueltas de este módulo; no se publica la cifra pagada, solo desde cuándo se paga; los
 * importes de ejemplo se rotulan como ejemplo; el pago a cuenta bancaria en moneda local es
 * lo que viene, no lo que ya funciona; los clientes que salen con logo son los que el founder
 * autorizó (CLIENTES), rotulados como "algunos" de nuestros clientes y no como la lista entera.
 *
 * Hechos que sostienen el copy: Harmony calcula el reparto del bono y lo paga en USDC en la
 * red principal de Stellar desde septiembre de 2026, con pagos directos a la billetera de
 * cada operador. El contrato de Soroban del reparto (Organization/Factory) sigue en la red de
 * pruebas: verificado el 2026-10-26, la cuenta pagadora en la red principal no invoca
 * contratos y el README de Harmony dice "Not deployed on mainnet". Por eso el flujo de pagos
 * nombra a Harmony y no a Soroban, y nada de la home se rotula "Testnet". Las maquetas (tabla semanal,
 * teléfono, importes) son ejemplos y lo dicen: ni nombres de personas ni "LIVE" sobre datos
 * inventados. Los textos van en minúscula normal; las mayúsculas las pone el CSS.
 *
 * Sin la voz de terminal (las indicaciones de consola de "zelena products" o "zelena pay")
 * sobre los titulares de la home: el founder la quitó el 2026-10-26 porque metía ruido. Ese
 * mismo día salieron MXN y ARS: el valor local de ejemplo del flujo de pagos va solo en pesos
 * colombianos (la cobertura de hoy es Colombia), sin selector de moneda.
 */

/** Años construyendo con operadores logísticos. */
export const ANOS_CON_OPERADORES = "2 years";

/** Dónde operan hoy las bodegas con las que trabajamos. */
export const PAISES = "Colombia";

/** Título y descripción de la página (buscadores y vista previa al compartir). */
export const META_HOME = {
  titulo: "Zelena — Performance-based payroll for LATAM logistics",
  descripcion:
    "Performance-based payroll and incentives for LATAM logistics: Zelena measures your warehouse operators’ work and pays the bonus they earn in USDC, on Stellar.",
} as const;

/** Llamada principal (hero y cierre): la página de la demo (/book-a-demo, copy-demo.ts). */
export const CTA_DEMO = { nombre: "Book a demo" } as const;

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

/**
 * Clientes que salen con logo en la home, con su Instagram. Autorizados por el founder el
 * 2026-10-25: por eso sus nombres ya no están en la lista de nombres privados del repo.
 * Salen como fotos de perfil (círculos a color, sin rótulos): el clic abre su Instagram en
 * otra pestaña.
 */
export const CLIENTES = [
  { nombre: "Bloomshell", instagram: "bloomshell_cosmetics", logo: "clienteBloomshell" },
  { nombre: "Montoc", instagram: "montoccosmetictools", logo: "clienteMontoc" },
  { nombre: "Burbay", instagram: "burbaybeauty", logo: "clienteBurbay" },
] as const;

/** El bloque de clientes del hero: los años con empresas y un círculo por cliente. */
export const BLOQUE_CLIENTES = {
  etiqueta: "Some of our clients",
  cifra: ANOS_CON_OPERADORES,
  texto: `impacting companies in ${PAISES}.`,
  logosAria: "Companies we work with",
  /** Nombre accesible (y title) de cada enlace: "{nombre} on Instagram". */
  enInstagram: "on Instagram",
} as const;

export interface PuntoProducto {
  texto: string;
  /** Lo que todavía no funciona: se pinta con otra viñeta, como lo que viene. */
  siguiente?: boolean;
}

export const PRODUCTOS = {
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

/** Textos del flujo de pagos (isla de cliente): solo cadenas, se pasan como props. */
export interface TextosFlujoPagos {
  /** Valor aproximado en moneda local del último nodo (solo COP: la cobertura es Colombia). */
  equivalente: string;
  aproximado: string;
  nodos: ReadonlyArray<{ n: string; titulo: string; valor: string; tiempo: string }>;
  controles: { pausar: string; seguir: string; repetir: string };
}

export const PAGOS = {
  h2: { linea1: "From score to wallet", linea2: "in seconds." },
  intro:
    "The bonus leaves in digital dollars (USDC) and settles in the worker’s Stellar wallet in seconds, with network fees under a cent.",
  flujo: {
    // Tasa de ejemplo (unos 4.100 COP por dólar): se rotula como aproximada.
    equivalente: "≈ COP 82,000",
    aproximado: "approx.",
    nodos: [
      { n: "01", titulo: "Company pool", valor: "US$ 800", tiempo: "0 s" },
      { n: "02", titulo: "Harmony splits", valor: "40 people", tiempo: "+1 s" },
      { n: "03", titulo: "Stellar settles", valor: "USDC", tiempo: "+3 s" },
      { n: "04", titulo: "Worker’s wallet", valor: "20 USDC", tiempo: "+5 s" },
    ],
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
  nota: "Sample amounts and approximate exchange rates. Bonus payouts run in USDC on Stellar mainnet since September 2026.",
} as const;

export const MANIFIESTO = {
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
      texto: "Technology you don’t notice. Trust is earned step by step.",
    },
  ],
  cta: { nombre: "Read the manifesto" },
  comunidad: "Meet the community",
} as const;

export const CIERRE = {
  h2: "Bring performance-based payroll to your warehouse.",
  texto: "Book a demo and see how Zelena measures the work and pays the bonus in USDC on Stellar.",
} as const;
