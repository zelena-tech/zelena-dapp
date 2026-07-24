/**
 * Capa de datos ÚNICA. Todo acceso a persistencia pasa por aquí.
 *
 * Driver dual:
 *  1) better-sqlite3 si está disponible (rendimiento, prod local).
 *  2) node:sqlite (built-in de Node >=22) como fallback sin compilación nativa.
 * Ambos se adaptan a la misma superficie mínima: prepare().get/all/run,
 * exec(), pragma(), transaction(). Toda la app importa SOLO desde este archivo.
 *
 * Swap a Postgres/Turso (obligatorio en Vercel, donde SQLite no persiste):
 * reemplaza los drivers manteniendo esta interfaz. Ver docs/deploy.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { seedIfEmpty } from "./seed";

export interface Stmt {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DB {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  pragma(directive: string): void;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
}

const g = globalThis as unknown as { __zelenaDb?: DB };

function dbFilePath(): string {
  const configured = process.env.DATABASE_FILE;
  if (configured) return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  return path.join(process.cwd(), "data", "zelena.db");
}

function schemaSql(): string {
  const p = path.join(process.cwd(), "src", "lib", "schema.sql");
  return fs.readFileSync(p, "utf8");
}

/** Driver 1: better-sqlite3 (ya implementa la interfaz completa). */
function tryBetterSqlite(file: string): DB | null {
  try {
    const req = createRequire(import.meta.url);
    const Database = req("better-sqlite3");
    const db = new Database(file);
    return {
      prepare: (sql: string) => db.prepare(sql) as Stmt,
      exec: (sql: string) => void db.exec(sql),
      pragma: (d: string) => void db.pragma(d),
      transaction: <A extends unknown[], R>(fn: (...args: A) => R) => db.transaction(fn) as (...args: A) => R,
    };
  } catch {
    return null;
  }
}

/** Driver 2: node:sqlite (DatabaseSync, sin dependencias nativas externas). */
function nodeSqlite(file: string): DB {
  const req = createRequire(import.meta.url);
  const { DatabaseSync } = req("node:sqlite");
  const db = new DatabaseSync(file);
  let inTx = false;
  return {
    prepare: (sql: string) => {
      // Statement perezoso: tolera DDL posterior y evita statements colgados.
      return {
        run: (...p: unknown[]) => db.prepare(sql).run(...p),
        get: (...p: unknown[]) => db.prepare(sql).get(...p),
        all: (...p: unknown[]) => db.prepare(sql).all(...p),
      } as Stmt;
    },
    exec: (sql: string) => void db.exec(sql),
    pragma: (d: string) => void db.exec(`PRAGMA ${d};`),
    transaction:
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        if (inTx) return fn(...args); // transacción anidada: únete a la externa
        db.exec("BEGIN IMMEDIATE");
        inTx = true;
        try {
          const r = fn(...args);
          db.exec("COMMIT");
          return r;
        } catch (e) {
          try { db.exec("ROLLBACK"); } catch { /* ya revertida */ }
          throw e;
        } finally {
          inTx = false;
        }
      },
  };
}

/** Abre una conexión con el mejor driver disponible, sin schema ni seed (útil en tests). */
export function openDb(file: string): DB {
  return tryBetterSqlite(file) ?? nodeSqlite(file);
}

function init(): DB {
  const file = dbFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql());
  seedIfEmpty(db);
  return db;
}

export function getDb(): DB {
  if (!g.__zelenaDb) g.__zelenaDb = init();
  return g.__zelenaDb;
}
