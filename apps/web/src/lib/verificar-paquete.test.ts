/**
 * `scripts/verificar-paquete.mjs` (hallazgo de verificación, 2026-09-30): el paquete
 * de producción hecho "como la última vez" (zip de apps/web sin node_modules,
 * reutilizando el node_modules de Oryx con next 14.2.15, y docs/whitepaper.md
 * tomado de apps/web/docs/, que está en .gitignore) no sirve con el código de v1.
 * Estos tests fijan que el verificador lo rechaza con un motivo claro y acepta un
 * paquete correcto, en las dos formas: `next start` y standalone.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLA_SHA256,
  NEXT_MINIMO,
  cumpleRango,
  verificarPaquete,
  versionInstalada,
} from "../../scripts/verificar-paquete.mjs";

const WEB = process.cwd();
const PKG = JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
};
const CLA = fs.readFileSync(path.join(WEB, "CLA.md"));

function escribir(p: string, contenido: string | Buffer): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contenido);
}

/** Versión mínima que satisface un rango `^x.y.z` / `x.y.z`. */
const minima = (rango: string) => rango.replace(/^[\^~]|^>=/, "");

function instalar(raiz: string, nombre: string, version: string): void {
  escribir(path.join(raiz, "node_modules", nombre, "package.json"), JSON.stringify({ name: nombre, version }));
  if (nombre === "next") escribir(path.join(raiz, "node_modules", "next", "dist", "bin", "next"), "// cli");
}

let base: string;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-paquete-"));
});
afterEach(() => {
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* tmp */
  }
});

/**
 * Paquete `next start` como lo deja App Service: /home/site/wwwroot. Así
 * `cwd/../../CLA.md` cae en /home, fuera del paquete, igual que en Azure.
 */
function paqueteNextStart(opts: { nodeModules?: "linux" | "oryx-viejo" | "ninguno"; whitepaper?: boolean; cla?: Buffer | null } = {}) {
  const app = path.join(base, "home", "site", "wwwroot");
  escribir(path.join(app, "package.json"), JSON.stringify(PKG));
  escribir(path.join(app, ".next", "BUILD_ID"), "abc123");
  fs.mkdirSync(path.join(app, ".next", "static"), { recursive: true });
  escribir(path.join(app, "src", "lib", "schema.sql"), "-- schema");
  if (opts.cla !== null) escribir(path.join(app, "CLA.md"), opts.cla ?? CLA);
  if (opts.whitepaper !== false) escribir(path.join(app, "docs", "whitepaper.md"), "# Whitepaper");
  const nm = opts.nodeModules ?? "linux";
  if (nm === "linux") {
    for (const [n, r] of Object.entries(PKG.dependencies)) instalar(app, n, minima(r));
  } else if (nm === "oryx-viejo") {
    // El node_modules que Oryx construyó para 58ee2fd: next 14.2.15 y sin next-auth.
    for (const [n, r] of Object.entries(PKG.dependencies)) {
      if (n === "next-auth") continue;
      instalar(app, n, n === "next" ? "14.2.15" : minima(r));
    }
  }
  return app;
}

/** Paquete standalone: .next/standalone del monorepo, con apps/web/server.js. */
function paqueteStandalone(opts: { static?: boolean } = {}) {
  const raiz = path.join(base, "standalone");
  const app = path.join(raiz, "apps", "web");
  instalar(raiz, "next", "14.2.35");
  escribir(path.join(raiz, "CLA.md"), CLA);
  escribir(path.join(raiz, "docs", "whitepaper.md"), "# Whitepaper");
  escribir(path.join(app, "server.js"), "// next standalone");
  escribir(path.join(app, "package.json"), JSON.stringify(PKG));
  escribir(path.join(app, ".next", "BUILD_ID"), "abc123");
  if (opts.static !== false) fs.mkdirSync(path.join(app, ".next", "static"), { recursive: true });
  fs.mkdirSync(path.join(app, "public"), { recursive: true });
  escribir(path.join(app, "src", "lib", "schema.sql"), "-- schema");
  escribir(path.join(app, "CLA.md"), CLA);
  return app;
}

describe("cumpleRango: solo las formas que usa el repo", () => {
  it("caret, tilde, mínimo y exacto", () => {
    expect(cumpleRango("14.2.35", "^14.2.35")).toBe(true);
    expect(cumpleRango("14.2.40", "^14.2.35")).toBe(true);
    expect(cumpleRango("14.2.15", "^14.2.35")).toBe(false);
    expect(cumpleRango("15.0.0", "^14.2.35")).toBe(false);
    expect(cumpleRango("14.3.0", "~14.2.35")).toBe(false);
    expect(cumpleRango("16.0.0", ">=14.2.35")).toBe(true);
    expect(cumpleRango("14.2.15", "14.2.15")).toBe(true);
    expect(cumpleRango("14.2.16", "14.2.15")).toBe(false);
    expect(cumpleRango("14.2.35", "latest")).toBeNull();
  });
});

