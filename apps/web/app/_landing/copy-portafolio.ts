/**
 * Copy de la inicio (zelena.tech/): el portafolio de soluciones, en español y con el cromo
 * claro de la landing. La historia va en tres tiempos (pedido del founder, 2026-11-17): la
 * frase de gancho, a quiénes hemos impactado y los servicios. Después, cómo trabajamos,
 * colaborar (con el manifiesto) y el cierre. Se le habla a "tu negocio" o "tu empresa",
 * nunca a "tu pyme" (pedido del founder): nadie se presenta a sí mismo como pyme.
 *
 * El recurso visual es TACHAR: en el titular se tacha "complicarte", y quien visita tacha
 * en los servicios lo que le pasa hoy (una fila de píldoras, no una lista larga: la lista
 * hacía eterno llegar a los servicios).
 *
 * Lo que se afirma sale de lo que el sitio ya sostiene: dos años construyendo con
 * operaciones reales en Colombia (copy-home.ts) y los clientes que el founder autorizó a
 * mostrar (CLIENTES, también de copy-home.ts). Nada de cifras de impacto inventadas.
 * Mismas reglas que el resto del copy público (copy-comun.ts, sitio-publico.test.ts).
 * `interes` es el slug que entiende el formulario de contacto (lib/servicios.ts).
 */
import { ENLACES_EMPRESAS, contactoCon } from "./copy-empresas";
export const META_PORTAFOLIO = {
  titulo: "Zelena · Tecnología para mejorar tu negocio",
  descripcion:
    "Tecnología para mejorar tu negocio: dos productos propios (ZELENA WMS y ZELENA Social Listening), un programa de incentivos en dólares digitales y seis servicios, incluido el desarrollo a la medida.",
} as const;

export const HERO_PORTAFOLIO = {
  chip: "Tecnología para empresas",
  h1: {
    linea1: "Tecnología para",
    /** Se ve tachado y es decorativo: el lector de pantalla oye "Tecnología para mejorar tu negocio." */
    tachado: "complicarte",
    resaltado: "mejorar tu negocio.",
  },
  lead:
    "Bodega, ERP, datos, nube, redes sociales e incentivos para tu equipo: la tecnología que usan las grandes empresas, a la medida del tamaño, el presupuesto y el ritmo de tu negocio.",
  primario: { href: "#servicios", nombre: "Ver los servicios" },
  secundario: { href: ENLACES_EMPRESAS.contacto, nombre: "Hablemos" },
} as const;

/**
 * A quiénes hemos impactado, en un bloque de tinta: con quién ya trabajamos y desde
 * cuándo. Los clientes son los de la home (CLIENTES de copy-home.ts), los que el founder
 * autorizó a mostrar; aquí solo va el texto que los acompaña.
 */
export const IMPACTO = {
  ancla: "impacto",
  titulo: "A quiénes hemos impactado.",
  historia:
    "Llevamos dos años construyendo junto a operaciones reales en Colombia. Nuestros productos se hicieron dentro de empresas de verdad, con los problemas de todos los días.",
  clientes: "Algunas de las empresas con las que trabajamos",
  enInstagram: "en Instagram",
  otraPestana: "(se abre en otra pestaña)",
  paraQuien:
    "Trabajamos con empresas de 10 a 200 personas que necesitan ordenar su operación y crecer: inventario, despachos, gestión y presencia digital.",
} as const;

/**
 * "Tacha lo que te pasa", dentro de los servicios: una fila de píldoras. Cada una es un
 * botón; al tacharla, las líneas que lo resuelven se marcan "Para ti" en la rejilla.
 */
export const SITUACION = {
  pregunta: "¿Qué te pasa hoy?",
  instruccion: "Tacha lo que se parezca a tu empresa y te marcamos por dónde empezar.",
  recomendamos: "Para lo que tachaste",
  borrar: "Quitar lo tachado",
  listaAria: "Situaciones de tu empresa",
} as const;

