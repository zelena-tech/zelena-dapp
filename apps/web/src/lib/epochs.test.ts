import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { computeAndStoreEpochFitness, signEpochDecision } from "./epochs";
import { recordNoMutation } from "./mutation";
import { abrirRito, cerrarRito, prepararRito, registrarAsistencia } from "./ritos";
import { bucketDe, codigoRito, ritesSecret } from "./ritos-codigo";
import { GENOME_DEFAULTS } from "./genome";

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

describe("D7 · la participación sale de la asistencia a ritos (WP31-D)", () => {
  function persona(db: DB, wallet: string, role = "contributor"): void {
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, status, is_demo, is_founder, cla_signed, role, is_supervisor)
       VALUES (?, ?, 'Bronze', 'active', 0, ?, 1, ?, ?)`
    ).run(wallet, wallet, role === "founder" ? 1 : 0, role, role === "founder" ? 1 : 0);
  }

  it("sin ritos cerrados en la época se sigue degradando", () => {
    const db = seededDb();
    const report = computeAndStoreEpochFitness(db, 1);
    expect(report.components.find((c) => c.key === "participation")?.value).toBeNull();
  });

  it("con ≥ 1 rito cerrado en la época, participation.value no es null y es ≤ 1", () => {
    const db = seededDb();
    db.prepare(`UPDATE periods SET created_at = '2026-09-01 00:00:00' WHERE id = 1`).run();
    persona(db, "G_FUNDADORA_D7", "founder");
    persona(db, "G_ASISTE_D7");
    const fundadora = { wallet: "G_FUNDADORA_D7", name: "F", role: "founder" as const, isSupervisor: true };
    const id = prepararRito(db, fundadora, { kind: "demo", scheduledFor: "2026-10-09T21:00:00.000Z" }, new Date("2026-10-01T12:00:00Z")).id;
    abrirRito(db, fundadora, id, new Date("2026-10-09T20:45:00Z"));
    const t = new Date("2026-10-09T21:05:00Z");
    const codigo = codigoRito(ritesSecret(), id, bucketDe(t.getTime(), GENOME_DEFAULTS.RITE_CODE_ROTATION_S));
    registrarAsistencia(db, "G_ASISTE_D7", { sessionId: id, codigo }, t);
    registrarAsistencia(db, "G_FUNDADORA_D7", { sessionId: id, codigo }, t);
    cerrarRito(db, fundadora, { sessionId: id }, new Date("2026-10-09T22:05:00Z"));

    const report = computeAndStoreEpochFitness(db, 1);
    const part = report.components.find((c) => c.key === "participation");
    expect(part?.value).not.toBeNull();
    expect(part?.value as number).toBeGreaterThan(0);
    expect(part?.value as number).toBeLessThanOrEqual(1);
  });
});
