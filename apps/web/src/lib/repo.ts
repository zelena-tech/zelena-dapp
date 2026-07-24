/** Consultas de lectura/derivación sobre la DB. Reputación y puntos DERIVADOS. */
import { getDb } from "./db";
import { REPUTATION_AXES, type Axis } from "./config";
import { getActiveGenome } from "./genome";

export interface UserRow {
  wallet: string;
  display_name: string;
  tier: string;
  invited_by: string | null;
  status: string;
  is_demo: number;
  is_founder: number;
  cla_signed: number;
  created_at: string;
}

export function getUser(wallet: string): UserRow | undefined {
  return getDb().prepare(`SELECT * FROM users WHERE wallet = ?`).get(wallet) as UserRow | undefined;
}

export function reputationByAxis(wallet: string): Record<Axis, number> {
  const rows = getDb()
    .prepare(`SELECT axis, COALESCE(SUM(delta),0) AS total FROM reputation_events WHERE wallet = ? GROUP BY axis`)
    .all(wallet) as Array<{ axis: Axis; total: number }>;
  const out = {} as Record<Axis, number>;
  for (const a of REPUTATION_AXES) out[a] = 0;
  for (const r of rows) if (r.axis in out) out[r.axis] = r.total;
  return out;
}

/** Reputación GANADA en una época concreta (delta por eje), para medir crecimiento. */
export function reputationByAxisInEpoch(wallet: string, epoch: number): Record<Axis, number> {
  const rows = getDb()
    .prepare(
      `SELECT axis, COALESCE(SUM(delta),0) AS total FROM reputation_events WHERE wallet = ? AND period_id = ? GROUP BY axis`
    )
    .all(wallet, epoch) as Array<{ axis: Axis; total: number }>;
  const out = {} as Record<Axis, number>;
  for (const a of REPUTATION_AXES) out[a] = 0;
  for (const r of rows) if (r.axis in out) out[r.axis] = r.total;
  return out;
}

export function reputationHistory(wallet: string) {
  return getDb()
    .prepare(`SELECT axis, delta, ref, created_at FROM reputation_events WHERE wallet = ? ORDER BY id DESC`)
    .all(wallet) as Array<{ axis: Axis; delta: number; ref: string; created_at: string }>;
}

export function totalPoints(wallet: string): number {
  const r = getDb()
    .prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger WHERE wallet = ?`)
    .get(wallet) as { n: number };
  return r.n;
}

export function pointsByBucket(wallet: string): { ejecucion: number; academia: number } {
  const rows = getDb()
    .prepare(`SELECT bucket, COALESCE(SUM(points),0) AS n FROM points_ledger WHERE wallet = ? GROUP BY bucket`)
    .all(wallet) as Array<{ bucket: string; n: number }>;
  const out = { ejecucion: 0, academia: 0 };
  for (const r of rows) {
    if (r.bucket === "academia") out.academia = r.n;
    else out.ejecucion += r.n;
  }
  return out;
}

export function claSignature(wallet: string) {
  return getDb()
    .prepare(`SELECT cla_version, cla_hash, anchor_status, tx_id, signed_at FROM cla_signatures WHERE wallet = ? ORDER BY id DESC LIMIT 1`)
    .get(wallet) as
    | { cla_version: number; cla_hash: string; anchor_status: string; tx_id: string | null; signed_at: string }
    | undefined;
}

export function cohortStats() {
  const db = getDb();
  const contributors = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  const bounties = (db.prepare(`SELECT COUNT(*) AS n FROM projects`).get() as { n: number }).n;
  const points = (db.prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger`).get() as { n: number }).n;
  const clas = (db.prepare(`SELECT COUNT(*) AS n FROM cla_signatures`).get() as { n: number }).n;
  const genome = getActiveGenome(db);
  return { contributors, bounties, points, clas, epochBudget: genome.EPOCH_BUDGET, academiaBudget: genome.ACADEMIA_BUDGET };
}

