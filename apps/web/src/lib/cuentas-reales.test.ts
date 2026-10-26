/**
 * La wallet del navegador es una cuenta REAL (decisión del founder, 2026-10-21).
 *
 *  - `performOnboard` decide `is_demo` por el código de invitación, nunca por lo que diga
 *    el navegador: solo un código de demostración da una cuenta de demostración.
 *  - La migración de arranque pasa a reales las cuentas que ya entraron así en producción
 *    y NO toca las sembradas (wallets del seed, firmas `seed-sig-…`) ni a quien entró con
 *    un código de demostración. Probado sobre una base con el esquema de producción.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { openDb, prepararSqlite, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { performOnboard } from "./onboard";
import { claCanonicalHash } from "./cla";
import { claSigningPayload } from "./cla-signing";
import { DEMO_INVITE_CODES, esCodigoDemo } from "./config";
import { ACTOR_MIGRACION, marcarCuentasDeNavegadorComoReales } from "./cuentas-reales";

const LIB = path.join(process.cwd(), "src", "lib");
const SCHEMA = fs.readFileSync(path.join(LIB, "schema.sql"), "utf8");
const FIXTURE = fs.readFileSync(path.join(LIB, "__fixtures__", "schema-58ee2fd.sql"), "utf8");
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Las wallets que siembra seed(): marcadores fijos, no llaves válidas. */
const SEED_FOUNDER = "GA7ZELENAFOUNDERDEMOWALLET000000000000000000000000000AAA";
const SEED_DEMO = "GDELINACONTRIBUTORDEMOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("performOnboard: is_demo lo decide el código, no el navegador", () => {
  let db: DB;
  const hash = claCanonicalHash();

  beforeEach(() => {
    db = openDb(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
  });

  function alta(code: string, declaraDemo: boolean): { wallet: string; isDemo: boolean } {
    db.prepare(`INSERT INTO invites (code, issuer_wallet, expires_at) VALUES (?, 'GEMISOR', datetime('now','+1 day'))`).run(code);
    const kp = Keypair.random(); // la wallet que crea /entrar en el navegador
    const firma = b64(kp.sign(Buffer.from(claSigningPayload(hash), "utf8")));
    const r = performOnboard(db, { code, wallet: kp.publicKey(), name: "Ada", isDemo: declaraDemo, claHash: hash, signature: firma });
    return { wallet: kp.publicKey(), isDemo: r.isDemo };
  }
  const isDemo = (w: string) => (db.prepare(`SELECT is_demo FROM users WHERE wallet = ?`).get(w) as { is_demo: number }).is_demo;

  it("invitación real + wallet del navegador = cuenta real, aunque el navegador diga lo contrario", () => {
    const r = alta("GENESIS-AB12CD34EF", true);
    expect(r.isDemo).toBe(false);
    expect(isDemo(r.wallet)).toBe(0);
  });

  it("un código de demostración da una cuenta de demostración, aunque el navegador diga que no", () => {
    const r = alta(DEMO_INVITE_CODES[2], false);
    expect(r.isDemo).toBe(true);
    expect(isDemo(r.wallet)).toBe(1);
  });

  it("esCodigoDemo reconoce exactamente los seis códigos publicados", () => {
    expect(DEMO_INVITE_CODES.every((c) => esCodigoDemo(c))).toBe(true);
    expect(esCodigoDemo(" genesis-0001 ")).toBe(true);
    expect(esCodigoDemo("GENESIS-0007")).toBe(false);
    expect(esCodigoDemo("GENESIS-ABCDEF1234")).toBe(false);
    expect(esCodigoDemo("ESPECIALIZACION-2026")).toBe(false);
  });
});

