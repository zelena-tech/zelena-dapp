import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, applyMigrations, type DB } from "./db";

const SCHEMA = path.join(process.cwd(), "src", "lib", "schema.sql");
const sql = () => fs.readFileSync(SCHEMA, "utf8");

describe("esquema idempotente y migraciones", () => {
  it("schema.sql se puede ejecutar dos veces seguidas sin reventar", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    // El segundo arranque de la app vuelve a ejecutar el esquema completo.
    expect(() => db.exec(sql())).not.toThrow();
  });

  it("una base vieja SIN las columnas nuevas las recibe por migración", () => {
    const db: DB = openDb(":memory:");
    // Simula la base que ya está en la máquina de alguien: users sin email.
    db.exec(`CREATE TABLE users (
      wallet TEXT PRIMARY KEY, display_name TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'Bronze', invited_by TEXT,
      status TEXT NOT NULL DEFAULT 'active', is_demo INTEGER NOT NULL DEFAULT 0,
      is_founder INTEGER NOT NULL DEFAULT 0, cla_signed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('W_VIEJO','Viejo')`).run();

    const aplicadas = applyMigrations(db);
    expect(aplicadas).toEqual(["users.email", "users.recovery_email", "users.is_supervisor"]);

    // El dato preexistente sobrevive y ahora acepta correo.
    db.prepare(`UPDATE users SET email = 'viejo@zelena.tech' WHERE wallet = 'W_VIEJO'`).run();
    const r = db.prepare(`SELECT email FROM users WHERE wallet='W_VIEJO'`).get() as { email: string };
    expect(r.email).toBe("viejo@zelena.tech");
  });

  it("correr la migración dos veces no hace nada la segunda", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    expect(applyMigrations(db)).toEqual([]); // el esquema nuevo ya las trae
    expect(applyMigrations(db)).toEqual([]);
  });

  it("el índice único de correo impide dos wallets con el mismo email", () => {
    const db: DB = openDb(":memory:");
    db.exec(sql());
    db.prepare(`INSERT INTO users (wallet, display_name, email) VALUES ('A','A','x@zelena.tech')`).run();
    expect(() =>
      db.prepare(`INSERT INTO users (wallet, display_name, email) VALUES ('B','B','x@zelena.tech')`).run()
    ).toThrow();
    // Pero varios NULL sí conviven (el índice es parcial).
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('C','C')`).run();
    db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('D','D')`).run();
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    expect(n).toBe(3);
  });
});
