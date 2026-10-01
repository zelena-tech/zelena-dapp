import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { performOnboard, OnboardError } from "./onboard";
import { claCanonicalHash } from "./cla";
import { claSigningPayload } from "./cla-signing";
import { bootstrapInviteCode } from "./config";
import { seedBootstrapInvite } from "./seed";
import { onboardSchema } from "./validation";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function seedInvite(db: DB, code = "GENESIS-TEST", issuer = "ISSUER"): string {
  db.prepare(
    `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES (?, ?, datetime('now','+30 days'))`
  ).run(code, issuer);
  return code;
}

function inviteUsedBy(db: DB, code: string): string | null {
  return (db.prepare(`SELECT used_by FROM invites WHERE code = ?`).get(code) as { used_by: string | null }).used_by;
}

describe("performOnboard — verificación de firma antes de consumir invitación (WP01)", () => {
  let db: DB;
  let hash: string;
  let kp: Keypair;
  let wallet: string;
  let goodSig: string;

  beforeEach(() => {
    db = freshDb();
    hash = claCanonicalHash();
    kp = Keypair.random();
    wallet = kp.publicKey();
    goodSig = b64(kp.sign(Buffer.from(claSigningPayload(hash), "utf8")));
  });

  it("firma válida: completa el alta y consume la invitación", () => {
    const code = seedInvite(db);
    const res = performOnboard(db, { code, wallet, name: "Ada", isDemo: true, claHash: hash, signature: goodSig });
    expect(res.wallet).toBe(wallet);

    const user = db.prepare(`SELECT cla_signed FROM users WHERE wallet = ?`).get(wallet) as { cla_signed: number } | undefined;
    expect(user?.cla_signed).toBe(1);
    expect(inviteUsedBy(db, code)).toBe(wallet);

    const claRow = db.prepare(`SELECT cla_hash FROM cla_signatures WHERE wallet = ?`).get(wallet) as { cla_hash: string };
    expect(claRow.cla_hash).toBe(hash);
    const q = db.prepare(`SELECT COUNT(*) AS n FROM anchor_queue WHERE kind = 'cla' AND ref = ?`).get(wallet) as { n: number };
    expect(q.n).toBe(1);
  });

  it("firma inválida (tampered): 400 y la invitación NO se consume", () => {
    const code = seedInvite(db);
    const badSig = b64(Buffer.from("x".repeat(64))); // 64 bytes pero no es una firma real
    let err: unknown;
    try {
      performOnboard(db, { code, wallet, name: "Ada", isDemo: true, claHash: hash, signature: badSig });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OnboardError);
    expect((err as OnboardError).status).toBe(400);
    expect(inviteUsedBy(db, code)).toBeNull();
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(wallet)).toBeUndefined();
  });

  it("firma válida de OTRA wallet: 400 y la invitación NO se consume", () => {
    const code = seedInvite(db);
    const other = Keypair.random();
    const otherSig = b64(other.sign(Buffer.from(claSigningPayload(hash), "utf8")));
    let err: unknown;
    try {
      performOnboard(db, { code, wallet, name: "Ada", isDemo: true, claHash: hash, signature: otherSig });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OnboardError);
    expect((err as OnboardError).status).toBe(400);
    expect(inviteUsedBy(db, code)).toBeNull();
  });

  it("firma del hash SIN domain separator (replay de otra red): 400 y no consume", () => {
    const code = seedInvite(db);
    const noSepSig = b64(kp.sign(Buffer.from(hash, "utf8"))); // firma el claHash pelado
    let err: unknown;
    try {
      performOnboard(db, { code, wallet, name: "Ada", isDemo: true, claHash: hash, signature: noSepSig });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OnboardError);
    expect((err as OnboardError).status).toBe(400);
    expect(inviteUsedBy(db, code)).toBeNull();
  });

  it("hash de CLA que no coincide con el canónico: 400 y no consume", () => {
    const code = seedInvite(db);
    let err: unknown;
    try {
      performOnboard(db, { code, wallet, name: "Ada", isDemo: true, claHash: "0".repeat(64), signature: goodSig });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OnboardError);
    expect((err as OnboardError).status).toBe(400);
    expect(inviteUsedBy(db, code)).toBeNull();
  });
});