describe("migración sobre una base con el esquema de producción (58ee2fd)", () => {
  let dir: string;
  let file: string;
  const nav1 = Keypair.random().publicKey(); // invitación personal, wallet del navegador
  const nav2 = Keypair.random().publicKey(); // cohorte (sin used_by), wallet del navegador
  const navDemo = Keypair.random().publicKey(); // entró con un código de demostración
  const sinFirma = Keypair.random().publicKey(); // demo sin acuerdo firmado
  const real = Keypair.random().publicKey(); // ya era real (Freighter)

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-cuentas-"));
    file = path.join(dir, "zelena.db");
  });
  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows puede retener el archivo */
    }
  });

  function baseProduccion(): DB {
    const db = openDb(file);
    db.exec(FIXTURE);
    db.exec(`
      INSERT INTO users (wallet, display_name, invited_by, is_demo, is_founder, cla_signed, created_at) VALUES
        ('${SEED_FOUNDER}', 'Founder (seed)', NULL, 1, 1, 1, '2026-07-01 10:00:00'),
        ('${SEED_DEMO}', 'Demo (seed)', '${SEED_FOUNDER}', 1, 0, 1, '2026-07-01 10:00:00'),
        ('${nav1}', 'Navegador uno', '${SEED_FOUNDER}', 1, 0, 1, '2026-09-10 10:00:00'),
        ('${nav2}', 'Navegador dos', '${SEED_FOUNDER}', 1, 0, 1, '2026-09-11 10:00:00'),
        ('${navDemo}', 'Con código demo', '${SEED_FOUNDER}', 1, 0, 1, '2026-09-12 10:00:00'),
        ('${sinFirma}', 'Sin firma', '${SEED_FOUNDER}', 1, 0, 0, '2026-09-13 10:00:00'),
        ('${real}', 'Freighter', '${SEED_FOUNDER}', 0, 0, 1, '2026-09-14 10:00:00');
      INSERT INTO cla_signatures (wallet, cla_hash, signature, anchor_status, tx_id) VALUES
        ('${SEED_FOUNDER}', 'h0', 'seed-sig-founder', 'anchored', 'SEEDTX_FOUNDER_ANCHORED_0001'),
        ('${SEED_DEMO}', 'h1', 'seed-sig-delina', 'anchored', 'SEEDTX_DELINA_ANCHORED_0002'),
        ('${nav1}', 'h2', 'firma-ed25519-real-1', 'pending', NULL),
        ('${nav2}', 'h3', 'firma-ed25519-real-2', 'pending', NULL),
        ('${navDemo}', 'h4', 'firma-ed25519-real-3', 'pending', NULL),
        ('${real}', 'h5', 'firma-ed25519-real-4', 'anchored', 'tx');
      INSERT INTO invites (code, issuer_wallet, used_by, expires_at, max_uses, uses) VALUES
        ('GENESIS-1A2B3C4D5E', '${SEED_FOUNDER}', '${nav1}', '2026-10-01 00:00:00', NULL, 0),
        ('${DEMO_INVITE_CODES[3]}', '${SEED_FOUNDER}', '${navDemo}', '2026-10-01 00:00:00', NULL, 0),
        ('COHORTE-PRUEBA', '${SEED_FOUNDER}', NULL, '2026-12-01 00:00:00', 400, 7);
    `);
    return db;
  }

  const demos = (db: DB) =>
    Object.fromEntries(
      (db.prepare(`SELECT wallet, is_demo FROM users WHERE wallet NOT LIKE 'pending:%'`).all() as Array<{
        wallet: string;
        is_demo: number;
      }>).map((r) => [r.wallet, r.is_demo])
    );
  /** Todo lo de users salvo is_demo, más firmas e invitaciones: lo que la migración no toca. */
  const huella = (db: DB) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          db
            .prepare(
              `SELECT wallet, display_name, tier, invited_by, status, is_founder, cla_signed, created_at FROM users WHERE wallet NOT LIKE 'pending:%' ORDER BY wallet`
            )
            .all(),
          db.prepare(`SELECT * FROM cla_signatures ORDER BY id`).all(),
          db.prepare(`SELECT * FROM invites ORDER BY code`).all(),
        ])
      )
      .digest("hex");

  it("solo pasan a reales las cuentas del navegador con invitación válida; las sembradas no se tocan", () => {
    const db = baseProduccion();
    const antes = huella(db);
    prepararSqlite(db, { archivo: file, founderWallet: SEED_FOUNDER });

    expect(demos(db)).toEqual({
      [SEED_FOUNDER]: 1, // la fila del founder del seed
      [SEED_DEMO]: 1, // wallet del seed (no es una llave válida) y firma seed-sig
      [nav1]: 0, // invitación personal
      [nav2]: 0, // cohorte
      [navDemo]: 1, // entró con un código de demostración
      [sinFirma]: 1, // nunca firmó el acuerdo
      [real]: 0,
    });
    expect(huella(db)).toBe(antes);
    const rastro = db
      .prepare(`SELECT actor_wallet, target_wallet, action FROM talent_events WHERE action = 'cuenta_real' ORDER BY target_wallet`)
      .all();
    expect(rastro).toEqual(
      [nav1, nav2].sort().map((w) => ({ actor_wallet: ACTOR_MIGRACION, target_wallet: w, action: "cuenta_real" }))
    );
  });

  it("es idempotente: el segundo arranque no cambia nada ni deja otro rastro", () => {
    const db = baseProduccion();
    prepararSqlite(db, { archivo: file, founderWallet: SEED_FOUNDER });
    const tras1 = { d: demos(db), n: db.prepare(`SELECT COUNT(*) AS n FROM talent_events`).get() };
    prepararSqlite(db, { archivo: file, founderWallet: SEED_FOUNDER });
    expect(marcarCuentasDeNavegadorComoReales(db)).toEqual([]);
    expect({ d: demos(db), n: db.prepare(`SELECT COUNT(*) AS n FROM talent_events`).get() }).toEqual(tras1);
  });

  it("si la migración falla, el arranque sigue y no cambia nada", () => {
    const db = baseProduccion();
    const rota: DB = {
      ...db,
      prepare: (sql: string) => {
        if (sql.includes("SET is_demo = 0")) throw new Error("fallo simulado");
        return db.prepare(sql);
      },
    };
    expect(() => prepararSqlite(rota, { archivo: file, founderWallet: SEED_FOUNDER })).not.toThrow();
    expect(demos(db)[nav1]).toBe(1);
  });

  it("una base nueva sembrada no tiene nada que migrar (las demo del seed siguen demo)", () => {
    const db = openDb(":memory:");
    db.exec(SCHEMA);
    seedIfEmpty(db, {} as NodeJS.ProcessEnv);
    expect(marcarCuentasDeNavegadorComoReales(db)).toEqual([]);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_demo = 1`).get() as { n: number }).n).toBe(4);
  });
});
