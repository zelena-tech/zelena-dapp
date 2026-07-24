/**
 * Cierre de época: reúne señales reales de la DB, calcula el fitness (motor puro
 * de lib/fitness.ts con los pesos del genoma), lo persiste como reporte explicable
 * y deja que el humano firme la recomendación (keep/revert). WP07.
 *
 * NO cambia el cierre de periodo/merkle existente ni automatiza la decisión: el
 * algoritmo propone, el founder firma (regla 4).
 */
import type { DB } from "./db";
import { getDb } from "./db";
import { sha256Hex } from "./crypto";
import { getActiveGenome } from "./genome";
import { computeFitness, recommend, type EpochData, type FitnessComponent, type Recommendation } from "./fitness";
import { mutationDecidedFor } from "./mutation";

export interface EpochFitnessReport {
  id: number;
  epoch: number;
  genomeVersion: number | null;
  score: number;
  components: FitnessComponent[];
  recommendation: Recommendation;
  prevScore: number | null;
  signed: boolean;
  signedDecision: Recommendation | null;
  decisionLogId: number | null;
}

/**
 * Reúne datos de la época desde señales REALES disponibles. Lo que aún no tiene
 * fuente en el schema (calidad calibrada, ritos) se omite: el motor de fitness lo
 * degrada explícitamente. Doc: se calibra tras las primeras épocas reales (WP11).
 */
export function gatherEpochData(db: DB, _epoch: number): EpochData {
  const activeBase = (
    db.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT wallet FROM reputation_events UNION SELECT wallet FROM points_ledger)`
    ).get() as { n: number }
  ).n;
  const retained = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT wallet) AS n FROM (
           SELECT wallet, created_at FROM reputation_events
           UNION ALL SELECT wallet, created_at FROM points_ledger
         ) WHERE created_at > datetime('now','-14 days')`
      )
      .get() as { n: number }
  ).n;
  const approvedDeliveries = (
    db.prepare(`SELECT COUNT(*) AS n FROM milestones WHERE approved = 1`).get() as { n: number }
  ).n;

  const data: EpochData = {};
  if (activeBase > 0) {
    data.activeUsersPrev = activeBase;
    data.retainedUsers = retained;
  }
  if (approvedDeliveries > 0) {
    // No hay mecanismo de disputas todavía → 0 disputas registradas sobre N entregas.
    data.disputes = 0;
    data.totalDeliveries = approvedDeliveries;
  }
  // Calidad y ritos: sin señal calibrada en Génesis → se degradan en el reporte.
  return data;
}

function genomeVersionFor(db: DB, epoch: number): number | null {
  const row = db
    .prepare(
      `SELECT version FROM genome_versions WHERE effective_from_epoch <= ? ORDER BY effective_from_epoch DESC, version DESC LIMIT 1`
    )
    .get(epoch) as { version: number } | undefined;
  return row ? row.version : null;
}

/** Calcula y persiste el reporte de fitness de una época (recomendación keep/revert). */
export function computeAndStoreEpochFitness(db: DB = getDb(), epoch?: number): EpochFitnessReport {
  const e = epoch ?? (db.prepare(`SELECT id FROM periods ORDER BY id DESC LIMIT 1`).get() as { id: number } | undefined)?.id ?? 1;
  const genome = getActiveGenome(db, e);
  const data = gatherEpochData(db, e);
  const result = computeFitness(data, genome.FITNESS_WEIGHTS);

  const prev = db.prepare(`SELECT score FROM epoch_fitness WHERE epoch = ? ORDER BY id DESC LIMIT 1`).get(e - 1) as
    | { score: number }
    | undefined;
  const prevScore = prev ? prev.score : null;
  const rec = recommend(result.score, prevScore);
  const genomeVersion = genomeVersionFor(db, e);

  const info = db
    .prepare(
      `INSERT INTO epoch_fitness (epoch, genome_version, score, components, recommendation, prev_score)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(e, genomeVersion, result.score, JSON.stringify(result.components), rec, prevScore);

  return {
    id: info.lastInsertRowid as number,
    epoch: e,
    genomeVersion,
    score: result.score,
    components: result.components,
    recommendation: rec,
    prevScore,
    signed: false,
    signedDecision: null,
    decisionLogId: null,
  };
}

/** El founder firma la decisión → entrada en el decision log referenciando el reporte. */
export function signEpochDecision(db: DB, epochFitnessId: number, decision: Recommendation): void {
  const row = db.prepare(`SELECT id, epoch, score, recommendation, signed FROM epoch_fitness WHERE id = ?`).get(epochFitnessId) as
    | { id: number; epoch: number; score: number; recommendation: string; signed: number }
    | undefined;
  if (!row) throw new Error("Reporte de fitness no encontrado.");
  if (row.signed) throw new Error("La decisión de esta época ya fue firmada.");

  // Guard (WP08 / salvaguarda 4): no se cierra una época sin haber decidido la
  // mutación de la siguiente — aunque la decisión sea "sin cambios" (explícita).
  if (!mutationDecidedFor(db, row.epoch + 1)) {
    throw new Error(
      `Antes de cerrar la época ${row.epoch} debes decidir la mutación de la época ${row.epoch + 1} (proponer, revertir o registrar "sin cambios").`
    );
  }

  const tx = db.transaction(() => {
    const title = `Cierre de época ${row.epoch}: ${decision === "keep" ? "mantener genoma" : "revertir genoma"}`;
    const reason =
      `Fitness de la época: ${row.score.toFixed(3)}. Recomendación del algoritmo: ${row.recommendation}. ` +
      `Decisión firmada por el founder: ${decision}. Referencia: reporte de fitness #${row.id}.`;
    const decInfo = db
      .prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (date('now'), ?, ?, ?)`)
      .run(title, reason, sha256Hex(`${title}|${reason}`));
    db.prepare(`UPDATE epoch_fitness SET signed = 1, signed_decision = ?, decision_log_id = ? WHERE id = ?`).run(
      decision,
      decInfo.lastInsertRowid as number,
      epochFitnessId
    );
  });
  tx();
}

function parseReport(row: {
  id: number;
  epoch: number;
  genome_version: number | null;
  score: number;
  components: string;
  recommendation: string;
  prev_score: number | null;
  signed: number;
  signed_decision: string | null;
  decision_log_id: number | null;
}): EpochFitnessReport {
  return {
    id: row.id,
    epoch: row.epoch,
    genomeVersion: row.genome_version,
    score: row.score,
    components: JSON.parse(row.components) as FitnessComponent[],
    recommendation: row.recommendation as Recommendation,
    prevScore: row.prev_score,
    signed: !!row.signed,
    signedDecision: (row.signed_decision as Recommendation | null) ?? null,
    decisionLogId: row.decision_log_id,
  };
}

/** Último reporte de fitness (el más reciente calculado), para el admin. */
export function latestEpochFitness(db: DB = getDb()): EpochFitnessReport | null {
  const row = db.prepare(`SELECT * FROM epoch_fitness ORDER BY id DESC LIMIT 1`).get() as Parameters<typeof parseReport>[0] | undefined;
  return row ? parseReport(row) : null;
}
