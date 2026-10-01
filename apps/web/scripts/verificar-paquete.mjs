#!/usr/bin/env node
/**
 * Verifica un paquete de despliegue ANTES de arrancarlo (fusión v1, 2026-09-30).
 *
 * Por qué existe. El último despliegue subió un zip de apps/web SIN node_modules
 * (OneDeploy sin limpiar) y reutilizó el node_modules que Oryx había construido en
 * producción con next 14.2.15. Con el código de v1 eso ya no sirve: package.json
 * pide next ^14.2.35 (parche de la vulnerabilidad crítica) y añade next-auth, así
 * que la .next nueva correría sobre otro Next y sin next-auth. Además el zip tomaba
 * docs/whitepaper.md de apps/web/docs/, que está en .gitignore y no existe en un
 * checkout limpio. Y ya pasó una vez (2026-09-04) que faltó CLA.md y dos altas
 * firmaron el texto de reserva. Nada de eso da un error claro al arrancar: la app
 * sube y falla después, o firma lo que no debe.
 *
 * Qué comprueba, con las MISMAS rutas candidatas que usa el código en ejecución:
 *   - la build (.next/BUILD_ID y .next/static);
 *   - node_modules: cada dependencia de package.json instalada y dentro de su rango,
 *     y next >= 14.2.35 pase lo que pase (en standalone solo next: el resto lo decide
 *     el trazado de Next);
 *   - src/lib/schema.sql (db.ts), CLA.md con el sha256 que firmaron las altas reales
 *     (cla.ts: primero cwd/../../CLA.md, luego cwd/CLA.md) y docs/whitepaper.md
 *     (app/whitepaper: cwd/../../docs y cwd/docs).
 *
 * Uso (en Kudu, o lo corre start-azure.sh antes de arrancar):
 *   node scripts/verificar-paquete.mjs [carpeta de la app]
 * La carpeta es la que queda como cwd al arrancar: wwwroot con `next start`; la de
 * server.js (apps/web) en un paquete standalone. Sale con código 1 si algo falla.
 *
 * Sin dependencias: solo node:fs, node:path y node:crypto.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** sha256 de CLA.md v1, el texto que firmaron las altas reales. Cambiarlo es un acto legal. */
export const CLA_SHA256 = "03293c9378146cbd7fcbd49a0df467134a118d7a7e0379664c5d069c0398edb9";

/** Next mínimo: 14.2.35 parchea la vulnerabilidad crítica de 14.2.15 (WP33). */
export const NEXT_MINIMO = "14.2.35";

