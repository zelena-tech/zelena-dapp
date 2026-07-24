/**
 * Mutación por época — Doc 16 salvaguarda 4 (Houchin & MacLean): la organización
 * tiende a congelar reglas; la variación se fuerza programadamente. Cada época DEBE
 * decidir la mutación de la siguiente (proponer, revertir o "sin cambios" explícito).
 *
 * Reglas duras: máx. 2 genes por mutación, cambio ≤15% en numéricos, justificación
 * obligatoria. Nunca a mitad de época ni retroactivo: toda versión nueva es efectiva
 * desde la época SIGUIENTE (mecanismo de WP02). Append-only: el linaje nunca se borra.
 */
import type { DB } from "./db";
import { sha256Hex } from "./crypto";
import { getActiveGenome, currentEpoch, clearGenomeCache, type Genome } from "./genome";

// Genes numéricos escalares mutables (los objetos/arrays quedan fuera del alcance M1).
export const NUMERIC_GENES = ["EPOCH_BUDGET", "ACADEMIA_BUDGET", "ACADEMIA_DAILY_CAP", "ACADEMIA_VOTE_WEIGHT"] as const;
export type NumericGene = (typeof NUMERIC_GENES)[number];

export const MAX_GENES_PER_MUTATION = 2;
export const MAX_CHANGE_RATIO = 0.15; // ±15%

export interface GeneChange {
  key: NumericGene;
  value: number;
}

export class MutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationError";
  }
}

function isNumericGene(k: string): k is NumericGene {
  return (NUMERIC_GENES as readonly string[]).includes(k);
}

function nextVersion(db: DB): number {
  return (db.prepare(`SELECT COALESCE(MAX(version),0) AS v FROM genome_versions`).get() as { v: number }).v + 1;
}

/** Validación PURA de una mutación contra el genoma actual (testeable sin DB). */
export function validateMutation(current: Genome, changes: GeneChange[], justification: string): void {
  if (!justification || justification.trim().length < 10) {
    throw new MutationError("La justificación es obligatoria (mínimo 10 caracteres).");
  }
  if (changes.length < 1 || changes.length > MAX_GENES_PER_MUTATION) {
    throw new MutationError(`Una mutación cambia entre 1 y ${MAX_GENES_PER_MUTATION} genes.`);
  }
  const seen = new Set<string>();
  for (const c of changes) {
    if (!isNumericGene(c.key)) throw new MutationError(`Gen no mutable: ${c.key}.`);
    if (seen.has(c.key)) throw new MutationError(`Gen repetido en la mutación: ${c.key}.`);
    seen.add(c.key);
    if (typeof c.value !== "number" || !Number.isFinite(c.value) || c.value <= 0) {
      throw new MutationError(`Valor inválido para ${c.key}.`);
    }
    const cur = current[c.key] as number;
    const ratio = Math.abs(c.value - cur) / Math.abs(cur);
    if (ratio > MAX_CHANGE_RATIO + 1e-9) {
      throw new MutationError(
        `El cambio de ${c.key} es ${(ratio * 100).toFixed(1)}% y excede el máximo permitido (${MAX_CHANGE_RATIO * 100}%).`
      );
    }
  }
}

export interface MutationResult {
  version: number;
  targetEpoch: number;
  decisionLogId: number;
}

function assertUndecided(db: DB, epoch: number): void {
  const existing = db.prepare(`SELECT 1 AS x FROM mutation_decisions WHERE epoch = ?`).get(epoch);
  if (existing) throw new MutationError(`Ya hay una decisión de genoma para la época ${epoch}.`);
}

