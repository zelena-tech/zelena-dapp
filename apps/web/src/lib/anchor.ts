/**
 * Anclaje en Stellar testnet ejecutable DESDE EL SERVIDOR.
 *
 * Por qué existe: `performOnboard` encola cada firma del CLA en `anchor_queue`
 * con estado 'pending', y antes el único anclador era un script que había que correr a
 * mano. Esta capa permite disparar una pasada desde una ruta protegida
 * (`/api/anchor/run`, que llama el workflow programado `anclaje.yml`); el worker de
 * `packages/scripts/anchor-worker.mjs` reutiliza ESTE módulo para correrla en local.
 *
 * Mecánica: `manageData` con nombre y valor de 64 bytes, verificable por terceros. La
 * lógica de datos vive aquí y la ruta solo la invoca (ver CLAUDE.md).
 *
 * Cola confiable (hallazgo M23 de la auditoría):
 *  - TOPE DE INTENTOS: una fila que falla `ANCLAJE_MAX_INTENTOS` veces queda `failed` (y,
 *    si es una firma del acuerdo, `cla_signatures.anchor_status = 'failed'`); ya no se
 *    reintenta para siempre ni tapa a las nuevas. Reintentarla es una decisión explícita:
 *    `UPDATE anchor_queue SET status = 'pending', attempts = 0 WHERE id = <id>`.
 *  - RESERVA: antes de enviar, la fila pasa de `pending` a `processing` con un UPDATE
 *    condicionado (`WHERE status = 'pending'`): de dos pasadas simultáneas solo una la
 *    toma, así nada se ancla dos veces. Una reserva más vieja que `ANCLAJE_RESERVA_MS`
 *    (el proceso murió a mitad) se libera en la pasada siguiente.
 *
 * Sin `db.transaction` y con imports de valor con sufijo `.ts`: el worker lo carga con el
 * type-stripping de Node, sobre un adaptador mínimo de la base.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { DB } from "./db";
import { instanteDb } from "./zona-horaria.ts";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

/** Intentos (envíos) antes de dar una fila por fallida. Constante de infraestructura, no del genoma. */
export const ANCLAJE_MAX_INTENTOS = 8;
/** Una reserva (`processing`) más vieja que esto se considera abandonada y se libera. */
export const ANCLAJE_RESERVA_MS = 10 * 60_000;

export interface AnchorRow {
  id: number;
  kind: string;
  ref: string;
  data_key: string;
  payload_hash: string;
}

export interface AnchorResultado {
  pendientes: number;
  anclados: number;
  fallidos: number;
  cuenta: string | null;
  detalle: Array<{ id: number; kind: string; tx?: string; error?: string }>;
}

/**
 * ¿La cabecera `x-anchor-secret` trae el secreto del anclaje programado? Comparación en
 * tiempo constante y SIN filtrar el largo: se comparan los sha256 de los dos valores
 * (siempre 32 bytes) con `timingSafeEqual`, haya cabecera o no.
 *  - sin secreto configurado (o corto, ver `anchorRunSecret`) → `sin_configurar`;
 *  - cabecera ausente o distinta → `rechazado`.
 * La ruta, con cualquier cosa distinta de `ok`, cae a la sesión del founder.
 */
export function autorizarAnclaje(header: string | null, esperado: string | null): "ok" | "sin_configurar" | "rechazado" {
  const secreto = typeof esperado === "string" ? esperado.trim() : "";
  if (!secreto) return "sin_configurar";
  const dado = typeof header === "string" ? header.trim() : "";
  const a = createHash("sha256").update(dado, "utf8").digest();
  const b = createHash("sha256").update(secreto, "utf8").digest();
  const igual = timingSafeEqual(a, b); // mismo trabajo con o sin cabecera
  return dado.length > 0 && igual ? "ok" : "rechazado";
}

