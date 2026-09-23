// Catálogo comercial de ZELENA. Fuente única para la página /empresas/servicios,
// el formulario de contacto y su validación: si se agrega una línea aquí,
// aparece en los tres lugares a la vez.
//
// Sin SLA a propósito: publicados se vuelven un compromiso contractual.

export type Servicio = {
  slug: string;
  nombre: string;
  linea: string;
  incluye: string[];
  meta: string;
};

export const SERVICIOS: Servicio[] = [
  {
    slug: "gestion-ti",
    nombre: "Gestión de Área TI",
    linea: "Dirigimos la tecnología de tu empresa como si fuera nuestra.",
    incluye: [
      "Dirección tecnológica y roadmap anual",
      "Gestión de proveedores y licenciamiento",
      "Diseño de área, roles y comité mensual",
    ],
    meta: "Arranque en 1 semana · Mensualidad",
  },
  {
    slug: "odoo",
    nombre: "Odoo / ERP",
    linea: "Implementación y migración, con acompañamiento después de salir a producción.",
    incluye: [
      "Levantamiento y parametrización",
      "Migración de catálogo y maestros",
      "Capacitación y acompañamiento post salida",
    ],
    meta: "Arranque en 2 semanas · Proyecto + soporte mensual",
  },
  {
    slug: "wms",
    nombre: "WMS ZELENA",
    linea: "Nuestro sistema de bodega. En producción en Colombia y México.",
    incluye: [
      "Instancia dedicada y mapeo físico de bodega",
      "Recepción, picking con ruta optimizada, packing",
      "Averías, desempeño por operario, traslados",
    ],
    meta: "Arranque en 1 semana · Implementación + mensualidad",
  },
  {
    slug: "transformacion",
    nombre: "Transformación Digital",
    linea: "Diagnóstico de la operación, procesos, estructura de área y manuales de funciones.",
    incluye: [
      "Diagnóstico y rediseño de procesos",
      "Estructura de área y manuales de funciones",
      "Plan de mejoramiento continuo",
    ],
    meta: "Arranque en 2 semanas · Proyecto por fases",
  },
  {
    slug: "datos",
    nombre: "Datos y Analítica",
    linea: "Tableros, KPIs, limpieza de datos e integraciones entre sistemas.",
    incluye: [
      "Tableros Power BI y catálogo de KPIs",
      "Migraciones y limpieza masiva de datos",
      "Integraciones entre ERP, tienda y bodega",
    ],
    meta: "Arranque en 2 semanas · Proyecto de 4 a 6 semanas",
  },
  {
    slug: "cloud",
    nombre: "Cloud e Infraestructura",
    linea: "Azure, PostgreSQL, respaldos, monitoreo y soporte.",
    incluye: [
      "Despliegue dedicado en Azure",
      "PostgreSQL, respaldos y monitoreo",
      "Soporte y sostenimiento",
    ],
    meta: "Arranque inmediato · Mensualidad",
  },
];

// Opciones del formulario: las seis líneas, más Harmony (el producto de
// incentivos, que no es un servicio del catálogo) y una salida para quien aún
// no sabe qué necesita.
export const INTERESES: Array<{ slug: string; nombre: string }> = [
  { slug: "harmony", nombre: "Harmony · Incentivos por desempeño" },
  ...SERVICIOS.map(({ slug, nombre }) => ({ slug, nombre })),
  { slug: "otro", nombre: "Todavía no sé, quiero conversarlo" },
];

export const SLUGS_INTERES = INTERESES.map((i) => i.slug) as [string, ...string[]];

export function nombreInteres(slug: string): string {
  return INTERESES.find((i) => i.slug === slug)?.nombre ?? slug;
}
