/**
 * Núcleo del onboarding, sin cookies ni HTTP (los handlers solo lo invocan —
 * ver CLAUDE.md). Aislado aquí para poder testearlo con una DB en memoria.
 *
 * Orden CRÍTICO (WP01 / hallazgo Alta #1): la firma ed25519 se verifica ANTES de
 * consumir la invitación. Una firma inválida devuelve 400 y jamás gasta el código
 * (el consumo atómico no debe malgastarse con firmas falsas).
 */
import type { DB } from "./db";
import { consumeInvite, InviteConsumeError } from "./invites";
import { claCanonicalHash } from "./cla";
import { claSigningPayload } from "./cla-signing";
import { verifyWalletSignature } from "./crypto";
import { CLA_VERSION } from "./config";

export class OnboardError extends Error {
  status: number;
  /**
   * Motivo estructurado. Sin esto el cliente no puede distinguir "esta wallet ya
   * está registrada" de "se agotaron los cupos": ambos eran 409, y el wizard
   * trataba los dos como reingreso, mostrando un mensaje que decía lo contrario
   * de lo que había pasado.
   */
  reason: string;
  constructor(status: number, message: string, reason = "error") {
    super(message);
    this.name = "OnboardError";
    this.status = status;
    this.reason = reason;
  }
}

export interface OnboardInput {
  code: string;
  wallet: string;
  name: string;
  isDemo: boolean;
  claHash: string;
  signature: string;
}

export interface OnboardResult {
  wallet: string;
  name: string;
  tier: "Bronze";
  isDemo: boolean;
}

export function performOnboard(db: DB, input: OnboardInput): OnboardResult {
  const { code, wallet, name, isDemo, claHash, signature } = input;

  // 1. El hash recibido debe coincidir con el texto canónico del servidor.
  if (claHash !== claCanonicalHash()) {
    throw new OnboardError(400, "El hash del CLA no coincide con la versión oficial.", "cla_desactualizado");
  }

  // 2. Verificación criptográfica de la firma (ANTES de consumir la invitación).
  //    El payload firmado incluye el domain separator (anti-replay entre redes).
  if (!verifyWalletSignature(wallet, claSigningPayload(claHash), signature)) {
    throw new OnboardError(400, "Firma inválida: no corresponde a la wallet declarada.", "firma_invalida");
  }

  // 3, 4 y 5 en UNA SOLA TRANSACCIÓN. Antes el cupo se consumía en su propia
  // transacción y el alta en otra: si el proceso moría o el INSERT fallaba en
  // medio, el cupo quedaba quemado sin usuario y nadie podía recuperarlo. Con
  // node:sqlite la transacción anidada de consumeInvite se une a esta (ver
  // db.ts), y con better-sqlite3/libsql se resuelve con savepoints.
  const tx = db.transaction((): string => {
    // Wallet ya registrada.
    const existing = db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(wallet);
    if (existing) throw new OnboardError(409, "Esta wallet ya está registrada.", "wallet_registrada");

    // Consumo del cupo (solo tras firma válida).
    let issuer: string;
    try {
      issuer = consumeInvite(db, code, wallet);
    } catch (e) {
      if (e instanceof InviteConsumeError) {
        throw new OnboardError(
          409,
          e.reason === "used"
            ? "Este código ya no tiene cupos disponibles."
            : e.message,
          e.reason === "used" ? "cupos_agotados" : e.reason === "expired" ? "codigo_expirado" : "codigo_invalido"
        );
      }
      throw new OnboardError(400, "No se pudo usar la invitación.", "invitacion_invalida");
    }

    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, invited_by, is_demo, cla_signed) VALUES (?, ?, 'Bronze', ?, ?, 1)`
    ).run(wallet, name, issuer, isDemo ? 1 : 0);
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature, anchor_status) VALUES (?, ?, ?, ?, 'pending')`
    ).run(wallet, CLA_VERSION, claHash, signature);
    db.prepare(
      `INSERT INTO anchor_queue (kind, ref, data_key, payload_hash, status) VALUES ('cla', ?, ?, ?, 'pending')`
    ).run(wallet, `cla:v${CLA_VERSION}:${wallet.slice(0, 12)}`, claHash);
    return issuer;
  });
  tx();

  return { wallet, name, tier: "Bronze", isDemo };
}

export interface LoginInput {
  wallet: string;
  claHash: string;
  signature: string;
}

export interface LoginResult {
  wallet: string;
  name: string;
  tier: string;
  isDemo: boolean;
}

/**
 * Reingreso de una wallet ya registrada (WP-demo). No consume invitación ni
 * escribe nada: firma la sesión si —y solo si— la firma ed25519 sobre el payload
 * del CLA corresponde a esa wallet. Es autenticación real, no un bypass: quien
 * no tenga la llave privada no puede producir la firma.
 *
 * Existe porque el onboarding es de un solo uso por wallet (409) y sin esto
 * nadie podía volver a entrar tras perder la cookie — en un despliegue nuevo,
 * ni el propio fundador.
 */
export function performLogin(db: DB, input: LoginInput): LoginResult {
  const { wallet, claHash, signature } = input;

  if (claHash !== claCanonicalHash()) {
    throw new OnboardError(400, "El hash del CLA no coincide con la versión oficial.", "cla_desactualizado");
  }
  if (!verifyWalletSignature(wallet, claSigningPayload(claHash), signature)) {
    throw new OnboardError(401, "Firma inválida: no corresponde a la wallet declarada.", "firma_invalida");
  }
  const user = db
    .prepare(`SELECT wallet, display_name, tier, is_demo, cla_signed FROM users WHERE wallet = ?`)
    .get(wallet) as
    | { wallet: string; display_name: string; tier: string; is_demo: number; cla_signed: number }
    | undefined;
  if (!user) throw new OnboardError(404, "Esta wallet no está registrada. Usa un código de invitación.", "no_registrada");
  if (!user.cla_signed) throw new OnboardError(403, "Esta wallet no tiene el CLA firmado.", "sin_cla");

  return { wallet: user.wallet, name: user.display_name, tier: user.tier, isDemo: user.is_demo === 1 };
}