export const PORTAFOLIO = {
  ancla: "servicios",
  h2: { linea1: "Todo lo que hacemos", antes: "por tu negocio.", enfasis: "" },
  intro: "Contrata solo lo que necesitas. Cada servicio funciona por sí solo y todos se conectan entre sí.",
  filtroAria: "Filtrar el portafolio",
  filtros: [
    { valor: "Todo", nombre: "Todo" },
    { valor: "Producto", nombre: "Productos" },
    { valor: "Programa", nombre: "Incentivos" },
    { valor: "Servicio", nombre: "Servicios" },
  ],
  verDetalle: "Ver detalle",
  recomendada: "Para ti",
} as const;

export const FICHA = {
  cerrar: "Cerrar",
  anterior: "Anterior",
  siguiente: "Siguiente",
  pestanasAria: "Secciones de la ficha",
  que: "Qué es",
  paraQuien: "Para quién",
  resuelve: "Qué resuelve",
  incluye: "Qué incluye",
  configuraciones: "Configuraciones",
  configuracionesIntro: "Puntos de partida según el tipo de empresa. Elige uno:",
  beneficiosYModalidad: "Beneficios y modalidad",
  beneficios: "Beneficios",
  modalidad: "Modalidad",
  soporte: "Soporte",
  paginaCompleta: "Ver la página completa",
  quiero: "Quiero esta solución",
} as const;

export const CICLO = {
  ancla: "como-trabajamos",
  h2: { linea1: "El mismo ciclo", antes: "en todas las líneas.", enfasis: "" },
  intro: "Cuatro pasos, una sola forma de trabajar. Por eso un servicio abre la puerta al siguiente.",
} as const;

/**
 * La parte de colaborar: democratizar la tecnología también es abrir el trabajo. Tres
 * puertas, y el manifiesto es una de ellas (pedido del founder: "falta el manifiesto").
 * Dice lo mismo que /comunidad y /manifiesto, y nada más: ni cifras, ni pagos, ni la red.
 * Todas llevan a páginas con el diseño de zelena.tech (pedido del founder: nada del diseño
 * viejo); la comunidad y el manifiesto están en inglés y se marcan con hrefLang.
 */
export const COLABORAR = {
  ancla: "colaborar",
  h2: { linea1: "Rediseñamos la forma", antes: "de colaborar.", enfasis: "" },
  intro:
    "Abrir la tecnología también es abrir el trabajo. Zelena es una comunidad con reglas públicas, trabajo por hitos y un historial que es de quien lo construye.",
  puertas: [
    {
      t: "Trae una necesidad",
      d: "Un problema real de tu empresa se vuelve un proyecto con alcance, hitos y forma de evaluación, a la vista de todos.",
      href: contactoCon("a-la-medida"),
      enlace: "Contarnos tu idea",
      enIngles: false,
    },
    {
      t: "Construye con nosotros",
      d: "Súmate a la comunidad: proyectos con alcance claro, entregas por hitos y un historial que es tuyo.",
      href: ENLACES_EMPRESAS.comunidad,
      enlace: "Conocer la comunidad",
      enIngles: true,
    },
    {
      t: "Lee el manifiesto",
      d: "Lo que creemos: lo que entregas decide lo que recibes. Se califica la entrega, nunca a la persona.",
      href: ENLACES_EMPRESAS.manifiesto,
      enlace: "Leer el manifiesto",
      enIngles: true,
    },
  ],
} as const;

export const CIERRE_PORTAFOLIO = {
  titulo: { linea1: "La misma tecnología,", linea2: "a la medida de tu negocio." },
  texto:
    "El tamaño de una empresa no debería decidir la tecnología que puede usar. Cuéntanos qué está pasando en la tuya y te proponemos por dónde empezar.",
  primario: { href: ENLACES_EMPRESAS.contacto, nombre: "Hablemos" },
  secundario: { href: ENLACES_EMPRESAS.incentivos, nombre: "Ver los incentivos" },
} as const;

