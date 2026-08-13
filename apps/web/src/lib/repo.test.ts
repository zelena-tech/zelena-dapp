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
import { listTeamMembers } from "./team";

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

  it("contributors cuenta SOLO la puerta de comunidad (role = contributor)", () => {
    const esperado = (
      db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'contributor'`).get() as { n: number }
    ).n;
    const { contributors } = cohortStats(db);
    expect(contributors).toBe(esperado);
    expect(contributors).toBeGreaterThan(0); // la cohorte demo sigue contando
    // Y el roster interno no está dentro.
    expect(contributors).toBeLessThan(
      (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n
    );
  });

  it("el roster `pending:*` no cuenta como cohorte", () => {
    const antes = cohortStats(db).contributors;
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, cla_signed, role) VALUES ('pending:nuevo','Nuevo','Bronze',0,'core')`
    ).run();
    expect(cohortStats(db).contributors).toBe(antes);
  });

  // El bug que tenía la versión anterior: filtraba por FORMATO del principal, así que
  // un miembro del equipo entrando por Entra (`entra:<oid>`) se contaba como cohorte.
  it("un miembro `core` que entra por Entra NO infla la cohorte", () => {
    const antes = cohortStats(db).contributors;
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, cla_signed, role, auth_provider)
       VALUES ('entra:oid-maria','María','Bronze',0,'core','entra')`
    ).run();
    expect(cohortStats(db).contributors).toBe(antes);
  });

  it("un contribuidor real de comunidad SÍ suma", () => {
    const antes = cohortStats(db).contributors;
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, cla_signed, role) VALUES ('GNUEVOCONTRIB0001','Ada','Bronze',1,'contributor')`
    ).run();
    expect(cohortStats(db).contributors).toBe(antes + 1);
  });

  it("sembrar el roster otra vez no mueve el conteo público", () => {
    const antes = cohortStats(db).contributors;
    seedIfEmpty(db); // idempotente: vuelve a sembrar el roster
    expect(cohortStats(db).contributors).toBe(antes);
  });
});

// Con la base REAL de producción (seed completo + roster) había dos filas de founder
// para el mismo humano: `pending:john` y la wallet demo del seed. `listTeamMembers`
// devolvía 7, lo que duplicaba a John en los desplegables de responsable y ponía el
// denominador de la salud de ritos en 7 en vez de 6.
describe("listTeamMembers sobre la base real: el equipo son 6, sin duplicados", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb(); // seedIfEmpty COMPLETO, como en producción
  });

  it("devuelve exactamente los 6 del roster", () => {
    const m = listTeamMembers(db);
    expect(m).toHaveLength(TEAM_ROSTER.length);
    expect(m.every((x) => x.wallet.startsWith(PENDING_PREFIX))).toBe(true);
  });

  it("hay UN solo founder y John no aparece dos veces", () => {
    const m = listTeamMembers(db);
    expect(m.filter((x) => x.role === "founder")).toHaveLength(1);
    const nombres = m.map((x) => x.display_name);
    expect(new Set(nombres).size).toBe(nombres.length); // cero nombres repetidos
  });

  it("el founder DEMO del seed existe en users pero no es del equipo", () => {
    // No se borra: sostiene los proyectos, la reputación y los puntos del Ágora demo.
    const demo = db
      .prepare(`SELECT wallet FROM users WHERE role = 'founder' AND is_demo = 1`)
      .get() as { wallet: string } | undefined;
    expect(demo?.wallet).toBeTruthy();
    expect(listTeamMembers(db).map((x) => x.wallet)).not.toContain(demo!.wallet);
  });
});
