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
import { createHash } from "node:crypto";
import {
  ANCLAJE_MAX_INTENTOS,
  ANCLAJE_RESERVA_MS,
  anclarPendientes,
  autorizarAnclaje,
  contarPendientes,
  filasParaAnclar,
  mantenerCola,
  registrarAnclada,
  registrarFallo,
  reservarFila,
} from "./anchor";
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

// ---------------------------------------------------------------------------
// Cola confiable (hallazgo M23): tope de intentos y reserva de la fila
// ---------------------------------------------------------------------------

function colaVacia(): DB {
  const db: DB = openDb(":memory:");
  db.exec(fs.readFileSync(path.join(WEB, "src", "lib", "schema.sql"), "utf8"));
  return db;
}

function encolar(db: DB, ref: string, attempts = 0, status = "pending"): number {
  return Number(
    db
      .prepare(
        `INSERT INTO anchor_queue (kind, ref, data_key, payload_hash, status, attempts) VALUES ('cla', ?, ?, ?, ?, ?)`
      )
      .run(ref, `k-${ref}`, "a".repeat(64), status, attempts).lastInsertRowid
  );
}

const estado = (db: DB, id: number) =>
  db.prepare(`SELECT status, attempts FROM anchor_queue WHERE id = ?`).get(id) as { status: string; attempts: number };

describe("una fila que falla siempre no tapa a las nuevas", () => {
  it("filasParaAnclar toma primero las de menos intentos y nunca las agotadas", () => {
    const db = colaVacia();
    for (let i = 0; i < 3; i++) encolar(db, `vieja${i}`, ANCLAJE_MAX_INTENTOS - 1);
    encolar(db, "agotada", ANCLAJE_MAX_INTENTOS);
    encolar(db, "nueva", 0);
    expect(filasParaAnclar(db, 1).map((f) => f.ref)).toEqual(["nueva"]);
    expect(filasParaAnclar(db, 10).map((f) => f.ref)).not.toContain("agotada");
  });

  it("sin llave de servicio no se ancla nada y se dice por qué (el workflow lo muestra)", async () => {
    const db = colaVacia();
    encolar(db, "nueva");
    const previo = process.env.SERVICE_ACCOUNT_SECRET;
    delete process.env.SERVICE_ACCOUNT_SECRET;
    try {
      await expect(anclarPendientes(db, 1)).rejects.toThrow(/SERVICE_ACCOUNT_SECRET/);
    } finally {
      if (previo !== undefined) process.env.SERVICE_ACCOUNT_SECRET = previo;
    }
  });
});

describe("tope de intentos: tras ANCLAJE_MAX_INTENTOS la fila queda 'failed'", () => {
  it("el tope es una constante documentada", () => {
    expect(ANCLAJE_MAX_INTENTOS).toBe(8);
    const src = fs.readFileSync(path.join(WEB, "src", "lib", "anchor.ts"), "utf8");
    expect(src).toContain("export const ANCLAJE_MAX_INTENTOS = 8;");
  });

  it("cada pasada fallida cuenta un intento; al llegar al tope, failed (y la firma del acuerdo también)", async () => {
    const db = colaVacia();
    const w = "GFIRMANTEAAAA";
    db.prepare(`INSERT INTO cla_signatures (wallet, cla_hash, signature, anchor_status) VALUES (?, 'h', 's', 'pending')`).run(w);
    const id = encolar(db, w);
    const falla = async () => {
      throw new Error("red caída");
    };
    for (let i = 1; i < ANCLAJE_MAX_INTENTOS; i++) {
      const r = await anclarPendientes(db, 8, { enviar: falla });
      expect(r.fallidos).toBe(1);
      expect(estado(db, id)).toEqual({ status: "pending", attempts: i });
    }
    await anclarPendientes(db, 8, { enviar: falla });
    expect(estado(db, id)).toEqual({ status: "failed", attempts: ANCLAJE_MAX_INTENTOS });
    expect(db.prepare(`SELECT anchor_status FROM cla_signatures WHERE wallet = ?`).get(w)).toEqual({ anchor_status: "failed" });
    // Ya no se intenta más ni cuenta como pendiente.
    const r = await anclarPendientes(db, 8, { enviar: falla });
    expect(r).toMatchObject({ pendientes: 0, anclados: 0, fallidos: 0 });
    expect(contarPendientes(db)).toBe(0);
  });

  it("una fila que ya había agotado sus intentos antes del tope pasa a failed sin enviarse", async () => {
    const db = colaVacia();
    const vieja = encolar(db, "vieja", 50);
    const nueva = encolar(db, "nueva", 0);
    const enviadas: string[] = [];
    const r = await anclarPendientes(db, 8, {
      enviar: async (f) => {
        enviadas.push(f.ref);
        return "b".repeat(64);
      },
    });
    expect(enviadas).toEqual(["nueva"]);
    expect(r.anclados).toBe(1);
    expect(estado(db, vieja).status).toBe("failed");
    expect(estado(db, nueva)).toEqual({ status: "anchored", attempts: 1 });
  });
});

