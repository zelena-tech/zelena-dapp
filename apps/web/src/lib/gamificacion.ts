/**
 * Gamificación de las entregas (WP31 §5.B.3): puntos y reputación al APROBAR una
 * entrega, tope por época y bucket, insignias derivadas y "Tu progreso".
 *
 * Reglas de producto que este archivo hace cumplir:
 *  - Jamás se confisca lo ganado: solo INSERT en los ledgers, nunca un delta
 *    negativo, nunca UPDATE ni DELETE (test estático B12). Si el presupuesto de la
 *    época no alcanza, se emite el remanente y la reputación va completa.
 *  - Se califica la ENTREGA, nunca a la persona: sin rankings, sin posiciones, sin
 *    rachas. Las insignias son reconocimiento ("4 de 10"), nunca algo que se pierde.
 *  - Los parámetros salen del genoma (`TASK_POINTS`, `TASK_REP`, `ON_TIME_BONUS_PCT`,
 *    `EPOCH_BUDGET`, `BADGE_GOALS`); el nombre y la descripción de las insignias son
 *    copy y viven aquí.
 *  - Cuatro ojos: quien entrega no cobra su propia aprobación (sus identidades cuentan
 *    como una, `identidadesDe`) y quien invita no evalúa a su invitado, ni al revés
 *    (B8, founder exento). La regla real está en `puedeTransicionar`; aquí es defensa
 *    en profundidad.
 *  - Todo INSERT lleva `period_id = currentEpoch(db)` explícito: después de cerrar una
 *    época, ninguna fila nueva cae en ella (su raíz Merkle sigue siendo reproducible).
 *
 * Construcción: sin `node:`, sin `crypto.ts`, sin `session.ts` y sin valores de
 * `db.ts` (solo su tipo). Queda en la cadena de `team.ts` (gancho de WP31-I1), que
 * llega al CLI de Node con type-stripping (imports de valor con sufijo `.ts`,
 * sintaxis borrable) y a un componente de cliente.
 */
import type { DB } from "./db";
import type { Size } from "./team";
import { GENOME_DEFAULTS, currentEpoch, getActiveGenome, type Genome } from "./genome.ts";
import { identidadesDe, mismaPersona, principalFounder } from "./identidades.ts";
import { aprobadaATiempo } from "./sla.ts";
import { cargarPiezaSla, slaConfig } from "./sla-db.ts";

// ---------------------------------------------------------------------------
// Premio de una tarea
// ---------------------------------------------------------------------------

export interface PremioTarea {
  tamano: Size;
  base: number;
  bono: number;
  puntos: number;
  reputacion: number;
}

const TAMANOS: readonly Size[] = ["S", "M", "L"];

