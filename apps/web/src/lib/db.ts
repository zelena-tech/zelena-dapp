/**
 * Capa de datos ÚNICA. Todo acceso a persistencia pasa por aquí.
 *
 * Driver triple, misma superficie SÍNCRONA (prepare().get/all/run, exec, pragma,
 * transaction). Toda la app importa SOLO desde este archivo.
 *  1) libSQL/Turso (paquete `libsql`, síncrono, compatible better-sqlite3) — se
 *     ACTIVA cuando hay DATABASE_URL/TURSO_DATABASE_URL. Sirve para el deploy
 *     serverless persistente (Vercel no persiste SQLite local — fork F2) y para
 *     un archivo libSQL local en dev/CI.
 *  2) better-sqlite3 si está disponible (rendimiento, prod local).
 *  3) node:sqlite (built-in de Node >=22) como fallback sin compilación nativa.
 *
 * IMPORTANTE: se usa `libsql` (síncrono), NO `@libsql/client` (asíncrono): la capa
 * de datos y todos sus consumidores son síncronos; un cliente async obligaría a
 * reescribir toda la app. `libsql` habla con archivo local (`file:`), réplica
 * embebida o Turso remoto (`libsql://…` + authToken). Ver docs/deploy.md.
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

/** Driver libSQL/Turso: paquete `libsql` (síncrono, API compatible better-sqlite3). */
function tryLibsql(url: string, authToken?: string): DB | null {
  try {
    const req = createRequire(import.meta.url);
    const Database = req("libsql");
    const db = authToken ? new Database(url, { authToken }) : new Database(url);
    return {
      prepare: (sql: string) => db.prepare(sql) as Stmt,
      exec: (sql: string) => void db.exec(sql),
      // Los pragmas locales (WAL, foreign_keys) no aplican en Turso remoto: best-effort.
      pragma: (d: string) => {
        try {
          db.pragma(d);
        } catch {
          /* remoto/no soportado: ignorar */
        }
      },
      transaction: <A extends unknown[], R>(fn: (...args: A) => R) => db.transaction(fn) as (...args: A) => R,
    };
  } catch {
    return null;
  }
}

/** Abre explícitamente un DB libSQL (para tests y para el selector por env var). */
export function openLibsql(url: string, authToken?: string): DB {
  const db = tryLibsql(url, authToken);
  if (!db) throw new Error("No se pudo abrir libSQL: ¿está instalado el paquete `libsql`?");
  return db;
}

/** URL de libSQL configurada por entorno (Turso o archivo libSQL local), o null. */
export function libsqlUrl(): string | null {
  return process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

/** Ruta de archivo local si la URL es local (`file:` o path plano); null si es remota. */
export function localFileFromUrl(url: string): string | null {
  if (url.startsWith("file:")) {
    const p = url.slice("file:".length).replace(/^\/\//, "");
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return null; // remota (libsql://, https://, wss://)
  return path.isAbsolute(url) ? url : path.join(process.cwd(), url); // path plano
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
  const url = libsqlUrl();
  let db: DB;
  if (url) {
    // Driver libSQL/Turso seleccionado por env var (deploy serverless o archivo local).
    const authToken = process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN ?? undefined;
    const localFile = localFileFromUrl(url);
    // Para un archivo local, crea el directorio antes de abrir (primer arranque).
    if (localFile) fs.mkdirSync(path.dirname(localFile), { recursive: true });
    const libsql = tryLibsql(url, authToken);
    if (libsql) {
      db = libsql;
    } else if (!localFile) {
      // URL REMOTA (Turso) pero el paquete `libsql` no cargó: FALLAR fuerte. Degradar
      // a SQLite local sería el archivo efímero de Vercel (fork F2) sin aviso — el
      // fallo exacto que WP03 existe para evitar.
      throw new Error(
        `DATABASE/TURSO URL remota configurada pero el paquete 'libsql' no está disponible. ` +
          `Instala 'libsql' o corrige la URL; no se degrada silenciosamente a SQLite local.`
      );
    } else {
      // URL de archivo local: degradar al driver estándar sobre ese mismo archivo es aceptable.
      fs.mkdirSync(path.dirname(localFile), { recursive: true });
      db = openDb(localFile);
    }
  } else {
    const file = dbFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    db = openDb(file);
  }
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
