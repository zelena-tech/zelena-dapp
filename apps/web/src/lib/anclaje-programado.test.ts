/**
 * Anclaje programado (hallazgo de la verificación final: el anclaje en Stellar no ocurría
 * solo; ningún workflow ni botón llamaba a /api/anchor/run y la cola crecía).
 *
 *  - `.github/workflows/anclaje.yml` llama cada 15 minutos a POST /api/anchor/run con el
 *    secret ANCHOR_RUN_SECRET, igual que recordatorios.yml con el cron.
 *  - La ruta compara `x-anchor-secret` en tiempo constante y sin filtrar el largo.
 *  - Una fila que falla siempre no tapa a las nuevas.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { anclarPendientes, autorizarAnclaje } from "./anchor";
import { ANCHOR_RUN_SECRET_MIN, anchorRunSecret } from "./config";

const WEB = process.cwd();
const RAIZ = path.join(WEB, "..", "..");
const leer = (r: string) => fs.readFileSync(path.join(RAIZ, r), "utf8");
const SECRETO = "s".repeat(40);

describe("autorizarAnclaje: x-anchor-secret en tiempo constante", () => {
  it("solo el secreto exacto pasa", () => {
    expect(autorizarAnclaje(SECRETO, SECRETO)).toBe("ok");
    expect(autorizarAnclaje(` ${SECRETO} `, SECRETO)).toBe("ok");
    expect(autorizarAnclaje(SECRETO.slice(1), SECRETO)).toBe("rechazado");
    expect(autorizarAnclaje(SECRETO + "x", SECRETO)).toBe("rechazado");
    expect(autorizarAnclaje("otro", SECRETO)).toBe("rechazado");
    expect(autorizarAnclaje("", SECRETO)).toBe("rechazado");
    expect(autorizarAnclaje(null, SECRETO)).toBe("rechazado");
  });

  it("sin secreto configurado no abre nada, ni con cabecera vacía", () => {
    expect(autorizarAnclaje("", "")).toBe("sin_configurar");
    expect(autorizarAnclaje(null, null)).toBe("sin_configurar");
    expect(autorizarAnclaje("algo", null)).toBe("sin_configurar");
  });

  it("compara huellas de largo fijo con timingSafeEqual (no filtra el largo)", () => {
    const src = fs.readFileSync(path.join(WEB, "src", "lib", "anchor.ts"), "utf8");
    const cuerpo = src.slice(src.indexOf("export function autorizarAnclaje"), src.indexOf("export function contarPendientes"));
    expect(cuerpo).toContain("timingSafeEqual(a, b)");
    expect(cuerpo).toMatch(/createHash\("sha256"\)\.update\(dado/);
    expect(cuerpo).not.toMatch(/===\s*secreto|secreto\s*===/);
  });

  it("ANCHOR_RUN_SECRET corto o ausente cuenta como no configurado", () => {
    expect(ANCHOR_RUN_SECRET_MIN).toBe(32);
    expect(anchorRunSecret({} as NodeJS.ProcessEnv)).toBeNull();
    expect(anchorRunSecret({ ANCHOR_RUN_SECRET: "corto" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(anchorRunSecret({ ANCHOR_RUN_SECRET: ` ${SECRETO} ` } as unknown as NodeJS.ProcessEnv)).toBe(SECRETO);
  });
});

describe("la ruta /api/anchor/run (estático)", () => {
  const ruta = fs.readFileSync(path.join(WEB, "app", "api", "anchor", "run", "route.ts"), "utf8");

  it("usa autorizarAnclaje con el secreto validado y, si no, la sesión del founder por rol", () => {
    expect(ruta).toContain('autorizarAnclaje(req.headers.get("x-anchor-secret"), anchorRunSecret())');
    expect(ruta).toMatch(/adminActor\(session, getDb\(\)\)/);
    expect(ruta).not.toMatch(/process\.env\.ANCHOR_RUN_SECRET/);
    expect(ruta).not.toMatch(/x\.length === y\.length/);
  });
});

describe(".github/workflows/anclaje.yml", () => {
  const yml = leer(".github/workflows/anclaje.yml");

  it("programado, con disparo manual, sin concurrencia y sin permisos", () => {
    expect(yml).not.toContain("\r");
    expect(yml).toMatch(/^\s*schedule:\s*$/m);
    expect(yml).toMatch(/cron:\s*"\*\/15 \* \* \* \*"/);
    expect(yml).toMatch(/^\s*workflow_dispatch:/m);
    expect(yml).toMatch(/^concurrency:\s*\n\s+group:\s*anclaje\s*\n\s+cancel-in-progress:\s*false/m);
    expect(yml).toMatch(/^permissions:\s*\{\}/m);
    expect(yml).toContain("github.repository == 'zelena-tech/zelena-dapp'");
  });

  it("llama POST /api/anchor/run con secrets.ANCHOR_RUN_SECRET en x-anchor-secret, sin mostrarlo, y exige 200", () => {
    expect(yml).toContain("${{ secrets.ANCHOR_RUN_SECRET }}");
    expect(yml).toMatch(/-X POST \\\s*\n\s*"\$APP_URL\/api\/anchor\/run"/);
    expect(yml).toContain('-H "x-anchor-secret: $ANCHOR_RUN_SECRET"');
    expect(yml).not.toMatch(/echo[^\n]*\$\{?ANCHOR_RUN_SECRET/);
    expect(yml).not.toMatch(/--retry/);
    expect(yml).toContain("%{http_code}");
    expect(yml).toMatch(/test "\$code" = 200 \|\| exit 1/);
    // Del cuerpo solo salen los conteos (y el error): ni el detalle por fila ni la cuenta.
    expect(yml).toContain("jq -c '{pendientes, anclados, fallidos, error}'");
    expect(yml).not.toMatch(/cat respuesta\.json/);
  });

  it("es gemelo de recordatorios.yml en la forma de llamar", () => {
    const rec = leer(".github/workflows/recordatorios.yml");
    for (const y of [yml, rec]) {
      expect(y).toContain("APP_URL: ${{ vars.ZELENA_APP_URL || 'https://www.zelena.tech' }}");
      expect(y).toContain("runs-on: ubuntu-latest");
    }
  });
});

describe("una fila que falla siempre no tapa a las nuevas", () => {
  it("anclarPendientes toma primero las de menos intentos", async () => {
    const db: DB = openDb(":memory:");
    db.exec(fs.readFileSync(path.join(WEB, "src", "lib", "schema.sql"), "utf8"));
    const insertar = db.prepare(
      `INSERT INTO anchor_queue (kind, ref, data_key, payload_hash, status, attempts) VALUES ('cla', ?, ?, ?, 'pending', ?)`
    );
    for (let i = 0; i < 3; i++) insertar.run(`vieja${i}`, `k-vieja${i}`, "a".repeat(64), 50);
    insertar.run("nueva", "k-nueva", "b".repeat(64), 0);
    // La consulta con la que anclarPendientes elige filas, sobre una cola real.
    const src = fs.readFileSync(path.join(WEB, "src", "lib", "anchor.ts"), "utf8");
    const m = /`(SELECT id, kind, ref, data_key, payload_hash FROM anchor_queue WHERE status = 'pending' ORDER BY attempts, id LIMIT \?)`/.exec(src);
    expect(m).not.toBeNull();
    const elegidas = db.prepare(m![1]).all(1) as Array<{ ref: string }>;
    expect(elegidas.map((f) => f.ref)).toEqual(["nueva"]);
    // Sin llave de servicio no se ancla nada y se dice por qué (el workflow lo muestra).
    const previo = process.env.SERVICE_ACCOUNT_SECRET;
    delete process.env.SERVICE_ACCOUNT_SECRET;
    try {
      await expect(anclarPendientes(db, 1)).rejects.toThrow(/SERVICE_ACCOUNT_SECRET/);
    } finally {
      if (previo !== undefined) process.env.SERVICE_ACCOUNT_SECRET = previo;
    }
  });
});
