/**
 * Los pull requests corren tipos, pruebas, lint y build (hallazgo M25 de la auditoría).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.join(process.cwd(), "..", "..");
const yml = fs.readFileSync(path.join(RAIZ, ".github", "workflows", "ci.yml"), "utf8");

describe(".github/workflows/ci.yml", () => {
  it("corre en cada pull request, con Node 22 y permisos de solo lectura", () => {
    expect(yml).not.toContain("\r");
    expect(yml).toMatch(/^on:\s*\n\s+pull_request:/m);
    expect(yml).toMatch(/node-version: 22\b/);
    expect(yml).not.toMatch(/node-version: 20\b/);
    expect(yml).toMatch(/^permissions:\s*\n\s+contents: read/m);
  });

  it("instala con el lockfile y los binarios de Linux de rollup/esbuild, como paquete-azure.yml", () => {
    expect(yml).toContain("run: npm ci");
    const paquete = fs.readFileSync(path.join(RAIZ, ".github", "workflows", "paquete-azure.yml"), "utf8");
    for (const linea of [
      `RV=$(node -p "require('rollup/package.json').version")`,
      `EV=$(node -p "require('esbuild/package.json').version")`,
      `npm install --no-save --no-package-lock "@rollup/rollup-linux-x64-gnu@$RV" "@esbuild/linux-x64@$EV"`,
    ]) {
      expect(yml).toContain(linea);
      expect(paquete).toContain(linea);
    }
  });

  it("tsc, npm test, lint y build, en ese orden", () => {
    const pasos = ["npx tsc --noEmit -p .", "run: npm test", "npm --workspace apps/web run lint", "npm --workspace apps/web run build"];
    const pos = pasos.map((p) => yml.indexOf(p));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });
});
