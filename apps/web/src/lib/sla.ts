/**
 * SLA de las entregas (WP31 §5.B.2): horas hábiles, vencimientos por fase y semáforo.
 *
 * Qué mide y qué no:
 *  - Mide la ENTREGA (cuándo vence una pieza de trabajo), nunca a la persona: no hay
 *    horas trabajadas, ni jornada, ni "última conexión". El semáforo dice si una pieza
 *    va a tiempo; quién la tiene se ve en el tablero, no aquí.
 *  - Los plazos salen del genoma (`SLA_*`, `BUSINESS_*`): `slaConfigDesdeGenoma` es el
 *    único puente. Aquí no hay ningún número de negocio.
 *  - "A tiempo" para el bono (literal de la decisión del líder) = la tarea se APROBÓ
 *    antes de su vencimiento de entrega (`aprobadaATiempo`). Si llega tarde no se
 *    resta nada: solo no hay extra.
 *
 * Reglas de construcción:
 *  - Módulo PURO y apto para cliente: sin base, sin `crypto.ts`, sin `session.ts`, sin
 *    `node:`. Los cargadores desde la base viven en `sla-db.ts`.
 *  - Toda conversión entre instantes y fechas/horas locales pasa por `zona-horaria.ts`
 *    (sin constantes de zona). Sin festivos en v1.
 *  - Sintaxis borrable e imports de valor con sufijo `.ts`: queda en la cadena de
 *    `team.ts`, que el CLI de Node carga con type-stripping.
 */
import type { Genome } from "./genome";
import type { TeamStatus } from "./team-state-machine";
import { diaLocal, diaSemanaIso, horaLocal, instanteLocal, parseInstanteDb } from "./zona-horaria.ts";

// Se re-exportan para quien ya importa de aquí; no se reimplementan (§5.0).
export { diaLocal, horaLocal, parseInstanteDb };

export type SlaPrioridad = "Urgent" | "High" | "Normal" | "Low";
export type SlaEstado = "a_tiempo" | "por_vencer" | "vencida" | "sin_plazo";
export type SlaFase = "respuesta" | "entrega" | "revision" | "bloqueo";

export const SLA_LABEL: Record<SlaEstado, string> = {
  a_tiempo: "A tiempo",
  por_vencer: "Por vencer",
  vencida: "Vencida",
  sin_plazo: "Sin plazo",
};

export const PRIORIDAD_CORTA: Record<SlaPrioridad, string> = {
  Urgent: "P1",
  High: "P2",
  Normal: "P3",
  Low: "P4",
};

const PRIORIDADES: readonly SlaPrioridad[] = ["Urgent", "High", "Normal", "Low"];

export function isSlaPrioridad(v: unknown): v is SlaPrioridad {
  return typeof v === "string" && (PRIORIDADES as readonly string[]).includes(v);
}

export interface SlaConfig {
  tz: string;
  diasHabiles: number[];
  horaInicio: number;
  horaFin: number;
  respuestaH: Record<SlaPrioridad, number>; // horas hábiles
  entregaH: Record<SlaPrioridad, number | null>; // null = sin plazo propio (Low)
  revisionH: Record<SlaPrioridad, number>;
  bloqueoEscalaH: number;
  bloqueoFounderH: number;
  avisoPct: number;
  avisoMaxH: number;
}

const MS_HORA = 3_600_000;
/** Tope de días que recorre un cálculo: protege de un genoma sin días hábiles. */
const MAX_DIAS = 366 * 30;

/** 1 día hábil, en horas (`horaFin − horaInicio`). */
export function horasPorDiaHabil(c: SlaConfig): number {
  return c.horaFin - c.horaInicio;
}