// La escotilla de arranque tiene que dejarte ADMINISTRAR, no solo entrar. Sin esto,
// entrar con FOUNDER_BOOTSTRAP_CODE daba `contributor` y el founder quedaba fuera de
// /admin y de /equipo: la escotilla no resolvía el deadlock que existe para resolver.
describe("escotilla de arranque: el código de founder concede administración", () => {
  const BOOT = "ZELENA-BOOTSTRAP-2026-XYZ";
  let db: DB;
  let hash: string;
  let kp: Keypair;
  let wallet: string;
  let goodSig: string;
  let prev: string | undefined;

  beforeEach(() => {
    db = freshDb();
    hash = claCanonicalHash();
    kp = Keypair.random();
    wallet = kp.publicKey();
    goodSig = b64(kp.sign(Buffer.from(claSigningPayload(hash), "utf8")));
    prev = process.env.FOUNDER_BOOTSTRAP_CODE;
    process.env.FOUNDER_BOOTSTRAP_CODE = BOOT;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.FOUNDER_BOOTSTRAP_CODE;
    else process.env.FOUNDER_BOOTSTRAP_CODE = prev;
  });

  function rolDe(w: string) {
    return db.prepare(`SELECT role, is_supervisor FROM users WHERE wallet = ?`).get(w) as {
      role: string;
      is_supervisor: number;
    };
  }

  it("entrar con el código de arranque crea un FOUNDER supervisor", () => {
    seedInvite(db, BOOT, "ISSUER");
    performOnboard(db, { code: BOOT, wallet, name: "John", isDemo: true, claHash: hash, signature: goodSig });
    const r = rolDe(wallet);
    expect(r.role).toBe("founder");
    expect(r.is_supervisor).toBe(1);
  });

  it("cualquier OTRO código sigue dando contributor sin supervisión", () => {
    seedInvite(db, "GENESIS-0001", "ISSUER");
    performOnboard(db, {
      code: "GENESIS-0001",
      wallet,
      name: "Alguien",
      isDemo: true,
      claHash: hash,
      signature: goodSig,
    });
    const r = rolDe(wallet);
    expect(r.role).toBe("contributor");
    expect(r.is_supervisor).toBe(0);
  });

  it("un código de arranque DEMASIADO CORTO no concede founder", () => {
    process.env.FOUNDER_BOOTSTRAP_CODE = "corto";
    seedInvite(db, "corto", "ISSUER");
    performOnboard(db, { code: "corto", wallet, name: "X", isDemo: true, claHash: hash, signature: goodSig });
    expect(rolDe(wallet).role).toBe("contributor");
  });

  it("sin la variable configurada, ningún código concede founder", () => {
    delete process.env.FOUNDER_BOOTSTRAP_CODE;
    seedInvite(db, BOOT, "ISSUER");
    performOnboard(db, { code: BOOT, wallet, name: "X", isDemo: true, claHash: hash, signature: goodSig });
    expect(rolDe(wallet).role).toBe("contributor");
  });

  // Hallazgo de verificación (2026-09-30): si la wallet de John ya estaba registrada
  // (entró con la cohorte o con una invitación), la escotilla respondía 409
  // `wallet_registrada` ANTES de mirar el código, así que no servía justo para el
  // caso en que hace falta: una wallet real que nació contributor.
  it("la escotilla también promueve una wallet YA registrada (entró antes con otro código)", () => {
    seedInvite(db, "COHORTE-UNO", "ISSUER");
    seedInvite(db, BOOT, "ISSUER");
    performOnboard(db, { code: "COHORTE-UNO", wallet, name: "John", isDemo: false, claHash: hash, signature: goodSig });
    expect(rolDe(wallet)).toEqual({ role: "contributor", is_supervisor: 0 });

    const r = performOnboard(db, { code: BOOT, wallet, name: "Otro", isDemo: true, claHash: hash, signature: goodSig });
    expect(r).toMatchObject({ wallet, name: "John", isDemo: false, role: "founder", isSupervisor: true });
    expect(rolDe(wallet)).toEqual({ role: "founder", is_supervisor: 1 });
    expect(inviteUsedBy(db, BOOT)).toBe(wallet);
    // No reescribe la fila ni duplica la firma del CLA ni su anclaje.
    const n = (sql: string) => (db.prepare(sql).get(wallet) as { n: number }).n;
    expect(n(`SELECT COUNT(*) AS n FROM cla_signatures WHERE wallet = ?`)).toBe(1);
    expect(n(`SELECT COUNT(*) AS n FROM anchor_queue WHERE ref = ?`)).toBe(1);
    expect(db.prepare(`SELECT display_name, is_demo FROM users WHERE wallet = ?`).get(wallet)).toEqual({
      display_name: "John",
      is_demo: 0,
    });
  });

  it("con una wallet ya registrada, cualquier OTRO código sigue dando 409 y no gasta el cupo", () => {
    seedInvite(db, "UNO", "ISSUER");
    seedInvite(db, "DOS", "ISSUER");
    performOnboard(db, { code: "UNO", wallet, name: "Ada", isDemo: true, claHash: hash, signature: goodSig });
    let err: unknown;
    try {
      performOnboard(db, { code: "DOS", wallet, name: "Ada", isDemo: true, claHash: hash, signature: goodSig });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OnboardError);
    expect((err as OnboardError).status).toBe(409);
    expect((err as OnboardError).reason).toBe("wallet_registrada");
    expect(inviteUsedBy(db, "DOS")).toBeNull();
    expect(rolDe(wallet).role).toBe("contributor");
  });

  it("una escotilla ya consumida no promueve a una wallet registrada", () => {
    seedInvite(db, "UNO", "ISSUER");
    seedInvite(db, BOOT, "ISSUER");
    performOnboard(db, { code: "UNO", wallet, name: "Ada", isDemo: true, claHash: hash, signature: goodSig });
    db.prepare(`UPDATE invites SET used_by = 'GOTRAPERSONA' WHERE code = ?`).run(BOOT);
    expect(() =>
      performOnboard(db, { code: BOOT, wallet, name: "Ada", isDemo: true, claHash: hash, signature: goodSig })
    ).toThrow(OnboardError);
    expect(rolDe(wallet).role).toBe("contributor");
    expect(inviteUsedBy(db, BOOT)).toBe("GOTRAPERSONA");
  });

  // /entrar pasa el código a MAYÚSCULAS (input y ?code=) y la validación corta a 40
  // caracteres. Un FOUNDER_BOOTSTRAP_CODE en minúsculas o más largo se sembraba tal
  // cual y nunca coincidía: la escotilla quedaba inservible desde la web.
  it("el código de arranque se compara en mayúsculas, como lo envía /entrar", () => {
    process.env.FOUNDER_BOOTSTRAP_CODE = "zelena-arranque-2026-abc";
    seedBootstrapInvite(db);
    const enviado = "ZELENA-ARRANQUE-2026-ABC";
    expect(db.prepare(`SELECT code FROM invites WHERE code = ?`).get(enviado)).toEqual({ code: enviado });
    performOnboard(db, { code: enviado, wallet, name: "John", isDemo: true, claHash: hash, signature: goodSig });
    expect(rolDe(wallet)).toEqual({ role: "founder", is_supervisor: 1 });
  });

  it("un código de arranque de más de 40 caracteres se ignora (la validación de /entrar no lo deja pasar)", () => {
    const largo = "A".repeat(41);
    expect(bootstrapInviteCode({ FOUNDER_BOOTSTRAP_CODE: largo } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(bootstrapInviteCode({ FOUNDER_BOOTSTRAP_CODE: "A".repeat(40) } as unknown as NodeJS.ProcessEnv)).toBe(
      "A".repeat(40)
    );
    // El tope es el mismo que aplica la API: 40 entra, 41 no.
    expect(onboardSchema.shape.code.safeParse("A".repeat(40)).success).toBe(true);
    expect(onboardSchema.shape.code.safeParse(largo).success).toBe(false);
  });
});

describe("performOnboard — atomicidad del cupo (caso borde de la cohorte)", () => {
  it("si el alta falla DESPUÉS de consumir, el cupo se devuelve", async () => {
    const { openDb, applyMigrations } = await import("./db");
    const { createCohortInvite } = await import("./invites");
    const { Keypair } = await import("@stellar/stellar-sdk");
    const { claCanonicalHash } = await import("./cla");
    const { claSigningPayload } = await import("./cla-signing");
    const { CLA_VERSION } = await import("./config");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zln-")), "t.db");
    const db = openDb(file);
    db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
    applyMigrations(db);

    createCohortInvite(db, { code: "COHORTE-X", issuerWallet: "GISSUER", maxUses: 5, expiresDays: 10 });
    const usos = () => (db.prepare(`SELECT uses FROM invites WHERE code = 'COHORTE-X'`).get() as { uses: number }).uses;

    const kp = Keypair.random();
    const claHash = claCanonicalHash();
    const firma = kp.sign(Buffer.from(claSigningPayload(claHash), "utf8")).toString("base64");

    // Sembramos SOLO la firma: el usuario no existe, así que el alta pasa la
    // comprobación inicial, consume el cupo, inserta el usuario, y revienta al
    // insertar la firma por UNIQUE(wallet, cla_version). Es exactamente el punto
    // en que antes el cupo quedaba quemado sin usuario.
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature) VALUES (?, ?, ?, 'previa')`
    ).run(kp.publicKey(), CLA_VERSION, claHash);

    expect(() =>
      performOnboard(db, {
        code: "COHORTE-X",
        wallet: kp.publicKey(),
        name: "Alguien",
        isDemo: true,
        claHash,
        signature: firma,
      })
    ).toThrow();

    // El cupo volvió a su sitio y no quedó usuario a medias.
    expect(usos()).toBe(0);
    const u = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE wallet = ?`).get(kp.publicKey()) as { n: number };
    expect(u.n).toBe(0);
  });
});

