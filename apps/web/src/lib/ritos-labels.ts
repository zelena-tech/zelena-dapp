/**
 * Ritos (WP31-D): etiquetas, cadencia y ventana. Módulo PURO y apto para cliente.
 *
 * Por qué existe aparte de `ritos.ts`: lo importan componentes `"use client"` (el
 * formulario de asistencia, el código del anfitrión) y la página pública. Por eso
 * aquí no hay base de datos, ni HMAC, ni `node:`: solo copy y aritmética de fechas.
 * Lo que necesita el secreto vive en `ritos-codigo.ts`; lo que toca la base, en
 * `ritos.ts` (test estático D8).
 *
 * Reglas:
 *  - La cadencia sale del genoma (`RITES_CADENCE`). Las próximas ocurrencias se
 *    CALCULAN; solo se guarda la que alguien prepara.
 *  - Fechas y horas siempre en la zona del genoma (`BUSINESS_TZ`) con
 *    `zona-horaria.ts`; nunca la hora del servidor.
 *  - Estar es lo normal y faltar no resta nada: aquí no hay copy de ausencias.
 */
import type { CadenciaRito, Genome, RiteKind } from "./genome";
import { diaLocal, diaSemanaIso, instanteLocal } from "./zona-horaria";

export type AudienciaRito = "equipo" | "comunidad";

/** Los tres ritos, en el orden en que se muestran. */
export const RITE_KINDS = ["sync", "demo", "retro"] as const satisfies readonly RiteKind[];

export function isRiteKind(v: unknown): v is RiteKind {
  return typeof v === "string" && (RITE_KINDS as readonly string[]).includes(v);
}

/** Nombre, para qué sirve y a quién está abierto cada rito (copy de §8.4). */
export const RITE_LABEL: Record<RiteKind, { nombre: string; descripcion: string; audiencia: AudienciaRito }> = {
  sync: {
    nombre: "Sync semanal",
    descripcion: "Qué avanzó, qué está trabado y qué sigue.",
    audiencia: "equipo",
  },
  demo: {
    nombre: "Demo quincenal",
    descripcion: "Quien construye muestra lo que salió, lo que no y lo que aprendió.",
    audiencia: "comunidad",
  },
  retro: {
    nombre: "Retro mensual",
    descripcion: "Qué funcionó, qué cambiamos y qué decidimos.",
    audiencia: "comunidad",
  },
};

/** Para quién es cada audiencia, tal cual se lee en /comunidad. */
export const AUDIENCIA_LABEL: Record<AudienciaRito, string> = {
  equipo: "Del equipo y de quien trabaja en un proyecto.",
  comunidad: "Abierta a la comunidad.",
};

/** Estado de una sesión, en español. La clave es el valor de la base. */
export const ESTADO_RITO_LABEL: Record<string, string> = {
  Planned: "Programado",
  Open: "Abierto ahora",
  Closed: "Cerrado",
};

export interface OcurrenciaRito {
  kind: RiteKind;
  inicio: Date;
  duracionMin: number;
}

// ---------------------------------------------------------------------------
// Aritmética de días locales (AAAA-MM-DD) sin la hora del servidor
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Horizonte de búsqueda: ninguna cadencia válida tarda más que esto en repetirse. */
const MAX_PASOS = 400;

