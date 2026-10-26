/**
 * Genoma versionado — Doc 16 §3: en Zelena evolucionan las REGLAS, no las personas.
 *
 * Los parámetros evolutivos del sistema (presupuestos de época, caps de Academia,
 * topes de invitación por tier) viven como configuración versionada en la tabla
 * `genome_versions` (append-only). Todo el código los lee vía `getActiveGenome()`;
 * nunca se hardcodean valores nuevos (guardrail de CLAUDE.md). Cada cambio es una
 * versión nueva ligada a una entrada del decision log y con `effective_from_epoch`:
 * nada aplica retroactivamente ni a mitad de época.
 *
 * WP31 (genoma v2): las claves de entregas, plazos (SLA), recordatorios y ritos se
 * suman como `GENOME_V2_NUEVAS`. `getActiveGenome` mezcla SIEMPRE lo guardado sobre
 * `GENOME_DEFAULTS`: una versión vieja (la v1 de producción) se lee con todas las
 * claves, y la app funciona aunque la migración `seedGenomeV2` no haya corrido.
 *
 * Sintaxis borrable y sin `node:`: lo importa `sim.ts` desde el CLI de Node
 * (type-stripping) y queda en la cadena de `team.ts`, que también llega a un
 * componente de cliente. Por eso el sha256 del decision log va en JS puro aquí.
 */
import type { DB } from "./db";
import type { FitnessWeights } from "./fitness";
import { diaLocal } from "./zona-horaria.ts";

/** Las 8 claves del genoma v1 (WP02/WP07/WP19). Sin cambios: hay un test de regresión. */
export interface GenomeV1 {
  EPOCH_BUDGET: number; // puntos ZWORK totales por época
  ACADEMIA_BUDGET: number; // presupuesto separado de Academia
  ACADEMIA_DAILY_CAP: number; // máx. contenidos con puntos por día y wallet
  ACADEMIA_DIMINISHING: number[]; // multiplicadores 1º/2º/3º del día
  ACADEMIA_VOTE_WEIGHT: number; // peso de los puntos de Academia para votos
  TIER_INVITE_CAPS: Record<string, number>; // invitaciones activas por tier
  FITNESS_WEIGHTS: FitnessWeights; // meta-parámetros del motor de épocas (WP07)
  /**
   * Hora local (0-23) a la que el asistente propone los 3 focos del día (WP19).
   * Es un parámetro del sistema, así que vive AQUÍ y no hardcodeado en el bot:
   * si John quiere que lleguen a otra hora, se publica una versión nueva del
   * genoma y queda en el linaje. Nada retroactivo sobre épocas cerradas.
   */
  DAILY_FOCUS_HOUR: number;
}

/** Puntos o reputación por tamaño de entrega. */
export type SizeTable = { S: number; M: number; L: number };

export type RiteKind = "sync" | "demo" | "retro";

/**
 * Cadencia de un rito. `dia_semana` ISO (1 = lunes … 7 = domingo); `hora` "HH:MM"
 * local de `BUSINESS_TZ`; `ancla` "AAAA-MM-DD" de una ocurrencia (quincenal).
 */
export type CadenciaRito =
  | { frecuencia: "semanal"; dia_semana: number; hora: string; duracion_min: number }
  | { frecuencia: "quincenal"; dia_semana: number; hora: string; duracion_min: number; ancla: string }
  | { frecuencia: "mensual"; semana_del_mes: 1 | 2 | 3 | 4; dia_semana: number; hora: string; duracion_min: number };

/** Días hábiles por prioridad para los recordatorios que no son urgentes. */
export type DiasPorPrioridad = { High: number; Normal: number };

/** Hito por defecto de una pieza publicada en el Ágora (reparto 20/70/10). */
export interface HitoGenoma {
  nombre: string;
  semana: string;
  pct: number;
}

