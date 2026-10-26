/**
 * Código de cohorte `ESPECIALIZACION-2026` (fusión v1, decisión del líder): se
 * conserva el código, pero SOLO se siembra con `SEED_COHORT=1`. Es predecible y
 * de cientos de cupos — la misma objeción que GENESIS —, así que no puede nacer
 * solo en una base nueva de producción.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { COHORT_CODE, cohortSeedAllowed, seedCohortInvite } from "./seed";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

/** Entorno de prueba (ProcessEnv exige NODE_ENV en los tipos). */
const env = (vars: Record<string, string> = {}) => ({ NODE_ENV: "test", ...vars }) as NodeJS.ProcessEnv;
const ON = env({ SEED_COHORT: "1" });

const fila = (db: DB) =>
  db.prepare(`SELECT max_uses, uses FROM invites WHERE code = ?`).get(COHORT_CODE) as
    | { max_uses: number; uses: number }
    | undefined;

describe("seedCohortInvite — solo con SEED_COHORT=1", () => {
  it("sin la variable no siembra nada", () => {
    const db = freshDb();
    expect(cohortSeedAllowed(env())).toBe(false);
    expect(seedCohortInvite(db, env())).toBe(false);
    expect(fila(db)).toBeUndefined();
  });

  it("solo el valor exacto '1' la enciende", () => {
    expect(cohortSeedAllowed(env({ SEED_COHORT: "true" }))).toBe(false);
    expect(cohortSeedAllowed(env({ SEED_COHORT: "0" }))).toBe(false);
    expect(cohortSeedAllowed(ON)).toBe(true);
  });

  it("con SEED_COHORT=1 siembra 400 cupos y es idempotente (no reinicia los usos)", () => {
    const db = freshDb();
    expect(seedCohortInvite(db, ON)).toBe(true);
    expect(fila(db)).toEqual({ max_uses: 400, uses: 0 });
    db.prepare(`UPDATE invites SET uses = 7 WHERE code = ?`).run(COHORT_CODE);
    seedCohortInvite(db, ON);
    expect(fila(db)).toEqual({ max_uses: 400, uses: 7 });
  });

  it("una base que ya tiene la cohorte la conserva aunque la variable se apague", () => {
    const db = freshDb();
    seedCohortInvite(db, ON);
    expect(seedCohortInvite(db, env())).toBe(false);
    expect(fila(db)).toEqual({ max_uses: 400, uses: 0 });
  });
});