// Reingreso (performLogin): la cookie se firma con el rol LEÍDO DE LA BASE, no
// comparando la wallet con FOUNDER_WALLET. Así un founder real conserva /admin y
// un contribuidor no se vuelve founder por coincidir con una variable de entorno.
describe("performLogin — devuelve rol y supervisión de la fila", () => {
  it("contributor por invitación y founder por dato de la base", async () => {
    const { performLogin } = await import("./onboard");
    const db = freshDb();
    const hash = claCanonicalHash();
    const kp = Keypair.random();
    const wallet = kp.publicKey();
    const sig = b64(kp.sign(Buffer.from(claSigningPayload(hash), "utf8")));
    const code = seedInvite(db);
    performOnboard(db, { code, wallet, name: "Ada", isDemo: true, claHash: hash, signature: sig });

    const r1 = performLogin(db, { wallet, claHash: hash, signature: sig });
    expect(r1.role).toBe("contributor");
    expect(r1.isSupervisor).toBe(false);

    db.prepare(`UPDATE users SET role = 'founder', is_supervisor = 1 WHERE wallet = ?`).run(wallet);
    const r2 = performLogin(db, { wallet, claHash: hash, signature: sig });
    expect(r2.role).toBe("founder");
    expect(r2.isSupervisor).toBe(true);
  });

  it("un valor de rol corrupto cae a is_founder, nunca a la cookie", async () => {
    const { performLogin } = await import("./onboard");
    const db = freshDb();
    const hash = claCanonicalHash();
    const kp = Keypair.random();
    const wallet = kp.publicKey();
    const sig = b64(kp.sign(Buffer.from(claSigningPayload(hash), "utf8")));
    performOnboard(db, { code: seedInvite(db), wallet, name: "Ada", isDemo: true, claHash: hash, signature: sig });
    db.prepare(`UPDATE users SET role = 'admin-de-mentira' WHERE wallet = ?`).run(wallet);
    expect(performLogin(db, { wallet, claHash: hash, signature: sig }).role).toBe("contributor");
  });
});
