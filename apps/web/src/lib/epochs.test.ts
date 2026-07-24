import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { computeAndStoreEpochFitness, signEpochDecision } from "./epochs";
import { recordNoMutation } from "./mutation";

function seededDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  return db;
}

describe("motor de épocas — persistencia y firma (WP07)", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("calcular fitness persiste un reporte con score, desglose y recomendación", () => {
    const report = computeAndStoreEpochFitness(db, 1);
    expect(report.id).toBeGreaterThan(0);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(1);
    expect(report.components).toHaveLength(4);
    expect(report.prevScore).toBeNull(); // primera época
    expect(report.recommendation).toBe("keep"); // sin base anterior no se revierte

    const row = db.prepare(`SELECT epoch, score, recommendation, components FROM epoch_fitness WHERE id = ?`).get(report.id) as {
      epoch: number;
      score: number;
      recommendation: string;
      components: string;
    };
    expect(row.epoch).toBe(1);
    expect(row.recommendation).toBe("keep");
    expect(JSON.parse(row.components)).toHaveLength(4);
  });

  it("no se puede firmar el cierre sin decidir la mutación de la época siguiente (guard WP08)", () => {
    const report = computeAndStoreEpochFitness(db, 1);
    expect(() => signEpochDecision(db, report.id, "keep")).toThrow(/mutación de la época 2/i);
  });

  it("firmar la decisión crea una entrada en el decision log y marca el reporte", () => {
    const report = computeAndStoreEpochFitness(db, 1);
    recordNoMutation(db, 2, "época 2 sin cambios de genoma"); // decisión requerida por el guard
    const decBefore = (db.prepare(`SELECT COUNT(*) AS n FROM decision_log`).get() as { n: number }).n;

    signEpochDecision(db, report.id, "keep");

    const decAfter = (db.prepare(`SELECT COUNT(*) AS n FROM decision_log`).get() as { n: number }).n;
    expect(decAfter).toBe(decBefore + 1);

    const row = db.prepare(`SELECT signed, signed_decision, decision_log_id FROM epoch_fitness WHERE id = ?`).get(report.id) as {
      signed: number;
      signed_decision: string;
      decision_log_id: number | null;
    };
    expect(row.signed).toBe(1);
    expect(row.signed_decision).toBe("keep");
    expect(row.decision_log_id).not.toBeNull();

    // La entrada del decision log referencia el reporte.
    const dec = db.prepare(`SELECT title, reason FROM decision_log WHERE id = ?`).get(row.decision_log_id) as {
      title: string;
      reason: string;
    };
    expect(dec.title).toMatch(/Cierre de época 1/);
    expect(dec.reason).toMatch(new RegExp(`reporte de fitness #${report.id}`));

    // No se puede firmar dos veces.
    expect(() => signEpochDecision(db, report.id, "revert")).toThrow(/ya fue firmada/i);
  });

  it("época peor que la anterior → recomienda revert (end-to-end)", () => {
    // Wallet con actividad ANTIGUA (40 días): cuenta como base pero no como retenida → baja la retención.
    db.prepare(
      `INSERT INTO reputation_events (wallet, axis, delta, ref, created_at) VALUES ('GOLDOLDWALLETDEMO0000000000000000000000000000000000000AA','comunidad',5,'viejo',datetime('now','-40 days'))`
    ).run();
    // Época anterior (1) con fitness máximo.
    db.prepare(`INSERT INTO epoch_fitness (epoch, score, components, recommendation) VALUES (1, 1.0, '[]', 'keep')`).run();

    const report = computeAndStoreEpochFitness(db, 2);
    expect(report.prevScore).toBe(1.0);
    expect(report.score).toBeLessThan(1.0); // retención < 1 por la wallet inactiva
    expect(report.recommendation).toBe("revert");
  });
});
