/**
 * Motor de recordatorios de SLA (WP31 §5.C.1). PURO: recibe las piezas abiertas, la
 * configuración del genoma y el instante, y devuelve qué recordar, a quién (como
 * destino abstracto) y con qué texto. Quién es cada destinatario lo resuelve
 * `recordatorios-db.ts`; aquí no hay base, ni red, ni reloj propio.
 *
 * Reglas que este archivo hace cumplir:
 *  - Se habla de la ENTREGA, nunca de la persona: el texto lleva el título entre « » y,
 *    en los escalamientos, la prioridad y el proyecto. El responsable se ve en el
 *    enlace, nunca en el mensaje. Sin horas trabajadas, jornada ni "última conexión"
 *    (`VOCABULARIO_PROHIBIDO` lo vigila en los tests).
 *  - Sin avalancha: solo lo urgente (P1) sale en la corrida (`inmediato`); todo lo de
 *    High y Normal, escalamientos incluidos, va al resumen del día. Low no genera nada.
 *  - Guarda de arranque (`activadoDesde`): lo que ya estaba vencido antes de encender
 *    el motor no escala, y su aviso al dueño va al resumen, no al momento.
 *  - Todos los números salen del genoma (`configRecordatoriosDesdeGenoma`); las fechas,
 *    de `zona-horaria.ts` (vía `sla.ts`) en la zona del genoma.
 *  - Cada mensaje de Telegram cabe en el límite de la Bot API (`MAX_TEXTO_TELEGRAM`, un
 *    tope del protocolo, no del negocio): lo que no cabe se cuenta con «Y N más.».
 *
 * Reglas de construcción: módulo puro (sin `node:`, `db.ts`, `crypto.ts` ni
 * `session.ts`), sintaxis borrable e imports de valor con sufijo `.ts`.
 */
import type { Genome } from "./genome";
import {
  PRIORIDAD_CORTA,
  diasHabilesAntes,
  formatoVence,
  horasHabilesEntre,
  horasPorDiaHabil,
  inicioReloj,
  momentoEntrega,
  respondida,
  slaConfigDesdeGenoma,
  sumarHorasHabiles,
  venceEntrega,
  venceRespuesta,
  venceRevision,
  type PiezaSla,
  type SlaConfig,
} from "./sla.ts";
import { diaLocal, horaLocal, instanteDb, instanteLocal, parseInstanteDb } from "./zona-horaria.ts";

export type TipoRecordatorio =
  | "p1_asignada"
  | "p1_sin_respuesta"
  | "vence_pronto"
  | "vence_hoy"
  | "vencida"
  | "revision_pendiente"
  | "bloqueo"
  | "escala_supervisor"
  | "escala_founder";

export const TIPOS_RECORDATORIO: readonly TipoRecordatorio[] = [
  "p1_asignada",
  "p1_sin_respuesta",
  "vence_pronto",
  "vence_hoy",
  "vencida",
  "revision_pendiente",
  "bloqueo",
  "escala_supervisor",
  "escala_founder",
];

export type Destino =
  | { tipo: "persona"; wallet: string }
  | { tipo: "supervision"; initiativeId: number | null; incluyeRevisa: boolean } // incluyeRevisa solo en revision_pendiente
  | { tipo: "founder" };

export interface PiezaRecordable extends PiezaSla {
  title: string;
  owner_wallet: string | null;
  initiative_id: number | null;
  initiative_slug: string | null;
  initiative_name: string | null;
  blocked_reason: string | null;
  /** Cliente de la pieza (para que un escalamiento no llegue a quien no la ve). Opcional. */
  client_id?: number | null;
}

export interface ConfigRecordatorios extends SlaConfig {
  digestHora: number;
  p1SinRespuestaH: number;
  antesDias: { High: number; Normal: number };
  escalaSupervisorD: { High: number; Normal: number };
  escalaFounderD: { High: number; Normal: number };
  p1FounderFactor: number;
  maxInmediatos: number; // REMINDER_MAX_INMEDIATOS: tope por persona y corrida
  activadoDesde: Date | null; // guarda de arranque; la calcula recordatorios-db (§5.C.2)
}

export interface Recordatorio {
  tipo: TipoRecordatorio;
  assignmentId: number;
  destino: Destino;
  clave: string;
  inmediato: boolean;
  texto: string;
  enlace: string; // ruta relativa
}

