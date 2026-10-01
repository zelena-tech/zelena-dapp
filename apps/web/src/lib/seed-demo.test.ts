/**
 * Invitaciones demo `GENESIS-0001..0006` en producción (hallazgo de verificación,
 * 2026-09-30).
 *
 * `demoInvitesAllowed()` solo evitaba SEMBRARLAS: las que ya existían en la base
 * seguían vivas. En la copia de prod las seis están sin usar y vencen el
 * 2026-10-03, y los códigos están publicados en CLAUDE.md y docs/deploy.md: con el
 * código fusionado y NODE_ENV=production, cualquiera se daba de alta con ellas.
 * Ahora cada arranque fuera del modo demo vence las que sigan sin usar.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { checkInvite, consumeInvite, InviteConsumeError } from "./invites";
import { DEMO_INVITE_CODES, retirarInvitacionesDemo, seedIfEmpty } from "./seed";
import { translate } from "./sql-dialect";

const PROD = { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
const DEV = { NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;
const PROD_DEMO = { NODE_ENV: "production", SEED_DEMO: "1" } as unknown as NodeJS.ProcessEnv;

/** Invitación que /admin genera de verdad: MISMO prefijo GENESIS-, no es demo. */
const REAL = "GENESIS-9F3A1C0B7E";
const COHORTE = "ESPECIALIZACION-2026";

/** Base con la forma de la copia de prod: 6 demo (una usada), una real y la cohorte. */
function baseConInvitaciones(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  const ins = db.prepare(
    `INSERT INTO invites (code, issuer_wallet, used_by, expires_at, max_uses, uses)
     VALUES (?, 'GFOUNDER', ?, datetime('now', '+3 days'), ?, ?)`
  );
  for (const code of DEMO_INVITE_CODES) ins.run(code, code === "GENESIS-0002" ? "GUSADA" : null, null, 0);
  ins.run(REAL, null, null, 0);
  ins.run(COHORTE, null, 400, 7);
  return db;
}

const fila = (db: DB, code: string) =>
  db.prepare(`SELECT used_by, expires_at, max_uses, uses FROM invites WHERE code = ?`).get(code);

describe("retirarInvitacionesDemo: los GENESIS-000x publicados no abren producción", () => {
  it("son exactamente los seis códigos del seed", () => {
    expect(DEMO_INVITE_CODES).toEqual([
      "GENESIS-0001",
      "GENESIS-0002",
      "GENESIS-0003",
      "GENESIS-0004",
      "GENESIS-0005",
      "GENESIS-0006",
    ]);
  });

  it("en producción vence las demo sin usar y deja intactas la usada, la real de /admin y la cohorte", () => {
    const db = baseConInvitaciones();
    const usada = fila(db, "GENESIS-0002");
    const real = fila(db, REAL);
    const cohorte = fila(db, COHORTE);

    expect(retirarInvitacionesDemo(db, PROD)).toBe(5);

    for (const code of DEMO_INVITE_CODES.filter((c) => c !== "GENESIS-0002")) {
      expect(checkInvite(db, code), code).toEqual({ ok: false, reason: "expired" });
      expect(() => consumeInvite(db, code, "GINTRUSO")).toThrow(InviteConsumeError);
    }
    expect(fila(db, "GENESIS-0002")).toEqual(usada);
    // `LIKE 'GENESIS-%'` habría vencido también las invitaciones reales: no se usa.
    expect(fila(db, REAL)).toEqual(real);
    expect(checkInvite(db, REAL).ok).toBe(true);
    // La cohorte es otra decisión (SEED_COHORT): no se toca aquí.
    expect(fila(db, COHORTE)).toEqual(cohorte);
  });

  it("es idempotente: el segundo arranque no cambia nada", () => {
    const db = baseConInvitaciones();
    retirarInvitacionesDemo(db, PROD);
    const tras1 = db.prepare(`SELECT * FROM invites ORDER BY code`).all();
    expect(retirarInvitacionesDemo(db, PROD)).toBe(0);
    expect(db.prepare(`SELECT * FROM invites ORDER BY code`).all()).toEqual(tras1);
  });

  it("fuera de producción, o con SEED_DEMO=1, no toca nada", () => {
    for (const entorno of [DEV, PROD_DEMO]) {
      const db = baseConInvitaciones();
      const antes = db.prepare(`SELECT * FROM invites ORDER BY code`).all();
      expect(retirarInvitacionesDemo(db, entorno)).toBe(0);
      expect(db.prepare(`SELECT * FROM invites ORDER BY code`).all()).toEqual(antes);
      expect(checkInvite(db, "GENESIS-0001").ok).toBe(true);
    }
  });

  it("seedIfEmpty la aplica en cada arranque de producción, también sobre una base ya sembrada", () => {
    const db = baseConInvitaciones();
    db.prepare(`INSERT INTO users (wallet, display_name, cla_signed) VALUES ('GALGUIEN', 'Alguien', 1)`).run();
    seedIfEmpty(db, PROD);
    expect(checkInvite(db, "GENESIS-0001")).toEqual({ ok: false, reason: "expired" });
    expect(checkInvite(db, REAL).ok).toBe(true);
  });

  it("una base de producción NUEVA no nace con ninguna invitación demo utilizable", () => {
    const db = openDb(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
    seedIfEmpty(db, PROD);
    const vivas = DEMO_INVITE_CODES.filter((c) => checkInvite(db, c).ok);
    expect(vivas).toEqual([]);
  });

  it("su SQL también se traduce a T-SQL (la ruta Azure SQL siembra con el mismo seed)", () => {
    const real = baseConInvitaciones();
    const vistos: string[] = [];
    const espia: DB = { ...real, prepare: (sql: string) => (vistos.push(sql), real.prepare(sql)) };
    retirarInvitacionesDemo(espia, PROD);
    expect(vistos.length).toBeGreaterThan(0);
    for (const sql of vistos) expect(() => translate(sql)).not.toThrow();
  });
});
