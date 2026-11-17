/**
 * Copy del portafolio de soluciones (/empresas/portafolio), en español y con el cromo
 * claro de la landing (pedido del founder, 2026-11-17): un producto propio, cinco
 * servicios y el programa de incentivos. Todo el texto vive aquí, no en el JSX.
 * `interes` es el slug que entiende el formulario de contacto (lib/servicios.ts).
 *
 * Mismas reglas que el resto del copy público (ver copy-comun.ts y
 * sitio-publico.test.ts): ni clientes ni personas, ni la entidad legal, ni jerga.
 */
import { ENLACES_EMPRESAS } from "./copy-empresas";

export const META_PORTAFOLIO = {
  titulo: "Portafolio de soluciones · Zelena",
  descripcion:
    "Ordenamos la operación de tu pyme: un producto propio (ZELENA WMS), cinco servicios que se contratan por separado y un programa de incentivos en dólares digitales para tu equipo.",
} as const;

export const HERO_PORTAFOLIO = {
  chip: "Portafolio de soluciones",
  h1: { antes: "Ordenamos la operación de tu ", resaltado: "pyme.", despues: "" },
  lead:
    "Primero tus procesos, después tu bodega y tu gestión. Tecnología propia y servicios para que tu inventario cuadre, tus despachos salgan bien y decidas con datos. Y cuando la operación ya se mide, un incentivo que reconoce a quien la hace posible.",
  primario: { href: "#situacion", nombre: "Encontrar mi solución" },
  secundario: { href: "#portafolio", nombre: "Ver el portafolio" },
} as const;

/**
 * Lo primero que ve quien llega con el enlace y no nos conoce: qué hace el negocio, en
 * tres verbos. Cada uno lleva a su parte.
 */
export const TRES_LINEAS = {
  etiqueta: "Zelena en tres líneas",
  lineas: [
    {
      n: "01",
      verbo: "Ordenamos",
      que: "tus procesos, tu información y tu tecnología.",
      como: "Cinco servicios: procesos, Odoo, datos, nube y dirección de TI.",
      href: "#portafolio",
      enlace: "Ver los servicios",
    },
    {
      n: "02",
      verbo: "Operamos",
      que: "tu bodega con tecnología propia.",
      como: "ZELENA WMS: inventario exacto y despachos validados.",
      href: "#portafolio",
      enlace: "Ver el producto",
    },
    {
      n: "03",
      verbo: "Reconocemos",
      que: "el trabajo real de tu equipo.",
      como: "Incentivos por desempeño, pagados en dólares digitales.",
      href: ENLACES_EMPRESAS.incentivos,
      enlace: "Ver los incentivos",
    },
  ],
  cifras: ["1 producto propio", "5 servicios", "1 programa de incentivos", "1 solo aliado"],
} as const;

export const SITUACION = {
  ancla: "situacion",
  etiqueta: "01 · Tu situación",
  h2: { linea1: "¿Qué pasa hoy", antes: "en tu ", enfasis: "empresa?" },
  intro: "Elige una o varias situaciones y te mostramos qué solución te sirve.",
  vacio: "Tus soluciones recomendadas aparecen aquí.",
  recomendamos: "Te recomendamos",
} as const;

export const PORTAFOLIO = {
  ancla: "portafolio",
  etiqueta: "02 · Portafolio",
  h2: { linea1: "Un producto, cinco servicios", antes: "y un programa de ", enfasis: "incentivos." },
  intro: "Contrata solo lo que necesitas. Cada línea funciona por sí sola y todas se conectan entre sí.",
  filtroAria: "Filtrar el portafolio",
  filtros: [
    { valor: "Todo", nombre: "Todo" },
    { valor: "Producto", nombre: "Producto" },
    { valor: "Servicio", nombre: "Servicios" },
    { valor: "Programa", nombre: "Incentivos" },
  ],
  verDetalle: "Ver detalle",
  recomendada: "Recomendada",
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
  etiqueta: "03 · Cómo trabajamos",
  h2: { linea1: "El mismo ciclo", antes: "en todas las ", enfasis: "líneas." },
  intro: "Cuatro pasos, una sola forma de trabajar. Por eso un servicio abre la puerta al siguiente.",
} as const;

export const ALIADO = {
  etiqueta: "04 · Por qué Zelena",
  frase: "Un solo aliado,",
  enfasis: "no cinco proveedores.",
  paraQuienTitulo: "Para quién trabajamos",
  paraQuien:
    "Pymes en Colombia de 10 a 200 empleados que necesitan ordenar y digitalizar su operación, con foco en inventario, bodegas, despachos o distribución.",
} as const;