/** Genoma completo: v1 + claves de WP31 (spec §6). */
export interface Genome extends GenomeV1 {
  // Entregas aprobadas (bloque B)
  TASK_POINTS: SizeTable; // puntos ZWORK por entrega aprobada
  TASK_REP: SizeTable; // reputación de ejecución
  ON_TIME_BONUS_PCT: number; // % extra de puntos si se aprobó a tiempo
  // Horario hábil (bloque C)
  BUSINESS_TZ: string;
  BUSINESS_DAYS: number[]; // ISO, 1 = lunes
  BUSINESS_HOUR_START: number; // hora local
  BUSINESS_HOUR_END: number; // hora local
  // SLA (_H = horas hábiles, _D = días hábiles)
  SLA_P1_RESPONSE_H: number;
  SLA_P1_RESTORE_H: number;
  SLA_P1_REVIEW_H: number;
  SLA_P2_RESPONSE_H: number;
  SLA_P2_RESOLVE_D: number;
  SLA_P3_RESPONSE_D: number;
  SLA_P3_RESOLVE_D: number;
  SLA_P4_TRIAGE_D: number;
  SLA_REVIEW_D: number;
  SLA_BLOCK_ESCALATE_D: number;
  SLA_BLOCK_FOUNDER_D: number;
  SLA_WARN_PCT: number; // "por vencer" cuando queda ≤ este % de la ventana…
  SLA_WARN_MAX_H: number; // …y como máximo estas horas hábiles antes
  // Recordatorios
  REMINDER_DIGEST_HOUR: number; // hora local del resumen diario
  REMINDER_MAX_INMEDIATOS: number; // tope de urgentes por persona y corrida
  REMINDER_P1_NO_RESPONSE_H: number;
  REMINDER_BEFORE_D: DiasPorPrioridad;
  ESCALATE_SUPERVISOR_D: DiasPorPrioridad;
  ESCALATE_FOUNDER_D: DiasPorPrioridad;
  ESCALATE_P1_FOUNDER_FACTOR: number;
  // Ritos (bloque D)
  RITES_CADENCE: Record<RiteKind, CadenciaRito>;
  RITE_ATTEND_REP: number;
  RITE_HOST_REP: number;
  RITE_RECORDER_REP: number;
  RITE_CODE_ROTATION_S: number;
  RITE_WINDOW_MIN: number;
  // Ágora e insignias
  AGORA_HITOS_DEFAULT: HitoGenoma[];
  BADGE_GOALS: Record<string, number>; // meta por id de insignia (nombre y descripción viven en código)
}

/**
 * Genoma v1 — valores EXACTOS de la config previa (hay un test de regresión que
 * lo verifica). Única fuente de verdad de los valores evolutivos v1: es lo que
 * siembra la DB.
 */
export const GENOME_V1: GenomeV1 = {
  EPOCH_BUDGET: 100_000,
  ACADEMIA_BUDGET: 5_000,
  ACADEMIA_DAILY_CAP: 3,
  ACADEMIA_DIMINISHING: [1, 0.75, 0.5],
  ACADEMIA_VOTE_WEIGHT: 0.5,
  TIER_INVITE_CAPS: { Bronze: 2, Silver: 5, Gold: 10 },
  FITNESS_WEIGHTS: { retention: 0.35, quality: 0.35, participation: 0.2, disputes: 0.1 },
  DAILY_FOCUS_HOUR: 7,
};

/**
 * Claves nuevas de WP31 con sus valores por defecto (spec §6). Ninguna entra en
 * `NUMERIC_GENES` esta noche: cambiarlas = versión nueva del genoma.
 */
export const GENOME_V2_NUEVAS: Omit<Genome, keyof GenomeV1> = {
  TASK_POINTS: { S: 10, M: 30, L: 80 },
  TASK_REP: { S: 1, M: 3, L: 8 },
  ON_TIME_BONUS_PCT: 25,
  BUSINESS_TZ: "America/Bogota",
  BUSINESS_DAYS: [1, 2, 3, 4, 5],
  BUSINESS_HOUR_START: 8,
  BUSINESS_HOUR_END: 18, // 1 día hábil = 10 h
  SLA_P1_RESPONSE_H: 2,
  SLA_P1_RESTORE_H: 8,
  SLA_P1_REVIEW_H: 4,
  SLA_P2_RESPONSE_H: 10, // = 1 día hábil
  SLA_P2_RESOLVE_D: 3,
  SLA_P3_RESPONSE_D: 2,
  SLA_P3_RESOLVE_D: 10,
  SLA_P4_TRIAGE_D: 5,
  SLA_REVIEW_D: 1,
  SLA_BLOCK_ESCALATE_D: 2,
  SLA_BLOCK_FOUNDER_D: 5,
  SLA_WARN_PCT: 25,
  SLA_WARN_MAX_H: 10,
  // A las 8 y no a DAILY_FOCUS_HOUR (7): las 7 quedan fuera del horario hábil.
  REMINDER_DIGEST_HOUR: 8,
  REMINDER_MAX_INMEDIATOS: 3,
  REMINDER_P1_NO_RESPONSE_H: 1,
  REMINDER_BEFORE_D: { High: 1, Normal: 2 },
  ESCALATE_SUPERVISOR_D: { High: 1, Normal: 2 },
  ESCALATE_FOUNDER_D: { High: 3, Normal: 5 },
  ESCALATE_P1_FOUNDER_FACTOR: 2,
  RITES_CADENCE: {
    sync: { frecuencia: "semanal", dia_semana: 1, hora: "09:00", duracion_min: 30 },
    demo: { frecuencia: "quincenal", dia_semana: 5, hora: "16:00", duracion_min: 60, ancla: "2026-10-09" },
    retro: { frecuencia: "mensual", semana_del_mes: 1, dia_semana: 1, hora: "10:00", duracion_min: 60 },
  },
  RITE_ATTEND_REP: 2,
  RITE_HOST_REP: 5,
  RITE_RECORDER_REP: 5,
  RITE_CODE_ROTATION_S: 90,
  RITE_WINDOW_MIN: 30,
  AGORA_HITOS_DEFAULT: [
    { nombre: "Anticipo", semana: "1", pct: 20 },
    { nombre: "Primera entrega", semana: "2", pct: 25 },
    { nombre: "Segunda entrega", semana: "4", pct: 25 },
    { nombre: "Entrega final", semana: "6", pct: 20 },
    { nombre: "Retención de calidad", semana: "8", pct: 10 },
  ],
  BADGE_GOALS: {
    "primera-entrega": 1,
    "diez-entregas": 10,
    "a-tiempo": 5,
    "pieza-grande": 1,
    "ojo-de-revisor": 5,
    presente: 3,
    anfitrion: 1,
  },
};

