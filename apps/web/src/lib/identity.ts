/**
 * WP13 (parte de modelo) · Enlace correo corporativo ↔ wallet.
 *
 * Decisión de John: se entra con el MISMO correo de la wallet.
 *
 * Por qué importa: la wallet es la clave primaria de TODA la reputación, los
 * puntos y el historial ya acumulados. Si el login SSO creara una identidad
 * nueva, partiríamos el historial en dos y romperíamos la regla de que la
 * reputación es acumulativa. Entonces el correo no es una identidad: es un
 * ALIAS de acceso que resuelve a la wallet que ya existe.
 *
 * `recovery_email` es el correo personal de continuidad del plano 05: si
 * alguien deja la organización, su progreso lo sigue.
 */
import type { DB } from "./db";

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

/** Dominio corporativo aceptado para el SSO de Entra. */
export const CORPORATE_DOMAIN = "zelena.tech";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

export function isCorporate(email: string): boolean {
  return normalizeEmail(email).endsWith(`@${CORPORATE_DOMAIN}`);
}

/**
 * Vincula un correo corporativo a una wallet existente. Idempotente para el
 * mismo par; falla si el correo ya pertenece a OTRA wallet (un correo, una
 * persona) o si la wallet no existe.
 */
export function linkEmail(db: DB, wallet: string, email: string): void {
  const e = normalizeEmail(email);
  if (!EMAIL_RE.test(e)) throw new IdentityError("Correo inválido.");
  if (!isCorporate(e)) throw new IdentityError(`El SSO solo acepta correos @${CORPORATE_DOMAIN}.`);

  const user = db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(wallet) as
    | { wallet: string }
    | undefined;
  if (!user) throw new IdentityError("La wallet no existe. El correo se vincula a una wallet ya creada.");

  const dueno = db.prepare(`SELECT wallet FROM users WHERE email = ?`).get(e) as { wallet: string } | undefined;
  if (dueno && dueno.wallet !== wallet) {
    throw new IdentityError(`El correo ${e} ya está vinculado a otra wallet.`);
  }
  db.prepare(`UPDATE users SET email = ? WHERE wallet = ?`).run(e, wallet);
}

export function setRecoveryEmail(db: DB, wallet: string, email: string): void {
  const e = normalizeEmail(email);
  if (!EMAIL_RE.test(e)) throw new IdentityError("Correo de continuidad inválido.");
  if (isCorporate(e)) {
    // Plano 05: el correo de continuidad existe para sobrevivir a la salida de
    // la organización. Uno corporativo no cumple esa función.
    throw new IdentityError("El correo de continuidad debe ser personal, no corporativo.");
  }
  db.prepare(`UPDATE users SET recovery_email = ? WHERE wallet = ?`).run(e, wallet);
}

export interface ResolvedIdentity {
  wallet: string;
  displayName: string;
  isFounder: boolean;
  email: string | null;
}

/** Resuelve el correo del SSO a la wallet ya existente. null = no vinculado. */
export function resolveByEmail(db: DB, email: string): ResolvedIdentity | null {
  const e = normalizeEmail(email);
  const r = db
    .prepare(`SELECT wallet, display_name, is_founder, email FROM users WHERE email = ?`)
    .get(e) as { wallet: string; display_name: string; is_founder: number; email: string } | undefined;
  if (!r) return null;
  return {
    wallet: r.wallet,
    displayName: r.display_name,
    isFounder: r.is_founder === 1,
    email: r.email,
  };
}

export function emailFor(db: DB, wallet: string): string | null {
  const r = db.prepare(`SELECT email FROM users WHERE wallet = ?`).get(wallet) as
    | { email: string | null }
    | undefined;
  return r?.email ?? null;
}