export type TipoLinea = "Producto" | "Servicio" | "Programa";

export interface Linea {
  id: string;
  tipo: TipoLinea;
  icono: string; // trazos SVG (viewBox 24) — se pintan con stroke=currentColor
  nombre: string;
  corto: string;
  entrada: string;
  que: string;
  para: string;
  resuelve: string;
  incluye: string[];
  beneficios: string;
  extra?: { etiqueta: string; texto: string };
  configuraciones?: Array<{ nombre: string; para: string; alcance: string }>;
  modalidad: string;
  soporte: string;
  interes: string;
  /** Página propia, cuando la línea tiene una. */
  enlace?: string;
}

export const LINEAS: Linea[] = [
  {
    id: "wms",
    tipo: "Producto",
    icono: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/>',
    nombre: "ZELENA WMS",
    corto: "Controlamos el ciclo completo de la bodega desde una sola plataforma.",
    entrada:
      "Nuestro sistema propio de gestión de bodegas: cada producto con su ubicación, cada operario sabe qué hacer y cada despacho se valida.",
    que: "Sistema de gestión de bodegas (WMS) en la nube, desarrollado por ZELENA.",
    para: "Empresas cuya bodega es el corazón del negocio: distribuidores con alto volumen, e-commerce con picos y operadores logísticos.",
    resuelve:
      "Inventario que no cuadra, errores al alistar y despachar, dependencia de personas que «saben dónde está todo» y baja productividad.",
    incluye: [
      "Instancia dedicada para tu empresa",
      "Recepción, ubicaciones y traslados",
      "Picking con ruta optimizada",
      "Verificación y despacho",
      "Conteos sin detener la operación",
      "Desempeño por operario",
    ],
    beneficios:
      "Inventario exacto, despachos sin errores, operarios nuevos productivos en menos tiempo y visibilidad total de la bodega.",
    extra: { etiqueta: "Se conecta con", texto: "Odoo y otros ERP como Siigo, World Office o SAP Business One." },
    modalidad: "Implementación + mensualidad",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "wms",
  },
  {
    id: "incentivos",
    tipo: "Programa",
    icono: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5C14.6 8.6 13.5 8 12 8C10.3 8 9 8.9 9 10.2C9 13 15 11.6 15 14.2C15 15.3 13.7 16 12 16C10.5 16 9.4 15.4 9 14.5M12 6V8M12 16V18"/>',
    nombre: "Incentivos en Dólares Digitales",
    corto: "Reconocemos el desempeño real de tu equipo con un incentivo que también sirve para ahorrar.",
    entrada:
      "Un programa de incentivos ligado a lo que el equipo de verdad hace en la operación, pagado en dólares digitales.",
    que: "Harmony, nuestro programa de incentivos por desempeño: las reglas se definen antes, el resultado se mide en la operación y cada persona recibe su incentivo en dólares digitales.",
    para: "Empresas que ya miden su operación —o van a medirla con ZELENA WMS— y quieren reconocer a su equipo con reglas claras.",
    resuelve:
      "Alta rotación, incentivos manuales que se abandonan, bonos decididos a ojo y equipos que no sienten suyo el resultado.",
    incluye: [
      "Diseño de las reglas del incentivo con tu equipo directivo",
      "Medición automática desde la operación",
      "Cierre por periodo con resultados visibles para cada persona",
      "Pago en dólares digitales (USDC) a la billetera de cada persona",
    ],
    beneficios:
      "Una herramienta de ahorro para tu equipo, más productividad donde se mide el trabajo y un sentido de pertenencia que se nota en la rotación.",
    extra: { etiqueta: "Importante", texto: "El incentivo es adicional al salario: nunca lo reemplaza." },
    modalidad: "Se diseña con cada empresa, por periodos",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "harmony",
    enlace: "/empresas/incentivos",
  },
  {
    id: "social",
    tipo: "Producto",
    icono: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.8A8 8 0 1 1 21 12z"/><path d="M8.5 13.5l2-2.5 2 2 3-3.5"/>',
    nombre: "ZELENA Social Listening",
    corto: "Medimos tus campañas con creadores de contenido y lo que la gente dice de tu marca.",
    entrada:
      "Nuestra plataforma para seguir, semana a semana, las campañas con creadores de contenido en Instagram y TikTok, con su histórico y sus comentarios.",
    que: "Plataforma de inteligencia digital desarrollada por ZELENA: captura las métricas de las publicaciones de tus campañas, guarda su histórico y ordena lo que la gente comenta.",
    para: "Marcas que trabajan con creadoras e influenciadores y hoy siguen sus campañas en un Excel.",
    resuelve:
      "Métricas copiadas a mano y sin histórico, metas que nadie revisa y un presupuesto que se reparte sin saber qué creadoras y qué contenidos funcionan.",
    incluye: [
      "Captura automática de vistas, likes y comentarios en Instagram y TikTok",
      "Histórico por publicación, por creadora y por campaña",
      "Metas por creadora y por campaña",
      "Gestión de creadoras: contacto, estado y tipo de colaboración",
      "Comentarios clasificados con inteligencia artificial",
      "Tableros para gerencia, con permisos por rol",
    ],
    beneficios:
      "Saber qué creadoras y qué contenidos funcionan, con datos de varias semanas y no de una foto, para invertir mejor el presupuesto de cada campaña.",
    extra: {
      etiqueta: "Sin riesgo para tu cuenta",
      texto: "Solo se leen publicaciones públicas: la cuenta de tu marca nunca se conecta a herramientas no oficiales.",
    },
    modalidad: "Implementación + mensualidad",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "social-listening",
  },
  {
    id: "odoo",
    tipo: "Servicio",
    icono: '<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M12 11l8-4.5M12 11v9M12 11L4 6.5"/>',
    nombre: "Implementación Odoo",
    corto: "Un solo sistema para ventas, compras, inventario, contabilidad y factura electrónica DIAN.",
    entrada: "Implementamos y sostenemos Odoo, configurado según el tipo de empresa, sobre una base ya validada.",
    que: "ERP Odoo (versión 19 Enterprise) configurado y adaptado por ZELENA para empresas colombianas.",
    para: "Empresas que hoy trabajan con Excel y un software contable (Siigo, Alegra, World Office) o con un ERP antiguo.",
    resuelve:
      "Información en varios sistemas que no se hablan: doble digitación, inventario que no coincide con la contabilidad, cierres lentos y gerencia sin datos.",
    incluye: [
      "Parametrización por módulo",
      "Migración de catálogo y datos maestros",
      "Configuración contable y factura electrónica DIAN",
      "Capacitación por área",
      "Acompañamiento en la salida en vivo",
    ],
    beneficios:
      "Todo el negocio en un sistema, cumplimiento DIAN, inventario valorizado en tiempo real y tableros para la gerencia.",
    configuraciones: [
      { nombre: "Esencial", para: "Empresas pequeñas que salen de Excel", alcance: "Ventas, compras, inventario, contabilidad y factura electrónica." },
      { nombre: "Distribución", para: "Distribuidores y mayoristas", alcance: "Escáner en bodega, varias bodegas, listas de precios por cliente, CRM y reabastecimiento sugerido." },
      { nombre: "Omnicanal", para: "E-commerce con bodega propia", alcance: "Tienda en línea, marketplaces (Mercado Libre, Shopify), transportadoras y pagos en línea." },
      { nombre: "Importador", para: "Importadores y comercializadoras", alcance: "Costeo de importaciones, varias monedas y control por lotes." },
    ],
    modalidad: "Proyecto + soporte mensual (licencias de Odoo aparte)",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "odoo",
  },
  {
    id: "td",
    tipo: "Servicio",
    icono: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M6 9v4a2 2 0 0 0 2 2h7"/>',
    nombre: "Transformación Digital",
    corto: "Ordenamos y documentamos la operación antes de automatizarla.",
    entrada: "Entendemos, rediseñamos y documentamos tus procesos y la estructura de tu empresa.",
    que: "Consultoría para entender, rediseñar y documentar los procesos y la estructura de la empresa.",
    para: "Empresas que van a implementar un sistema o que necesitan ordenar su operación y su estructura.",
    resuelve:
      "Procesos sin documentar, roles poco claros y una operación que depende de personas. Automatizar sobre ese desorden no funciona.",
    incluye: [
      "Diagnóstico de la operación (levantamiento de procesos)",
      "Rediseño de procesos",
      "Diseño de la estructura del área",
      "Manuales de funciones",
      "Plan de mejoramiento continuo",
    ],
    beneficios: "Una operación clara, documentada y lista para crecer o para implementar tecnología.",
    modalidad: "Proyecto por fases",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "transformacion",
  },
  {
    id: "data",
    tipo: "Servicio",
    icono: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    nombre: "Datos y Analítica",
    corto: "Convertimos el histórico que ya tienes en decisiones del día a día.",
    entrada: "Tableros e indicadores construidos con los datos de tu ERP, tu WMS y otras fuentes.",
    que: "Construcción de tableros e indicadores a partir de los datos del ERP, el WMS y otras fuentes.",
    para: "Empresas que ya registran su operación (en Odoo, el WMS, Excel u otros sistemas) pero no usan esos datos para decidir.",
    resuelve: "Informes armados a mano, cifras que no coinciden entre áreas y decisiones tomadas sin datos.",
    incluye: [
      "Tableros en Power BI por área",
      "Catálogo de indicadores",
      "Cartera, gastos y margen",
      "Rotación y punto de reorden",
      "Migraciones e integraciones",
    ],
    beneficios: "Información confiable y al día para decidir rápido, en cada área.",
    modalidad: "Proyecto por fases",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "datos",
  },
  {
    id: "cloud",
    tipo: "Servicio",
    icono: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>',
    nombre: "Cloud e Infraestructura",
    corto: "Sostenemos la base técnica sobre la que corre todo lo demás.",
    entrada: "Diseñamos, desplegamos y administramos la nube donde funcionan tus sistemas.",
    que: "Diseño, despliegue y administración de la infraestructura en la nube donde funcionan los sistemas del cliente.",
    para: "Empresas que usan Odoo, el WMS u otras aplicaciones y no tienen equipo propio para administrar servidores.",
    resuelve: "Caídas, lentitud, riesgo de perder información y servidores que nadie en la empresa sabe administrar.",
    incluye: [
      "Arquitectura y despliegue en Azure",
      "PostgreSQL administrado",
      "Instancia dedicada para tu empresa",
      "Respaldos y recuperación",
      "Monitoreo y alertas",
    ],
    beneficios: "Sistemas estables, información protegida y cero preocupaciones por servidores.",
    modalidad: "Consumo de nube + administración",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "cloud",
  },
  {
    id: "ti",
    tipo: "Servicio",
    icono: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5V12M12 12l-6 4.7M12 12l6 4.7"/>',
    nombre: "Gestión de Área TI",
    corto: "Dirigimos y operamos tu área de tecnología como un servicio continuo.",
    entrada: "Asumimos la dirección de tecnología de tu empresa: estrategia, proveedores, procesos y estructura.",
    que: "ZELENA asume la dirección de tecnología del cliente: estrategia, proveedores, procesos y estructura del área.",
    para: "Empresas sin área de tecnología o con un área sin dirección clara.",
    resuelve:
      "Tecnología manejada por varios proveedores sueltos, sin estrategia ni responsable, y un gerente que termina coordinándolos.",
    incluye: [
      "Dirección tecnológica y hoja de ruta",
      "Gestión de proveedores",
      "Estandarización de procesos",
      "Diseño del área y sus roles",
    ],
    beneficios: "Un solo responsable de tu tecnología y una hoja de ruta clara.",
    modalidad: "Mensualidad fija",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "gestion-ti",
  },
  {
    id: "medida",
    tipo: "Servicio",
    icono: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    nombre: "Desarrollo a la Medida",
    corto: "Si lo que necesitas todavía no existe, lo diseñamos y lo construimos contigo.",
    entrada:
      "Convertimos una idea o un proceso propio en software que funciona: integraciones, aplicaciones y automatizaciones.",
    que: "Diseño y desarrollo de software a la medida, desde una integración entre dos sistemas hasta una aplicación completa.",
    para: "Empresas con una idea, un proceso propio o una necesidad que ningún sistema del mercado resuelve tal como la viven.",
    resuelve:
      "Procesos que se hacen a mano porque ningún sistema los cubre, sistemas que no se hablan y proyectos de tecnología que no arrancan por falta de equipo.",
    incluye: [
      "Descubrimiento: entendemos el problema antes de escribir código",
      "Diseño y prototipo que puedes probar",
      "Desarrollo por hitos, con entregas cortas",
      "Integración con tus sistemas: ERP, WMS, tienda en línea",
      "Despliegue en la nube y acompañamiento",
    ],
    beneficios: "Una solución hecha para tu operación, documentada y lista para crecer contigo.",
    extra: {
      etiqueta: "Cómo lo construimos",
      texto: "Con el método de Zelena: el alcance, los hitos y la forma de evaluar cada entrega se acuerdan antes de empezar.",
    },
    modalidad: "Proyecto por hitos, con el alcance acordado en cada fase",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "a-la-medida",
  },
];

