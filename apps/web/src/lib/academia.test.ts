import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "./db";
import fs from "node:fs";
import path from "node:path";
import { startReading, getQuiz, gradeQuiz, heartbeat } from "./academia";

function freshDb() {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  db.prepare(
    `INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'T', 100000, 5000, 'Open')`
  ).run();
  const info = db
    .prepare(
      `INSERT INTO academia_content (slug, kind, title, summary, points, min_seconds, ord)
       VALUES ('t', 'article', 'T', 's', 150, 60, 1)`
    )
    .run();
  const cid = info.lastInsertRowid as number;
  const q = db.prepare(`INSERT INTO academia_quiz (content_id, question, options, correct) VALUES (?, ?, ?, ?)`);
  for (let i = 0; i < 5; i++) q.run(cid, `Q${i}`, JSON.stringify(["a", "b", "c", "d"]), 1);
  return { db, cid };
}

const W = "GTESTWALLET000000000000000000000000000000000000000000000";

describe("Academia anti-bot", () => {
  let db: ReturnType<typeof freshDb>["db"];
  let cid: number;
  beforeEach(() => {
    const f = freshDb();
    db = f.db;
    cid = f.cid;
  });

  it("rechaza el quiz antes del tiempo mínimo", () => {
    const { token } = startReading(db, W, cid);
    expect(() => getQuiz(db, W, token)).toThrow(/tiempo mínimo/i);
  });

  it("permite el quiz tras cumplir tiempo activo y transcurrido", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      token
    );
    const questions = getQuiz(db, W, token);
    expect(questions).toHaveLength(3);
  });

  it("otorga puntos al aprobar 2/3 y no vuelve a otorgar", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      token
    );
    const questions = getQuiz(db, W, token);
    const ids = questions.map((q) => q.id);
    // todas correctas (correct=1)
    const r1 = gradeQuiz(db, W, token, ids, [1, 1, 1]);
    expect(r1.passed).toBe(true);
    expect(r1.points).toBe(150);
    // segundo intento: ya premiado → 0 puntos
    const r2 = gradeQuiz(db, W, token, ids, [1, 1, 1]);
    expect(r2.points).toBe(0);
  });

  it("no aprueba con menos de 2 correctas", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      token
    );
    const questions = getQuiz(db, W, token);
    const ids = questions.map((q) => q.id);
    const r = gradeQuiz(db, W, token, ids, [0, 0, 0]); // todas incorrectas
    expect(r.passed).toBe(false);
    expect(r.points).toBe(0);
  });

  it("el heartbeat acumula tiempo activo", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET last_beat = ? WHERE token = ?`).run(Date.now() - 15_000, token);
    const r = heartbeat(db, W, token);
    expect(r.activeSeconds).toBeGreaterThanOrEqual(15);
  });
});
