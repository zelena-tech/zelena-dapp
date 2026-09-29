// Encuentros de la comunidad. Publicar una fecha es agregar un objeto a
// ENCUENTROS: la página los ordena, calcula los días que faltan y oculta los
// que ya pasaron. Mientras la lista esté vacía, /encuentros muestra el aviso
// para que la gente deje su correo. Nunca inventar fechas, sedes ni precios.

export type Encuentro = {
  slug: string;
  titulo: string;
  ciudad: string;
  /** Fecha local del encuentro, AAAA-MM-DD. */
  fecha: string;
  lugar: string;
  /** Texto tal cual se muestra: "Gratis", "$50.000 COP"… */
  precio: string;
  descripcion: string;
  /** Página de inscripción (Luma, formulario, etc.). */
  registro: string;
};

export const ENCUENTROS: Encuentro[] = [];

// Cómo queremos que sean. Salen del calendario ritual del whitepaper (demo
// quincenal, retro mensual pública) más la jornada abierta para construir.
export const FORMATOS = [
  {
    n: "01",
    t: "Jornada de construcción",
    d: "Un día para construir algo real en equipo, con problemas que salen de operaciones de verdad. Llegas con tus herramientas y te vas con algo funcionando y gente con quien seguir.",
  },
  {
    n: "02",
    t: "Demo abierta",
    d: "Quien está construyendo muestra lo que hizo: lo que salió, lo que no y lo que aprendió. Mostrar el trabajo es la mitad de construirlo.",
  },
  {
    n: "03",
    t: "Retro pública",
    d: "Una vez al mes revisamos en voz alta cómo va la comunidad: qué funcionó, qué hay que cambiar y qué decidimos. Transparencia en vivo, no en un informe.",
  },
];

const DIA = 24 * 60 * 60 * 1000;

/** Días enteros que faltan para la fecha (0 = hoy). Negativo si ya pasó. */
export function diasPara(fecha: string, hoy = new Date()): number {
  const [a, m, d] = fecha.split("-").map(Number);
  const objetivo = Date.UTC(a, m - 1, d);
  const base = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((objetivo - base) / DIA);
}

export function proximosEncuentros(hoy = new Date()): Encuentro[] {
  return ENCUENTROS.filter((e) => diasPara(e.fecha, hoy) >= 0).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export function fechaLarga(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
