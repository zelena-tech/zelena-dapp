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

describe("verifyWalletSignature — preimagen alternativa (wallets que hashean)", () => {
  it("acepta una firma sobre sha256(payload) y sigue rechazando firmas ajenas", async () => {
    const { Keypair } = await import("@stellar/stellar-sdk");
    const { createHash } = await import("node:crypto");
    const kp = Keypair.random();
    const payload = "zelena-cla-testnet-v1:" + "a".repeat(64);
    const hash = createHash("sha256").update(payload, "utf8").digest();

    const firmaDirecta = kp.sign(Buffer.from(payload, "utf8")).toString("base64");
    const firmaSobreHash = kp.sign(hash).toString("base64");
    expect(verifyWalletSignature(kp.publicKey(), payload, firmaDirecta)).toBe(true);
    expect(verifyWalletSignature(kp.publicKey(), payload, firmaSobreHash)).toBe(true);

    const otra = Keypair.random();
    expect(verifyWalletSignature(otra.publicKey(), payload, firmaSobreHash)).toBe(false);
    expect(verifyWalletSignature(kp.publicKey(), payload + "x", firmaSobreHash)).toBe(false);
    expect(verifyWalletSignature(kp.publicKey(), payload, Buffer.alloc(64).toString("base64"))).toBe(false);
  });
});

describe("verifyWalletSignature — SEP-53 (el formato de Freighter)", () => {
  it("acepta la firma sobre sha256('Stellar Signed Message:\n' + payload)", async () => {
    const { Keypair } = await import("@stellar/stellar-sdk");
    const { createHash } = await import("node:crypto");
    const kp = Keypair.random();
    const payload = claSigningPayload("b".repeat(64));
    const sep53 = createHash("sha256").update(Buffer.from("Stellar Signed Message:\n" + payload, "utf8")).digest();

    expect(verifyWalletSignature(kp.publicKey(), payload, kp.sign(sep53).toString("base64"))).toBe(true);
    // Sigue rechazando lo que debe rechazar
    const otra = Keypair.random();
    expect(verifyWalletSignature(otra.publicKey(), payload, kp.sign(sep53).toString("base64"))).toBe(false);
    const otroPayload = claSigningPayload("c".repeat(64));
    expect(verifyWalletSignature(kp.publicKey(), otroPayload, kp.sign(sep53).toString("base64"))).toBe(false);
  });
});
