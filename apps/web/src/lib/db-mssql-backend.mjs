/**
 * Backend ASÍNCRONO real: Azure SQL Database vía `mssql` (tedious). WP16.
 *
 * Corre SIEMPRE dentro del worker del puente síncrono (`db-query.worker.mjs`),
 * nunca en el hilo principal. Aquí `await` es legal.
 *
 * Autenticación (en este orden, según la configuración):
 *  1. Managed identity — `azure-active-directory-default`. tedious pide un token
 *     FRESCO a `@azure/identity` en cada conexión nueva, así que no hay problema de
 *     expiración (los tokens de Entra viven ~1 h y el pool es de larga vida).
 *  2. Si esa versión de tedious no conoce ese método, se pide el token a mano con
 *     `DefaultAzureCredential`/`ManagedIdentityCredential`. Camino de compatibilidad:
 *     el token NO se renueva solo, así que conexiones nuevas tras ~1 h fallarían;
 *     documentado en docs/deploy.md.
 *  3. Usuario/contraseña (App Settings o Key Vault) como fallback explícito.
 *
 * NADA se registra en log: ni el token, ni la contraseña, ni la cadena de conexión.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AZURE_SQL_SCOPE = "https://database.windows.net/.default";

function requireMssql() {
  try {
    return require("mssql");
  } catch (err) {
    throw new Error(
      "Hay configuración de Azure SQL pero el paquete 'mssql' no está instalado. " +
        "Instálalo (`npm install mssql`) o corrige la configuración; no se degrada a SQLite local. " +
        `Detalle: ${err && err.message ? err.message : String(err)}`
    );
  }
}

async function explicitToken(clientId) {
  let identity;
  try {
    identity = require("@azure/identity");
  } catch (err) {
    throw new Error(
      "Managed identity solicitada pero falta el paquete '@azure/identity'. " +
        `Instálalo o usa AZURE_SQL_USER/AZURE_SQL_PASSWORD. Detalle: ${err && err.message ? err.message : String(err)}`
    );
  }
  const credential = clientId
    ? new identity.ManagedIdentityCredential(clientId)
    : new identity.DefaultAzureCredential();
  const token = await credential.getToken(AZURE_SQL_SCOPE);
  if (!token || !token.token) throw new Error("No se pudo obtener un token de Entra ID para Azure SQL.");
  return token.token;
}

function baseConfig(config) {
  return {
    server: config.server,
    database: config.database,
    port: config.port ?? 1433,
    options: {
      encrypt: config.encrypt !== false, // Azure SQL exige TLS
      trustServerCertificate: false,
      enableArithAbort: true,
    },
    // El puente es estrictamente secuencial; un pool pequeño basta y evita
    // sorpresas de estado de sesión entre conexiones.
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
    requestTimeout: config.requestTimeoutMs ?? 20_000,
    connectionTimeout: config.connectionTimeoutMs ?? 15_000,
  };
}

async function connectPool(sql, config) {
  if (config.auth.kind === "connection-string") {
    const pool = new sql.ConnectionPool(config.auth.connectionString);
    await pool.connect();
    return pool;
  }
  if (config.auth.kind === "password") {
    const pool = new sql.ConnectionPool({
      ...baseConfig(config),
      user: config.auth.user,
      password: config.auth.password,
    });
    await pool.connect();
    return pool;
  }
  // Managed identity: primero el método nativo de tedious (token fresco por conexión).
  try {
    const pool = new sql.ConnectionPool({
      ...baseConfig(config),
      authentication: {
        type: "azure-active-directory-default",
        options: config.auth.clientId ? { clientId: config.auth.clientId } : {},
      },
    });
    await pool.connect();
    return pool;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (!/authentication|unknown|unsupported/i.test(message)) throw err;
    const token = await explicitToken(config.auth.clientId);
    const pool = new sql.ConnectionPool({
      ...baseConfig(config),
      authentication: { type: "azure-active-directory-access-token", options: { token } },
    });
    await pool.connect();
    return pool;
  }
}

export async function createBackend(config) {
  const sql = requireMssql();
  const pool = await connectPool(sql, config);
  let transaction = null;

  const request = () => (transaction ? new sql.Request(transaction) : pool.request());

  return {
    async exec(text) {
      // `batch` (no `sp_executesql`) es lo correcto para DDL.
      await request().batch(text);
    },

    async query(text, params) {
      const req = request();
      (params ?? []).forEach((value, i) => {
        req.input(`p${i}`, value === undefined ? null : value);
      });
      const res = await req.query(text);
      const recordsets = res.recordsets ?? [];
      let lastInsertRowid = 0;
      let rows = res.recordset ?? [];
      // El eco de identidad (`SELECT SCOPE_IDENTITY() AS lastInsertRowid`) viaja en
      // el MISMO lote que el INSERT: es el último recordset.
      const last = recordsets.length > 0 ? recordsets[recordsets.length - 1] : null;
      if (last && last.length === 1 && Object.hasOwn(last[0], "lastInsertRowid")) {
        lastInsertRowid = last[0].lastInsertRowid ?? 0;
        rows = recordsets.length > 1 ? recordsets[0] : [];
      }
      const affected = Array.isArray(res.rowsAffected) ? (res.rowsAffected[0] ?? 0) : 0;
      return { rows, rowsAffected: affected, lastInsertRowid };
    },

    async begin() {
      if (transaction) throw new Error("transacción ya abierta en esta conexión");
      transaction = new sql.Transaction(pool);
      await transaction.begin();
    },

    async commit() {
      if (!transaction) throw new Error("no hay transacción que confirmar");
      const tx = transaction;
      transaction = null;
      await tx.commit();
    },

    async rollback() {
      if (!transaction) return;
      const tx = transaction;
      transaction = null;
      await tx.rollback();
    },

    async close() {
      transaction = null;
      await pool.close();
    },
  };
}