/** Propone una mutación efectiva desde la época siguiente. Anuncio = versión pendiente + decision log. */
export function proposeMutation(db: DB, changes: GeneChange[], justification: string): MutationResult {
  const epoch = currentEpoch(db);
  const targetEpoch = epoch + 1;
  const current = getActiveGenome(db, epoch);
  validateMutation(current, changes, justification);
  assertUndecided(db, targetEpoch);

  const newParams: Genome = { ...current };
  for (const c of changes) newParams[c.key] = c.value;

  const version = nextVersion(db);
  const changeDesc = changes.map((c) => `${c.key}: ${current[c.key]} → ${c.value}`).join("; ");
  const title = `Mutación del genoma para la época ${targetEpoch} (v${version})`;
  const reason = `Cambios: ${changeDesc}. Justificación: ${justification.trim()}`;

  const result = db.transaction((): MutationResult => {
    const dec = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (date('now'), ?, ?, ?)`).run(
      title,
      reason,
      sha256Hex(`${title}|${reason}`)
    );
    const decId = dec.lastInsertRowid as number;
    db.prepare(
      `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (?, ?, ?, ?)`
    ).run(version, JSON.stringify(newParams), targetEpoch, decId);
    db.prepare(
      `INSERT INTO mutation_decisions (epoch, kind, genome_version, decision_log_id) VALUES (?, 'mutation', ?, ?)`
    ).run(targetEpoch, version, decId);
    return { version, targetEpoch, decisionLogId: decId };
  })();
  clearGenomeCache(db);
  return result;
}

/** Revierte a los parámetros de una versión previa, como versión nueva efectiva la época siguiente. */
export function revertToVersion(db: DB, targetVersion: number, justification: string): MutationResult {
  const epoch = currentEpoch(db);
  const targetEpoch = epoch + 1;
  if (!justification || justification.trim().length < 10) {
    throw new MutationError("La justificación es obligatoria (mínimo 10 caracteres).");
  }
  assertUndecided(db, targetEpoch);
  const src = db.prepare(`SELECT params FROM genome_versions WHERE version = ?`).get(targetVersion) as
    | { params: string }
    | undefined;
  if (!src) throw new MutationError(`No existe la versión ${targetVersion} del genoma.`);

  const version = nextVersion(db);
  const title = `Reversión del genoma a v${targetVersion} para la época ${targetEpoch} (v${version})`;
  const reason = `Se restauran los valores de la versión ${targetVersion}. Justificación: ${justification.trim()}`;

  const result = db.transaction((): MutationResult => {
    const dec = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (date('now'), ?, ?, ?)`).run(
      title,
      reason,
      sha256Hex(`${title}|${reason}`)
    );
    const decId = dec.lastInsertRowid as number;
    db.prepare(
      `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (?, ?, ?, ?)`
    ).run(version, src.params, targetEpoch, decId);
    db.prepare(
      `INSERT INTO mutation_decisions (epoch, kind, genome_version, decision_log_id) VALUES (?, 'mutation', ?, ?)`
    ).run(targetEpoch, version, decId);
    return { version, targetEpoch, decisionLogId: decId };
  })();
  clearGenomeCache(db);
  return result;
}

/** Registra explícitamente "sin cambios" para una época (la excepción también se documenta). */
export function recordNoMutation(db: DB, epoch: number, justification: string): number {
  assertUndecided(db, epoch);
  const title = `Época ${epoch}: sin cambios de genoma`;
  const reason = `Decisión explícita de no mutar el genoma. Justificación: ${(justification || "sin cambios propuestos").trim()}`;
  return db.transaction((): number => {
    const dec = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (date('now'), ?, ?, ?)`).run(
      title,
      reason,
      sha256Hex(`${title}|${reason}`)
    );
    const decId = dec.lastInsertRowid as number;
    db.prepare(`INSERT INTO mutation_decisions (epoch, kind, decision_log_id) VALUES (?, 'no_change', ?)`).run(epoch, decId);
    return decId;
  })();
}

/** Guard de cierre: ¿ya se decidió la mutación (o el no-cambio) de esta época? */
export function mutationDecidedFor(db: DB, epoch: number): boolean {
  return !!db.prepare(`SELECT 1 AS x FROM mutation_decisions WHERE epoch = ?`).get(epoch);
}

export interface PendingMutation {
  version: number;
  targetEpoch: number;
  changes: Array<{ key: string; from: number; to: number }>;
  reason: string;
}

/** Mutación anunciada (efectiva la época siguiente) para el banner de la cohorte, o null. */
export function pendingMutation(db: DB): PendingMutation | null {
  const epoch = currentEpoch(db);
  const target = epoch + 1;
  const row = db
    .prepare(
      `SELECT gv.version AS version, gv.params AS params, dl.reason AS reason
       FROM genome_versions gv LEFT JOIN decision_log dl ON dl.id = gv.decision_log_id
       WHERE gv.effective_from_epoch = ? ORDER BY gv.version DESC LIMIT 1`
    )
    .get(target) as { version: number; params: string; reason: string | null } | undefined;
  if (!row) return null;
  const current = getActiveGenome(db, epoch) as unknown as Record<string, number>;
  const next = JSON.parse(row.params) as Record<string, number>;
  const changes: Array<{ key: string; from: number; to: number }> = [];
  for (const key of NUMERIC_GENES) {
    if (typeof next[key] === "number" && next[key] !== current[key]) {
      changes.push({ key, from: current[key], to: next[key] });
    }
  }
  return { version: row.version, targetEpoch: target, changes, reason: row.reason ?? "" };
}

export interface LineageEntry {
  version: number;
  effectiveFromEpoch: number;
  params: Genome;
  reason: string | null;
  decisionLogId: number | null;
}

/** Linaje completo del genoma (query de auditoría, reconstruye toda la evolución). */
export function genomeLineage(db: DB): LineageEntry[] {
  const rows = db
    .prepare(
      `SELECT gv.version AS version, gv.effective_from_epoch AS eff, gv.params AS params,
              gv.decision_log_id AS decId, dl.reason AS reason
       FROM genome_versions gv LEFT JOIN decision_log dl ON dl.id = gv.decision_log_id
       ORDER BY gv.version ASC`
    )
    .all() as Array<{ version: number; eff: number; params: string; decId: number | null; reason: string | null }>;
  return rows.map((r) => ({
    version: r.version,
    effectiveFromEpoch: r.eff,
    params: JSON.parse(r.params) as Genome,
    reason: r.reason,
    decisionLogId: r.decId,
  }));
}
