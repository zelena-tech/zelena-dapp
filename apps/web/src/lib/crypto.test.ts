import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { verifyWalletSignature } from "./crypto";
import { claSigningPayload } from "./cla-signing";

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("verifyWalletSignature (WP01 — hallazgo Alta #1)", () => {
  const kp = Keypair.random();
  const wallet = kp.publicKey();
  const payload = claSigningPayload("a".repeat(64));
  const sig = b64(kp.sign(Buffer.from(payload, "utf8")));

  it("acepta una firma válida de la wallet declarada", () => {
    expect(verifyWalletSignature(wallet, payload, sig)).toBe(true);
  });

  it("rechaza una firma alterada", () => {
    const tampered = b64(Buffer.from("z".repeat(64)));
    expect(verifyWalletSignature(wallet, payload, tampered)).toBe(false);
  });

  it("rechaza una firma válida pero hecha con OTRA clave", () => {
    const other = Keypair.random();
    const otherSig = b64(other.sign(Buffer.from(payload, "utf8")));
    expect(verifyWalletSignature(wallet, payload, otherSig)).toBe(false);
  });

  it("rechaza si el payload difiere (otro domain separator / otra red)", () => {
    const otherPayload = claSigningPayload("b".repeat(64));
    expect(verifyWalletSignature(wallet, otherPayload, sig)).toBe(false);
  });

  it("rechaza un placeholder que no es una firma ed25519 de 64 bytes (H3)", () => {
    expect(verifyWalletSignature(wallet, payload, "freighter-no-signMessage")).toBe(false);
  });

  it("rechaza una pubkey mal formada sin lanzar", () => {
    expect(verifyWalletSignature("NOT_A_STELLAR_KEY", payload, sig)).toBe(false);
  });
});
