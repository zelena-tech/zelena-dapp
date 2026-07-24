import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "./db";
import fs from "node:fs";
import path from "node:path";
import {
  generateInvite,
  consumeInvite,
  checkInvite,
  countActiveInvites,
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
