/**
 * Driver de Azure SQL Database (`mssql`) detrás de la interfaz SÍNCRONA de
 * `lib/db.ts`. WP16.
 *
 * Dos piezas puestas en serie:
 *  1. `lib/sql-dialect.ts` — traduce el SQL SQLite de la app a T-SQL (puro).
 *  2. `lib/db-sync-bridge.ts` — ejecuta la consulta en un worker asíncrono y
 *     BLOQUEA el hilo principal hasta el resultado.
 *
 * La lógica de negocio no cambia ni una línea: sigue viendo `prepare().get()`.
 *
 * Modo `passthrough`: no traduce el SQL. Existe para que los tests puedan probar el
 * puente de punta a punta contra un backend asíncrono FALSO con semántica SQL real.
 * En producción el modo es siempre `tsql`.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { DB, Stmt } from "./db";
import {
  translate,
  translateSchema,
  collectIdentityColumns,
  withIdentityEcho,
  statementKind,
  bindPlaceholders,
  type DialectOptions,
  type Translated,
} from "./sql-dialect";
import { startSyncBridge, SyncBridgeError, type SyncBridge } from "./db-sync-bridge";

export interface SyncRemoteOptions {
  /** Ruta absoluta del módulo de backend asíncrono (`createBackend`). */
  backendModule: string;
  /** Configuración que recibe `createBackend` (credenciales incluidas). */
  backendConfig?: unknown;
  /** `tsql` traduce el dialecto; `passthrough` lo deja tal cual (solo tests). */
  dialect?: "tsql" | "passthrough";
  dialectOptions?: DialectOptions;
  workerPath?: string;
  bootTimeoutMs?: number;
  callTimeoutMs?: number;
  chunkBytes?: number;
}

export interface ClosableDB extends DB {
  close(): void;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowsAffected: number;
  lastInsertRowid: number | string;
}

/** Ruta del worker del puente (`src/lib/db-query.worker.mjs`). */
export function defaultWorkerPath(): string {
  return process.env.ZELENA_DB_WORKER ?? path.join(process.cwd(), "src", "lib", "db-query.worker.mjs");
}

/** Ruta del backend real de Azure SQL. */
export function mssqlBackendPath(): string {
  return path.join(process.cwd(), "src", "lib", "db-mssql-backend.mjs");
}

/** Deshace la codificación de binarios que hace el worker (`{__buf: base64}`). */
function rehydrate(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.__buf === "string") return Buffer.from(obj.__buf, "base64");
  for (const [k, v] of Object.entries(obj)) obj[k] = rehydrate(v);
  return obj;
}

/**
 * Abre un DB síncrono sobre un backend asíncrono inyectado.
 *
 * Lanza (no degrada) si el worker no arranca: sin puente no hay base de datos.
 */
export function openSyncRemote(options: SyncRemoteOptions): ClosableDB {
  const useTsql = (options.dialect ?? "tsql") === "tsql";
  const bridge: SyncBridge = startSyncBridge({
    workerPath: options.workerPath ?? defaultWorkerPath(),
    workerData: { backendModule: options.backendModule, backendConfig: options.backendConfig },
    bootTimeoutMs: options.bootTimeoutMs,
    callTimeoutMs: options.callTimeoutMs,
    chunkBytes: options.chunkBytes,
  });

  const cache = new Map<string, Translated>();
  // Columnas IDENTITY del esquema REAL, aprendidas al ejecutar `exec(schema.sql)`.
  let identityColumns: ReadonlyMap<string, string> = new Map();

  function compile(sql: string): Translated {
    const hit = cache.get(sql);
    if (hit) return hit;
    const out = useTsql
      ? translate(sql, { identityColumns })
      : {
          sql: sql.trim().replace(/;\s*$/, ""),
          paramCount: bindPlaceholders(sql).paramCount,
          kind: statementKind(sql),
        };
    cache.set(sql, out);
    return out;
  }

  function query(sql: string, params: unknown[], wantRows: boolean): QueryResult {
    return bridge.call<QueryResult>({ op: "query", sql, params, wantRows });
  }

  let txDepth = 0;

  const db: ClosableDB = {
    prepare(sql: string): Stmt {
      const compiled = compile(sql);
      if (compiled.kind === "noop") {
        // `PRAGMA …` no existe en Azure SQL: statement inerte.
        return {
          run: () => ({ changes: 0, lastInsertRowid: 0 }),
          get: () => undefined,
          all: () => [],
        };
      }
      // El eco de identidad solo tiene sentido en T-SQL y solo para INSERT.
      const runSql =
        useTsql && compiled.kind === "insert" ? withIdentityEcho(compiled.sql) : compiled.sql;
      return {
        run: (...params: unknown[]) => {
          const res = query(runSql, params, false);
          const rowid = res.lastInsertRowid;
          return {
            changes: res.rowsAffected,
            lastInsertRowid: typeof rowid === "string" ? Number(rowid) : rowid,
          };
        },
        get: (...params: unknown[]) => {
          const res = query(compiled.sql, params, true);
          const first = res.rows[0];
          return first === undefined ? undefined : (rehydrate(first) as unknown);
        },
        all: (...params: unknown[]) => query(compiled.sql, params, true).rows.map((r) => rehydrate(r)),
      };
    },

    exec(sql: string): void {
      if (!useTsql) {
        bridge.call({ op: "exec", sql });
        return;
      }
      // El script (típicamente `schema.sql`) se traduce en tiempo de ejecución:
      // agnóstico del esquema, sin `.sql` paralelo que se desincronice.
      const statements = translateSchema(sql, options.dialectOptions);
      const identities = collectIdentityColumns(statements);
      if (identities.size > 0) {
        identityColumns = identities;
        cache.clear(); // lo compilado antes del esquema no sabía de IDENTITY
      }
      for (const statement of statements) {
        bridge.call({ op: "exec", sql: statement });
      }
    },

    pragma(): void {
      // No-op: WAL y foreign_keys son propiedades del motor en Azure SQL.
    },

    transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
      return (...args: A): R => {
        if (txDepth > 0) {
          // Transacción anidada: se une a la externa (igual que el driver SQLite).
          txDepth++;
          try {
            return fn(...args);
          } finally {
            txDepth--;
          }
        }
        bridge.call({ op: "begin" });
        txDepth = 1;
        try {
          const result = fn(...args);
          bridge.call({ op: "commit" });
          return result;
        } catch (err) {
          try {
            bridge.call({ op: "rollback" });
          } catch {
            /* la transacción ya no existe */
          }
          throw err;
        } finally {
          txDepth = 0;
        }
      };
    },

    close(): void {
      bridge.close();
    },
  };
  return db;
}

