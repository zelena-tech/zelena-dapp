import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "./db";
import fs from "node:fs";
import path from "node:path";
import {
  generateInvite,
  consumeInvite,
  checkInvite,
  countActiveInvites,
  createCohortInvite,
  inviteCap,
  InviteCapError,
  InviteConsumeError,
} from "./invites";

function freshDb() {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

describe("invitaciones", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it("respeta el tope de tier (Bronze=2)", () => {
    expect(inviteCap(db, "Bronze")).toBe(2);
    generateInvite(db, "ISSUER", "Bronze");
    generateInvite(db, "ISSUER", "Bronze");
    expect(countActiveInvites(db, "ISSUER")).toBe(2);
    expect(() => generateInvite(db, "ISSUER", "Bronze")).toThrow(InviteCapError);
  });

  it("Gold permite hasta 10 activas", () => {
    for (let i = 0; i < 10; i++) generateInvite(db, "GOLD", "Gold");
    expect(() => generateInvite(db, "GOLD", "Gold")).toThrow(InviteCapError);
  });

  it("consumir libera cupo del emisor", () => {
    const code = generateInvite(db, "ISSUER", "Bronze");
    generateInvite(db, "ISSUER", "Bronze");
    expect(countActiveInvites(db, "ISSUER")).toBe(2);
    consumeInvite(db, code, "NEWUSER");
    expect(countActiveInvites(db, "ISSUER")).toBe(1);
  });

  it("rechaza el doble uso de un código", () => {
    const code = generateInvite(db, "ISSUER", "Bronze");
    const issuer = consumeInvite(db, code, "USER_A");
    expect(issuer).toBe("ISSUER");
    expect(() => consumeInvite(db, code, "USER_B")).toThrow(InviteConsumeError);
  });

  it("rechaza código inexistente y código expirado", () => {
    expect(() => consumeInvite(db, "NOPE", "U")).toThrow(InviteConsumeError);
    db.prepare(
      `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES (?, ?, datetime('now','-1 day'))`
    ).run("OLD-1", "ISSUER");
    const check = checkInvite(db, "OLD-1");
    expect(check.ok).toBe(false);
    expect(() => consumeInvite(db, "OLD-1", "U")).toThrow(InviteConsumeError);
  });

  it("solo una wallet gana en dos consumos secuenciales (simulación de carrera)", () => {
    const code = generateInvite(db, "ISSUER", "Bronze");
    let wins = 0;
    for (const w of ["W1", "W2"]) {
      try {
        consumeInvite(db, code, w);
        wins++;
      } catch {
        /* esperado para el perdedor */
      }
    }
    expect(wins).toBe(1);
  });
});

describe("códigos de cohorte multiuso", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  const COHORTE = "ESPECIALIZACION-2026";

  it("un código con maxUses 3 se consume 3 veces y la 4a falla con reason 'used'", () => {
    createCohortInvite(db, { code: COHORTE, issuerWallet: "FOUNDER", maxUses: 3, expiresDays: 14 });
    for (const w of ["W1", "W2", "W3"]) {
      expect(consumeInvite(db, COHORTE, w)).toBe("FOUNDER");
    }
    let err: unknown;
    try {
      consumeInvite(db, COHORTE, "W4");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InviteConsumeError);
    expect((err as InviteConsumeError).reason).toBe("used");
    const row = db.prepare(`SELECT uses, max_uses FROM invites WHERE code = ?`).get(COHORTE) as {
      uses: number;
      max_uses: number;
    };
    expect(row.uses).toBe(3);
    expect(row.max_uses).toBe(3);
  });

  it("un código de cohorte expirado falla con reason 'expired'", () => {
    db.prepare(
      `INSERT INTO invites (code, issuer_wallet, expires_at, max_uses, uses)
       VALUES (?, ?, datetime('now','-1 day'), 50, 0)`
    ).run("COHORTE-VIEJA", "FOUNDER");
    const check = checkInvite(db, "COHORTE-VIEJA");
    expect(check).toEqual({ ok: false, reason: "expired" });
    let err: unknown;
    try {
      consumeInvite(db, "COHORTE-VIEJA", "W1");
    } catch (e) {
      err = e;
    }
    expect((err as InviteConsumeError).reason).toBe("expired");
  });

  it("checkInvite devuelve ok con cupos libres aunque used_by siga NULL", () => {
    createCohortInvite(db, { code: COHORTE, issuerWallet: "FOUNDER", maxUses: 2, expiresDays: 14 });
    expect(checkInvite(db, COHORTE)).toEqual({ ok: true, issuerWallet: "FOUNDER" });
    consumeInvite(db, COHORTE, "W1");
    // used_by nunca se escribe en el camino de cohorte: manda el contador.
    const row = db.prepare(`SELECT used_by FROM invites WHERE code = ?`).get(COHORTE) as {
      used_by: string | null;
    };
    expect(row.used_by).toBeNull();
    expect(checkInvite(db, COHORTE)).toEqual({ ok: true, issuerWallet: "FOUNDER" });
    consumeInvite(db, COHORTE, "W2");
    expect(checkInvite(db, COHORTE)).toEqual({ ok: false, reason: "used" });
  });

  it("regresión: un código de un solo uso sigue fallando al segundo consumo", () => {
    const code = generateInvite(db, "ISSUER", "Bronze");
    expect(consumeInvite(db, code, "USER_A")).toBe("ISSUER");
    let err: unknown;
    try {
      consumeInvite(db, code, "USER_B");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InviteConsumeError);
    expect((err as InviteConsumeError).reason).toBe("used");
    const row = db.prepare(`SELECT used_by, max_uses, uses FROM invites WHERE code = ?`).get(code) as {
      used_by: string;
      max_uses: number | null;
      uses: number;
    };
    expect(row.used_by).toBe("USER_A");
    expect(row.max_uses).toBeNull();
    expect(row.uses).toBe(0); // el camino de un solo uso no toca el contador
  });

  it("createCohortInvite es idempotente y no reinicia el contador", () => {
    expect(
      createCohortInvite(db, { code: COHORTE, issuerWallet: "FOUNDER", maxUses: 150, expiresDays: 14 })
    ).toBe(true);
    consumeInvite(db, COHORTE, "W1");
    // Segunda (y tercera) siembra: no duplica ni pisa `uses`.
    expect(
      createCohortInvite(db, { code: COHORTE, issuerWallet: "FOUNDER", maxUses: 150, expiresDays: 14 })
    ).toBe(false);
    createCohortInvite(db, { code: COHORTE, issuerWallet: "OTRO", maxUses: 9, expiresDays: 1 });
    const rows = db.prepare(`SELECT issuer_wallet, max_uses, uses FROM invites WHERE code = ?`).all(
      COHORTE
    ) as Array<{ issuer_wallet: string; max_uses: number; uses: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ issuer_wallet: "FOUNDER", max_uses: 150, uses: 1 });
  });

  it("el código de cohorte no consume cupo del tier del emisor", () => {
    createCohortInvite(db, { code: COHORTE, issuerWallet: "ISSUER", maxUses: 150, expiresDays: 14 });
    expect(countActiveInvites(db, "ISSUER")).toBe(0);
    generateInvite(db, "ISSUER", "Bronze");
    generateInvite(db, "ISSUER", "Bronze");
    expect(countActiveInvites(db, "ISSUER")).toBe(2);
    expect(() => generateInvite(db, "ISSUER", "Bronze")).toThrow(InviteCapError);
  });
});
