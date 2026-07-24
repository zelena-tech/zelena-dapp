import fs from "node:fs";
import path from "node:path";
import { sha256Hex } from "./crypto";

/** Lee el texto canónico del CLA (CLA.md en la raíz del repo). */
export function readClaText(): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "CLA.md"),
    path.join(process.cwd(), "CLA.md"),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      /* next */
    }
  }
  // Fallback mínimo si el archivo no está disponible en el entorno.
  return "# Acuerdo de Contribuidor (CLA) — Zelena · v1\n\n(No se pudo cargar CLA.md)";
}

export function claCanonicalHash(): string {
  return sha256Hex(readClaText());
}