/** Cuántas quedan sin anclar (para mostrarlo en el panel sin ejecutar nada). */
export function contarPendientes(db: DB): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM anchor_queue WHERE status = 'pending'`).get() as { n: number };
  return Number(r.n);
}

/** Una firma del acuerdo que ya no se va a anclar: su estado visible pasa a `failed`. */
function marcarFirmaFallida(db: DB, fila: { kind: string; ref: string }): void {
  if (fila.kind !== "cla") return;
  db.prepare(`UPDATE cla_signatures SET anchor_status = 'failed' WHERE wallet = ? AND anchor_status = 'pending'`).run(
    fila.ref
  );
}

/**
 * Mantenimiento previo a cada pasada (sin red):
 *  - las `pending` que ya agotaron sus intentos (de antes del tope) pasan a `failed`;
 *  - las reservas abandonadas (`processing` desde hace más de `ANCLAJE_RESERVA_MS`)
 *    vuelven a `pending`, o a `failed` si ya agotaron sus intentos.
 * Devuelve cuántas filas tocó de cada tipo.
 */
export function mantenerCola(db: DB, ahora: Date = new Date()): { agotadas: number; liberadas: number } {
  const limite = instanteDb(new Date(ahora.getTime() - ANCLAJE_RESERVA_MS));
  const agotar = db
    .prepare(
      `SELECT id, kind, ref FROM anchor_queue
        WHERE attempts >= ? AND (status = 'pending' OR (status = 'processing' AND (claimed_at IS NULL OR claimed_at < ?)))`
    )
    .all(ANCLAJE_MAX_INTENTOS, limite) as Array<{ id: number; kind: string; ref: string }>;
  let agotadas = 0;
  for (const f of agotar) {
    const r = db
      .prepare(`UPDATE anchor_queue SET status = 'failed', claimed_at = NULL WHERE id = ? AND status IN ('pending', 'processing')`)
      .run(f.id);
    if (Number(r.changes) === 1) {
      agotadas++;
      marcarFirmaFallida(db, f);
    }
  }
  const liberadas = Number(
    db
      .prepare(
        `UPDATE anchor_queue SET status = 'pending', claimed_at = NULL
          WHERE status = 'processing' AND attempts < ? AND (claimed_at IS NULL OR claimed_at < ?)`
      )
      .run(ANCLAJE_MAX_INTENTOS, limite).changes
  );
  return { agotadas, liberadas };
}

/** Filas candidatas: pendientes con intentos disponibles, primero las de menos intentos. */
export function filasParaAnclar(db: DB, limite: number): AnchorRow[] {
  return db
    .prepare(
      `SELECT id, kind, ref, data_key, payload_hash FROM anchor_queue
        WHERE status = 'pending' AND attempts < ? ORDER BY attempts, id LIMIT ?`
    )
    .all(ANCLAJE_MAX_INTENTOS, limite) as AnchorRow[];
}

/**
 * Reserva la fila para ESTA pasada: `pending` → `processing`, con su intento contado.
 * UPDATE condicionado: si otra pasada la tomó primero, no cambia nada y devuelve `false`.
 */
export function reservarFila(db: DB, id: number, ahora: Date = new Date()): boolean {
  const r = db
    .prepare(
      `UPDATE anchor_queue SET status = 'processing', claimed_at = ?, attempts = attempts + 1
        WHERE id = ? AND status = 'pending' AND attempts < ?`
    )
    .run(instanteDb(ahora), id, ANCLAJE_MAX_INTENTOS);
  return Number(r.changes) === 1;
}

/** La fila reservada quedó anclada con la transacción `hash`. */
export function registrarAnclada(db: DB, fila: AnchorRow, hash: string): void {
  db.prepare(`UPDATE anchor_queue SET status = 'anchored', tx_id = ?, claimed_at = NULL WHERE id = ?`).run(hash, fila.id);
  if (fila.kind === "cla") {
    db.prepare(`UPDATE cla_signatures SET anchor_status = 'anchored', tx_id = ? WHERE wallet = ?`).run(hash, fila.ref);
  } else if (fila.kind === "merkle_root") {
    db.prepare(`UPDATE periods SET state = 'Anchored', anchor_tx_id = ? WHERE id = ?`).run(hash, Number(fila.ref));
  }
}

/**
 * La fila reservada falló: vuelve a `pending` para otra pasada o, si ya agotó sus
 * intentos, queda `failed`. Devuelve el estado final.
 */
export function registrarFallo(db: DB, fila: AnchorRow, mensaje: string): "pending" | "failed" {
  db.prepare(
    `UPDATE anchor_queue
        SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, last_error = ?, claimed_at = NULL
      WHERE id = ? AND status = 'processing'`
  ).run(ANCLAJE_MAX_INTENTOS, mensaje.slice(0, 300), fila.id);
  const r = db.prepare(`SELECT status FROM anchor_queue WHERE id = ?`).get(fila.id) as { status: string } | undefined;
  if (r?.status === "failed") {
    marcarFirmaFallida(db, fila);
    return "failed";
  }
  return "pending";
}

/** Envía una fila a la red y devuelve el hash de la transacción. */
export type EnviarAnclaje = (fila: AnchorRow) => Promise<string>;

export interface OpcionesAnclaje {
  /** Envío a la red. Por defecto, `manageData` en testnet con `SERVICE_ACCOUNT_SECRET` (en tests, un doble). */
  enviar?: EnviarAnclaje;
  ahora?: () => Date;
}

/** Envío real: la cuenta de servicio de testnet firma un `manageData` por fila. */
async function envioTestnet(res: AnchorResultado): Promise<EnviarAnclaje> {
  const secreto = process.env.SERVICE_ACCOUNT_SECRET;
  if (!secreto) {
    throw new Error(
      "SERVICE_ACCOUNT_SECRET no configurado: sin llave de servicio no se puede firmar el anclaje."
    );
  }
  const { Horizon, Keypair, TransactionBuilder, Networks, Operation, BASE_FEE } = await import(
    "@stellar/stellar-sdk"
  );
  const server = new Horizon.Server(HORIZON);
  const kp = Keypair.fromSecret(secreto);
  res.cuenta = kp.publicKey();

  // Primer arranque en testnet: la cuenta puede no existir todavía.
  try {
    await server.loadAccount(kp.publicKey());
  } catch {
    const r = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(kp.publicKey())}`);
    if (!r.ok) throw new Error(`La cuenta de servicio no existe y friendbot falló (${r.status}).`);
    await new Promise((s) => setTimeout(s, 3000));
    await server.loadAccount(kp.publicKey());
  }

  return async (fila) => {
    // manageData admite nombre y valor de hasta 64 bytes: el hash hex cabe justo.
    const nombre = String(fila.data_key).slice(0, 64);
    const valor = String(fila.payload_hash).slice(0, 64);
    const cuenta = await server.loadAccount(kp.publicKey());
    const tx = new TransactionBuilder(cuenta, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.manageData({ name: nombre, value: valor }))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    const enviada = await server.submitTransaction(tx);
    return enviada.hash;
  };
}

