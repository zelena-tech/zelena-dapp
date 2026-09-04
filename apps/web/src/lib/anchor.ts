/**
 * Anclaje en Stellar testnet ejecutable DESDE EL SERVIDOR.
 *
 * Por qué existe: `performOnboard` encola cada firma del CLA en `anchor_queue`
 * con estado 'pending', pero el único anclador era `packages/scripts/anchor-worker.mjs`,
 * un script que hay que correr a mano. En el despliegue nadie lo corre, así que
 * la cola crecía para siempre y la promesa de "tu reputación queda anclada"
 * no se cumplía. Esta capa permite disparar una pasada desde una ruta protegida.
 *
 * Misma mecánica que el worker (manageData con nombre y valor de 64 bytes) para
 * que lo anclado sea verificable igual por terceros. La lógica de datos vive
 * aquí y la ruta solo la invoca (ver CLAUDE.md).
 */
import type { DB } from "./db";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

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

/** Cuántas quedan sin anclar (para mostrarlo en el panel sin ejecutar nada). */
export function contarPendientes(db: DB): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM anchor_queue WHERE status = 'pending'`).get() as { n: number };
  return r.n;
}

/**
 * Ejecuta una pasada de anclaje. `limite` acota cuántas filas se intentan en una
 * llamada para no exceder el tiempo de respuesta de la petición HTTP.
 */
export async function anclarPendientes(db: DB, limite = 8): Promise<AnchorResultado> {
  const pendientes = contarPendientes(db);
  const res: AnchorResultado = { pendientes, anclados: 0, fallidos: 0, cuenta: null, detalle: [] };
  if (pendientes === 0) return res;

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

  const filas = db
    .prepare(`SELECT id, kind, ref, data_key, payload_hash FROM anchor_queue WHERE status = 'pending' ORDER BY id LIMIT ?`)
    .all(limite) as AnchorRow[];

  for (const fila of filas) {
    try {
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
      const hash = enviada.hash;

      db.prepare(
        `UPDATE anchor_queue SET status = 'anchored', tx_id = ?, attempts = attempts + 1 WHERE id = ?`
      ).run(hash, fila.id);
      if (fila.kind === "cla") {
        db.prepare(`UPDATE cla_signatures SET anchor_status = 'anchored', tx_id = ? WHERE wallet = ?`).run(
          hash,
          fila.ref
        );
      } else if (fila.kind === "merkle_root") {
        db.prepare(`UPDATE periods SET state = 'Anchored', anchor_tx_id = ? WHERE id = ?`).run(
          hash,
          Number(fila.ref)
        );
      }
      res.anclados++;
      res.detalle.push({ id: fila.id, kind: fila.kind, tx: hash });
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e).slice(0, 300);
      db.prepare(`UPDATE anchor_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(msg, fila.id);
      res.fallidos++;
      res.detalle.push({ id: fila.id, kind: fila.kind, error: msg });
    }
  }
  return res;
}
