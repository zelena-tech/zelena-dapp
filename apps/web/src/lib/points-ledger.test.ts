/**
 * Test anti-confiscación (WP09 / regla de producto doc 16): jamás se confiscan
 * puntos ya ganados. El points_ledger es append-only de CRÉDITOS: ningún flujo
 * que escriba en él produce débitos ni disminuye el total de nadie.
 *
 * Recorre los dos flujos reales que escriben en points_ledger (aprobación de hito
 * y Academia) y verifica la invariante tras cada uno.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { approveMilestone } from "./admin";
import { startReading, getQuiz, gradeQuiz } from "./academia";

function seededDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  return db;
}

function walletTotals(db: DB): Record<string, number> {
  const rows = db
    .prepare(`SELECT wallet, COALESCE(SUM(points),0) AS n FROM points_ledger GROUP BY wallet`)
    .all() as Array<{ wallet: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.wallet] = r.n;
  return out;
}

function negativeRows(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE points < 0`).get() as { n: number }).n;
}

function rowCount(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM points_ledger`).get() as { n: number }).n;
}

function assertNobodyLostPoints(before: Record<string, number>, after: Record<string, number>): void {
  for (const w of Object.keys(before)) {
    expect(after[w] ?? 0).toBeGreaterThanOrEqual(before[w]); // nadie pierde lo ganado
  }
}

describe("anti-confiscación del points_ledger (WP09)", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("el estado sembrado no contiene débitos (ningún punto negativo)", () => {
    expect(negativeRows(db)).toBe(0);
  });

  it("aprobar un hito ACREDITA puntos y no confisca a nadie (append-only)", () => {
    const project = db.prepare(`SELECT id FROM projects ORDER BY id LIMIT 1`).get() as { id: number };
    const assignee = "GNEWEXECDEMOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, invited_by, is_demo, cla_signed) VALUES (?, 'Exec', 'Bronze', NULL, 1, 1)`
    ).run(assignee);
    db.prepare(`UPDATE projects SET assignee_wallet = ?, state = 'Assigned' WHERE id = ?`).run(assignee, project.id);
    const ms = db
      .prepare(`SELECT id, amount_usd FROM milestones WHERE project_id = ? AND approved = 0 ORDER BY ord LIMIT 1`)
      .get(project.id) as { id: number; amount_usd: number };

    const before = walletTotals(db);
    const beforeCount = rowCount(db);

    const r = approveMilestone(ms.id, db);

    expect(r.points).toBe(ms.amount_usd);
    expect(rowCount(db)).toBe(beforeCount + 1); // exactamente una fila NUEVA (append-only)
    const after = walletTotals(db);
    expect(after[assignee] ?? 0).toBe((before[assignee] ?? 0) + ms.amount_usd);
    assertNobodyLostPoints(before, after);
    expect(negativeRows(db)).toBe(0);
  });

  it("completar Academia ACREDITA puntos y no confisca a nadie", () => {
    const W = "GACADEMIADEMOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const content = db.prepare(`SELECT id FROM academia_content ORDER BY id LIMIT 1`).get() as { id: number };

    const before = walletTotals(db);
    const beforeCount = rowCount(db);

    const { token } = startReading(db, W, content.id);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 999, started_at = ? WHERE token = ?`).run(
      Date.now() - 999_000,
      token
    );
    const quiz = getQuiz(db, W, token);
    const answers = quiz.map((q) => (db.prepare(`SELECT correct FROM academia_quiz WHERE id = ?`).get(q.id) as { correct: number }).correct);
    const r = gradeQuiz(db, W, token, quiz.map((q) => q.id), answers);

    expect(r.passed).toBe(true);
    expect(r.points).toBeGreaterThan(0);
    const after = walletTotals(db);
    expect(after[W]).toBe(r.points);
    expect(rowCount(db)).toBe(beforeCount + 1);
    assertNobodyLostPoints(before, after);
    expect(negativeRows(db)).toBe(0);
  });
});
