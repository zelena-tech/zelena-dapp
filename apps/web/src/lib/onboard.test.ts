import { describe, it, expect, beforeEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { performOnboard, OnboardError } from "./onboard";
import { claCanonicalHash } from "./cla";
import { claSigningPayload } from "./cla-signing";

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
