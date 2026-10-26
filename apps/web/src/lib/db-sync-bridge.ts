/**
 * Puente SÍNCRONO sobre un backend ASÍNCRONO (WP16).
 *
 * EL PROBLEMA: `lib/db.ts` y todos sus consumidores son estrictamente síncronos
 * (`prepare().get()` devuelve la fila, no una promesa). El paquete `mssql`
 * (tedious) es solo asíncrono y NO existe cliente síncrono de Azure SQL para
 * Node. WP03 ya descartó `@libsql/client` por lo mismo (ver NIGHT-REPORT,
 * decisión #2): volver la app asíncrona significaría reescribir toda la lógica de
 * negocio, que el spec de WP16 prohíbe tocar.
 *
 * LA SOLUCIÓN: un `worker_thread` ejecuta la consulta asíncrona; el hilo principal
 * BLOQUEA con `Atomics.wait` sobre un `SharedArrayBuffer` hasta que el worker
 * escribe el resultado serializado. El request va por `postMessage` (se encola en
 * el puerto del worker: que el hilo principal esté bloqueado no impide que el
 * worker lo reciba, porque su event loop es independiente). La respuesta vuelve
 * por el SAB en trozos (`chunkBytes`), así que un resultado grande no exige
 * reservar memoria compartida gigante.
 *
 * Consecuencia deseada: mientras el puente espera, el hilo principal no procesa
 * nada más → una transacción completa es un bloque síncrono, igual de atómica
 * frente a otras peticiones que con `better-sqlite3` hoy.
 *
 * NUNCA DEGRADA EN SILENCIO: si el worker no arranca (p. ej. falta el paquete
 * `mssql`) o una llamada excede el timeout, se LANZA. Un puente colgado o un
 * fallback a SQLite local en producción es el fallo que este módulo existe para
 * evitar.
 */
import fs from "node:fs";
import { Worker } from "node:worker_threads";

/* Índices del array de control (Int32Array compartido). */
const CTL_STATE = 0;
const CTL_LEN = 1;
const CTL_MORE = 2;
const CTL_READY = 3;
const CTL_ERRLEN = 4;
const CTL_SLOTS = 8;

/* Valores de CTL_STATE. */
const STATE_IDLE = 0;
const STATE_CHUNK = 1;
const STATE_CONSUMED = 2;

/* Valores de CTL_READY. */
const READY_BOOT = 0;
const READY_OK = 1;
const READY_FATAL = 2;

export const DEFAULT_CHUNK_BYTES = 1 << 20; // 1 MiB
export const DEFAULT_BOOT_TIMEOUT_MS = 30_000;
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

export interface SyncBridgeOptions {
  /** Ruta absoluta al worker (`.mjs`). */
  workerPath: string;
  /** Datos que recibe el worker (ruta del backend async y su configuración). */
  workerData?: Record<string, unknown>;
  bootTimeoutMs?: number;
  callTimeoutMs?: number;
  chunkBytes?: number;
}

export class SyncBridgeError extends Error {
  /** Código del motor (p. ej. número de error de SQL Server), si lo hay. */
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "SyncBridgeError";
    this.code = code;
  }
}

export interface SyncBridge {
  /** Envía una petición y BLOQUEA hasta la respuesta. Lanza si el worker falla. */
  call<T>(request: unknown): T;
  close(): void;
  readonly closed: boolean;
}

interface Reply {
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string };
}

function decode(bytes: Uint8Array): string {
  // `slice` copia a memoria NO compartida: TextDecoder no acepta buffers compartidos.
  return new TextDecoder().decode(bytes.slice());
}

/** Bloquea hasta que `ctl[idx]` cumpla el predicado. `null` = timeout. */
function waitUntil(
  ctl: Int32Array,
  idx: number,
  done: (value: number) => boolean,
  timeoutMs: number
): number | null {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = Atomics.load(ctl, idx);
    if (done(value)) return value;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    Atomics.wait(ctl, idx, value, left);
  }
}

export function startSyncBridge(options: SyncBridgeOptions): SyncBridge {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;

  if (!fs.existsSync(options.workerPath)) {
    throw new SyncBridgeError(
      `No se encuentra el worker de base de datos en '${options.workerPath}'. ` +
        `Sin él no hay puente síncrono contra Azure SQL; no se degrada a SQLite local.`
    );
  }

  const control = new SharedArrayBuffer(CTL_SLOTS * 4);
  const data = new SharedArrayBuffer(chunkBytes);
  const ctl = new Int32Array(control);
  const bytes = new Uint8Array(data);

  const worker = new Worker(options.workerPath, {
    workerData: { ...options.workerData, control, data, chunkBytes },
  });
  // Un worker de datos no debe mantener vivo el proceso.
  worker.unref();
  let workerFailure: string | null = null;
  worker.on("error", (err: Error) => {
    workerFailure = err.stack ?? err.message;
  });

  let closed = false;
  let broken: string | null = null;

  const ready = waitUntil(ctl, CTL_READY, (v) => v !== READY_BOOT, bootTimeoutMs);
  if (ready === null) {
    void worker.terminate();
    throw new SyncBridgeError(
      `El worker de base de datos no arrancó en ${bootTimeoutMs} ms. ${workerFailure ?? ""}`.trim()
    );
  }
  if (ready === READY_FATAL) {
    const len = Atomics.load(ctl, CTL_ERRLEN);
    const message = decode(bytes.subarray(0, len));
    void worker.terminate();
    throw new SyncBridgeError(`El worker de base de datos falló al arrancar: ${message}`);
  }

  function call<T>(request: unknown): T {
    if (closed) throw new SyncBridgeError("El puente de base de datos está cerrado.");
    if (broken) throw new SyncBridgeError(`El puente de base de datos quedó inutilizable: ${broken}`);

    Atomics.store(ctl, CTL_STATE, STATE_IDLE);
    worker.postMessage(request);

    const parts: Uint8Array[] = [];
    for (;;) {
      const state = waitUntil(ctl, CTL_STATE, (v) => v === STATE_CHUNK, callTimeoutMs);
      if (state === null) {
        // El worker sigue con la consulta en vuelo: cualquier respuesta posterior
        // llegaría desalineada. El puente se marca inutilizable en vez de mentir.
        broken = `timeout de ${callTimeoutMs} ms esperando al backend. ${workerFailure ?? ""}`.trim();
        throw new SyncBridgeError(broken);
      }
      const len = Atomics.load(ctl, CTL_LEN);
      parts.push(bytes.subarray(0, len).slice());
      const more = Atomics.load(ctl, CTL_MORE);
      Atomics.store(ctl, CTL_STATE, STATE_CONSUMED);
      Atomics.notify(ctl, CTL_STATE);
      if (!more) break;
    }

    const total = parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      joined.set(p, off);
      off += p.length;
    }
    const reply = JSON.parse(decode(joined)) as Reply;
    if (!reply.ok) {
      throw new SyncBridgeError(reply.error?.message ?? "error desconocido del backend", reply.error?.code);
    }
    return reply.result as T;
  }

  return {
    call,
    close(): void {
      if (closed) return;
      if (!broken) {
        try {
          call({ op: "close" });
        } catch {
          /* cerrando: el estado del backend ya no importa */
        }
      }
      closed = true;
      void worker.terminate();
    },
    get closed(): boolean {
      return closed;
    },
  };
}
