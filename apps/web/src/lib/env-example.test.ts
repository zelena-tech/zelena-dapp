/**
 * `.env.example` documenta TODAS las variables que lee el código, solo con nombres y
 * comentarios (hallazgo M26 de la auditoría): ningún valor y ninguna variable que nadie lee.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = process.cwd();
const RAIZ = path.join(WEB, "..", "..");
const ejemplo = fs.readFileSync(path.join(WEB, ".env.example"), "utf8");

/** Las pone la plataforma (Node, Next, App Service, vitest): no se configuran a mano. */
const DE_LA_PLATAFORMA = new Set(["NODE_ENV", "NEXT_PHASE", "PORT", "HOSTNAME", "TZ", "VERCEL", "NODE_OPTIONS"]);

function recorrer(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === "__fixtures__") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, out);
    // Los .sh de packages/scripts (el smoke) tienen sus propias opciones: no son configuración
    // de la app. Los dos .sh de arranque se leen aparte, abajo.
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Nombres que el código lee del entorno (`process.env.X`, `env.X`, `${X:-}` en los .sh). */
function variablesDelCodigo(): Set<string> {
  const archivos = [
    ...recorrer(path.join(WEB, "src")),
    ...recorrer(path.join(WEB, "app")),
    ...recorrer(path.join(WEB, "scripts")),
    ...recorrer(path.join(RAIZ, "packages", "scripts")),
    path.join(WEB, "middleware.ts"),
    path.join(WEB, "next.config.mjs"),
    path.join(WEB, "start-azure.sh"),
    path.join(WEB, "start-standalone.sh"),
  ];
  const nombres = new Set<string>();
  for (const a of archivos) {
    const src = fs.readFileSync(a, "utf8");
    for (const m of src.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]{1,})\b/g)) nombres.add(m[1]);
    if (a.endsWith(".sh")) for (const m of src.matchAll(/\$\{([A-Z][A-Z0-9_]+):-/g)) nombres.add(m[1]);
  }
  return nombres;
}

describe("apps/web/.env.example", () => {
  it("nombra cada variable que lee el código", () => {
    const faltan = [...variablesDelCodigo()].filter((v) => !DE_LA_PLATAFORMA.has(v) && !ejemplo.includes(`# ${v}=`));
    expect(faltan).toEqual([]);
  });

  it("no trae valores: cada asignación está comentada y vacía", () => {
    const asignaciones = ejemplo.split("\n").filter((l) => /^#?\s*[A-Z][A-Z0-9_]+=/.test(l));
    expect(asignaciones.length).toBeGreaterThan(40);
    for (const l of asignaciones) expect(l, l).toMatch(/^# [A-Z][A-Z0-9_]+=$/);
  });

  it("no documenta variables que nadie lee (STELLAR_NETWORK salió)", () => {
    const delCodigo = variablesDelCodigo();
    const documentadas = [...ejemplo.matchAll(/^# ([A-Z][A-Z0-9_]+)=$/gm)].map((m) => m[1]);
    const soloPruebas = ["ZELENA_NOMBRES_PRIVADOS", "ZELENA_NOMBRES_VETADOS", "ZELENA_BARRIDO_NOMBRES"];
    expect(documentadas.filter((v) => !delCodigo.has(v) && !soloPruebas.includes(v))).toEqual([]);
    expect(ejemplo).not.toContain("STELLAR_NETWORK");
  });
});
