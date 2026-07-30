/**
 * Frontera entre el roster interno (WP14) y la cohorte pública de la DAO.
 *
 * WP14 siembra a los 6 del equipo con un principal placeholder `pending:<slug>`
 * mientras no tengan identidad real (eso es WP13). Esos placeholders NO son
 * contribuidores de la cohorte Génesis: si se cuelan en `cohortStats()`, la home
 * pública anuncia una cohorte que no existe (pasaba de 4 a 10).
 *
 * Este test fija la frontera en los dos sentidos: el roster existe en `users`, y
 * las stats públicas no lo cuentan.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { cohortStats } from "./repo";
import { PENDING_PREFIX, TEAM_ROSTER } from "./roles";

function seededDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  return db;
}

describe("cohortStats: el roster interno no infla la cohorte pública", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("el roster del equipo SÍ está sembrado en users", () => {
    const n = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE wallet LIKE ?`)
        .get(PENDING_PREFIX + "%") as { n: number }
    ).n;
    expect(n).toBe(TEAM_ROSTER.length);
  });

  it("contributors excluye los placeholders `pending:*`", () => {
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    const { contributors } = cohortStats(db);

    expect(contributors).toBe(total - TEAM_ROSTER.length);
    expect(contributors).toBeGreaterThan(0); // la cohorte demo sigue contando
  });

  it("sembrar el roster otra vez no mueve el conteo público", () => {
    const antes = cohortStats(db).contributors;
    seedIfEmpty(db); // idempotente: vuelve a sembrar el roster
    expect(cohortStats(db).contributors).toBe(antes);
  });
});
