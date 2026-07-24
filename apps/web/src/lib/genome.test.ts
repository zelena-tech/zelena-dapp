import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { getActiveGenome, currentEpoch, seedGenomeV1, clearGenomeCache, GENOME_V1 } from "./genome";
import { seedIfEmpty } from "./seed";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

function seedPeriod(db: DB, id: number): void {
  db.prepare(
    `INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (?, ?, 0, 0, 'Open')`
  ).run(id, `Época ${id}`);
}

describe("genoma versionado (WP02)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    seedPeriod(db, 1);
  });

  it("los valores v1 equivalen exactamente a las constantes previas (regresión)", () => {
    seedGenomeV1(db);
    const g = getActiveGenome(db, 1);
    expect(g.EPOCH_BUDGET).toBe(100_000);
    expect(g.ACADEMIA_BUDGET).toBe(5_000);
    expect(g.ACADEMIA_DAILY_CAP).toBe(3);
    expect(g.ACADEMIA_DIMINISHING).toEqual([1, 0.75, 0.5]);
    expect(g.ACADEMIA_VOTE_WEIGHT).toBe(0.5);
    expect(g.TIER_INVITE_CAPS).toEqual({ Bronze: 2, Silver: 5, Gold: 10 });
  });

  it("sin ninguna versión en DB cae al genoma v1 (bootstrap)", () => {
    const g = getActiveGenome(db, 1);
    expect(g).toEqual(GENOME_V1);
  });

  it("la época actual es el id del período más reciente", () => {
    expect(currentEpoch(db)).toBe(1);
    seedPeriod(db, 2);
    expect(currentEpoch(db)).toBe(2);
  });

  it("una versión con effective_from_epoch futuro NO cambia la época actual", () => {
    seedGenomeV1(db); // v1 efectivo desde época 1

    // Publica un genoma v2 (presupuesto distinto) efectivo desde la época 2.
    const v2 = { ...GENOME_V1, EPOCH_BUDGET: 250_000, ACADEMIA_DAILY_CAP: 5 };
    db.prepare(
      `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (2, ?, 2, NULL)`
    ).run(JSON.stringify(v2));
    clearGenomeCache(db);

    // La época en curso (1) sigue viendo v1 — nada retroactivo.
    expect(getActiveGenome(db, 1).EPOCH_BUDGET).toBe(100_000);
    expect(getActiveGenome(db, 1).ACADEMIA_DAILY_CAP).toBe(3);

    // La época futura (2) ya ve v2.
    expect(getActiveGenome(db, 2).EPOCH_BUDGET).toBe(250_000);
    expect(getActiveGenome(db, 2).ACADEMIA_DAILY_CAP).toBe(5);
  });

  it("el seed publica el genoma v1 en el decision log y en genome_versions", () => {
    const fresh = freshDb(); // seedIfEmpty crea su propio período 1
    seedIfEmpty(fresh);
    const dec = fresh.prepare(`SELECT id FROM decision_log WHERE title = 'Genoma v1 publicado'`).get() as
      | { id: number }
      | undefined;
    expect(dec).toBeTruthy();
    const gv = fresh.prepare(`SELECT version, decision_log_id FROM genome_versions WHERE version = 1`).get() as
      | { version: number; decision_log_id: number }
      | undefined;
    expect(gv?.version).toBe(1);
    expect(gv?.decision_log_id).toBe(dec!.id);
    // Tras el seed, getActiveGenome lee v1 desde la DB (no el fallback de bootstrap).
    expect(getActiveGenome(fresh, 1)).toEqual(GENOME_V1);
  });

  it("seedGenomeV1 es idempotente y liga a una entrada del decision log", () => {
    db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-07-01','Genoma v1 publicado','r','h')`).run();
    const decId = (db.prepare(`SELECT id FROM decision_log ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    seedGenomeV1(db, decId);
    seedGenomeV1(db, decId); // segunda llamada no duplica
    const rows = db.prepare(`SELECT version, decision_log_id FROM genome_versions`).all() as Array<{
      version: number;
      decision_log_id: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].decision_log_id).toBe(decId);
  });
});