/**
 * Ejecuta una pasada de anclaje. `limite` acota cuántas filas se intentan en una
 * llamada para no exceder el tiempo de respuesta de la petición HTTP.
 */
export async function anclarPendientes(db: DB, limite = 8, opts: OpcionesAnclaje = {}): Promise<AnchorResultado> {
  const ahora = opts.ahora ?? (() => new Date());
  mantenerCola(db, ahora());
  const pendientes = contarPendientes(db);
  const res: AnchorResultado = { pendientes, anclados: 0, fallidos: 0, cuenta: null, detalle: [] };
  if (pendientes === 0) return res;

  const enviar = opts.enviar ?? (await envioTestnet(res));

  for (const fila of filasParaAnclar(db, limite)) {
    // Otra pasada pudo tomarla mientras esta esperaba a la red: entonces no es nuestra.
    if (!reservarFila(db, fila.id, ahora())) continue;
    try {
      const hash = await enviar(fila);
      registrarAnclada(db, fila, hash);
      res.anclados++;
      res.detalle.push({ id: fila.id, kind: fila.kind, tx: hash });
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e).slice(0, 300);
      registrarFallo(db, fila, msg);
      res.fallidos++;
      res.detalle.push({ id: fila.id, kind: fila.kind, error: msg });
    }
  }
  return res;
}
