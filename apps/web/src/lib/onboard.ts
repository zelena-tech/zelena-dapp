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
  constructor(status: number, message: string) {
    super(message);
    this.name = "OnboardError";
    this.status = status;
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
    throw new OnboardError(400, "El hash del CLA no coincide con la versión oficial.");
  }

  // 2. Verificación criptográfica de la firma (ANTES de consumir la invitación).
  //    El payload firmado incluye el domain separator (anti-replay entre redes).
  if (!verifyWalletSignature(wallet, claSigningPayload(claHash), signature)) {
    throw new OnboardError(400, "Firma inválida: no corresponde a la wallet declarada.");
  }

  // 3. Wallet ya registrada.
  const existing = db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(wallet);
  if (existing) throw new OnboardError(409, "Esta wallet ya está registrada.");

  // 4. Consumo atómico de la invitación (solo tras firma válida).
  let issuer: string;
  try {
    issuer = consumeInvite(db, code, wallet);
  } catch (e) {
    if (e instanceof InviteConsumeError) throw new OnboardError(409, e.message);
    throw new OnboardError(400, "No se pudo usar la invitación.");
  }

  // 5. Alta atómica: usuario + firma + cola de anclaje.
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, invited_by, is_demo, cla_signed) VALUES (?, ?, 'Bronze', ?, ?, 1)`
    ).run(wallet, name, issuer, isDemo ? 1 : 0);
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature, anchor_status) VALUES (?, ?, ?, ?, 'pending')`
    ).run(wallet, CLA_VERSION, claHash, signature);
    db.prepare(
      `INSERT INTO anchor_queue (kind, ref, data_key, payload_hash, status) VALUES ('cla', ?, ?, ?, 'pending')`
    ).run(wallet, `cla:v${CLA_VERSION}:${wallet.slice(0, 12)}`, claHash);
  });
  tx();

  return { wallet, name, tier: "Bronze", isDemo };
}
