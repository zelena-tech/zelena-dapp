/**
 * Puerta de invitación. Un solo uso, expira 30 días, ligada a la wallet del
 * emisor. Topes por tier (Bronze 2 · Silver 5 · Gold 10) sobre invitaciones
 * ACTIVAS (sin usar y no expiradas). Consumo atómico anti-doble-uso.
 *
 * CÓDIGOS DE COHORTE (multiuso). `invites.max_uses` decide la semántica:
 *  - `max_uses IS NULL`  → invitación normal de UN SOLO USO: manda `used_by`.
 *  - `max_uses NOT NULL` → código de cohorte: vale mientras `uses < max_uses`
 *    y no haya expirado; `used_by` se ignora (decenas de personas entran con
 *    el mismo código, p. ej. el QR proyectado en clase).
 * Los códigos de cohorte NO consumen cupo del tier del emisor.
 */
import type { DB } from "./db";
import { getActiveGenome } from "./genome";
import { randomBytes } from "node:crypto";

export function inviteCap(db: DB, tier: string): number {
  const caps = getActiveGenome(db).TIER_INVITE_CAPS;
  return caps[tier] ?? caps.Bronze;
}

/**
 * Cupo del tier: solo cuenta invitaciones personales de un solo uso. Los
 * códigos de cohorte (max_uses NOT NULL) quedan FUERA del tope — si contaran,
 * sembrar la cohorte de clase le comería una invitación al founder.
 */
export function countActiveInvites(db: DB, issuerWallet: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM invites
       WHERE issuer_wallet = ? AND max_uses IS NULL AND used_by IS NULL
         AND expires_at > datetime('now')`
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
    if (active >= inviteCap(db, tier)) throw new InviteCapError();
    const code = genCode();
    db.prepare(
      `INSERT INTO invites (code, issuer_wallet, expires_at)
       VALUES (?, ?, datetime('now', '+30 days'))`
    ).run(code, issuerWallet);
    return code;
  });
  return tx();
}

export interface CohortInviteInput {
  code: string;
  issuerWallet: string;
  maxUses: number;
  expiresDays: number;
}

/**
 * Crea un código de cohorte multiuso. IDEMPOTENTE (`INSERT OR IGNORE`):
 * sembrarlo mil veces no reinicia `uses` ni corre la fecha de expiración, así
 * que es seguro llamarlo en cada arranque. NO cuenta contra el tope del tier
 * del emisor (ver countActiveInvites).
 *
 * Devuelve true si lo creó, false si ya existía.
 */
export function createCohortInvite(db: DB, input: CohortInviteInput): boolean {
  const { code, issuerWallet, maxUses, expiresDays } = input;
  if (!Number.isInteger(maxUses) || maxUses < 1) throw new Error("maxUses debe ser un entero >= 1.");
  if (!Number.isInteger(expiresDays) || expiresDays < 1)
    throw new Error("expiresDays debe ser un entero >= 1.");
  // El modificador se arma en JS (expiresDays ya validado como entero) porque
  // no todos los drivers concatenan un parámetro numérico dentro de datetime().
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO invites (code, issuer_wallet, expires_at, max_uses, uses)
       VALUES (?, ?, datetime('now', ?), ?, 0)`
    )
    .run(code, issuerWallet, `+${expiresDays} days`, maxUses);
  return Number(info.changes) === 1;
}

export type InviteCheck =
  | { ok: true; issuerWallet: string }
  | { ok: false; reason: "not_found" | "used" | "expired" };

/** Solo lectura: valida sin consumir (para el wizard). */
export function checkInvite(db: DB, code: string): InviteCheck {
  const row = db
    .prepare(
      `SELECT code, issuer_wallet, used_by, expires_at, max_uses, uses,
              (expires_at <= datetime('now')) AS expired
         FROM invites WHERE code = ?`
    )
    .get(code) as
    | {
        code: string;
        issuer_wallet: string;
        used_by: string | null;
        expires_at: string;
        max_uses: number | null;
        uses: number;
        expired: number;
      }
    | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.max_uses != null) {
    // Cohorte multiuso: `used_by` se ignora, manda el contador de cupos.
    if (row.uses >= row.max_uses) return { ok: false, reason: "used" };
    if (row.expired) return { ok: false, reason: "expired" };
    return { ok: true, issuerWallet: row.issuer_wallet };
  }
  // Un solo uso: mismo orden de diagnóstico que siempre (used antes que expired).
  if (row.used_by) return { ok: false, reason: "used" };
  if (row.expired) return { ok: false, reason: "expired" };
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
 * Consume atómicamente. UPDATE condicional dentro de una transacción → gana
 * exactamente uno en carreras simultáneas. Devuelve la wallet del emisor.
 *
 * Dos caminos según `max_uses`:
 *  - cohorte (NOT NULL): `uses = uses + 1` con guarda `uses < max_uses`;
 *    la misma wallet no puede entrar dos veces porque el onboard falla por
 *    PK de users, no por este contador.
 *  - un solo uso (NULL): el camino histórico, intacto.
 */
export function consumeInvite(db: DB, code: string, wallet: string): string {
  const tx = db.transaction((c: string, w: string): string => {
    const meta = db.prepare(`SELECT max_uses FROM invites WHERE code = ?`).get(c) as
      | { max_uses: number | null }
      | undefined;

    if (meta && meta.max_uses != null) {
      // ---- Camino cohorte multiuso ----
      const hit = db
        .prepare(
          `UPDATE invites SET uses = uses + 1
           WHERE code = ? AND max_uses IS NOT NULL AND uses < max_uses
             AND expires_at > datetime('now')`
        )
        .run(c);
      if (Number(hit.changes) === 1) {
        const row = db.prepare(`SELECT issuer_wallet FROM invites WHERE code = ?`).get(c) as {
          issuer_wallet: string;
        };
        return row.issuer_wallet;
      }
      // Falló: cupos agotados ("used") o expirado. Diagnostica con checkInvite.
      const diag = checkInvite(db, c);
      if (diag.ok) throw new InviteConsumeError("used"); // ganó otra tx la última plaza
      throw new InviteConsumeError(diag.reason);
    }

    // ---- Camino de UN SOLO USO (sin cambios) ----
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
