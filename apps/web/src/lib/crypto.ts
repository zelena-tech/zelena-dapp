import { createHash, createHmac, randomBytes } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
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
