import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import {
  linkEmail,
  setRecoveryEmail,
  resolveByEmail,
  emailFor,
  isCorporate,
  normalizeEmail,
  IdentityError,
  CORPORATE_DOMAIN,
} from "./identity";

const SCHEMA = path.join(process.cwd(), "src", "lib", "schema.sql");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA, "utf8"));
  db.prepare(`INSERT INTO users (wallet, display_name, is_founder) VALUES ('W_JOHN','John',1)`).run();
  db.prepare(`INSERT INTO users (wallet, display_name) VALUES ('W_VALE','Vale')`).run();
  return db;
}

describe("WP13 · el correo del SSO resuelve a la wallet que ya existe", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("vincula el correo corporativo a la wallet y la resuelve al entrar", () => {
    linkEmail(db, "W_JOHN", `John.Jimenez@${CORPORATE_DOMAIN}`);
    const id = resolveByEmail(db, `john.jimenez@${CORPORATE_DOMAIN}`)!;
    expect(id.wallet).toBe("W_JOHN");
    expect(id.isFounder).toBe(true);
    // Se normaliza a minúsculas: el SSO no debe crear dos identidades por mayúsculas.
    expect(id.email).toBe(`john.jimenez@${CORPORATE_DOMAIN}`);
  });

  it("NO crea una identidad nueva: la wallet sigue siendo la clave de la reputación", () => {
    db.prepare(
      `INSERT INTO reputation_events (wallet, axis, delta, ref) VALUES ('W_JOHN','ejecucion',50,'previo')`
    ).run();
    linkEmail(db, "W_JOHN", `john@${CORPORATE_DOMAIN}`);
    const usuarios = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    expect(usuarios).toBe(2); // no apareció un usuario nuevo
    const rep = (
      db.prepare(`SELECT COALESCE(SUM(delta),0) AS n FROM reputation_events WHERE wallet='W_JOHN'`).get() as {
        n: number;
      }
    ).n;
    expect(rep).toBe(50); // el historial sigue entero y ligado a la misma wallet
  });

  it("solo acepta el dominio corporativo", () => {
    expect(isCorporate(`x@${CORPORATE_DOMAIN}`)).toBe(true);
    expect(isCorporate("x@gmail.com")).toBe(false);
    expect(() => linkEmail(db, "W_VALE", "vale@gmail.com")).toThrow(IdentityError);
  });

  it("un correo pertenece a una sola wallet", () => {
    linkEmail(db, "W_JOHN", `equipo@${CORPORATE_DOMAIN}`);
    expect(() => linkEmail(db, "W_VALE", `equipo@${CORPORATE_DOMAIN}`)).toThrow(/ya está vinculado/i);
  });

  it("es idempotente para el mismo par wallet/correo", () => {
    linkEmail(db, "W_VALE", `vale@${CORPORATE_DOMAIN}`);
    linkEmail(db, "W_VALE", `VALE@${CORPORATE_DOMAIN}`);
    expect(emailFor(db, "W_VALE")).toBe(`vale@${CORPORATE_DOMAIN}`);
  });

  it("rechaza vincular un correo a una wallet inexistente", () => {
    expect(() => linkEmail(db, "W_FANTASMA", `x@${CORPORATE_DOMAIN}`)).toThrow(/no existe/i);
  });

  it("el correo de continuidad debe ser personal (plano 05)", () => {
    setRecoveryEmail(db, "W_VALE", "vale.personal@gmail.com");
    const r = db.prepare(`SELECT recovery_email FROM users WHERE wallet='W_VALE'`).get() as {
      recovery_email: string;
    };
    expect(r.recovery_email).toBe("vale.personal@gmail.com");
    // Uno corporativo no sobrevive a la salida de la organización: no sirve.
    expect(() => setRecoveryEmail(db, "W_VALE", `vale@${CORPORATE_DOMAIN}`)).toThrow(IdentityError);
  });

  it("un correo no vinculado no resuelve a nadie", () => {
    expect(resolveByEmail(db, `nadie@${CORPORATE_DOMAIN}`)).toBeNull();
  });

  it("normaliza espacios y mayúsculas", () => {
    expect(normalizeEmail("  John@Zelena.Tech  ")).toBe("john@zelena.tech");
  });
});
