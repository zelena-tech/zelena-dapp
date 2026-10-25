/**
 * Datos en vivo de la landing en inglés (WP33). Solo servidor: lee la base.
 *
 * Las mismas reglas que la landing anterior (lib/prueba-en-vivo.ts): solo lo real, sin
 * cuentas de prueba, y con todo en cero se muestra el cero. Ningún nombre de cliente ni
 * de persona: de un proyecto salen su título, su tipo (Client / Community), su
 * presupuesto y sus semanas, nunca la campaña. Todo lo que devuelve este módulo son
 * objetos planos (sin Date), listos para pasarlos a un componente de cliente.
 *
 * `datosComunidad()` arma lo que pinta /comunidad en una sola llamada, con un try/catch
 * por bloque: si la base falla, ese bloque sale en su estado vacío y la página no se cae.
 */
import type { DB } from "./db";
import type { RiteKind } from "./genome";
import { cifrasEnVivo, puntosRepartidos } from "./prueba-en-vivo";
import { esActaDeRito, esTipoCliente, etiquetaTipoEn, tipoDesdeQuery } from "./agora-labels";
import { decisionesVigentes } from "./decisiones";
import { proximosEncuentros, type Encuentro } from "./encuentros";
import { EXPLORADOR_TX } from "./pruebas-testnet";
import { proximoRitoPreparado, ritosPublicos, zonaRitos, type RitoProximo } from "./ritos";
import { RUTA_AVISO_ENCUENTROS, llamadaParticipar } from "./ritos-labels";
import { RUTA_RITOS } from "./menu";
import { anclaPropuesta, propuestasAbiertas, recuentoVotos } from "./votos";

// ---------------------------------------------------------------------------
// Votaciones abiertas
// ---------------------------------------------------------------------------

/** Donde se vota de verdad (con sesión y el acuerdo firmado). La landing solo enlaza. */
export const RUTA_VOTAR = "/gobernanza";

export interface VotacionAbierta {
  id: number;
  /** Título tal cual está en la base (hoy en español: pintarlo con lang="es"). */
  titulo: string;
  /** % de votos a favor que necesita para aprobarse. */
  umbral: number;
  favor: number;
  contra: number;
  abstencion: number;
  total: number;
  /** round(favor / total × 100); 0 sin votos. La misma fórmula que /gobernanza. */
  pctFavor: number;
  /** Su votación en /gobernanza (`/gobernanza#propuesta-N`), que las muestra todas. */
  href: string;
}

function entero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Las votaciones abiertas, la más antigua primero, con el MISMO recuento que /gobernanza
 * (lib/votos.ts: sin los votos de cuentas de prueba). Cada una enlaza a su ancla allí.
 */
export function votacionesAbiertas(db: DB, limite = 3): VotacionAbierta[] {
  const cuantas = Math.min(Math.max(0, Math.floor(limite) || 0), 20);
  if (cuantas === 0) return [];
  return propuestasAbiertas(db, cuantas).map((p) => {
    const t = recuentoVotos(db, p.id);
    const total = t.favor + t.contra + t.abstencion;
    return {
      id: p.id,
      titulo: p.title,
      umbral: p.threshold,
      ...t,
      total,
      pctFavor: total > 0 ? Math.round((t.favor / total) * 100) : 0,
      href: `${RUTA_VOTAR}#${anclaPropuesta(p.id)}`,
    };
  });
}