export const CIERRE_PORTAFOLIO = {
  titulo: { linea1: "Hablemos de", linea2: "tu operación." },
  texto: "Cuéntanos qué está pasando en tu empresa y te proponemos por dónde empezar.",
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
    id: "odoo",
    tipo: "Servicio",
    icono: '<path d="M12 2l8 4.5v9L12 20l-8-4.5v-9z"/><path d="M12 11l8-4.5M12 11v9M12 11L4 6.5"/>',
    nombre: "Implementación Odoo",
    corto: "Un solo sistema para ventas, compras, inventario, contabilidad y factura electrónica DIAN.",
    entrada: "Implementamos y sostenemos Odoo, configurado según el tipo de empresa, sobre una base ya validada.",
    que: "ERP Odoo (versión 19 Enterprise) configurado y adaptado por ZELENA para pymes colombianas.",
    para: "Pymes que hoy trabajan con Excel y un software contable (Siigo, Alegra, World Office) o con un ERP antiguo.",
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
    para: "Pymes que van a implementar un sistema o que necesitan ordenar su operación y su estructura.",
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
    para: "Pymes sin área de tecnología o con un área sin dirección clara.",
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
      "Alta rotación, incentivos manuales que se abandonan, bonos que dependen del criterio de un jefe y equipos que no sienten suyo el resultado.",
    incluye: [
      "Diseño de las reglas del incentivo con tu equipo directivo",
      "Medición automática desde la operación",
      "Cierre por periodo con resultados visibles para cada persona",
      "Pago en dólares digitales (USDC) a la billetera de cada persona",
      "Historial de logros a nombre de cada trabajador",
    ],
    beneficios:
      "Una herramienta de ahorro para tu equipo, más productividad donde se mide el trabajo y un sentido de pertenencia que se nota en la rotación.",
    extra: { etiqueta: "Importante", texto: "El incentivo es adicional al salario: nunca lo reemplaza." },
    modalidad: "Se diseña con cada empresa, por periodos",
    soporte: "Lunes a viernes, 8:00 a 18:00",
    interes: "harmony",
    enlace: "/empresas/incentivos",
  },
];

export const NECESIDADES: Array<{ texto: string; lineas: string[] }> = [
  { texto: "Mi inventario no cuadra", lineas: ["wms", "odoo"] },
  { texto: "Despachamos con errores", lineas: ["wms"] },
  { texto: "Trabajamos en Excel y sistemas que no se hablan", lineas: ["odoo", "data"] },
  { texto: "Necesito factura electrónica y contabilidad en un solo lugar", lineas: ["odoo"] },
  { texto: "Nuestros procesos no están documentados", lineas: ["td"] },
  { texto: "No uso mis datos para decidir", lineas: ["data"] },
  { texto: "Mis sistemas se caen o no sé dónde viven", lineas: ["cloud"] },
  { texto: "Nadie dirige nuestra tecnología", lineas: ["ti"] },
  { texto: "Vamos a crecer y no sabemos por dónde empezar", lineas: ["td", "ti"] },
  { texto: "Mi equipo rota mucho o no se siente reconocido", lineas: ["incentivos", "wms"] },
];

export const PASOS_CICLO = [
  { n: "01", titulo: "Diagnosticar", corto: "Entendemos la operación y definimos el alcance.", detalle: "Levantamos tus procesos área por área, identificamos entradas, salidas y responsables, y definimos juntos qué resolver primero." },
  { n: "02", titulo: "Implementar", corto: "Ejecutamos con entregas parciales y visibles.", detalle: "Ponemos en marcha la solución por etapas, para que veas avances desde las primeras semanas." },
  { n: "03", titulo: "Mejorar", corto: "Lo construido se vuelve herramienta evolutiva.", detalle: "Ajustamos y ampliamos lo implementado a medida que tu empresa cambia." },
  { n: "04", titulo: "Acompañar", corto: "Mejoramiento continuo y soporte permanente.", detalle: "Seguimos a tu lado con soporte y mejoramiento continuo después de salir en vivo." },
];

export const POR_QUE = [
  { n: "I · procesos", titulo: "Empezamos por los procesos.", texto: "Entendemos y ordenamos tu operación antes de instalar cualquier sistema." },
  { n: "II · tecnología", titulo: "Tecnología propia.", texto: "Desarrollamos ZELENA WMS para la bodega de la pyme." },
  { n: "III · un equipo", titulo: "Un solo responsable.", texto: "Bodega, ERP, datos, nube y tecnología con un mismo equipo." },
  { n: "IV · continuidad", titulo: "Seguimos a tu lado.", texto: "Soporte y mejoramiento continuo después de salir en vivo." },
];

export const SECTORES = [
  "Cosmética y cuidado personal",
  "Distribuidores y mayoristas",
  "Comercializadoras e importadores",
  "Tiendas en línea con bodega",
  "Operadores logísticos",
  "Empresas que producen y almacenan",
];