/** Mapeo genoma → `SlaConfig` (tabla de §5.B.2; `h` = horas de un día hábil). */
export function slaConfigDesdeGenoma(g: Genome): SlaConfig {
  const h = g.BUSINESS_HOUR_END - g.BUSINESS_HOUR_START;
  const revision = g.SLA_REVIEW_D * h;
  return {
    tz: g.BUSINESS_TZ,
    diasHabiles: [...g.BUSINESS_DAYS],
    horaInicio: g.BUSINESS_HOUR_START,
    horaFin: g.BUSINESS_HOUR_END,
    respuestaH: {
      Urgent: g.SLA_P1_RESPONSE_H,
      High: g.SLA_P2_RESPONSE_H,
      Normal: g.SLA_P3_RESPONSE_D * h,
      Low: g.SLA_P4_TRIAGE_D * h,
    },
    entregaH: {
      Urgent: g.SLA_P1_RESTORE_H,
      High: g.SLA_P2_RESOLVE_D * h,
      Normal: g.SLA_P3_RESOLVE_D * h,
      Low: null,
    },
    revisionH: { Urgent: g.SLA_P1_REVIEW_H, High: revision, Normal: revision, Low: revision },
    bloqueoEscalaH: g.SLA_BLOCK_ESCALATE_D * h,
    bloqueoFounderH: g.SLA_BLOCK_FOUNDER_D * h,
    avisoPct: g.SLA_WARN_PCT,
    avisoMaxH: g.SLA_WARN_MAX_H,
  };
}

// ---------------------------------------------------------------------------
// Calendario y horas hábiles (por días locales de `tz`)
// ---------------------------------------------------------------------------

function valida(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function dos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Suma `n` días de calendario a un `AAAA-MM-DD` (aritmética de fechas, sin zona). */
function sumarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const r = new Date(Date.UTC(a, m - 1, d + n));
  return `${String(r.getUTCFullYear()).padStart(4, "0")}-${dos(r.getUTCMonth() + 1)}-${dos(r.getUTCDate())}`;
}