/**
 * Palabras que ningún texto de recordatorio puede decir (spec §5.C.1 y §8.8): juzgan a
 * la persona o miden presencia. Se califica la entrega, nunca a quien la hace.
 */
export const VOCABULARIO_PROHIBIDO: readonly RegExp[] = [
  /atrasad/i,
  /vas tarde|llegó tarde/i,
  /bajo desempeño/i,
  /\brojo\b/i,
  /ranking/i,
  /última conexión/i,
  /horas trabajadas/i,
  /perdiste/i,
  /castigo/i,
  /jornada/i,
  /\bempleado\b/i,
  /\bjefe\b/i,
];

/** Mapeo genoma → configuración del motor (todo número sale de aquí). */
export function configRecordatoriosDesdeGenoma(g: Genome): ConfigRecordatorios {
  return {
    ...slaConfigDesdeGenoma(g),
    digestHora: g.REMINDER_DIGEST_HOUR,
    p1SinRespuestaH: g.REMINDER_P1_NO_RESPONSE_H,
    antesDias: { High: g.REMINDER_BEFORE_D.High, Normal: g.REMINDER_BEFORE_D.Normal },
    escalaSupervisorD: { High: g.ESCALATE_SUPERVISOR_D.High, Normal: g.ESCALATE_SUPERVISOR_D.Normal },
    escalaFounderD: { High: g.ESCALATE_FOUNDER_D.High, Normal: g.ESCALATE_FOUNDER_D.Normal },
    p1FounderFactor: g.ESCALATE_P1_FOUNDER_FACTOR,
    maxInmediatos: g.REMINDER_MAX_INMEDIATOS,
    activadoDesde: null,
  };
}

// ---------------------------------------------------------------------------
// Ayudas de tiempo y de texto
// ---------------------------------------------------------------------------

