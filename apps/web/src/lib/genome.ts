/**
 * Genoma versionado — Doc 16 §3: en Zelena evolucionan las REGLAS, no las personas.
 *
 * Los parámetros evolutivos del sistema (presupuestos de época, caps de Academia,
 * topes de invitación por tier) viven como configuración versionada en la tabla
 * `genome_versions` (append-only). Todo el código los lee vía `getActiveGenome()`;
 * nunca se hardcodean valores nuevos (guardrail de CLAUDE.md). Cada cambio es una
 * versión nueva ligada a una entrada del decision log y con `effective_from_epoch`:
 * nada aplica retroactivamente ni a mitad de época.
 */
import type { DB } from "./db";

export interface Genome {
  EPOCH_BUDGET: number; // puntos ZWORK totales por época
  ACADEMIA_BUDGET: number; // presupuesto separado de Academia
  ACADEMIA_DAILY_CAP: number; // máx. contenidos con puntos por día y wallet
  ACADEMIA_DIMINISHING: number[]; // multiplicadores 1º/2º/3º del día
  ACADEMIA_VOTE_WEIGHT: number; // peso de los puntos de Academia para votos
  TIER_INVITE_CAPS: Record<string, number>; // invitaciones activas por tier
}

/**
 * Genoma v1 — valores EXACTOS de la config previa (hay un test de regresión que
 * lo verifica). Única fuente de verdad de los valores evolutivos v1: es lo que
 * siembra la DB y el fallback de bootstrap si aún no hay ninguna versión.
 */
export const GENOME_V1: Genome = {
  EPOCH_BUDGET: 100_000,
  ACADEMIA_BUDGET: 5_000,
  ACADEMIA_DAILY_CAP: 3,
  ACADEMIA_DIMINISHING: [1, 0.75, 0.5],
  ACADEMIA_VOTE_WEIGHT: 0.5,
  TIER_INVITE_CAPS: { Bronze: 2, Silver: 5, Gold: 10 },
};

// Cache por-DB y por-época. Aislada por instancia de DB (WeakMap) para no filtrar
// entre tests. Cachear por época es correcto —no solo una optimización—: el genoma
// es inmutable dentro de una época (nunca retroactivo ni a mitad de época).
const cache = new WeakMap<DB, Map<number, Genome>>();

/** Época actual = id del período más reciente (1 en Génesis). */
export function currentEpoch(db: DB): number {
  const row = db.prepare(`SELECT id FROM periods ORDER BY id DESC LIMIT 1`).get() as { id: number } | undefined;
  return row?.id ?? 1;
}

/**
 * Genoma activo para la época dada (por defecto, la actual). Devuelve la versión
 * con mayor `effective_from_epoch <= epoch`. Si aún no hay ninguna versión en DB
 * (bootstrap / tests sin seed) cae a GENOME_V1 (mismos valores canónicos).
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
  const genome = row ? (JSON.parse(row.params) as Genome) : GENOME_V1;
  perDb.set(e, genome);
  return genome;
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
