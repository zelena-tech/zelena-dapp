/**
 * "Roles, no personas" (AUTHZ + fusión v1, 2026-09-30) · test ESTÁTICO.
 *
 * La línea desplegada autorizaba comparando la wallet de la sesión con la de una
 * persona (`session.wallet === FOUNDER_WALLET`) en /clientes, /api/clientes/grafo,
 * /api/anchor/run, el login y el Nav. En v1 la autoridad es `users.role` leído de
 * la base (`adminActor`, `equipoInternoActor`, `clientActor` en lib/authz.ts).
 *
 * Este test recorre `app/`, `src/components/` y `middleware.ts` y falla si vuelve
 * a aparecer una comparación contra `FOUNDER_WALLET`. La variable sigue existiendo
 * para el seed y para el backfill de la migración (lib/), nunca como gate.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RAIZ = process.cwd(); // apps/web
const COMPARACION = /[!=]==?\s*FOUNDER_WALLET\b|\bFOUNDER_WALLET\s*[!=]==?/;

function archivos(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(p));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("sin gates por persona en la capa web", () => {
  const objetivo = [
    ...archivos(path.join(RAIZ, "app")),
    ...archivos(path.join(RAIZ, "src", "components")),
    path.join(RAIZ, "middleware.ts"),
  ];

  it("recorre de verdad los archivos de la web (el test no pasa por vacío)", () => {
    expect(objetivo.length).toBeGreaterThan(40);
    expect(objetivo.some((p) => p.endsWith(path.join("app", "admin", "page.tsx")))).toBe(true);
  });

  it("ningún archivo de app/, src/components/ ni middleware.ts compara contra FOUNDER_WALLET", () => {
    const culpables = objetivo
      .map((p) => {
        const lineas = fs.readFileSync(p, "utf8").split("\n");
        const malas = lineas
          .map((l, i) => ({ l, i: i + 1 }))
          .filter(({ l }) => COMPARACION.test(l))
          .map(({ i }) => `${path.relative(RAIZ, p)}:${i}`);
        return malas;
      })
      .flat();
    expect(culpables).toEqual([]);
  });

  it("el patrón detecta las dos formas que existían en la línea desplegada", () => {
    expect(COMPARACION.test("isFounder: session.wallet === FOUNDER_WALLET }")).toBe(true);
    expect(COMPARACION.test("if (session.wallet !== FOUNDER_WALLET) {")).toBe(true);
    expect(COMPARACION.test("// no por FOUNDER_WALLET")).toBe(false);
  });
});
