/**
 * Worker del puente síncrono (WP16). Corre en un `worker_thread`: aquí SÍ se puede
 * usar `await`. Recibe la petición por `postMessage` y devuelve la respuesta
 * serializada por el `SharedArrayBuffer` compartido, en trozos.
 *
 * El backend concreto se INYECTA (`workerData.backendModule`), así que el puente
 * se puede probar de punta a punta con un backend asíncrono falso, sin Azure.
 * Contrato del backend:
 *   createBackend(config) -> {
 *     exec(sql), query(sql, params) -> { rows, rowsAffected, lastInsertRowid },
 *     begin(), commit(), rollback(), close()
 *   }   (todo async)
 */
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const CTL_STATE = 0;
const CTL_LEN = 1;
const CTL_MORE = 2;
const CTL_READY = 3;
const CTL_ERRLEN = 4;

const STATE_CHUNK = 1;
const STATE_CONSUMED = 2;

const READY_OK = 1;
const READY_FATAL = 2;

const ctl = new Int32Array(workerData.control);
const bytes = new Uint8Array(workerData.data);
const chunkBytes = workerData.chunkBytes;
const encoder = new TextEncoder();

function writeFatal(message) {
  const buf = encoder.encode(String(message)).subarray(0, Math.min(chunkBytes, 8192));
  bytes.set(buf, 0);
  Atomics.store(ctl, CTL_ERRLEN, buf.length);
  Atomics.store(ctl, CTL_READY, READY_FATAL);
  Atomics.notify(ctl, CTL_READY);
}

/** Escribe la respuesta en el SAB en trozos; espera el acuse de cada trozo. */
function reply(payload) {
  const buf = encoder.encode(JSON.stringify(payload));
  let off = 0;
  for (;;) {
    const n = Math.min(chunkBytes, buf.length - off);
    if (n > 0) bytes.set(buf.subarray(off, off + n), 0);
    off += n;
    const more = off < buf.length ? 1 : 0;
    Atomics.store(ctl, CTL_LEN, n);
    Atomics.store(ctl, CTL_MORE, more);
    Atomics.store(ctl, CTL_STATE, STATE_CHUNK);
    Atomics.notify(ctl, CTL_STATE);
    if (!more) return;
    while (Atomics.load(ctl, CTL_STATE) !== STATE_CONSUMED) {
      Atomics.wait(ctl, CTL_STATE, STATE_CHUNK);
    }
  }
}

/**
 * Normaliza valores para que la app vea exactamente lo que veía con SQLite:
 * booleanos (BIT) → 0/1, fechas → texto 'YYYY-MM-DD HH:MM:SS', binarios → base64.
 */
function normalize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
  if (value instanceof Uint8Array) return { __buf: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
    return out;
  }
  return value;
}

function serializeError(err) {
  const code = err && (err.code ?? (err.number !== undefined ? String(err.number) : undefined));
  const message = err && err.message ? err.message : String(err);
  return { message, code };
}

let backend = null;

try {
  const mod = await import(pathToFileURL(workerData.backendModule).href);
  if (typeof mod.createBackend !== "function") {
    throw new Error(`El módulo de backend '${workerData.backendModule}' no exporta createBackend()`);
  }
  backend = await mod.createBackend(workerData.backendConfig);
  Atomics.store(ctl, CTL_READY, READY_OK);
  Atomics.notify(ctl, CTL_READY);
} catch (err) {
  writeFatal(err && err.stack ? err.stack : String(err));
}

async function handle(req) {
  switch (req.op) {
    case "exec":
      await backend.exec(req.sql);
      return null;
    case "query": {
      const res = await backend.query(req.sql, req.params ?? [], req.wantRows === true);
      return {
        rows: normalize(res.rows ?? []),
        rowsAffected: Number(res.rowsAffected ?? 0),
        lastInsertRowid: normalize(res.lastInsertRowid ?? 0),
      };
    }
    case "begin":
      await backend.begin();
      return null;
    case "commit":
      await backend.commit();
      return null;
    case "rollback":
      await backend.rollback();
      return null;
    case "close":
      await backend.close();
      return null;
    default:
      throw new Error(`operación desconocida del puente: ${String(req.op)}`);
  }
}

parentPort.on("message", async (req) => {
  if (!backend) {
    reply({ ok: false, error: { message: "el backend de base de datos no está inicializado" } });
    return;
  }
  try {
    reply({ ok: true, result: await handle(req) });
  } catch (err) {
    reply({ ok: false, error: serializeError(err) });
  }
});