/** Cuántas votaciones hay abiertas (todas, no solo las que se listan). */
export function cuantasVotacionesAbiertas(db: DB): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'open'`).get() as { n: number } | undefined;
  return entero(r?.n);
}

/** Decisiones publicadas y vigentes (sin las actas de los ritos), como en /gobernanza. */
export function cuantasDecisiones(db: DB): number {
  return decisionesVigentes(db).filter((d) => !esActaDeRito(d.title)).length;
}

// ---------------------------------------------------------------------------
// Proyectos abiertos del Ágora
// ---------------------------------------------------------------------------

export type ClaveTipoProyecto = "client" | "community" | "other";

export interface ProyectoAbierto {
  id: number;
  titulo: string;
  /** Para los filtros: client | community (other si el valor interno no se reconoce). */
  tipo: ClaveTipoProyecto;
  /** "Client" | "Community" | "Project". Nunca el valor interno. */
  etiquetaTipo: string;
  presupuestoUsd: number;
  semanas: number;
  /** La ficha del proyecto en el Ágora. */
  href: string;
}

function claveTipo(tipo: string): ClaveTipoProyecto {
  if (esTipoCliente(tipo)) return "client";
  return tipo === tipoDesdeQuery("comunidad") ? "community" : "other";
}

/**
 * Proyectos abiertos y publicados: el mismo filtro que `listProjects({ state: "Open" })`
 * (sin borradores), lo más nuevo primero. No se lee la campaña: puede llevar el nombre
 * de un cliente.
 */
export function proyectosAbiertos(db: DB, limite = 6): ProyectoAbierto[] {
  const cuantos = Math.min(Math.max(0, Math.floor(limite) || 0), 50);
  if (cuantos === 0) return [];
  const filas = db
    .prepare(
      `SELECT id, title, type, budget_usd, weeks FROM projects WHERE state = 'Open' AND draft = 0 ORDER BY id DESC LIMIT ${cuantos}`
    )
    .all() as Array<{ id: number; title: string; type: string; budget_usd: number; weeks: number }>;
  return filas.map((p) => ({
    id: entero(p.id),
    titulo: String(p.title),
    tipo: claveTipo(String(p.type)),
    etiquetaTipo: etiquetaTipoEn(String(p.type)),
    presupuestoUsd: entero(p.budget_usd),
    semanas: entero(p.weeks),
    href: `/agora/${entero(p.id)}`,
  }));
}

// ---------------------------------------------------------------------------
// Próximas fechas: encuentros publicados y ritos de comunidad ya preparados
// ---------------------------------------------------------------------------

/** Nombre de cada rito en inglés (solo salen los de comunidad: demo y retro). */
export const RITO_EN: Readonly<Record<RiteKind, string>> = {
  sync: "Weekly sync",
  demo: "Community demo",
  retro: "Monthly retro",
};

export interface CitaComunidad {
  /** Clave estable para React. */
  clave: string;
  tipo: "encuentro" | "rito";
  /** Día local, AAAA-MM-DD. */
  fecha: string;
  /** "NOV 14" (mes corto en inglés y día), para el cartel. */
  diaCorto: string;
  /** "6:00 PM GMT-5" en la zona de los ritos; null en un encuentro (su hora no está en los datos). */
  hora: string | null;
  /** Título: el del encuentro (en español, `idiomaTitulo: "es"`) o el nombre del rito en inglés. */
  titulo: string;
  idiomaTitulo: "es" | "en";
  /** Ciudad del encuentro o lugar del rito; null si no se publicó. */
  lugar: string | null;
  href: string;
}

const ZONA_POR_DEFECTO = "America/Bogota";

function zonaValida(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

function partesFecha(fecha: Date, tz: string): { iso: string; diaCorto: string; hora: string } {
  const zona = zonaValida(tz);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(fecha)
      .map((x) => [x.type, x.value])
  );
  const diaCorto = new Intl.DateTimeFormat("en-US", { timeZone: zona, month: "short", day: "numeric" })
    .format(fecha)
    .toUpperCase();
  const hora = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(fecha);
  return { iso: `${p.year}-${p.month}-${p.day}`, diaCorto, hora };
}

/** "2026-11-14" → "NOV 14" (sin zona: la fecha del encuentro ya es local). */
function diaCortoDeFecha(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d))
    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

function citaDeEncuentro(e: Encuentro): CitaComunidad {
  return {
    clave: `encuentro-${e.slug}`,
    tipo: "encuentro",
    fecha: e.fecha,
    diaCorto: diaCortoDeFecha(e.fecha),
    hora: null,
    titulo: e.titulo,
    idiomaTitulo: "es",
    lugar: e.ciudad || null,
    href: "/encuentros#proximos",
  };
}

function citaDeRito(r: RitoProximo, tz: string): CitaComunidad {
  const f = partesFecha(r.inicio, tz);
  return {
    clave: `rito-${r.sessionId}`,
    tipo: "rito",
    fecha: f.iso,
    diaCorto: f.diaCorto,
    hora: f.hora,
    titulo: RITO_EN[r.kind],
    idiomaTitulo: "en",
    lugar: r.lugar,
    href: `${RUTA_RITOS}/${r.sessionId}`,
  };
}

/**
 * Lo próximo en el calendario de la comunidad, por fecha: los encuentros publicados
 * (lib/encuentros.ts) y los ritos de comunidad YA PREPARADOS en /admin (con sesión, fecha
 * y lugar). Nunca una fecha de la cadencia sin preparar: no tiene lugar ni página.
 * Vacío → la página muestra "No dates yet" y lleva a `RUTA_AVISO_ENCUENTROS`.
 */
export function proximasCitas(
  db: DB,
  ahora: Date = new Date(),
  o: { limite?: number; encuentros?: readonly Encuentro[] } = {}
): CitaComunidad[] {
  const limite = Math.min(Math.max(0, Math.floor(o.limite ?? 3) || 0), 12);
  const encuentros = (o.encuentros ?? proximosEncuentros(ahora)).map(citaDeEncuentro);
  const tz = zonaRitos(db);
  const ritos = ritosPublicos(db, ahora, 6)
    .proximos.filter((r) => r.sessionId !== null)
    .map((r) => citaDeRito(r, tz));
  return [...encuentros, ...ritos].sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, limite);
}

// ---------------------------------------------------------------------------
// La llamada a participar (el botón secundario del cierre de /comunidad)
// ---------------------------------------------------------------------------

export interface LlamadaLanding {
  href: string;
  /** A dónde lleva: un encuentro, un rito ya preparado o el aviso de encuentros. */
  destino: "encuentro" | "rito" | "aviso";
  /** Texto llano en inglés (nombre accesible del botón). */
  texto: string;
  /** Etiqueta con la voz de comando del diseño (snake_case). */
  comando: string;
}

/** Sin calendario (o si la base falla): al formulario para dejar el correo. */
export const LLAMADA_AVISO: LlamadaLanding = {
  href: RUTA_AVISO_ENCUENTROS,
  destino: "aviso",
  texto: "Get notified of the next date",
  comando: "get_notified",
};

/**
 * La misma decisión que `llamadaParticipar` (lib/ritos-labels.ts), con los textos en
 * inglés: el encuentro publicado si llega antes, el próximo rito de comunidad preparado,
 * o el aviso de encuentros. La entrada es por invitación: /entrar solo no lleva a nada.
 */
export function llamadaParticiparEn(
  db: DB,
  ahora: Date = new Date(),
  encuentros: readonly Encuentro[] = proximosEncuentros(ahora)
): LlamadaLanding {
  const tz = zonaRitos(db);
  const rito = proximoRitoPreparado(db, ahora);
  const base = llamadaParticipar(encuentros[0] ?? null, rito, tz);
  if (base.href === "/encuentros#proximos") {
    return { href: base.href, destino: "encuentro", texto: "Come to a meetup", comando: "join_a_meetup" };
  }
  if (rito && rito.sessionId && base.href === `${RUTA_RITOS}/${rito.sessionId}`) {
    const nombre = rito.kind === "retro" ? "retro" : "demo";
    const dia = partesFecha(rito.inicio, tz).diaCorto;
    return {
      href: base.href,
      destino: "rito",
      texto: `Come to the ${nombre} on ${dia.charAt(0)}${dia.slice(1).toLowerCase()}`,
      comando: `join_the_next_${nombre}`,
    };
  }
  return { ...LLAMADA_AVISO, href: base.href };
}

// ---------------------------------------------------------------------------
// Todo /comunidad en una llamada
// ---------------------------------------------------------------------------

export interface CifrasComunidad {
  /** Firmas del acuerdo de cuentas reales con una transacción verificable de Stellar (testnet). */
  firmas: number;
  /** Proyectos abiertos y publicados del Ágora. */
  proyectosAbiertos: number;
  /** Puntos repartidos a cuentas reales. */
  puntos: number;
  /** Hitos del Ágora y entregas del equipo aprobadas, de cuentas reales. */
  entregasAprobadas: number;
  /** Decisiones publicadas y vigentes. */
  decisiones: number;
  /** Votaciones abiertas (todas). */
  votacionesAbiertas: number;
  /** La firma más reciente anclada en la red de pruebas, con su enlace al explorador. */
  ultimaFirma: { tx: string; fecha: string; url: string } | null;
}

export interface DatosComunidad {
  cifras: CifrasComunidad;
  proyectos: ProyectoAbierto[];
  votaciones: VotacionAbierta[];
  citas: CitaComunidad[];
  llamada: LlamadaLanding;
}

export const CIFRAS_EN_CERO: CifrasComunidad = {
  firmas: 0,
  proyectosAbiertos: 0,
  puntos: 0,
  entregasAprobadas: 0,
  decisiones: 0,
  votacionesAbiertas: 0,
  ultimaFirma: null,
};

/** Corre un bloque; si la base falla, lo registra y devuelve el estado vacío. */
function bloque<T>(nombre: string, fn: () => T, vacio: T): T {
  try {
    return fn();
  } catch (e) {
    console.error(`[landing] ${nombre}`, e);
    return vacio;
  }
}

/**
 * Lo que pinta /comunidad. Cada bloque por su lado: un fallo en el calendario no
 * borra las cifras, y un fallo en la base entera deja todo en cero (que es lo que se
 * muestra, con su llamada a la acción).
 */
export function datosComunidad(db: DB, ahora: Date = new Date()): DatosComunidad {
  const cifras = bloque<CifrasComunidad>(
    "cifras",
    () => {
      const c = cifrasEnVivo(db);
      return {
        firmas: c.firmasRegistradas,
        proyectosAbiertos: c.proyectosAbiertos,
        puntos: bloque("puntos", () => puntosRepartidos(db), 0),
        entregasAprobadas: c.entregasAprobadas,
        decisiones: bloque("decisiones", () => cuantasDecisiones(db), 0),
        votacionesAbiertas: bloque("votaciones abiertas", () => cuantasVotacionesAbiertas(db), 0),
        ultimaFirma: c.ultimaFirmaAnclada
          ? { ...c.ultimaFirmaAnclada, url: `${EXPLORADOR_TX}${c.ultimaFirmaAnclada.tx}` }
          : null,
      };
    },
    CIFRAS_EN_CERO
  );
  return {
    cifras,
    proyectos: bloque("proyectos", () => proyectosAbiertos(db, 6), []),
    votaciones: bloque("votaciones", () => votacionesAbiertas(db, 3), []),
    citas: bloque("citas", () => proximasCitas(db, ahora), []),
    llamada: bloque("llamada", () => llamadaParticiparEn(db, ahora), LLAMADA_AVISO),
  };
}
