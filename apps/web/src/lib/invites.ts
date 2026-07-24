/**
 * Puerta de invitación. Un solo uso, expira 30 días, ligada a la wallet del
 * emisor. Topes por tier (Bronze 2 · Silver 5 · Gold 10) sobre invitaciones
 * ACTIVAS (sin usar y no expiradas). Consumo atómico anti-doble-uso.
 */
import type { DB } from "./db";
import { TIER_INVITE_CAPS } from "./config";
import { randomBytes } from "node:crypto";

export function inviteCap(tier: string): number {
  return TIER_INVITE_CAPS[tier] ?? TIER_INVITE_CAPS.Bronze;
}

export function countActiveInvites(db: DB, issuerWallet: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invites
       WHERE issuer_wallet = ? AND used_by IS NULL AND expires_at > datetime('now')`
    )
    .get(issuerWallet) as { n: number };
  return row.n;
}

export class InviteCapError extends Error {
  constructor() {
    super("Alcanzaste el tope de invitaciones activas de tu tier.");
    this.name = "InviteCapError";
  }
}

function genCode(): string {
  return "GENESIS-" + randomBytes(5).toString("hex").toUpperCase();
}

export function generateInvite(db: DB, issuerWallet: string, tier: string): string {
  // Transacción: el conteo y el insert son atómicos (fix TOCTOU, security-review #4).
  const tx = db.transaction((): string => {
    const active = countActiveInvites(db, issuerWallet);
    if (active >= inviteCap(tier)) throw new InviteCapError();
    const code = genCode();
    db.prepare(
      `INSERT INTO invites (code, issuer_wallet, expires_at)
       VALUES (?, ?, datetime('now', '+30 days'))`
    ).run(code, issuerWallet);
    return code;
  });
  return tx();
}

export type InviteCheck =
  | { ok: true; issuerWallet: string }
  | { ok: false; reason: "not_found" | "used" | "expired" };

/** Solo lectura: valida sin consumir (para el wizard). */
export function checkInvite(db: DB, code: string): InviteCheck {
  const row = db
    .prepare(`SELECT code, issuer_wallet, used_by, expires_at FROM invites WHERE code = ?`)
    .get(code) as
    | { code: string; issuer_wallet: string; used_by: string | null; expires_at: string }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.used_by) return { ok: false, reason: "used" };
  const expired = db
    .prepare(`SELECT (expires_at <= datetime('now')) AS e FROM invites WHERE code = ?`)
    .get(code) as { e: number };
  if (expired.e) return { ok: false, reason: "expired" };
  return { ok: true, issuerWallet: row.issuer_wallet };
}

export class InviteConsumeError extends Error {
  reason: "not_found" | "used" | "expired";
  constructor(reason: "not_found" | "used" | "expired") {
    super(
      reason === "used"
        ? "Este código ya fue usado."
        : reason === "expired"
        ? "Este código expiró."
        : "Código de invitación no válido."
    );
    this.name = "InviteConsumeError";
    this.reason = reason;
  }
}

/**
 * Consume atómicamente. UPDATE condicional (used_by IS NULL AND no expirado)
 * dentro de una transacción → gana exactamente uno en carreras simultáneas.
 * Devuelve la wallet del emisor.
 */
export function consumeInvite(db: DB, code: string, wallet: string): string {
  const tx = db.transaction((c: string, w: string): string => {
    const info = db
      .prepare(
        `UPDATE invites SET used_by = ?
         WHERE code = ? AND used_by IS NULL AND expires_at > datetime('now')`
      )
      .run(w, c);
    if (info.changes === 1) {
      const row = db.prepare(`SELECT issuer_wallet FROM invites WHERE code = ?`).get(c) as {
        issuer_wallet: string;
      };
      return row.issuer_wallet;
    }
    // Falló: diagnostica por qué para un mensaje claro.
    const check = checkInvite(db, c);
    if (check.ok) throw new InviteConsumeError("used"); // ganó otra tx
    throw new InviteConsumeError(check.reason);
  });
  return tx(code, wallet);
}