describe("reserva: dos pasadas simultáneas no toman la misma fila", () => {
  it("reservarFila es un UPDATE condicionado: la segunda vez no reserva", () => {
    const db = colaVacia();
    const id = encolar(db, "x");
    expect(reservarFila(db, id)).toBe(true);
    expect(reservarFila(db, id)).toBe(false);
    expect(estado(db, id)).toEqual({ status: "processing", attempts: 1 });
  });

  it("dos pasadas a la vez: cada fila se envía UNA sola vez", async () => {
    const db = colaVacia();
    for (let i = 0; i < 5; i++) encolar(db, `f${i}`);
    const enviadas: string[] = [];
    // El envío espera a la "red": mientras tanto corre la otra pasada.
    const enviar = async (f: { ref: string }) => {
      enviadas.push(f.ref);
      await new Promise((r) => setTimeout(r, 5));
      return createHash("sha256").update(f.ref).digest("hex");
    };
    const [a, b] = await Promise.all([anclarPendientes(db, 8, { enviar }), anclarPendientes(db, 8, { enviar })]);
    expect(enviadas.slice().sort()).toEqual(["f0", "f1", "f2", "f3", "f4"]);
    expect(a.anclados + b.anclados).toBe(5);
    const filas = db.prepare(`SELECT status, attempts FROM anchor_queue`).all() as Array<{ status: string; attempts: number }>;
    expect(filas.every((f) => f.status === "anchored" && f.attempts === 1)).toBe(true);
  });

  it("una reserva abandonada (el proceso murió) se libera en la pasada siguiente", async () => {
    const db = colaVacia();
    const id = encolar(db, "colgada");
    const antes = new Date("2026-10-21T10:00:00Z");
    expect(reservarFila(db, id, antes)).toBe(true);
    // Recién reservada: otra pasada no la toca.
    expect(mantenerCola(db, new Date(antes.getTime() + 60_000))).toEqual({ agotadas: 0, liberadas: 0 });
    expect(estado(db, id).status).toBe("processing");
    // Pasado el plazo de reserva, vuelve a la cola con su intento contado.
    const despues = new Date(antes.getTime() + ANCLAJE_RESERVA_MS + 60_000);
    expect(mantenerCola(db, despues)).toEqual({ agotadas: 0, liberadas: 1 });
    expect(estado(db, id)).toEqual({ status: "pending", attempts: 1 });
  });

  it("registrarFallo y registrarAnclada solo actúan sobre la fila reservada", () => {
    const db = colaVacia();
    const id = encolar(db, "r");
    const fila = { id, kind: "cla", ref: "r", data_key: "k-r", payload_hash: "a".repeat(64) };
    expect(reservarFila(db, id)).toBe(true);
    expect(registrarFallo(db, fila, "x")).toBe("pending");
    expect(reservarFila(db, id)).toBe(true);
    registrarAnclada(db, fila, "c".repeat(64));
    expect(db.prepare(`SELECT status, tx_id, claimed_at FROM anchor_queue WHERE id = ?`).get(id)).toEqual({
      status: "anchored",
      tx_id: "c".repeat(64),
      claimed_at: null,
    });
  });
});
