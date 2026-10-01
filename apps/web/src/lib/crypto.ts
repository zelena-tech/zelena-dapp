import { createHash, createHmac, randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Verifica criptográficamente (ed25519, vía StrKey de Stellar) que `signatureB64`
 * (base64) sobre el `payload` (UTF-8) corresponde a la clave pública `pubkey`.
 *
 * `payload` debe construirse SIEMPRE con `claSigningPayload()` (incluye el domain
 * separator anti-replay). Devuelve `false` — nunca lanza — ante cualquier entrada
 * inválida: pubkey mal formada, firma no decodificable, o longitud distinta de los
 * 64 bytes de una firma ed25519 (esto último rechaza placeholders como el literal
 * "freighter-no-signMessage" del hallazgo H3, que jamás debe anclarse on-chain).
 */
export function verifyWalletSignature(pubkey: string, payload: string, signatureB64: string): boolean {
  let kp: Keypair;
  try {
    kp = Keypair.fromPublicKey(pubkey); // valida el StrKey 'G...' real (checksum incluido)
  } catch {
    return false;
  }
  const sig = Buffer.from(signatureB64, "base64");
  if (sig.length !== 64) return false; // firma ed25519 = 64 bytes exactos
  for (const pre of preimagenesAceptadas(payload)) {
    try {
      if (kp.verify(pre, sig)) return true;
    } catch {
      /* siguiente preimagen */
    }
  }
  return false;
}

/** Prefijo de SEP-53 (Stellar: "Sign and Verify Messages"), que usan las wallets reales. */
const SEP53_PREFIX = "Stellar Signed Message:" + String.fromCharCode(10);

/**
 * Preimágenes aceptadas para una misma firma del CLA, en orden de preferencia:
 *
 *   1. los bytes UTF-8 del payload — lo que firma la wallet de prueba del navegador;
 *   2. su SHA-256 — wallets que hashean antes de firmar;
 *   3. SEP-53: SHA-256 del payload con el prefijo "Stellar Signed Message:
" —
 *      lo que hace Freighter en sus versiones recientes;
 *   4. el payload prefijado sin hashear — variante de implementaciones antiguas.
 *
 * TODAS están atadas al MISMO payload con domain separator y TODAS exigen la
 * llave privada de la wallet: aceptar varias no debilita la prueba (SHA-256 es
 * resistente a colisiones y el prefijo es constante), solo evita rechazar firmas
 * legítimas por el formato que eligió la wallet. Un placeholder sin llave falla
 * en las cuatro.
 */
function preimagenesAceptadas(payload: string): Buffer[] {
  const plano = Buffer.from(payload, "utf8");
  const prefijado = Buffer.from(SEP53_PREFIX + payload, "utf8");
  return [
    plano,
    createHash("sha256").update(plano).digest(),
    createHash("sha256").update(prefijado).digest(),
    prefijado,
  ];
}

export function hmacHex(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input, "utf8").digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

// Merkle root determinista: hojas ordenadas por wallet asc, JSON canónico.
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256Hex("");
  let level = leaves.map((l) => sha256Hex(l));
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(sha256Hex(a < b ? a + b : b + a));
    }
    level = next;
  }
  return level[0];
}