/** Días de calendario de `a` a `b` (ambos `AAAA-MM-DD`). */
function diasEntre(a: string, b: string): number {
  const [a1, m1, d1] = a.split("-").map(Number);
  const [a2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/** El instante de esa fecha a esa hora local (admite fracción de hora y la hora 24). */
function instanteHora(dia: string, hora: number, tz: string): Date {
  if (hora >= 24) return instanteLocal(sumarDias(dia, Math.floor(hora / 24)), "00:00", tz);
  const hh = Math.floor(hora);
  const mm = Math.min(59, Math.round((hora - hh) * 60));
  return instanteLocal(dia, `${dos(hh)}:${dos(mm)}`, tz);
}

/** ¿Es `dia` (`AAAA-MM-DD`) un día hábil? Sin festivos en v1. */
export function esDiaHabil(dia: string, c: SlaConfig): boolean {
  return c.diasHabiles.includes(diaSemanaIso(dia));
}

/** ¿Cae el instante dentro del horario hábil (día hábil, `horaInicio ≤ h < horaFin`)? */
export function esHorarioHabil(instante: Date, c: SlaConfig): boolean {
  if (!valida(instante)) return false;
  const dia = diaLocal(instante, c.tz);
  if (!esDiaHabil(dia, c)) return false;
  const t = instante.getTime();
  return t >= instanteHora(dia, c.horaInicio, c.tz).getTime() && t < instanteHora(dia, c.horaFin, c.tz).getTime();
}

/**
 * `desde` + `horas` hábiles. Fuera de horario, el reloj arranca en el siguiente
 * momento hábil: lun 17:00 + 2 h → mar 09:00; sáb 10:00 + 1 h → lun 09:00. Si cae
 * justo al cierre, devuelve el cierre (lun 08:00 + 10 h → lun 18:00).
 */
export function sumarHorasHabiles(desde: Date, horas: number, c: SlaConfig): Date {
  if (!valida(desde) || !Number.isFinite(horas)) return new Date(NaN);
  let restante = Math.max(0, horas) * MS_HORA;
  let dia = diaLocal(desde, c.tz);
  const desdeMs = desde.getTime();
  for (let i = 0; i < MAX_DIAS; i++, dia = sumarDias(dia, 1)) {
    if (!esDiaHabil(dia, c)) continue;
    const ini = instanteHora(dia, c.horaInicio, c.tz).getTime();
    const fin = instanteHora(dia, c.horaFin, c.tz).getTime();
    const arranque = Math.max(desdeMs, ini);
    if (arranque >= fin) continue;
    const disponible = fin - arranque;
    if (restante <= disponible) return new Date(arranque + restante);
    restante -= disponible;
  }
  return new Date(NaN);
}

function msHabilesEntre(desde: Date, hasta: Date, c: SlaConfig): number {
  if (!valida(desde) || !valida(hasta)) return 0;
  const a = desde.getTime();
  const b = hasta.getTime();
  if (b <= a) return 0;
  let total = 0;
  const ultimo = diaLocal(hasta, c.tz);
  let dia = diaLocal(desde, c.tz);
  for (let i = 0; i < MAX_DIAS; i++, dia = sumarDias(dia, 1)) {
    if (esDiaHabil(dia, c)) {
      const ini = Math.max(a, instanteHora(dia, c.horaInicio, c.tz).getTime());
      const fin = Math.min(b, instanteHora(dia, c.horaFin, c.tz).getTime());
      if (fin > ini) total += fin - ini;
    }
    if (dia >= ultimo) break;
  }
  return total;
}

/** Horas hábiles entre dos instantes (0 si `hasta <= desde`). */
export function horasHabilesEntre(desde: Date, hasta: Date, c: SlaConfig): number {
  return msHabilesEntre(desde, hasta, c) / MS_HORA;
}

/** El día (`AAAA-MM-DD`) que queda `n` días hábiles antes de `dia`. Con `n = 0`, `dia`. */
export function diasHabilesAntes(dia: string, n: number, c: SlaConfig): string {
  let d = dia;
  let cuenta = 0;
  for (let i = 0; cuenta < n && i < MAX_DIAS; i++) {
    d = sumarDias(d, -1);
    if (esDiaHabil(d, c)) cuenta++;
  }
  return d;
}

/** Esa fecha a la hora de cierre del horario hábil (vencimiento de un `due_date`). */
export function finDeDia(fechaYmd: string, c: SlaConfig): Date {
  return instanteHora(fechaYmd, c.horaFin, c.tz);
}

// ---------------------------------------------------------------------------
// Piezas y vencimientos por fase
// ---------------------------------------------------------------------------

export interface EventoSla {
  action: string;
  from_status: string;
  to_status: string;
  created_at: string;
}

export interface PiezaSla {
  id: number;
  priority: SlaPrioridad;
  status: TeamStatus;
  due_date: string | null;
  created_at: string;
  blocked_at: string | null;
  eventos: EventoSla[]; // eventos en orden de id
}

export interface SlaResultado {
  fase: SlaFase | null;
  vence: Date | null;
  estado: SlaEstado;
  horasRestantes: number | null;
  respondida: boolean;
}

/** Estados que cuentan como primera respuesta a una pieza asignada. */
const RESPONDE: ReadonlySet<string> = new Set(["En curso", "En revisión", "Bloqueada", "Hecha"]);

function indiceInicio(p: PiezaSla): number {
  return p.eventos.findIndex((e) => e.to_status === "Asignada");
}

function ultimoEvento(p: PiezaSla, action: string): EventoSla | null {
  for (let i = p.eventos.length - 1; i >= 0; i--) if (p.eventos[i].action === action) return p.eventos[i];
  return null;
}

function horasDe(tabla: Record<SlaPrioridad, number | null>, p: PiezaSla): number | null {
  const v = tabla[isSlaPrioridad(p.priority) ? p.priority : "Normal"];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Inicio del reloj: el primer evento que deja la pieza en `Asignada`; si no hay, su `created_at`. */
export function inicioReloj(p: PiezaSla): Date {
  const i = indiceInicio(p);
  return parseInstanteDb(i >= 0 ? p.eventos[i].created_at : p.created_at);
}

/** ¿Hubo primera respuesta? Algún evento posterior al inicio la llevó a En curso, En revisión, Bloqueada o Hecha. */
export function respondida(p: PiezaSla): boolean {
  return p.eventos.slice(indiceInicio(p) + 1).some((e) => RESPONDE.has(e.to_status));
}

/** Vencimiento de la primera respuesta: inicio + `respuestaH`. */
export function venceRespuesta(p: PiezaSla, c: SlaConfig): Date {
  const h = horasDe(c.respuestaH, p);
  return h === null ? new Date(NaN) : sumarHorasHabiles(inicioReloj(p), h, c);
}

function dueDateValida(p: PiezaSla): string | null {
  const d = typeof p.due_date === "string" ? p.due_date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  try {
    diaSemanaIso(d); // lanza si la fecha no existe (p. ej. 2026-02-30)
    return d;
  } catch {
    return null;
  }
}

/**
 * Vencimiento de la entrega: con `due_date`, el cierre del horario hábil de ese día
 * (la fecha manda); sin fecha, inicio + `entregaH` de su prioridad (Low: sin plazo → null).
 */
export function venceEntrega(p: PiezaSla, c: SlaConfig): Date | null {
  const due = dueDateValida(p);
  if (due) return finDeDia(due, c);
  const h = horasDe(c.entregaH, p);
  if (h === null) return null;
  const v = sumarHorasHabiles(inicioReloj(p), h, c);
  return valida(v) ? v : null;
}

/** Vencimiento de la revisión: último `enviar_a_revision` + `revisionH`; null si nunca se envió. */
export function venceRevision(p: PiezaSla, c: SlaConfig): Date | null {
  const envio = momentoEntrega(p);
  const h = horasDe(c.revisionH, p);
  if (!envio || h === null) return null;
  const v = sumarHorasHabiles(envio, h, c);
  return valida(v) ? v : null;
}

/** Momento de la entrega: el último evento `enviar_a_revision`. */
export function momentoEntrega(p: PiezaSla): Date | null {
  const e = ultimoEvento(p, "enviar_a_revision");
  const d = e ? parseInstanteDb(e.created_at) : null;
  return valida(d) ? d : null;
}

/** Momento de la aprobación: el último evento `aprobar`. */
export function momentoAprobacion(p: PiezaSla): Date | null {
  const e = ultimoEvento(p, "aprobar");
  const d = e ? parseInstanteDb(e.created_at) : null;
  return valida(d) ? d : null;
}

/**
 * Bono de puntualidad (literal del líder): se APROBÓ a tiempo. `aprobadaEn` por
 * defecto = `momentoAprobacion`. `aprobadaEn <= venceEntrega` → true; sin plazo
 * (`venceEntrega` null) o sin aprobación → false. Llegar tarde no resta nada: solo
 * no hay extra.
 */
export function aprobadaATiempo(p: PiezaSla, c: SlaConfig, aprobadaEn?: Date): boolean {
  const vence = venceEntrega(p, c);
  if (!valida(vence)) return false;
  const en = aprobadaEn ?? momentoAprobacion(p);
  if (!valida(en)) return false;
  return en.getTime() <= vence.getTime();
}

/** Semáforo de una pieza en `ahora` (tabla de §5.B.2). */
export function evaluarSla(p: PiezaSla, c: SlaConfig, ahora: Date): SlaResultado {
  const resp = respondida(p);
  let fase: SlaFase | null = null;
  let vence: Date | null = null;
  let inicioFase: Date | null = null;

  switch (p.status) {
    case "Backlog":
      // Solo lo urgente corre desde que existe; el resto espera a tener responsable.
      if (p.priority === "Urgent") {
        fase = "respuesta";
        vence = venceRespuesta(p, c);
        inicioFase = inicioReloj(p);
      }
      break;
    case "Asignada": {
      const entrega = venceEntrega(p, c);
      inicioFase = inicioReloj(p);
      if (!resp) {
        // La más próxima entre la primera respuesta y la entrega.
        const respuesta = venceRespuesta(p, c);
        if (valida(entrega) && (!valida(respuesta) || entrega.getTime() < respuesta.getTime())) {
          fase = "entrega";
          vence = entrega;
        } else {
          fase = "respuesta";
          vence = respuesta;
        }
      } else {
        fase = "entrega";
        vence = entrega;
      }
      break;
    }
    case "En curso":
      fase = "entrega";
      vence = venceEntrega(p, c);
      inicioFase = inicioReloj(p);
      break;
    case "En revisión":
      fase = "revision";
      vence = venceRevision(p, c);
      inicioFase = momentoEntrega(p);
      break;
    case "Bloqueada": {
      const desde = p.blocked_at ? parseInstanteDb(p.blocked_at) : null;
      if (valida(desde)) {
        fase = "bloqueo";
        vence = sumarHorasHabiles(desde, c.bloqueoEscalaH, c);
        inicioFase = desde;
      }
      break;
    }
    default:
      break; // Hecha: ya no corre ningún plazo
  }

  if (!fase || !valida(vence)) {
    return { fase: null, vence: null, estado: "sin_plazo", horasRestantes: null, respondida: resp };
  }
  if (ahora.getTime() > vence.getTime()) {
    return { fase, vence, estado: "vencida", horasRestantes: 0, respondida: resp };
  }
  const restante = msHabilesEntre(ahora, vence, c);
  const ventana = valida(inicioFase) ? msHabilesEntre(inicioFase, vence, c) : restante;
  const umbral = Math.min((ventana * c.avisoPct) / 100, c.avisoMaxH * MS_HORA);
  return {
    fase,
    vence,
    estado: restante <= umbral ? "por_vencer" : "a_tiempo",
    horasRestantes: Math.round((restante / MS_HORA) * 100) / 100,
    respondida: resp,
  };
}

// ---------------------------------------------------------------------------
// Texto del vencimiento
// ---------------------------------------------------------------------------

const DIA_CORTO = ["", "lun", "mar", "mié", "jue", "vie", "sáb", "dom"]; // índice ISO
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function horaMinutoLocal(instante: Date, tz: string): string {
  const dia = diaLocal(instante, tz);
  const h = horaLocal(instante, tz);
  const inicioHora = instanteLocal(dia, `${dos(h)}:00`, tz).getTime();
  const min = Math.max(0, Math.min(59, Math.floor((instante.getTime() - inicioHora) / 60_000)));
  return `${dos(h)}:${dos(min)}`;
}

/**
 * Cuándo vence, en la zona del genoma y relativo a `ahora`: "hoy 14:00",
 * "mañana 09:00", "ayer 18:00", "jue 16:00" (próximos 6 días) o "3 oct 18:00".
 */
export function formatoVence(vence: Date, ahora: Date, c: SlaConfig): string {
  if (!valida(vence) || !valida(ahora)) return "";
  const dv = diaLocal(vence, c.tz);
  const da = diaLocal(ahora, c.tz);
  const hhmm = horaMinutoLocal(vence, c.tz);
  const dif = diasEntre(da, dv);
  if (dif === 0) return `hoy ${hhmm}`;
  if (dif === 1) return `mañana ${hhmm}`;
  if (dif === -1) return `ayer ${hhmm}`;
  if (dif > 1 && dif < 7) return `${DIA_CORTO[diaSemanaIso(dv)]} ${hhmm}`;
  const [anio, mes, dia] = dv.split("-").map(Number);
  const anioTxt = dv.slice(0, 4) === da.slice(0, 4) ? "" : ` ${anio}`;
  return `${dia} ${MES_CORTO[mes - 1]}${anioTxt} ${hhmm}`;
}
