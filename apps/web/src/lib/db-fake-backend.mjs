/**
 * Backend ASÍNCRONO FALSO (WP16) — solo para tests del puente síncrono.
 *
 * Por qué existe: el puente `worker_threads` + `SharedArrayBuffer` + `Atomics.wait`
 * es la pieza delicada de WP16 y hay que probarla DE VERDAD sin una suscripción de
 * Azure. Este backend expone la MISMA interfaz asíncrona que
 * `db-mssql-backend.mjs` (`createBackend` → exec/query/begin/commit/rollback/close,
 * todo con `await`), pero por debajo usa SQLite. Así el test ejercita el puente
 * completo —round-trip, parámetros, transacciones, errores— con semántica SQL real.
 *
 * Cada operación cede el event loop (`setImmediate`) antes de ejecutar: si el
 * puente dependiera de que el backend responda de forma sincrónica, fallaría aquí.
 *
 * `hangOnSql` y `failOnSql` permiten provocar un cuelgue o un error del motor para
 * comprobar que el puente NO se queda esperando para siempre y que los errores
 * cruzan el hilo.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function openSqlite(file) {
  try {
    const Database = require("better-sqlite3");
    return new Database(file);
  } catch {
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(file);
  }
}

export async function createBackend(config) {
  await tick();
  const db = openSqlite(config.file);
  db.exec("PRAGMA foreign_keys = ON");
  const hangOn = config.hangOnSql ?? null;
  const failOn = config.failOnSql ?? null;

  async function guard(sql) {
    await tick();
    if (hangOn && sql.includes(hangOn)) {
      await new Promise(() => {
        /* nunca resuelve: simula un backend colgado */
      });
    }
    if (failOn && sql.includes(failOn)) {
      const err = new Error(`backend falso: fallo inducido en '${failOn}'`);
      err.code = "EFAKE";
      throw err;
    }
  }

  return {
    async exec(sql) {
      await guard(sql);
      db.exec(sql);
    },

    async query(sql, params, wantRows) {
      await guard(sql);
      const stmt = db.prepare(sql);
      if (wantRows) {
        return { rows: stmt.all(...params), rowsAffected: 0, lastInsertRowid: 0 };
      }
      const info = stmt.run(...params);
      return {
        rows: [],
        rowsAffected: Number(info.changes ?? 0),
        lastInsertRowid: Number(info.lastInsertRowid ?? 0),
      };
    },

    async begin() {
      await tick();
      db.exec("BEGIN IMMEDIATE");
    },

    async commit() {
      await tick();
      db.exec("COMMIT");
    },

    async rollback() {
      await tick();
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ya revertida */
      }
    },

    async close() {
      await tick();
      db.close();
    },
  };
}
