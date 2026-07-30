#!/usr/bin/env node
/**
 * Importador de tareas desde CSV → módulo equipo de la dapp (WP14).
 *
 * NO reimplementa nada: usa el MISMO código que la app y que los tests
 * (`apps/web/src/lib/team-import.ts`), cargado con el type-stripping nativo de Node.
 * Así el parser y los mapeos que se prueban en la suite son exactamente los que
 * corren en el import real: no hay dos verdades que puedan divergir.
 *
 * Uso:
 *   node packages/scripts/import-tareas.mjs <ruta-del-csv> [--dry-run]
 *
 * Ejemplo (paso 7 del despliegue, con los CSV reales de John, que viven FUERA
 * del repo y no se versionan):
 *   node packages/scripts/import-tareas.mjs "C:/Users/Omnia/Desktop/DAO/Zelena_Tareas_Import.csv"
 *
 * Columnas esperadas:
 *   Task Name, Description, Status, Priority, Assignee, Iniciativa, Horizonte,
 *   Criterio de aceptación
 *
 * IDEMPOTENTE: reejecutarlo con el mismo CSV actualiza y NO duplica. Se puede
 * correr las veces que haga falta.
 *
 * Requiere Node >= 22.6 (type stripping) y que la base de datos exista: arranca la
 * dapp una vez (`npm run dev`) para que se cree y se siembre.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "..", "apps", "web");
const REEXEC_MARK = "ZELENA_IMPORT_REEXEC";

/**
 * El type stripping de TypeScript es opt-in en Node 22.x. Si no está activo, este
 * proceso se relanza a sí mismo con el flag en vez de pedirle al usuario que lo
 * recuerde.
 */
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

// --- CLI -------------------------------------------------------------------

const args = process.argv.slice(2).filter((a) => a !== "--dry-run");
const DRY_RUN = process.argv.includes("--dry-run");
const csvArg = args[0];

if (!csvArg) {
  console.error("Uso: node packages/scripts/import-tareas.mjs <ruta-del-csv> [--dry-run]");
  process.exit(1);
}
const csvPath = path.resolve(process.cwd(), csvArg);
if (!fs.existsSync(csvPath)) {
  console.error(`[import] No encuentro el CSV en ${csvPath}`);
  process.exit(1);
}

// --- Base de datos (mismo criterio de ruta que apps/web/src/lib/db.ts) -----

function dbPath() {
  if (process.env.DATABASE_FILE) return path.resolve(process.env.DATABASE_FILE);
  return path.resolve(WEB_DIR, "data", "zelena.db");
}

const require_ = createRequire(import.meta.url);

/** Adaptador con la MISMA superficie síncrona que la interfaz `DB` de la app. */
function openDatabase(file) {
  try {
    const Database = require_("better-sqlite3");
    const db = new Database(file);
    return {
      prepare: (sql) => db.prepare(sql),
      exec: (sql) => void db.exec(sql),
      pragma: (d) => void db.pragma(d),
      transaction: (fn) => db.transaction(fn),
    };
  } catch {
    const { DatabaseSync } = require_("node:sqlite");
    const db = new DatabaseSync(file);
    let inTx = false;
    return {
      prepare: (sql) => ({
        run: (...p) => db.prepare(sql).run(...p),
        get: (...p) => db.prepare(sql).get(...p),
        all: (...p) => db.prepare(sql).all(...p),
      }),
      exec: (sql) => void db.exec(sql),
      pragma: (d) => void db.exec(`PRAGMA ${d};`),
      transaction:
        (fn) =>
        (...a) => {
          if (inTx) return fn(...a);
          db.exec("BEGIN IMMEDIATE");
          inTx = true;
          try {
            const r = fn(...a);
            db.exec("COMMIT");
            return r;
          } catch (e) {
            try {
              db.exec("ROLLBACK");
            } catch {
              /* ya revertida */
            }
            throw e;
          } finally {
            inTx = false;
          }
        },
    };
  }
}

// --- Ejecución -------------------------------------------------------------

const file = dbPath();
if (!fs.existsSync(file)) {
  console.error(
    `[import] No existe la base de datos en ${file}.\n` +
      `[import] Arranca la dapp una vez (npm run dev) para que se cree y se siembre.`
  );
  process.exit(1);
}

const db = openDatabase(file);
db.pragma("foreign_keys = ON");
// El esquema es CREATE TABLE IF NOT EXISTS: aplicarlo aquí solo garantiza que las
// tablas del módulo equipo existan si la dapp no se ha reiniciado tras actualizar.
db.exec(fs.readFileSync(path.join(WEB_DIR, "src", "lib", "schema.sql"), "utf8"));

// pathToFileURL: en Windows una ruta absoluta ('C:\…') no es una URL ESM válida.
const { importTasks, parseCsv, mapRow } = await import(
  pathToFileURL(path.join(WEB_DIR, "src", "lib", "team-import.ts")).href
);

const csvText = fs.readFileSync(csvPath, "utf8");

if (DRY_RUN) {
  const rows = parseCsv(csvText);
  const header = rows[0].map((h) => h.trim());
  let ok = 0;
  console.log(`[import] --dry-run sobre ${csvPath} (${rows.length - 1} filas de datos)\n`);
  for (let r = 1; r < rows.length; r++) {
    const cells = {};
    header.forEach((h, i) => (cells[h] = rows[r][i] ?? ""));
    const { row, error } = mapRow(cells);
    if (!row) {
      console.log(`  línea ${r + 1}  RECHAZADA  ${error}`);
      continue;
    }
    ok++;
    const avisos = row.warnings.length ? `  (aviso: ${row.warnings.join("; ")})` : "";
    console.log(
      `  línea ${r + 1}  ${row.initiativeName} / ${row.horizon} · ${row.status} · ${row.priority} · ` +
        `${row.ownerWallet ?? "sin responsable"} · ${row.title}${avisos}`
    );
  }
  console.log(`\n[import] ${ok} filas listas para importar. Nada se escribió en la base de datos.`);
  process.exit(0);
}

const summary = importTasks(db, csvText, null);

console.log(`[import] CSV: ${csvPath}`);
console.log(`[import] Base de datos: ${file}`);
console.log(`[import] Asignaciones creadas: ${summary.created}`);
console.log(`[import] Asignaciones actualizadas (ya existían): ${summary.updated}`);
console.log(`[import] Iniciativas referenciadas: ${summary.initiatives}`);

if (summary.warnings.length > 0) {
  console.log(`\n[import] Avisos (${summary.warnings.length}):`);
  for (const w of summary.warnings) console.log(`  línea ${w.line}  ${w.title} — ${w.warning}`);
}

if (summary.errors.length > 0) {
  console.log(`\n[import] Filas NO importadas (${summary.errors.length}):`);
  for (const e of summary.errors) console.log(`  línea ${e.line}  ${e.title || "(sin título)"} — ${e.reason}`);
  console.log(
    `\n[import] Corrige esas filas en el CSV y vuelve a correr el script: es idempotente, no duplica nada.`
  );
}

console.log(`\n[import] Listo. Revisa /equipo/proyectos en la dapp.`);