/** Genoma por defecto: v1 + claves nuevas. Base de toda lectura (`getActiveGenome`). */
export const GENOME_DEFAULTS: Genome = { ...GENOME_V1, ...GENOME_V2_NUEVAS };

/**
 * Parámetros guardados de una versión. Una fila ilegible o que no es un objeto no
 * tumba la app: se registra y se lee como vacía (rigen los defaults).
 */
function leerParams(raw: string | null | undefined): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch (e) {
    console.error("[genoma] params ilegibles en genome_versions", e);
  }
  return {};
}

/** Params guardados (JSON) mezclados sobre los defaults: toda versión se lee completa. */
export function mezclarConDefaults(params: string | null | undefined): Genome {
  return { ...GENOME_DEFAULTS, ...leerParams(params) } as Genome;
}

// Cache por-DB y por-época. Aislada por instancia de DB (WeakMap) para no filtrar
// entre tests. Cachear por época es correcto —no solo una optimización—: el genoma
// es inmutable dentro de una época (nunca retroactivo ni a mitad de época). Guarda
// el objeto YA MEZCLADO con los defaults.
const cache = new WeakMap<DB, Map<number, Genome>>();

/** Época actual = id del período más reciente (1 en Génesis). */
export function currentEpoch(db: DB): number {
  const row = db.prepare(`SELECT id FROM periods ORDER BY id DESC LIMIT 1`).get() as { id: number } | undefined;
  return row?.id ?? 1;
}

/**
 * Genoma activo para la época dada (por defecto, la actual): la versión con mayor
 * `effective_from_epoch <= epoch`, mezclada sobre los defaults
 * (`{ ...GENOME_DEFAULTS, ...guardado }`). Sin ninguna versión en DB (bootstrap /
 * tests sin seed) devuelve `GENOME_DEFAULTS`.
 */
export function getActiveGenome(db: DB, epoch?: number): Genome {
  const e = epoch ?? currentEpoch(db);
  let perDb = cache.get(db);
  if (!perDb) {
    perDb = new Map();
    cache.set(db, perDb);
  }
  const hit = perDb.get(e);
  if (hit) return hit;
  const row = db
    .prepare(
      `SELECT params FROM genome_versions
       WHERE effective_from_epoch <= ?
       ORDER BY effective_from_epoch DESC, version DESC LIMIT 1`
    )
    .get(e) as { params: string } | undefined;
  const genome = row ? mezclarConDefaults(row.params) : GENOME_DEFAULTS;
  perDb.set(e, genome);
  return genome;
}

/**
 * Hora de los 3 focos del día (WP19), leída del genoma activo. El bot llama aquí:
 * nunca lleva la hora como literal.
 */
export function dailyFocusHour(db: DB, epoch?: number): number {
  return getActiveGenome(db, epoch).DAILY_FOCUS_HOUR;
}

/** Invalida la cache de una DB (tras insertar/publicar una versión; útil en tests). */
export function clearGenomeCache(db: DB): void {
  cache.delete(db);
}

/**
 * Siembra el genoma v1 ligado a una entrada del decision log. Idempotente.
 * Efectivo desde la época 1 (Génesis).
 */
