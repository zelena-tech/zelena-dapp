#!/usr/bin/env node
/**
 * Worker de anclaje — Zelena DAO (Milestone 1 · testnet).
 *
 * Corre en TU máquina (no en el sandbox, cuya red no alcanza Stellar). Lee la
 * cola `anchor_queue` de la base SQLite de la Dapp y ancla cada hash pendiente
 * en Stellar testnet con una operación clásica `manageData` firmada por una
 * cuenta de servicio. Guarda el txId y marca la fila como 'anchored'.
 *
 * Uso:
 *   # 1) Instala deps del monorepo desde la raíz:  npm install
 *   # 2) (opcional) exporta el secreto de la cuenta de servicio; si no, el
 *   #    worker genera un keypair y lo fondea con friendbot en el primer arranque:
 *   export SERVICE_ACCOUNT_SECRET=S....
 *   # 3) corre una pasada, o en bucle:
 *   node packages/scripts/anchor-worker.mjs
 *   node packages/scripts/anchor-worker.mjs --watch
 *
 * Nunca subas el secreto al repo. Es solo testnet; sin dinero real.
 */
import { Horizon, Keypair, TransactionBuilder, Networks, Operation, BASE_FEE } from "@stellar/stellar-sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Driver dual: better-sqlite3 si existe; si no, node:sqlite (built-in Node >=22).
const require_ = createRequire(import.meta.url);
function openDatabase(file) {
  try {
    const Database = require_("better-sqlite3");
    return new Database(file);
  } catch {
    const { DatabaseSync } = require_("node:sqlite");
    return new DatabaseSync(file);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const WATCH = process.argv.includes("--watch");
const POLL_MS = 15_000;

function dbPath() {
  if (process.env.DATABASE_FILE) return path.resolve(process.env.DATABASE_FILE);
  return path.resolve(__dirname, "..", "..", "apps", "web", "data", "zelena.db");
}

async function ensureServiceAccount(server) {
  let secret = process.env.SERVICE_ACCOUNT_SECRET;
  const keyFile = path.resolve(__dirname, ".service-account.secret");
  if (!secret && fs.existsSync(keyFile)) secret = fs.readFileSync(keyFile, "utf8").trim();
  let kp;
  if (secret) {
    kp = Keypair.fromSecret(secret);
  } else {
    kp = Keypair.random();
    fs.writeFileSync(keyFile, kp.secret(), { mode: 0o600 });
    console.log("[anchor] Cuenta de servicio generada:", kp.publicKey());
    console.log("[anchor] Secreto guardado en", keyFile, "(gitignored — no lo subas).");
  }
  // ¿Existe/está fondeada?
  try {
    await server.loadAccount(kp.publicKey());
  } catch {
    console.log("[anchor] Fondeando con friendbot…");
    const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(kp.publicKey())}`);
    if (!res.ok) throw new Error("friendbot falló: " + res.status);
    await new Promise((r) => setTimeout(r, 3000));
    await server.loadAccount(kp.publicKey());
    console.log("[anchor] Cuenta fondeada:", kp.publicKey());
  }
  return kp;
}

async function anchorOne(server, kp, row) {
  const account = await server.loadAccount(kp.publicKey());
  // manageData: key <= 64 bytes, value <= 64 bytes. El hash hex de 64 chars cabe justo.
  const key = String(row.data_key).slice(0, 64);
  const value = String(row.payload_hash).slice(0, 64);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: key, value }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

async function runPass(db, server, kp) {
  const rows = db
    .prepare(`SELECT * FROM anchor_queue WHERE status = 'pending' ORDER BY id LIMIT 20`)
    .all();
  if (rows.length === 0) {
    console.log("[anchor] Sin pendientes.");
    return 0;
  }
  let done = 0;
  for (const row of rows) {
    try {
      const hash = await anchorOne(server, kp, row);
      db.prepare(`UPDATE anchor_queue SET status = 'anchored', tx_id = ?, attempts = attempts + 1 WHERE id = ?`).run(
        hash,
        row.id
      );
      if (row.kind === "cla") {
        db.prepare(`UPDATE cla_signatures SET anchor_status = 'anchored', tx_id = ? WHERE wallet = ?`).run(hash, row.ref);
      } else if (row.kind === "merkle_root") {
        db.prepare(`UPDATE periods SET state = 'Anchored', anchor_tx_id = ? WHERE id = ?`).run(hash, Number(row.ref));
      }
      console.log(`[anchor] #${row.id} (${row.kind}) → ${hash}`);
      done++;
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : String(e?.message ?? e);
      db.prepare(`UPDATE anchor_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(msg, row.id);
      console.error(`[anchor] #${row.id} falló:`, msg);
    }
  }
  return done;
}

async function main() {
  const file = dbPath();
  if (!fs.existsSync(file)) {
    console.error("[anchor] No existe la DB en", file, "— arranca la Dapp una vez para crearla.");
    process.exit(1);
  }
  const db = openDatabase(file);
  const server = new Horizon.Server(HORIZON);
  const kp = await ensureServiceAccount(server);
  console.log("[anchor] Cuenta de servicio:", kp.publicKey());