function noNegativo(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Premio de una entrega aprobada: `TASK_POINTS[tamaño]` (+ `ON_TIME_BONUS_PCT` % si
 * se aprobó a tiempo) y `TASK_REP[tamaño]`. Sin tamaño cuenta como S. Nunca negativo.
 */
export function calcularPremioTarea(
  input: { size: Size | null; aTiempo: boolean },
  g: Pick<Genome, "TASK_POINTS" | "TASK_REP" | "ON_TIME_BONUS_PCT">
): PremioTarea {
  const tamano: Size = input.size && TAMANOS.includes(input.size) ? input.size : "S";
  const base = noNegativo(g.TASK_POINTS?.[tamano]);
  const pct = Math.max(0, Number(g.ON_TIME_BONUS_PCT) || 0);
  const bono = input.aTiempo ? Math.round((base * pct) / 100) : 0;
  return { tamano, base, bono, puntos: base + bono, reputacion: noNegativo(g.TASK_REP?.[tamano]) };
}

/** `ref` de la emisión de una tarea aprobada (§3.4). */
export function refTarea(assignmentId: number): string {
  return `assignment:${assignmentId}`;
}

/** Puntos ya emitidos en una época y un bucket (`ejecucion` | `academia`). */
export function puntosDeEpoca(db: DB, periodId: number, bucket: "ejecucion" | "academia"): number {
  const r = db
    .prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger WHERE period_id = ? AND bucket = ?`)
    .get(periodId, bucket) as { n: number | null } | undefined;
  return Number(r?.n ?? 0);
}

/**
 * Lo que queda del presupuesto de ejecución de la época: `EPOCH_BUDGET` − puntos de
 * ESA época en bucket `ejecucion` (nunca menos de 0). Tareas e hitos del Ágora lo
 * comparten a propósito (mismo tipo de trabajo); la Academia tiene el suyo.
 */
export function presupuestoEjecucionRestante(db: DB, periodId: number, g?: Genome): number {
  const genoma = g ?? getActiveGenome(db, periodId);
  return Math.max(0, noNegativo(genoma.EPOCH_BUDGET) - puntosDeEpoca(db, periodId, "ejecucion"));
}

// ---------------------------------------------------------------------------
// Emisión al aprobar
// ---------------------------------------------------------------------------

export interface EmisionTarea {
  emitido: boolean;
  motivo?: "ya_emitido" | "autoaprobacion" | "invitacion" | "sin_responsable" | "publicada_en_agora" | "presupuesto_agotado";
  puntos: number;
  reputacion: number;
  bono: number;
  periodo: number;
}

function invitadoPor(db: DB, wallet: string): string | null {
  const r = db.prepare(`SELECT invited_by FROM users WHERE wallet = ?`).get(wallet) as
    | { invited_by: string | null }
    | undefined;
  return r?.invited_by ?? null;
}

/** ¿Es el founder? Por su rol en la base o por el roster (nunca por `FOUNDER_WALLET`). */
function esFounder(db: DB, wallet: string): boolean {
  const ids = identidadesDe(db, wallet);
  const principal = principalFounder(db);
  if (principal && ids.includes(principal)) return true;
  return ids.some((w) => {
    const r = db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(w) as { role: string | null } | undefined;
    return r?.role === "founder";
  });
}

/**
 * B8 en las dos direcciones (misma regla que `puedeTransicionar`): el aprobador no es
 * founder y (quien invitó al dueño es una identidad del aprobador, o quien invitó al
 * aprobador es una identidad del dueño).
 */
function vinculoInvitacion(db: DB, aprobador: string, dueno: string): boolean {
  if (esFounder(db, aprobador)) return false;
  const invDueno = invitadoPor(db, dueno);
  const invAprobador = invitadoPor(db, aprobador);
  return (
    (!!invDueno && identidadesDe(db, aprobador).includes(invDueno)) ||
    (!!invAprobador && identidadesDe(db, dueno).includes(invAprobador))
  );
}

function refYaEmitido(db: DB, ref: string): boolean {
  // En las DOS tablas y sin filtrar wallet: sobrevive a una vinculación de cuentas.
  return (
    !!db.prepare(`SELECT 1 AS x FROM points_ledger WHERE ref = ?`).get(ref) ||
    !!db.prepare(`SELECT 1 AS x FROM reputation_events WHERE ref = ?`).get(ref)
  );
}

/**
 * Emite puntos y reputación por una entrega aprobada. Abre su propia transacción
 * (anidable: se une a la del llamador). Nunca lanza por reglas de negocio; un error
 * de base sí se propaga (y revierte la aprobación entera: el gancho no lleva
 * try/catch).
 *
 * En orden: sin dueño → `sin_responsable`; misma persona → `autoaprobacion`; B8 →
 * `invitacion`; pieza publicada en el Ágora → `publicada_en_agora` (se paga por sus
 * hitos); `ref` ya presente en `points_ledger` o `reputation_events` → `ya_emitido`.
 * Si no: puntos = min(premio, presupuesto restante de la época), reputación completa.
 */
export function emitirPorAprobacion(
  db: DB,
  input: { assignmentId: number; ownerWallet: string | null; aprobadorWallet: string; size: Size | null; aTiempo: boolean }
): EmisionTarea {
  return db.transaction((): EmisionTarea => {
    const periodo = currentEpoch(db);
    const nada = (motivo: NonNullable<EmisionTarea["motivo"]>): EmisionTarea => ({
      emitido: false,
      motivo,
      puntos: 0,
      reputacion: 0,
      bono: 0,
      periodo,
    });

    const dueno = typeof input.ownerWallet === "string" ? input.ownerWallet.trim() : "";
    if (!dueno) return nada("sin_responsable");
    if (mismaPersona(db, input.aprobadorWallet, dueno)) return nada("autoaprobacion");
    if (vinculoInvitacion(db, input.aprobadorWallet, dueno)) return nada("invitacion");

    const pieza = db.prepare(`SELECT published_as_project_id FROM assignments WHERE id = ?`).get(input.assignmentId) as
      | { published_as_project_id: number | null }
      | undefined;
    if (pieza?.published_as_project_id != null) return nada("publicada_en_agora");

    const ref = refTarea(input.assignmentId);
    if (refYaEmitido(db, ref)) return nada("ya_emitido");

    const genoma = getActiveGenome(db, periodo);
    const premio = calcularPremioTarea({ size: input.size, aTiempo: input.aTiempo }, genoma);
    const puntos = Math.min(premio.puntos, presupuestoEjecucionRestante(db, periodo, genoma));

    if (puntos > 0) {
      db.prepare(
        `INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, ?, 'ejecucion', ?)`
      ).run(dueno, puntos, periodo, ref);
    }
    // La reputación va siempre y completa: también marca la emisión (idempotencia).
    db.prepare(
      `INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, 'ejecucion', ?, ?, ?)`
    ).run(dueno, premio.reputacion, ref, periodo);

    const recortada = puntos < premio.puntos;
    return {
      emitido: true,
      ...(recortada ? { motivo: "presupuesto_agotado" as const } : {}),
      puntos,
      reputacion: premio.reputacion,
      bono: Math.min(premio.bono, Math.max(0, puntos - premio.base)),
      periodo,
    };
  })();
}

/**
 * Copy de la respuesta de una aprobación según la emisión (§8.5), o null si no hay
 * nada que explicar. Habla de la entrega y del presupuesto, nunca de la persona.
 */
export function textoEmision(e: EmisionTarea): string | null {
  if (e.motivo === "presupuesto_agotado") {
    return "Esta temporada el presupuesto de puntos se completó: tu reputación quedó entera.";
  }
  if (e.motivo === "publicada_en_agora") return "Esta pieza se paga por sus hitos en el Ágora.";
  return null;
}

// ---------------------------------------------------------------------------
// Señales, insignias y "Tu progreso"
// ---------------------------------------------------------------------------

export interface SenalesProgreso {
  entregasAprobadas: number;
  entregasATiempo: number;
  entregasL: number;
  revisionesHechas: number;
  ritosAsistidos: number;
  ritosAnfitrion: number;
}

export interface Insignia {
  id: string;
  nombre: string;
  descripcion: string;
  obtenida: boolean;
  actual: number;
  meta: number;
}

/** Catálogo de insignias: reconocimiento, no moneda; sin rachas. La meta vive en `BADGE_GOALS`. */
export const INSIGNIAS: ReadonlyArray<{ id: string; nombre: string; descripcion: string; senal: keyof SenalesProgreso }> = [
  {
    id: "primera-entrega",
    nombre: "Primera entrega",
    descripcion: "Tu primera entrega aprobada por otra persona.",
    senal: "entregasAprobadas",
  },
  { id: "diez-entregas", nombre: "Diez entregas", descripcion: "Diez entregas aprobadas.", senal: "entregasAprobadas" },
  {
    id: "a-tiempo",
    nombre: "A tiempo",
    descripcion: "Cinco entregas aprobadas dentro de su plazo.",
    senal: "entregasATiempo",
  },
  { id: "pieza-grande", nombre: "Pieza grande", descripcion: "Una entrega de tamaño L aprobada.", senal: "entregasL" },
  {
    id: "ojo-de-revisor",
    nombre: "Ojo de revisor",
    descripcion: "Cinco entregas de otras personas revisadas y aprobadas por ti.",
    senal: "revisionesHechas",
  },
  { id: "presente", nombre: "Presente", descripcion: "Tres ritos con asistencia registrada.", senal: "ritosAsistidos" },
  { id: "anfitrion", nombre: "Anfitrión", descripcion: "Un rito sostenido como anfitrión o relator.", senal: "ritosAnfitrion" },
];

function metaDe(metas: Genome["BADGE_GOALS"] | undefined, id: string): number {
  const v = Number(metas?.[id]);
  if (Number.isFinite(v) && v >= 1) return Math.floor(v);
  const porDefecto = Number(GENOME_DEFAULTS.BADGE_GOALS[id]);
  return Number.isFinite(porDefecto) && porDefecto >= 1 ? Math.floor(porDefecto) : 1;
}

/** Insignias con su progreso (puro). Una no obtenida es "4 de 10", nunca "perdida". */
export function insignias(s: SenalesProgreso, metas: Genome["BADGE_GOALS"]): Insignia[] {
  return INSIGNIAS.map((i) => {
    const meta = metaDe(metas, i.id);
    const actual = Math.max(0, Math.floor(Number(s[i.senal]) || 0));
    return { id: i.id, nombre: i.nombre, descripcion: i.descripcion, obtenida: actual >= meta, actual, meta };
  });
}

/** "Primera entrega · conseguida" / "Diez entregas · 4 de 10" (§8.5). */
export function textoInsignia(i: Insignia): string {
  return i.obtenida ? `${i.nombre} · conseguida` : `${i.nombre} · ${Math.min(i.actual, i.meta)} de ${i.meta}`;
}

function marcas(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/**
 * Señales de progreso de una persona, sumando todas sus identidades. Solo cuentan
 * las aprobaciones hechas por OTRA persona (lo que alguien se aprobara a sí mismo
 * no suma) y las revisiones de piezas ajenas.
 */
export function senalesProgreso(db: DB, wallet: string): SenalesProgreso {
  const ids = identidadesDe(db, wallet);
  const vacio: SenalesProgreso = {
    entregasAprobadas: 0,
    entregasATiempo: 0,
    entregasL: 0,
    revisionesHechas: 0,
    ritosAsistidos: 0,
    ritosAnfitrion: 0,
  };
  if (ids.length === 0) return vacio;
  const propias = new Set(ids);
  const otraPersona = (w: string | null): boolean => !!w && !propias.has(w) && !mismaPersona(db, w, wallet);
  const m = marcas(ids.length);

  // Entregas propias aprobadas por otra persona.
  const aprobadas = db
    .prepare(
      `SELECT a.id, a.size, e.actor_wallet
         FROM assignments a
         JOIN assignment_events e ON e.assignment_id = a.id
        WHERE e.action = 'aprobar' AND a.owner_wallet IN (${m})
        ORDER BY a.id, e.id`
    )
    .all(...ids) as Array<{ id: number; size: string | null; actor_wallet: string }>;
  const porPieza = new Map<number, string | null>();
  for (const r of aprobadas) if (otraPersona(r.actor_wallet)) porPieza.set(Number(r.id), r.size ?? null);
  const cfg = porPieza.size > 0 ? slaConfig(db) : null;
  let aTiempo = 0;
  let grandes = 0;
  for (const [id, size] of porPieza) {
    if (size === "L") grandes++;
    const pieza = cargarPiezaSla(db, id);
    if (pieza && cfg && aprobadaATiempo(pieza, cfg)) aTiempo++;
  }

  // Revisiones: aprobaciones hechas por la persona sobre piezas de otra persona.
  const revisadas = db
    .prepare(
      `SELECT e.assignment_id, a.owner_wallet
         FROM assignment_events e
         JOIN assignments a ON a.id = e.assignment_id
        WHERE e.action = 'aprobar' AND e.actor_wallet IN (${m})`
    )
    .all(...ids) as Array<{ assignment_id: number; owner_wallet: string | null }>;
  const revisiones = new Set<number>();
  for (const r of revisadas) if (otraPersona(r.owner_wallet)) revisiones.add(Number(r.assignment_id));

  const ritos = db
    .prepare(`SELECT COUNT(DISTINCT session_id) AS n FROM rite_attendance WHERE layer = 1 AND wallet IN (${m})`)
    .get(...ids) as { n: number } | undefined;
  const anfitrion = db
    .prepare(
      `SELECT COUNT(*) AS n FROM rite_sessions
        WHERE state = 'Closed' AND (host_wallet IN (${m}) OR recorder_wallet IN (${m}))`
    )
    .get(...ids, ...ids) as { n: number } | undefined;

  return {
    entregasAprobadas: porPieza.size,
    entregasATiempo: aTiempo,
    entregasL: grandes,
    revisionesHechas: revisiones.size,
    ritosAsistidos: Number(ritos?.n ?? 0),
    ritosAnfitrion: Number(anfitrion?.n ?? 0),
  };
}

/**
 * "Tu progreso" de la época: puntos y reputación de ejecución por entregas aprobadas
 * (`ref` `assignment:%`) y cuántas entregas, sumando todas las identidades.
 */
export function progresoDeTareas(
  db: DB,
  wallet: string,
  epoch: number
): { puntos: number; reputacion: number; entregas: number } {
  const ids = identidadesDe(db, wallet);
  if (ids.length === 0) return { puntos: 0, reputacion: 0, entregas: 0 };
  const m = marcas(ids.length);
  const puntos = db
    .prepare(
      `SELECT COALESCE(SUM(points),0) AS n FROM points_ledger
        WHERE wallet IN (${m}) AND period_id = ? AND bucket = 'ejecucion' AND ref LIKE 'assignment:%'`
    )
    .get(...ids, epoch) as { n: number } | undefined;
  const rep = db
    .prepare(
      `SELECT COALESCE(SUM(delta),0) AS n FROM reputation_events
        WHERE wallet IN (${m}) AND period_id = ? AND axis = 'ejecucion' AND ref LIKE 'assignment:%'`
    )
    .get(...ids, epoch) as { n: number } | undefined;
  const refs = db
    .prepare(
      `SELECT ref FROM points_ledger WHERE wallet IN (${m}) AND period_id = ? AND ref LIKE 'assignment:%'
       UNION
       SELECT ref FROM reputation_events WHERE wallet IN (${m}) AND period_id = ? AND ref LIKE 'assignment:%'`
    )
    .all(...ids, epoch, ...ids, epoch) as Array<{ ref: string }>;
  return { puntos: Number(puntos?.n ?? 0), reputacion: Number(rep?.n ?? 0), entregas: refs.length };
}