function numeroDeDia(dia: string): number {
  const m = YMD.exec(dia);
  if (!m) throw new RangeError(`Fecha inválida: ${dia}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DIA_MS);
}

function diaDeNumero(n: number): string {
  return new Date(n * DIA_MS).toISOString().slice(0, 10);
}

function sumarDias(dia: string, n: number): string {
  return diaDeNumero(numeroDeDia(dia) + n);
}

/** Día del mes (1-28) del k-ésimo `diaSemana` (ISO) de ese mes. */
function kesimoDelMes(anio: number, mes: number, k: number, diaSemana: number): string {
  const primero = `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}-01`;
  const desfase = (diaSemana - diaSemanaIso(primero) + 7) % 7;
  return sumarDias(primero, desfase + 7 * (k - 1));
}

function esFechaReal(dia: unknown): dia is string {
  if (typeof dia !== "string" || !YMD.test(dia)) return false;
  try {
    diaSemanaIso(dia); // lanza si la fecha no existe (p. ej. 2026-02-30)
    return true;
  } catch {
    return false;
  }
}

function enteroEntre(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * ¿La cadencia guardada en el genoma se puede usar? El genoma es un dato (JSON
 * versionado): una cadencia mal escrita no tumba la página, solo deja de anunciar
 * ese rito. La quincenal exige que su ancla caiga en su día de la semana.
 */
export function cadenciaValida(c: unknown): c is CadenciaRito {
  if (!c || typeof c !== "object") return false;
  const x = c as Record<string, unknown>;
  if (!enteroEntre(x.dia_semana, 1, 7)) return false;
  if (typeof x.hora !== "string" || !HHMM.test(x.hora)) return false;
  if (!enteroEntre(x.duracion_min, 1, 720)) return false;
  if (x.frecuencia === "semanal") return true;
  if (x.frecuencia === "quincenal") return esFechaReal(x.ancla) && diaSemanaIso(x.ancla) === x.dia_semana;
  if (x.frecuencia === "mensual") return enteroEntre(x.semana_del_mes, 1, 4);
  return false;
}

/** ¿Ese día local es uno de la cadencia? (sin mirar la hora). */
function esDiaDeCadencia(c: CadenciaRito, dia: string): boolean {
  if (diaSemanaIso(dia) !== c.dia_semana) return false;
  if (c.frecuencia === "semanal") return true;
  if (c.frecuencia === "quincenal") {
    const diff = numeroDeDia(dia) - numeroDeDia(c.ancla);
    return diff >= 0 && diff % 14 === 0; // la serie empieza en el ancla
  }
  const [anio, mes] = dia.split("-").map(Number);
  return kesimoDelMes(anio, mes, c.semana_del_mes, c.dia_semana) === dia;
}

/** Días locales de la cadencia a partir de `desde` (inclusive), en orden. */
function* diasDeCadencia(c: CadenciaRito, desde: string): Generator<string> {
  if (c.frecuencia === "semanal") {
    let d = sumarDias(desde, (c.dia_semana - diaSemanaIso(desde) + 7) % 7);
    for (let i = 0; i < MAX_PASOS; i++, d = sumarDias(d, 7)) yield d;
    return;
  }
  if (c.frecuencia === "quincenal") {
    const diff = numeroDeDia(desde) - numeroDeDia(c.ancla);
    let d = diff <= 0 ? c.ancla : sumarDias(c.ancla, Math.ceil(diff / 14) * 14);
    for (let i = 0; i < MAX_PASOS; i++, d = sumarDias(d, 14)) yield d;
    return;
  }
  let [anio, mes] = desde.split("-").map(Number);
  for (let i = 0; i < MAX_PASOS; i++) {
    const d = kesimoDelMes(anio, mes, c.semana_del_mes, c.dia_semana);
    if (d >= desde) yield d;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }
}

/**
 * Próximas `n` ocurrencias (de todos los ritos, o solo de una audiencia), en orden
 * de inicio. "Próxima" = todavía no terminó: un rito en curso sigue apareciendo.
 */
export function proximasOcurrencias(
  cad: Genome["RITES_CADENCE"],
  desde: Date,
  tz: string,
  n: number,
  audiencia?: AudienciaRito
): OcurrenciaRito[] {
  const cuantas = Math.min(Math.max(0, Math.floor(Number(n) || 0)), 100);
  if (cuantas === 0 || Number.isNaN(desde.getTime())) return [];
  const out: OcurrenciaRito[] = [];
  for (const kind of RITE_KINDS) {
    if (audiencia && RITE_LABEL[kind].audiencia !== audiencia) continue;
    const c = cad?.[kind];
    if (!cadenciaValida(c)) continue;
    try {
      // Un día antes: un rito que cruzara la medianoche local seguiría en curso.
      const inicioBusqueda = sumarDias(diaLocal(desde, tz), -1);
      let delKind = 0;
      for (const dia of diasDeCadencia(c, inicioBusqueda)) {
        const inicio = instanteLocal(dia, c.hora, tz);
        if (inicio.getTime() + c.duracion_min * 60_000 <= desde.getTime()) continue;
        out.push({ kind, inicio, duracionMin: c.duracion_min });
        if (++delKind >= cuantas) break;
      }
    } catch {
      // Zona u hora ilegibles en el genoma: ese rito no se anuncia.
    }
  }
  return out
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || RITE_KINDS.indexOf(a.kind) - RITE_KINDS.indexOf(b.kind))
    .slice(0, cuantas);
}

const HORAS_24 = 24 * 60 * 60 * 1000;
const DIAS_60 = 60 * HORAS_24;

/**
 * ¿`inicio` es una ocurrencia real de la cadencia de ese rito (día y hora exactos en
 * la zona del genoma) y cae en `[ahora − 24 h, ahora + 60 d]`? Es la guarda de
 * `prepararRito`: no se preparan fechas inventadas ni muy lejanas.
 */
export function esOcurrenciaValida(
  cad: Genome["RITES_CADENCE"],
  kind: RiteKind,
  inicio: Date,
  tz: string,
  ahora: Date
): boolean {
  if (!isRiteKind(kind)) return false;
  const t = inicio.getTime();
  if (Number.isNaN(t) || Number.isNaN(ahora.getTime())) return false;
  if (t < ahora.getTime() - HORAS_24 || t > ahora.getTime() + DIAS_60) return false;
  const c = cad?.[kind];
  if (!cadenciaValida(c)) return false;
  try {
    const dia = diaLocal(inicio, tz);
    return esDiaDeCadencia(c, dia) && instanteLocal(dia, c.hora, tz).getTime() === t;
  } catch {
    return false;
  }
}

/** Ventana del rito: `[inicio − margen, inicio + duración + margen]`. */
export function ventanaRito(inicio: Date, duracionMin: number, margenMin: number): { abre: Date; cierra: Date } {
  const t = inicio.getTime();
  const margen = Math.max(0, Number(margenMin) || 0) * 60_000;
  const duracion = Math.max(0, Number(duracionMin) || 0) * 60_000;
  return { abre: new Date(t - margen), cierra: new Date(t + duracion + margen) };
}

/** ¿`ahora` está dentro de la ventana? (bordes incluidos). */
export function dentroDeVentana(ahora: Date, v: { abre: Date; cierra: Date }): boolean {
  const t = ahora.getTime();
  return t >= v.abre.getTime() && t <= v.cierra.getTime();
}

// ---------------------------------------------------------------------------
// Código de asistencia: lo que la persona escribe
// ---------------------------------------------------------------------------

/**
 * Normaliza lo que alguien escribe como código: dígitos de ancho completo a ASCII
 * (NFKC) y fuera espacios, guiones y puntos ("123 456", "123-456"). Devuelve los 6
 * dígitos o `null` si no queda un código con forma de código.
 */
export function normalizarCodigo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const limpio = raw.normalize("NFKC").replace(/[\s\-._·]/g, "");
  return /^\d{6}$/.test(limpio) ? limpio : null;
}

// ---------------------------------------------------------------------------
// Copy derivado del genoma (fechas, duraciones, cadencias)
// ---------------------------------------------------------------------------

const DIAS_SEMANA = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const ORDINAL_SEMANA = ["", "primer", "segundo", "tercer", "cuarto"];

/** Ciudad de la zona horaria, para decir "hora de Bogotá" sin inventar nada. */
const CIUDADES: Record<string, string> = { "America/Bogota": "Bogotá" };

export function zonaTexto(tz: string): string {
  const ciudad = CIUDADES[tz] ?? (tz.split("/").pop() ?? tz).replace(/_/g, " ");
  return `hora de ${ciudad}`;
}

/** 30 → "30 min" · 60 → "1 h" · 90 → "1 h 30 min". */
export function duracionTexto(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/** Margen de la ventana en palabras: 30 → "media hora" · 60 → "una hora" · 15 → "15 minutos". */
export function margenTexto(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m === 30) return "media hora";
  if (m === 60) return "una hora";
  if (m === 1) return "1 minuto";
  return `${m} minutos`;
}

/** Cuándo ocurre, en una frase: "Cada lunes a las 09:00". */
export function cuandoRito(c: unknown): string | null {
  if (!cadenciaValida(c)) return null;
  const dia = DIAS_SEMANA[c.dia_semana];
  if (c.frecuencia === "semanal") return `Cada ${dia} a las ${c.hora}`;
  if (c.frecuencia === "quincenal") return `Un ${dia} sí y otro no, a las ${c.hora}`;
  return `El ${ORDINAL_SEMANA[c.semana_del_mes]} ${dia} de cada mes, a las ${c.hora}`;
}

const formatosFecha = new Map<string, Intl.DateTimeFormat>();
const formatosHora = new Map<string, Intl.DateTimeFormat>();

function partesFecha(inicio: Date, tz: string): Record<string, string> {
  let f = formatosFecha.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("es-CO", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" });
    formatosFecha.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const parte of f.formatToParts(inicio)) if (parte.type !== "literal") p[parte.type] = parte.value;
  return p;
}

/** "viernes 9 de octubre" (en la zona del genoma). */
export function fechaRito(inicio: Date, tz: string): string {
  const p = partesFecha(inicio, tz);
  return `${p.weekday} ${p.day} de ${p.month}`;
}

/** "9 de octubre de 2026" (en la zona del genoma). */
export function fechaLargaRito(inicio: Date, tz: string): string {
  const p = partesFecha(inicio, tz);
  return `${p.day} de ${p.month} de ${p.year}`;
}

/** "16:00" (en la zona del genoma, reloj de 24 h). */
export function horaRito(inicio: Date, tz: string): string {
  let f = formatosHora.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatosHora.set(tz, f);
  }
  return f.format(inicio);
}

/** "1 persona registrada" · "3 personas registradas" (solo el conteo, nunca nombres). */
export function personasRegistradas(n: number): string {
  return n === 1 ? "1 persona registrada" : `${n} personas registradas`;
}