/** "14.2.35" → [14, 2, 35]; null si no es una versión x.y.z. */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function comparar(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * ¿`version` cumple `rango`? Solo las formas que usa este repo: `^x.y.z`, `~x.y.z`,
 * `>=x.y.z` y `x.y.z` exacto. Devuelve null si no entiende el rango (se avisa en
 * vez de adivinar).
 */
export function cumpleRango(version, rango) {
  const v = parseVersion(version);
  const m = /^(\^|~|>=)?\s*(\d+\.\d+\.\d+)$/.exec(String(rango ?? "").trim());
  if (!v || !m) return null;
  const min = parseVersion(m[2]);
  if (comparar(v, min) < 0) return false;
  if (m[1] === "^") return min[0] === 0 ? v[0] === 0 && v[1] === min[1] : v[0] === min[0];
  if (m[1] === "~") return v[0] === min[0] && v[1] === min[1];
  if (!m[1]) return comparar(v, min) === 0;
  return true;
}

/**
 * Versión instalada de `nombre`, buscando `node_modules/<nombre>/package.json` desde
 * `desde` hacia arriba, igual que la resolución de Node (en el monorepo las
 * dependencias están izadas a la raíz). null si no está.
 */
export function versionInstalada(desde, nombre) {
  let d = path.resolve(desde);
  for (;;) {
    const p = path.join(d, "node_modules", nombre, "package.json");
    if (fs.existsSync(p)) {
      try {
        return { version: JSON.parse(fs.readFileSync(p, "utf8")).version ?? null, ruta: p };
      } catch {
        return { version: null, ruta: p };
      }
    }
    const padre = path.dirname(d);
    if (padre === d) return null;
    d = padre;
  }
}

function esArchivo(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function esCarpeta(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Primera ruta que existe, en el orden en que la prueba el código de la app. */
function primeraQueExiste(rutas) {
  return rutas.find(esArchivo) ?? null;
}

/**
 * @param {string} dir carpeta de la app tal como arranca (su cwd).
 * @returns {{ ok: boolean, modo: "next-start" | "standalone", errores: string[], avisos: string[], detalles: string[] }}
 */
export function verificarPaquete(dir) {
  const app = path.resolve(dir);
  const errores = [];
  const avisos = [];
  const detalles = [];
  const modo = esArchivo(path.join(app, "server.js")) ? "standalone" : "next-start";

  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
  } catch {
    errores.push(`no hay package.json legible en ${app}: no es la carpeta de la app.`);
    return { ok: false, modo, errores, avisos, detalles };
  }

  // 1. La build.
  if (!esArchivo(path.join(app, ".next", "BUILD_ID"))) {
    errores.push(".next/BUILD_ID no existe: el paquete no trae la build de Next.");
  }
  if (!esCarpeta(path.join(app, ".next", "static"))) {
    errores.push(
      ".next/static no existe" +
        (modo === "standalone" ? ": standalone NO la copia, hay que copiarla junto a server.js." : ".")
    );
  }
  if (modo === "standalone" && !esCarpeta(path.join(app, "public"))) {
    avisos.push("public/ no está junto a server.js: standalone no la copia (iconos e imágenes darían 404).");
  }

  // 2. Dependencias. En standalone solo next: el trazado decide qué más entra.
  const deps = pkg.dependencies ?? {};
  const nombres = modo === "standalone" ? ["next"] : Object.keys(deps);
  for (const nombre of nombres) {
    const rango = deps[nombre];
    const inst = versionInstalada(app, nombre);
    if (!inst) {
      errores.push(`falta node_modules/${nombre} (package.json pide ${rango ?? "?"}).`);
      continue;
    }
    const cumple = rango ? cumpleRango(inst.version, rango) : true;
    if (cumple === false) {
      errores.push(
        `${nombre} instalado es ${inst.version} y package.json pide ${rango}: node_modules de otra build (¿el de Oryx?).`
      );
    } else if (cumple === null) {
      avisos.push(`no se pudo comprobar ${nombre}@${inst.version} contra el rango "${rango}".`);
    } else {
      detalles.push(`${nombre}@${inst.version}`);
    }
  }
  const next = versionInstalada(app, "next");
  if (next && parseVersion(next.version) && comparar(parseVersion(next.version), parseVersion(NEXT_MINIMO)) < 0) {
    errores.push(`next ${next.version} es menor que ${NEXT_MINIMO} (versión con la vulnerabilidad crítica).`);
  }
  if (modo === "next-start") {
    // start-azure.sh ejecuta `node node_modules/next/dist/bin/next` DESDE esta carpeta:
    // un next izado más arriba (como en el monorepo de desarrollo) no le sirve.
    if (!esArchivo(path.join(app, "node_modules", "next", "dist", "bin", "next"))) {
      errores.push(
        "no existe node_modules/next/dist/bin/next en esta carpeta, y start-azure.sh lo ejecuta desde aquí."
      );
    }
    for (const nombre of Object.keys(pkg.optionalDependencies ?? {})) {
      if (!versionInstalada(app, nombre)) avisos.push(`falta la dependencia opcional ${nombre} (solo la usa su driver).`);
    }
  }

  // 3. Archivos que el runtime lee con fs, en el orden en que los busca el código.
  const schema = path.join(app, "src", "lib", "schema.sql");
  if (!esArchivo(schema)) errores.push("falta src/lib/schema.sql (db.ts lo aplica en cada arranque).");
  else detalles.push("src/lib/schema.sql");

  const cla = primeraQueExiste([path.join(app, "..", "..", "CLA.md"), path.join(app, "CLA.md")]);
  if (!cla) {
    errores.push("falta CLA.md (junto a package.json): sin él las altas firman el TEXTO DE RESERVA.");
  } else {
    const hash = createHash("sha256").update(fs.readFileSync(cla)).digest("hex");
    if (hash !== CLA_SHA256) {
      errores.push(
        `CLA.md en ${cla} tiene sha256 ${hash.slice(0, 8)}…, no ${CLA_SHA256.slice(0, 8)}… ` +
          "(¿fin de línea convertido o texto cambiado?). Las firmas nuevas no coincidirían."
      );
    } else {
      detalles.push(`CLA.md ${CLA_SHA256.slice(0, 8)}… (${path.relative(app, cla) || "CLA.md"})`);
    }
  }

  const whitepaper = primeraQueExiste([
    path.join(app, "..", "..", "docs", "whitepaper.md"),
    path.join(app, "docs", "whitepaper.md"),
  ]);
  if (!whitepaper) {
    errores.push(
      "falta docs/whitepaper.md: cópialo de docs/whitepaper.md de la RAÍZ del repo " +
        "(apps/web/docs/ está en .gitignore y no existe en un checkout limpio)."
    );
  } else {
    detalles.push(`docs/whitepaper.md (${path.relative(app, whitepaper)})`);
  }

  for (const worker of ["db-query.worker.mjs", "db-mssql-backend.mjs"]) {
    if (!esArchivo(path.join(app, "src", "lib", worker))) {
      avisos.push(`falta src/lib/${worker} (solo lo necesita DATABASE_DRIVER=mssql).`);
    }
  }

  return { ok: errores.length === 0, modo, errores, avisos, detalles };
}

function main() {
  const dir = process.argv[2] ?? process.cwd();
  const r = verificarPaquete(dir);
  const pre = "[paquete]";
  console.log(`${pre} modo ${r.modo} · ${path.resolve(dir)}`);
  if (r.detalles.length) console.log(`${pre} ok: ${r.detalles.join(", ")}`);
  for (const a of r.avisos) console.log(`${pre} AVISO: ${a}`);
  for (const e of r.errores) console.error(`${pre} ERROR: ${e}`);
  console.log(r.ok ? `${pre} listo para arrancar.` : `${pre} NO arrancar: ${r.errores.length} error(es).`);
  process.exitCode = r.ok ? 0 : 1;
}

const invocado = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invocado && invocado === fileURLToPath(import.meta.url)) main();
