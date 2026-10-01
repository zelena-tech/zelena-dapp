import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, applyMigrations, COLUMNAS_NUEVAS, columnasFaltantes, type DB } from "./db";

const SCHEMA = path.join(process.cwd(), "src", "lib", "schema.sql");
const sql = () => fs.readFileSync(SCHEMA, "utf8");

const columnas = (db: DB, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

describe("esquema idempotente y migraciones (fusión v1)", () => {
  it("schema.sql se puede ejecutar dos veces seguidas sin reventar", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    // El segundo arranque de la app vuelve a ejecutar el esquema completo.
    expect(() => db.exec(sql())).not.toThrow();
  });

  it("COLUMNAS_NUEVAS es la lista final: rol e identidad de v1 + cupo multiuso; sin correos en users", () => {
    expect(COLUMNAS_NUEVAS.map((c) => `${c.tabla}.${c.columna}`)).toEqual([
      "users.role",
      "users.is_supervisor",
      "users.entra_oid",
      "users.auth_provider",
      "invites.max_uses",
      "invites.uses",
    ]);
  });

  it("una base vieja SIN las columnas nuevas las recibe por migración y conserva sus filas", () => {
    const db: DB = openDb(":memory:");
    // La base que ya está en una máquina: users e invites de antes de v1.
    db.exec(`CREATE TABLE users (
      wallet TEXT PRIMARY KEY, display_name TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'Bronze', invited_by TEXT,
      status TEXT NOT NULL DEFAULT 'active', is_demo INTEGER NOT NULL DEFAULT 0,
      is_founder INTEGER NOT NULL DEFAULT 0, cla_signed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    db.exec(`CREATE TABLE invites (
      code TEXT PRIMARY KEY, issuer_wallet TEXT NOT NULL, used_by TEXT,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('W_VIEJO','Viejo')`).run();

    expect(columnasFaltantes(db)).toHaveLength(6);
    const aplicadas = applyMigrations(db);
    expect(aplicadas).toEqual(COLUMNAS_NUEVAS.map((c) => `${c.tabla}.${c.columna}`));
    expect(columnasFaltantes(db)).toEqual([]);

    // El dato preexistente sobrevive con los valores por defecto de v1.
    const r = db
      .prepare(`SELECT role, is_supervisor, entra_oid, auth_provider FROM users WHERE wallet='W_VIEJO'`)
      .get();
    expect(r).toEqual({ role: "contributor", is_supervisor: 0, entra_oid: null, auth_provider: "invite" });
    // Los correos NO vuelven a users: viven en user_emails (WP13).
    expect(columnas(db, "users")).not.toContain("email");
  });

  it("una tabla que todavía no existe no se migra: la crea schema.sql", () => {
    const db: DB = openDb(":memory:");
    expect(applyMigrations(db)).toEqual([]);
    expect(columnasFaltantes(db)).toEqual([]);
  });

  it("correr la migración dos veces no hace nada la segunda", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    expect(applyMigrations(db)).toEqual([]); // el esquema nuevo ya las trae
    expect(applyMigrations(db)).toEqual([]);
  });

  it("el esquema unificado no declara users.email ni su índice (los correos van en user_emails)", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    expect(columnas(db, "users")).not.toContain("email");
    expect(columnas(db, "users")).not.toContain("recovery_email");
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_email'`).get();
    expect(idx).toBeUndefined();
  });

  it("user_emails impide dos wallets con el mismo correo", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('A','A')`).run();
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('B','B')`).run();
    db.prepare(`INSERT INTO user_emails (wallet, email) VALUES ('A','x@zelena.tech')`).run();
    expect(() => db.prepare(`INSERT INTO user_emails (wallet, email) VALUES ('B','x@zelena.tech')`).run()).toThrow();
  });

  it("varias filas sin identidad corporativa conviven (el índice de entra_oid es parcial)", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('C','C')`).run();
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('D','D')`).run();
    db.prepare(`INSERT INTO users (wallet, display_name, entra_oid) VALUES ('E','E','oid-1')`).run();
    expect(() =>
      db.prepare(`INSERT INTO users (wallet, display_name, entra_oid) VALUES ('F','F','oid-1')`).run()
    ).toThrow();
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    expect(n).toBe(3);
  });
});