/**
 * Lo que vive una empresa, dicho como lo diría ella y en pocas palabras: cada frase es una
 * píldora. `lineas` son las líneas del portafolio que lo resuelven (se marcan "Para ti").
 */
export const NECESIDADES: ReadonlyArray<{ texto: string; lineas: readonly string[] }> = [
  { texto: "El inventario no cuadra", lineas: ["wms", "odoo"] },
  { texto: "Despachamos con errores", lineas: ["wms"] },
  { texto: "Todo vive en Excel", lineas: ["odoo", "data"] },
  { texto: "Facturación y contabilidad aparte", lineas: ["odoo"] },
  { texto: "Informes hechos a mano", lineas: ["data"] },
  { texto: "Todo depende de una persona", lineas: ["td"] },
  { texto: "Los sistemas se caen", lineas: ["cloud", "ti"] },
  { texto: "Nadie dirige la tecnología", lineas: ["ti"] },
  { texto: "Influenciadores medidos en Excel", lineas: ["social"] },
  { texto: "No sabemos qué dicen de la marca", lineas: ["social", "data"] },
  { texto: "El equipo rota mucho", lineas: ["incentivos", "wms"] },
  { texto: "Una idea que nadie construye", lineas: ["medida"] },
];

export const PASOS_CICLO = [
  { n: "01", titulo: "Diagnosticar", corto: "Entendemos la operación y definimos el alcance.", detalle: "Levantamos tus procesos área por área, identificamos entradas, salidas y responsables, y definimos juntos qué resolver primero." },
  { n: "02", titulo: "Implementar", corto: "Ejecutamos con entregas parciales y visibles.", detalle: "Ponemos en marcha la solución por etapas, para que veas avances desde las primeras semanas." },
  { n: "03", titulo: "Mejorar", corto: "Lo construido se vuelve herramienta evolutiva.", detalle: "Ajustamos y ampliamos lo implementado a medida que tu empresa cambia." },
  { n: "04", titulo: "Acompañar", corto: "Mejoramiento continuo y soporte permanente.", detalle: "Seguimos a tu lado con soporte y mejoramiento continuo después de salir en vivo." },
];

export const SECTORES = [
  "Cosmética y cuidado personal",
  "Distribuidores y mayoristas",
  "Comercializadoras e importadores",
  "Tiendas en línea con bodega",
  "Operadores logísticos",
  "Empresas que producen y almacenan",
];