export function seedGenomeV1(db: DB, decisionLogId: number | null = null): void {
  const exists = db.prepare(`SELECT 1 AS x FROM genome_versions WHERE version = 1`).get();
  if (exists) return;
  db.prepare(
    `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id)
     VALUES (1, ?, 1, ?)`
  ).run(JSON.stringify(GENOME_V1), decisionLogId);
  clearGenomeCache(db);
}

/**
 * Genoma v2 (WP31, migración de arranque §3.5 paso 2). Idempotente: si alguna versión
 * ya trae `TASK_POINTS`, no hace nada. Si no, inserta UNA versión nueva con los params
 * de la versión más alta (o `GENOME_V1`) más las claves de `GENOME_V2_NUEVAS` que le
 * falten — sin cambiar ningún valor guardado, así conserva también una mutación
 * pendiente —, efectiva desde `max(época actual + 1, effective_from_epoch de la más
 * alta)`, con su entrada en `decision_log`. No toca `mutation_decisions` (no decide la
 * mutación de ninguna época). Las claves ya rigen desde hoy por la mezcla con los
 * defaults; la versión las deja en el linaje.
 *
 * Se llama en `seedIfEmpty` dentro de su propio try/catch: si falla, el arranque
 * sigue, la app funciona igual con los defaults y se reintenta en el siguiente.
 */
export function seedGenomeV2(db: DB): { insertada: boolean; version: number | null } {
  const filas = db.prepare(`SELECT version, params, effective_from_epoch FROM genome_versions`).all() as Array<{
    version: number;
    params: string;
    effective_from_epoch: number;
  }>;
  if (filas.some((f) => Object.prototype.hasOwnProperty.call(leerParams(f.params), "TASK_POINTS"))) {
    return { insertada: false, version: null };
  }
  let masAlta: (typeof filas)[number] | null = null;
  for (const f of filas) if (!masAlta || Number(f.version) > Number(masAlta.version)) masAlta = f;

  const base: Record<string, unknown> = masAlta ? leerParams(masAlta.params) : { ...GENOME_V1 };
  const params: Record<string, unknown> = { ...base };
  for (const [clave, valor] of Object.entries(GENOME_V2_NUEVAS)) {
    if (!Object.prototype.hasOwnProperty.call(params, clave)) params[clave] = valor;
  }
  const version = (masAlta ? Number(masAlta.version) : 0) + 1;
  const efectiva = Math.max(currentEpoch(db) + 1, masAlta ? Number(masAlta.effective_from_epoch) : 0);
  const title = `Genoma v${version}: claves nuevas de entregas, plazos y ritos`;
  const reason =
    "Se añaden claves sin cambiar ningún valor existente. Rigen con sus valores por defecto desde su " +
    `publicación y quedan versionadas desde la época ${efectiva}.`;
  // Fecha del decision log en la zona del genoma, no en la del servidor (UTC).
  const tz = typeof params.BUSINESS_TZ === "string" ? params.BUSINESS_TZ : GENOME_DEFAULTS.BUSINESS_TZ;
  let fecha: string;
  try {
    fecha = diaLocal(new Date(), tz);
  } catch {
    fecha = diaLocal(new Date(), GENOME_DEFAULTS.BUSINESS_TZ);
  }

  db.transaction(() => {
    // Hash: misma convención que mutation.ts, sha256(`${title}|${reason}`).
    const dec = db
      .prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (?, ?, ?, ?)`)
      .run(fecha, title, reason, sha256HexPuro(`${title}|${reason}`));
    db.prepare(
      `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (?, ?, ?, ?)`
    ).run(version, JSON.stringify(params), efectiva, Number(dec.lastInsertRowid));
  })();
  clearGenomeCache(db);
  return { insertada: true, version };
}

// ---------------------------------------------------------------------------
// sha256 en JS puro (FIPS 180-4). Da el mismo hex que `sha256Hex` de crypto.ts (un
// test lo compara), pero sin `node:crypto`: este módulo se carga en el CLI de Node y
// queda en la cadena de un componente de cliente.
// ---------------------------------------------------------------------------
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** sha256 (hex) de un texto UTF-8, en JS puro. Igual a `sha256Hex` de crypto.ts. */
export function sha256HexPuro(texto: string): string {
  const datos = new TextEncoder().encode(texto);
  const largo = datos.length;
  const total = Math.ceil((largo + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(datos);
  buf[largo] = 0x80;
  const vista = new DataView(buf.buffer);
  vista.setUint32(total - 8, Math.floor(largo / 0x20000000)); // 32 bits altos de largo × 8
  vista.setUint32(total - 4, (largo * 8) >>> 0); // 32 bits bajos
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64).fill(0);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = vista.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}