/* ------------------------------------------------------------------ *
 * Configuración de Azure SQL por entorno
 * ------------------------------------------------------------------ */

export type AzureSqlAuth =
  | { kind: "managed-identity"; clientId?: string }
  | { kind: "password"; user: string; password: string }
  | { kind: "connection-string"; connectionString: string };

export interface AzureSqlConfig {
  server: string;
  database: string;
  port: number;
  auth: AzureSqlAuth;
  encrypt: boolean;
}

/**
 * Lee la configuración de Azure SQL del entorno. Función PURA respecto del objeto
 * `env` que recibe (testeable sin tocar `process.env`).
 *
 * Las variables se documentan en `docs/deploy.md`, NUNCA en `.env*` del repo.
 * Camino recomendado: managed identity (sin contraseña en ninguna parte).
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export function azureSqlConfigFromEnv(env: EnvLike = process.env): AzureSqlConfig | null {
  const connectionString = env.AZURE_SQL_CONNECTION_STRING;
  if (connectionString) {
    return {
      server: env.AZURE_SQL_SERVER ?? "(en la cadena de conexión)",
      database: env.AZURE_SQL_DATABASE ?? "(en la cadena de conexión)",
      port: Number(env.AZURE_SQL_PORT ?? 1433),
      auth: { kind: "connection-string", connectionString },
      encrypt: true,
    };
  }
  const server = env.AZURE_SQL_SERVER;
  const database = env.AZURE_SQL_DATABASE;
  if (!server) return null;
  if (!database) {
    throw new Error("AZURE_SQL_SERVER está definido pero falta AZURE_SQL_DATABASE.");
  }
  const user = env.AZURE_SQL_USER;
  const password = env.AZURE_SQL_PASSWORD;
  const auth: AzureSqlAuth =
    user && password
      ? { kind: "password", user, password }
      : { kind: "managed-identity", clientId: env.AZURE_SQL_CLIENT_ID };
  if (user && !password) {
    throw new Error("AZURE_SQL_USER definido sin AZURE_SQL_PASSWORD (¿querías managed identity?).");
  }
  return {
    server,
    database,
    port: Number(env.AZURE_SQL_PORT ?? 1433),
    auth,
    encrypt: env.AZURE_SQL_ENCRYPT !== "false",
  };
}

/** Descripción de la configuración SIN secretos (para logs y errores). */
export function describeAzureSql(config: AzureSqlConfig): string {
  const auth =
    config.auth.kind === "managed-identity"
      ? `managed identity${config.auth.clientId ? " (asignada por el usuario)" : ""}`
      : config.auth.kind === "password"
      ? `usuario/contraseña (${config.auth.user})`
      : "cadena de conexión";
  return `${config.server}:${config.port}/${config.database} · auth: ${auth}`;
}

/**
 * Abre Azure SQL. FALLA FUERTE si falta cualquier pieza: paquete `mssql`, worker o
 * conectividad. Degradar a SQLite local en producción sería el fallo silencioso
 * que WP03 ya corrigió para Turso; aquí se repite la misma regla.
 */
export function openAzureSql(config: AzureSqlConfig, extra: Partial<SyncRemoteOptions> = {}): ClosableDB {
  if (config.auth.kind !== "connection-string") {
    const req = createRequire(import.meta.url);
    try {
      req.resolve("mssql");
    } catch {
      throw new Error(
        `Azure SQL configurado (${describeAzureSql(config)}) pero el paquete 'mssql' no está instalado. ` +
          `Instálalo (\`npm install mssql\`); no se degrada silenciosamente a SQLite local.`
      );
    }
  }
  const backendModule = extra.backendModule ?? mssqlBackendPath();
  if (!fs.existsSync(backendModule)) {
    throw new Error(`No se encuentra el backend de Azure SQL en '${backendModule}'.`);
  }
  try {
    return openSyncRemote({
      ...extra,
      backendModule,
      backendConfig: config,
      dialect: "tsql",
    });
  } catch (err) {
    if (err instanceof SyncBridgeError) {
      throw new Error(`No se pudo abrir Azure SQL (${describeAzureSql(config)}): ${err.message}`);
    }
    throw err;
  }
}