function valida(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function dos(n: number): string {
  return String(n).padStart(2, "0");
}

/** `HH:MM` local de un instante en la zona dada. */
function hhmmLocal(instante: Date, tz: string): string {
  const dia = diaLocal(instante, tz);
  const h = horaLocal(instante, tz);
  const inicioHora = instanteLocal(dia, `${dos(h)}:00`, tz).getTime();
  const min = Math.max(0, Math.min(59, Math.floor((instante.getTime() - inicioHora) / 60_000)));
  return `${dos(h)}:${dos(min)}`;
}

/** "a las 14:00" si es hoy; si no, el formato relativo ("mañana 09:00", "jue 16:00"). */
function horaOFecha(vence: Date, ahora: Date, c: SlaConfig): string {
  return diaLocal(vence, c.tz) === diaLocal(ahora, c.tz) ? hhmmLocal(vence, c.tz) : formatoVence(vence, ahora, c);
}

function diasHabiles(n: number): string {
  return n === 1 ? "1 día hábil" : `${n} días hábiles`;
}

/** Título de la pieza en una sola línea y con un largo razonable (lo escribe la gente). */
function tituloDe(p: PiezaRecordable): string {
  const t = String(p.title ?? "").replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 139)}…` : t || "Sin título";
}

function motivoDe(p: PiezaRecordable): string | null {
  const m = String(p.blocked_reason ?? "").replace(/\s+/g, " ").trim();
  if (!m) return null;
  return m.length > 160 ? `${m.slice(0, 159)}…` : m;
}

/** Nombre del proyecto en una línea y con un largo razonable, como el título y el motivo. */
function proyectoDe(p: PiezaRecordable): string {
  const n = String(p.initiative_name ?? "").replace(/\s+/g, " ").trim();
  return n ? recortar(n, 80) : "sin proyecto";
}

/** Dónde se ve la pieza (y su responsable): el tablero del proyecto o el día. */
function enlaceDe(p: PiezaRecordable): string {
  const slug = typeof p.initiative_slug === "string" ? p.initiative_slug.trim() : "";
  return /^[a-z0-9-]+$/.test(slug) ? `/equipo/proyectos/${slug}` : "/equipo/hoy";
}

/** Clave estable de un instante guardado (sin depender de si llevaba `Z` o no). */
function claveInstante(s: string): string {
  const d = parseInstanteDb(s);
  return valida(d) ? instanteDb(d).replace(" ", "T") : String(s).trim();
}

// ---------------------------------------------------------------------------
// Planificación
// ---------------------------------------------------------------------------

const EN_MARCHA: ReadonlySet<string> = new Set(["Asignada", "En curso"]);

/** ¿El vencimiento que dispara este aviso es anterior a la activación del motor? */
function anteriorALaActivacion(vence: Date | null, cfg: ConfigRecordatorios, ahora: Date): boolean {
  const desde = valida(cfg.activadoDesde) ? cfg.activadoDesde : ahora;
  return valida(vence) && vence.getTime() < desde.getTime();
}

/**
 * Qué recordar en `ahora` (tabla de §5.C.1). Determinista: mismo `ahora`, mismas piezas
 * y misma configuración → mismos recordatorios, en orden de pieza.
 */
export function planificarRecordatorios(
  piezas: PiezaRecordable[],
  cfg: ConfigRecordatorios,
  ahora: Date
): Recordatorio[] {
  const out: Recordatorio[] = [];
  if (!valida(ahora)) return out;
  const hoy = diaLocal(ahora, cfg.tz);
  const h = horasPorDiaHabil(cfg);
  const ordenadas = [...piezas].sort((a, b) => a.id - b.id);

  for (const p of ordenadas) {
    if (p.priority === "Low") continue; // Low no genera nada en v1 (sin digest semanal de P4)
    if (p.status === "Hecha" || p.status === "Backlog") continue; // sin responsable o ya aprobada
    const urgente = p.priority === "Urgent";
    const P = PRIORIDAD_CORTA[p.priority] ?? "P3";
    const titulo = `«${tituloDe(p)}»`;
    const enlace = enlaceDe(p);
    const id = p.id;
    const dueno: Destino | null = p.owner_wallet ? { tipo: "persona", wallet: p.owner_wallet } : null;
    const supervision: Destino = { tipo: "supervision", initiativeId: p.initiative_id ?? null, incluyeRevisa: false };
    const add = (r: Omit<Recordatorio, "assignmentId" | "enlace">) => out.push({ ...r, assignmentId: id, enlace });

    // --- Primera respuesta de lo urgente (al dueño, al momento) -------------------
    if (urgente && p.status === "Asignada" && !respondida(p) && dueno) {
      const vr = venceRespuesta(p, cfg);
      const viejo = anteriorALaActivacion(vr, cfg, ahora);
      add({
        tipo: "p1_asignada",
        destino: dueno,
        clave: `p1_asignada:${id}`,
        inmediato: !viejo,
        texto: valida(vr)
          ? `${titulo} (P1) es urgente y te espera. Primera respuesta antes de ${horaOFecha(vr, ahora, cfg)}.`
          : `${titulo} (P1) es urgente y te espera.`,
      });
      const inicio = inicioReloj(p);
      if (valida(inicio) && horasHabilesEntre(inicio, ahora, cfg) >= cfg.p1SinRespuestaH) {
        add({
          tipo: "p1_sin_respuesta",
          destino: dueno,
          clave: `p1_sin_respuesta:${id}`,
          inmediato: !viejo,
          texto: valida(vr)
            ? `${titulo} (P1) aún no tiene primera respuesta. Plazo: ${formatoVence(vr, ahora, cfg)}.`
            : `${titulo} (P1) aún no tiene primera respuesta.`,
        });
      }
    }

    // --- Entrega (Asignada / En curso) -------------------------------------------
    if (EN_MARCHA.has(p.status)) {
      const ve = venceEntrega(p, cfg);
      if (valida(ve)) {
        const diaVence = diaLocal(ve, cfg.tz);
        const viejo = anteriorALaActivacion(ve, cfg, ahora);
        const vencida = ahora.getTime() > ve.getTime();

        if (!urgente && dueno && !vencida) {
          const antes = p.priority === "High" ? cfg.antesDias.High : cfg.antesDias.Normal;
          if (diaVence !== hoy && hoy === diasHabilesAntes(diaVence, antes, cfg)) {
            add({
              tipo: "vence_pronto",
              destino: dueno,
              clave: `vence_pronto:${id}:${diaVence}`,
              inmediato: false,
              texto: `${titulo} (${P}) vence ${formatoVence(ve, ahora, cfg)}.`,
            });
          }
        }

        if (dueno && !vencida && diaVence === hoy) {
          add({
            tipo: "vence_hoy",
            destino: dueno,
            clave: `vence_hoy:${id}:${diaVence}`,
            inmediato: urgente,
            texto: `${titulo} (${P}) vence hoy a las ${hhmmLocal(ve, cfg.tz)}.`,
          });
        }

        if (vencida) {
          if (dueno) {
            add({
              tipo: "vencida",
              destino: dueno,
              clave: `vencida:${id}:${diaVence}`,
              // Lo vencido antes de encender el motor va al resumen del dueño, no al momento.
              inmediato: urgente && !viejo,
              texto: `${titulo} (${P}) pasó su fecha de entrega (${formatoVence(ve, ahora, cfg)}). Puedes pedir nueva fecha o bloquearla con motivo.`,
            });
          }

          if (!viejo) {
            const umbralSup = urgente
              ? ve
              : sumarHorasHabiles(
                  ve,
                  (p.priority === "High" ? cfg.escalaSupervisorD.High : cfg.escalaSupervisorD.Normal) * h,
                  cfg
                );
            if (valida(umbralSup) && ahora.getTime() >= umbralSup.getTime()) {
              add({
                tipo: "escala_supervisor",
                destino: supervision,
                clave: `escala_supervisor:${id}:${diaVence}`,
                inmediato: urgente,
                texto: `${titulo} (${P} · ${proyectoDe(p)}) pasó su plazo. ¿Ayudas a destrabarla o a acordar nueva fecha?`,
              });
            }

            let umbralFounder: Date | null = null;
            let cuanto = "";
            if (urgente) {
              const entregaH = cfg.entregaH.Urgent;
              if (typeof entregaH === "number" && Number.isFinite(entregaH)) {
                umbralFounder = sumarHorasHabiles(inicioReloj(p), entregaH * cfg.p1FounderFactor, cfg);
                cuanto = cfg.p1FounderFactor === 2 ? "el doble de su plazo" : `${cfg.p1FounderFactor} veces su plazo`;
              }
            } else {
              const d = p.priority === "High" ? cfg.escalaFounderD.High : cfg.escalaFounderD.Normal;
              umbralFounder = sumarHorasHabiles(ve, d * h, cfg);
              cuanto = diasHabiles(Math.max(1, Math.floor(horasHabilesEntre(ve, ahora, cfg) / h)));
            }
            if (valida(umbralFounder) && ahora.getTime() >= umbralFounder.getTime()) {
              add({
                tipo: "escala_founder",
                destino: { tipo: "founder" },
                clave: `escala_founder:${id}:${diaVence}`,
                inmediato: urgente,
                texto: `${titulo} (${P} · ${proyectoDe(p)}) lleva ${cuanto} sin entrega. Está en tu bandeja.`,
              });
            }
          }
        }
      }
    }

    // --- Revisión pendiente (a quien estructura y a quien revisa) -----------------
    if (p.status === "En revisión") {
      const vrev = venceRevision(p, cfg);
      const envio = momentoEntrega(p);
      if (valida(vrev) && valida(envio) && ahora.getTime() > vrev.getTime() && !anteriorALaActivacion(vrev, cfg, ahora)) {
        add({
          tipo: "revision_pendiente",
          destino: { tipo: "supervision", initiativeId: p.initiative_id ?? null, incluyeRevisa: true },
          clave: `revision:${id}:${diaLocal(envio, cfg.tz)}`,
          inmediato: urgente,
          texto: `${titulo} espera revisión desde ${formatoVence(envio, ahora, cfg)}.`,
        });
      }
    }

    // --- Bloqueo -------------------------------------------------------------------
    if (p.status === "Bloqueada" && p.blocked_at) {
      const desde = parseInstanteDb(p.blocked_at);
      if (valida(desde)) {
        const horas = horasHabilesEntre(desde, ahora, cfg);
        const escala = sumarHorasHabiles(desde, cfg.bloqueoEscalaH, cfg);
        const viejo = anteriorALaActivacion(escala, cfg, ahora);
        const marca = claveInstante(p.blocked_at);
        const dias = diasHabiles(Math.max(1, Math.floor(horas / h)));
        if (!viejo && horas >= cfg.bloqueoEscalaH) {
          const motivo = motivoDe(p);
          add({
            tipo: "bloqueo",
            destino: supervision,
            clave: `bloqueo:${id}:${marca}`,
            inmediato: urgente,
            texto: motivo
              ? `${titulo} lleva ${dias} bloqueada: «${motivo}».`
              : `${titulo} lleva ${dias} bloqueada.`,
          });
        }
        if (!viejo && horas >= cfg.bloqueoFounderH) {
          add({
            tipo: "escala_founder",
            destino: { tipo: "founder" },
            clave: `escala_founder:${id}:${marca}`,
            inmediato: urgente,
            texto: `${titulo} (${P} · ${proyectoDe(p)}) lleva ${dias} bloqueada. Está en tu bandeja.`,
          });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mensajes (Telegram, siempre sin parse_mode: los títulos los escribe la gente)
// ---------------------------------------------------------------------------

/**
 * Largo máximo de un mensaje del motor. La Bot API rechaza un `sendMessage` de más de
 * 4096 caracteres (y entonces no sale nada y se reintentaría para siempre); se deja
 * margen. No es un parámetro del negocio sino del protocolo, por eso no vive en el
 * genoma. `String.length` cuenta unidades UTF-16, igual o más que Telegram.
 */
export const MAX_TEXTO_TELEGRAM = 4000;

function base(appUrl: string): string {
  return String(appUrl ?? "").trim().replace(/\/+$/, "");
}

/** Corta `s` a `max` caracteres con «…», sin partir un par sustituto (emoji). */
function recortar(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return "…";
  let corte = max - 1;
  const c = s.charCodeAt(corte - 1);
  if (c >= 0xd800 && c <= 0xdbff) corte--;
  return `${s.slice(0, corte)}…`;
}

/**
 * Largo máximo de cada línea de un mensaje. El plan ya recorta título, motivo y proyecto,
 * así que es una defensa: un texto desmesurado se corta con «…» y no deja fuera a los demás.
 */
export const MAX_LINEA_TELEGRAM = 600;

/** Lo que se reserva para la línea «Y N más.» mientras se llena el mensaje. */
const RESERVA_RESTO = 24;

/**
 * Un mensaje de Telegram que siempre cabe en `MAX_TEXTO_TELEGRAM`: cabecera, tantas
 * líneas como quepan (en orden) y, si no caben todas, «Y N más.» antes del enlace; lo
 * demás está en la bandeja de Zelena. Sigue siendo UN mensaje por persona: no se
 * trocea, así no hay trozos que se repitan si uno falla ni se inunda a nadie.
 */
function mensajeConTope(cabecera: string | null, lineas: string[], pie: string): string {
  const max = MAX_TEXTO_TELEGRAM;
  const arriba = cabecera === null ? [] : [cabecera];
  const items = lineas.map((l) => recortar(l, MAX_LINEA_TELEGRAM));
  const entero = [...arriba, ...items, pie].join("\n");
  if (entero.length <= max) return entero;
  // No cabe todo: entran las primeras líneas (cada una con su salto) dejando sitio para «Y N más.».
  let usado = (cabecera === null ? 0 : cabecera.length + 1) + RESERVA_RESTO + pie.length;
  let n = 0;
  while (n < items.length && usado + items[n].length + 1 <= max) {
    usado += items[n].length + 1;
    n++;
  }
  const partes = [...arriba, ...items.slice(0, n), `Y ${items.length - n} más.`, pie];
  return recortar(partes.join("\n"), max); // última defensa (un enlace desmesurado): nunca pasa del límite
}

/** Un recordatorio inmediato suelto, con su enlace. */
export function renderInmediato(r: Recordatorio, appUrl: string): string {
  return mensajeConTope(null, [r.texto], `Ver en Zelena: ${base(appUrl)}${r.enlace}`);
}

/**
 * Los inmediatos de una persona en una corrida: uno suelto, o todos juntos en un mensaje
 * (con «Y N más.» si no caben en `MAX_TEXTO_TELEGRAM`).
 */
export function renderInmediatos(items: Recordatorio[], appUrl: string): string {
  if (items.length === 1) return renderInmediato(items[0], appUrl);
  return mensajeConTope(
    "Lo urgente de ahora:",
    items.map((r) => `· ${r.texto}`),
    `Ver en Zelena: ${base(appUrl)}/equipo/avisos`
  );
}

/**
 * El resumen del día de una persona: un mensaje con todo lo que no era urgente (con
 * «Y N más.» si no cabe en `MAX_TEXTO_TELEGRAM`; todo sigue en la bandeja).
 */
export function renderDigest(items: Recordatorio[], appUrl: string): string {
  return mensajeConTope(
    "Esto es lo de hoy en tus entregas:",
    items.map((r) => `· ${r.texto}`),
    `Ver en Zelena: ${base(appUrl)}/equipo/hoy`
  );
}
