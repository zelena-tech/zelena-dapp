#!/usr/bin/env node
/**
 * Worker de anclaje (local) — Zelena DAO · Stellar testnet.
 *
 * En el despliegue el anclaje lo dispara el workflow programado `anclaje.yml`, que
 * llama a `POST /api/anchor/run`. Este script hace LO MISMO en tu máquina, sobre la
 * base SQLite local, y NO reimplementa nada: carga `apps/web/src/lib/anchor.ts` (la
 * misma lógica que la ruta, con su tope de intentos y su reserva de filas) con el
 * type-stripping nativo de Node.
 *
 * Antes este archivo duplicaba la lógica y estaba truncado: no parseaba (auditoría
 * 2026-10-21, A4). Los scripts `anchor` y `anchor:watch` de packages/scripts lo usan.
 *
 * Uso:
 *   node packages/scripts/anchor-worker.mjs                # una pasada
 *   node packages/scripts/anchor-worker.mjs --watch        # en bucle, cada 60 s
 *   node packages/scripts/anchor-worker.mjs --pendientes   # solo cuenta, sin tocar la red
 *
 * Llave de la cuenta de servicio (solo testnet, sin dinero real): SERVICE_ACCOUNT_SECRET
 * o, si no está, `packages/scripts/.service-account.secret` (gitignored). Si no hay
 * ninguna, se genera una y se guarda ahí; `anchor.ts` la fondea con friendbot. Nunca
 * subas el secreto al repo.
 *
 * La base: DATABASE_FILE, o `apps/web/data/zelena.db` (la de `npm run dev`). Requiere
 * Node >= 22.6 (type stripping).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "..", "apps", "web");
const REEXEC_MARK = "ZELENA_ANCHOR_REEXEC";
const WATCH = process.argv.includes("--watch");
const SOLO_CONTAR = process.argv.includes("--pendientes");
const INTERVALO_MS = 60_000;
const LIMITE = 8;

/** El type stripping de TypeScript es opt-in en algunos Node 22.x: se relanza con el flag. */
function ensureTypeStripping() {
  if (process.env[REEXEC_MARK] === "1") return;
  const res = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, [REEXEC_MARK]: "1" } }
  );
  process.exit(res.status ?? 1);
}
ensureTypeStripping();

function dbPath() {
  if (process.env.DATABASE_FILE) return path.resolve(process.env.DATABASE_FILE);
  return path.resolve(WEB_DIR, "data", "zelena.db");
}

const require_ = createRequire(import.meta.url);

/** Adaptador mínimo con la superficie que usa anchor.ts: prepare().get/all/run. */
function openDatabase(file) {
  try {
    const Database = require_("better-sqlite3");
    const db = new Database(file);
    return { prepare: (sql) => db.prepare(sql) };
  } catch {
    const { DatabaseSync } = require_("node:sqlite");
    const db = new DatabaseSync(file);
    return {
      prepare: (sql) => ({
        run: (...p) => db.prepare(sql).run(...p),
        get: (...p) => db.prepare(sql).get(...p),
        all: (...p) => db.prepare(sql).all(...p),
      }),
    };
  }
}

/** SERVICE_ACCOUNT_SECRET del entorno, del archivo local o uno nuevo guardado ahí. */
async function asegurarLlave() {
  if (process.env.SERVICE_ACCOUNT_SECRET) return;
  const archivo = path.resolve(__dirname, ".service-account.secret");
  if (fs.existsSync(archivo)) {
    process.env.SERVICE_ACCOUNT_SECRET = fs.readFileSync(archivo, "utf8").trim();
    return;
  }
  const { Keypair } = await import("@stellar/stellar-sdk");
  const kp = Keypair.random();
  fs.writeFileSync(archivo, kp.secret(), { mode: 0o600 });
  process.env.SERVICE_ACCOUNT_SECRET = kp.secret();
  console.log(`[anchor] Cuenta de servicio nueva: ${kp.publicKey()} (secreto en ${archivo}, gitignored).`);
}

const file = dbPath();
if (!fs.existsSync(file)) {
  console.error(`[anchor] No existe la base en ${file}: arranca la dapp una vez (npm run dev) para crearla.`);
  process.exit(1);
}
const db = openDatabase(file);

// pathToFileURL: en Windows una ruta absoluta ('C:\…') no es una URL ESM válida.
const { anclarPendientes, contarPendientes, mantenerCola } = await import(
  pathToFileURL(path.join(WEB_DIR, "src", "lib", "anchor.ts")).href
);

if (SOLO_CONTAR) {
  mantenerCola(db);
  console.log(`[anchor] pendientes: ${contarPendientes(db)}`);
  process.exit(0);
}

async function pasada() {
  try {
    const r = await anclarPendientes(db, LIMITE);
    if (r.pendientes === 0) {
      console.log("[anchor] Sin pendientes.");
      return;
    }
    for (const d of r.detalle) {
      console.log(d.tx ? `[anchor] #${d.id} (${d.kind}) → ${d.tx}` : `[anchor] #${d.id} (${d.kind}) falló: ${d.error}`);
    }
    console.log(`[anchor] pendientes=${r.pendientes} anclados=${r.anclados} fallidos=${r.fallidos}`);
  } catch (e) {
    console.error(`[anchor] La pasada falló: ${e?.message ?? e}`);
    if (!WATCH) process.exitCode = 1;
  }
}

await asegurarLlave();
await pasada();
if (WATCH) {
  console.log(`[anchor] Modo --watch: una pasada cada ${INTERVALO_MS / 1000} s (Ctrl+C para salir).`);
  setInterval(() => void pasada(), INTERVALO_MS);
}