describe("verificarPaquete — `next start` (lo que arranca start-azure.sh)", () => {
  it("un paquete completo con node_modules de Linux está listo", () => {
    const r = verificarPaquete(paqueteNextStart());
    expect(r.errores).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.modo).toBe("next-start");
  });

  it("el paquete 'como la última vez' (node_modules de Oryx, sin whitepaper) se rechaza con motivos claros", () => {
    const r = verificarPaquete(paqueteNextStart({ nodeModules: "oryx-viejo", whitepaper: false }));
    expect(r.ok).toBe(false);
    const texto = r.errores.join("\n");
    expect(texto).toMatch(/next instalado es 14\.2\.15 y package\.json pide \^14\.2\.35/);
    expect(texto).toMatch(/falta node_modules\/next-auth/);
    expect(texto).toMatch(new RegExp(`menor que ${NEXT_MINIMO.replace(/\./g, "\\.")}`));
    expect(texto).toMatch(/falta docs\/whitepaper\.md/);
  });

  it("sin node_modules no arranca", () => {
    const r = verificarPaquete(paqueteNextStart({ nodeModules: "ninguno" }));
    expect(r.ok).toBe(false);
    expect(r.errores.join("\n")).toMatch(/falta node_modules\/next /);
  });

  it("un next izado FUERA de la carpeta no sirve: start-azure.sh ejecuta node_modules/next desde wwwroot", () => {
    const app = paqueteNextStart({ nodeModules: "ninguno" });
    for (const [n, r] of Object.entries(PKG.dependencies)) instalar(path.join(app, ".."), n, minima(r));
    const r = verificarPaquete(app);
    expect(r.ok).toBe(false);
    expect(r.errores).toEqual([
      "no existe node_modules/next/dist/bin/next en esta carpeta, y start-azure.sh lo ejecuta desde aquí.",
    ]);
  });

  it("un package.json viejo con next 14.2.15 tampoco pasa: el mínimo es fijo", () => {
    const app = paqueteNextStart();
    escribir(path.join(app, "package.json"), JSON.stringify({ ...PKG, dependencies: { ...PKG.dependencies, next: "14.2.15" } }));
    instalar(app, "next", "14.2.15");
    const r = verificarPaquete(app);
    expect(r.ok).toBe(false);
    expect(r.errores.join("\n")).toMatch(/menor que 14\.2\.35/);
  });

  it("sin CLA.md, o con otro texto (p. ej. CRLF), se rechaza: se firmaría lo que no es", () => {
    expect(verificarPaquete(paqueteNextStart({ cla: null })).errores.join("\n")).toMatch(/TEXTO DE RESERVA/);
    fs.rmSync(base, { recursive: true, force: true });
    fs.mkdirSync(base, { recursive: true });
    const crlf = Buffer.from(CLA.toString("utf8").replace(/\n/g, "\r\n"), "utf8");
    expect(verificarPaquete(paqueteNextStart({ cla: crlf })).errores.join("\n")).toMatch(/sha256/);
  });

  it("mira los CLA en el MISMO orden que cla.ts: uno en cwd/../../ manda sobre el de cwd", () => {
    const app = paqueteNextStart();
    escribir(path.join(app, "..", "..", "CLA.md"), "otro texto");
    expect(verificarPaquete(app).ok).toBe(false);
  });

  it("sin schema.sql o sin la build no arranca", () => {
    const app = paqueteNextStart();
    fs.rmSync(path.join(app, "src", "lib", "schema.sql"));
    fs.rmSync(path.join(app, ".next", "BUILD_ID"));
    const texto = verificarPaquete(app).errores.join("\n");
    expect(texto).toMatch(/schema\.sql/);
    expect(texto).toMatch(/BUILD_ID/);
  });
});

describe("verificarPaquete — standalone (build Linux de GitHub Actions)", () => {
  it("un bundle completo está listo y solo exige next (el resto lo traza Next)", () => {
    const r = verificarPaquete(paqueteStandalone());
    expect(r.errores).toEqual([]);
    expect(r.modo).toBe("standalone");
  });

  it("sin .next/static copiada junto a server.js se rechaza", () => {
    const r = verificarPaquete(paqueteStandalone({ static: false }));
    expect(r.ok).toBe(false);
    expect(r.errores.join("\n")).toMatch(/standalone NO la copia/);
  });
});

describe("el repo y el arranque", () => {
  it("el checkout encuentra lo mismo que la app: CLA con su hash, whitepaper de la raíz, schema y next del lockfile", () => {
    const r = verificarPaquete(WEB);
    // La build puede no existir cuando corre la suite (CI la hace después), y en el
    // monorepo next está izado a la raíz: el checkout NO es un paquete de `next start`.
    const propiosDelPaquete = r.errores.filter((e) => !/\.next\/|node_modules\/next\/dist\/bin\/next/.test(e));
    expect(propiosDelPaquete).toEqual([]);
    expect(r.detalles).toContain(`CLA.md ${CLA_SHA256.slice(0, 8)}… (${path.join("..", "..", "CLA.md")})`);
    expect(versionInstalada(WEB, "next")).not.toBeNull();
  });

  it("start-azure.sh verifica el paquete ANTES de arrancar Next", () => {
    const sh = fs.readFileSync(path.join(WEB, "start-azure.sh"), "utf8");
    expect(sh).not.toContain("\r");
    const verifica = sh.indexOf("scripts/verificar-paquete.mjs");
    const arranca = sh.indexOf("next/dist/bin/next start");
    expect(verifica).toBeGreaterThan(-1);
    expect(arranca).toBeGreaterThan(verifica);
  });
});
