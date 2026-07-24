#!/usr/bin/env node
/**
 * CLI del simulador ABM de la economía de puntos (WP11).
 *
 * Reusa el MISMO motor puro que la suite de tests: apps/web/src/lib/sim.ts.
 * Requiere Node >= 22 (type-stripping nativo de TypeScript). El motor solo
 * depende de módulos puros (genome/rules), sin tocar la DB.
 *
 * Uso:
 *   node packages/scripts/sim/index.mjs --genome v1 --epochs 1000 --pop 25
 *   node packages/scripts/sim/index.mjs --epochs 500 --pop 40 --json
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(here, "../../../apps/web/src/lib/sim.ts");

function parseArgs(argv) {
  const args = { genome: "v1", epochs: 1000, pop: 25, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--genome") args.genome = argv[++i];
    else if (a === "--epochs") args.epochs = parseInt(argv[++i], 10);
    else if (a === "--pop") args.pop = parseInt(argv[++i], 10);
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function pct(x) {
  return (x * 100).toFixed(1) + "%";
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Uso: node packages/scripts/sim/index.mjs --genome v1 --epochs 1000 --pop 25 [--json]");
    return;
  }

  const { simulate, genomePreset } = await import(pathToUrl(enginePath));
  const genome = genomePreset(args.genome);
  const report = simulate({ genome, epochs: args.epochs, population: args.pop });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n=== Simulación ABM · genoma ${args.genome} · ${args.epochs} épocas · ${args.pop} agentes ===`);
  console.log(`Puntos emitidos:        ${report.pointsEmitted.toLocaleString("es")} (${report.pointsPerEpoch.toLocaleString("es")} / época)`);
  console.log(`Alerta de emisión:      ${report.emissionAlert ? "⚠️  SÍ (sobre el techo de seguridad)" : "no"}`);
  console.log(`Gini de reputación:     ${report.gini.toFixed(3)}`);
  console.log(`Captura de farmers:     ${pct(report.farmerCapturePct)}`);
  console.log(`\nPor estrategia:`);
  for (const [strategy, s] of Object.entries(report.byStrategy)) {
    console.log(
      `  ${strategy.padEnd(20)} agentes ${String(s.agents).padStart(3)} · puntos ${String(Math.round(s.points)).padStart(9)} · retención ${pct(s.retention)}`
    );
  }
  console.log("");
}

// import() en Windows necesita URL file:// para rutas absolutas.
function pathToUrl(p) {
  return new URL(`file://${p.replace(/\\/g, "/")}`).href;
}

main().catch((e) => {
  console.error("Error en la simulación:", e.message);
  process.exit(1);
});