export function listProjects(filters?: { type?: string; state?: string }) {
  const db = getDb();
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters?.type && (filters.type === "SAS" || filters.type === "DAO")) {
    clauses.push("type = ?");
    params.push(filters.type);
  }
  if (filters?.state) {
    clauses.push("state = ?");
    params.push(filters.state);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM projects ${where} ORDER BY campaign, id`).all(...params) as ProjectRow[];
}

export interface ProjectRow {
  id: number;
  campaign: string;
  title: string;
  type: string;
  budget_usd: number;
  weeks: number;
  state: string;
  supervisor_wallet: string;
  assignee_wallet: string | null;
  summary: string;
  description: string;
  acceptance: string;
  created_at: string;
}

export function getProject(id: number): ProjectRow | undefined {
  return getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
}

export function getMilestones(projectId: number) {
  return getDb()
    .prepare(`SELECT * FROM milestones WHERE project_id = ? ORDER BY ord`)
    .all(projectId) as Array<{
    id: number;
    project_id: number;
    ord: number;
    code: string;
    name: string;
    week: string;
    pct: number;
    amount_usd: number;
    approved: number;
  }>;
}

export function getApplications(projectId: number) {
  return getDb()
    .prepare(`SELECT * FROM applications WHERE project_id = ? ORDER BY id`)
    .all(projectId) as Array<{
    id: number;
    project_id: number;
    wallet: string;
    approach: string;
    timeline: string;
    status: string;
    created_at: string;
  }>;
}

export function listDecisions() {
  return getDb().prepare(`SELECT * FROM decision_log ORDER BY id`).all() as Array<{
    id: number;
    date: string;
    title: string;
    reason: string;
    hash: string;
  }>;
}

export function getOpenProposal() {
  return getDb().prepare(`SELECT * FROM proposals WHERE status = 'open' ORDER BY id LIMIT 1`).get() as
    | { id: number; title: string; description: string; status: string; threshold: number }
    | undefined;
}

export function voteTally(proposalId: number) {
  const rows = getDb()
    .prepare(`SELECT choice, COUNT(*) AS n FROM votes WHERE proposal_id = ? GROUP BY choice`)
    .all(proposalId) as Array<{ choice: string; n: number }>;
  const out = { favor: 0, contra: 0, abstencion: 0 };
  for (const r of rows) (out as Record<string, number>)[r.choice] = r.n;
  return out;
}

export function userVote(proposalId: number, wallet: string) {
  return getDb()
    .prepare(`SELECT choice FROM votes WHERE proposal_id = ? AND wallet = ?`)
    .get(proposalId, wallet) as { choice: string } | undefined;
}

export function listAcademia(includeDisabled = false) {
  const where = includeDisabled ? "" : "WHERE enabled = 1";
  return getDb().prepare(`SELECT * FROM academia_content ${where} ORDER BY ord`).all() as AcademiaRow[];
}

export interface AcademiaRow {
  id: number;
  slug: string;
  kind: string;
  title: string;
  summary: string;
  axis: string;
  points: number;
  min_seconds: number;
  body: string | null;
  video_id: string | null;
  enabled: number;
  ord: number;
}

export function getAcademiaBySlug(slug: string): AcademiaRow | undefined {
  return getDb().prepare(`SELECT * FROM academia_content WHERE slug = ?`).get(slug) as AcademiaRow | undefined;
}

export function academiaAwardsToday(wallet: string, day: string): number {
  const r = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM academia_awards WHERE wallet = ? AND day = ?`)
    .get(wallet, day) as { n: number };
  return r.n;
}

export function academiaAlreadyAwarded(wallet: string, contentId: number): boolean {
  const r = getDb()
    .prepare(`SELECT 1 AS x FROM academia_awards WHERE wallet = ? AND content_id = ?`)
    .get(wallet, contentId) as { x: number } | undefined;
  return !!r;
}

export function currentPeriod() {
  return getDb().prepare(`SELECT * FROM periods ORDER BY id DESC LIMIT 1`).get() as {
    id: number;
    name: string;
    epoch_budget: number;
    academia_budget: number;
    state: string;
    merkle_root: string | null;
    anchor_tx_id: string | null;
  };
}

/**
 * Progreso propio de una época comparado consigo mismo (regla de producto doc 16:
 * todo ranking muestra el progreso propio al lado; aquí compites contigo, no con otros).
 * Puntos por época vía points_ledger.period_id; jamás confisca lo ganado.
 */
export interface EpochProgress {
  epoch: number;
  pointsThis: number;
  pointsPrev: number;
  deltaPoints: number;
  deliverables: number; // entregas puntuadas (bucket ejecución) en la época
  isFirstEpoch: boolean;
}

export function epochProgress(wallet: string, epoch: number): EpochProgress {
  const db = getDb();
  const sumFor = (p: number) =>
    (db.prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger WHERE wallet = ? AND period_id = ?`).get(wallet, p) as { n: number }).n;
  const pointsThis = sumFor(epoch);
  const pointsPrev = epoch > 1 ? sumFor(epoch - 1) : 0;
  const deliverables = (
    db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ? AND period_id = ? AND bucket = 'ejecucion'`).get(wallet, epoch) as { n: number }
  ).n;
  return { epoch, pointsThis, pointsPrev, deltaPoints: pointsThis - pointsPrev, deliverables, isFirstEpoch: epoch <= 1 };
}
