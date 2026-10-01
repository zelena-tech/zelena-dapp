/**
 * Código de asistencia rotativo y huella de cierre de los ritos (WP31-D). SOLO
 * SERVIDOR: usa HMAC y `node:crypto`, así que ningún componente de cliente lo
 * importa (el copy y la cadencia viven en `ritos-labels.ts`).
 *
 * Cómo funciona el código: el tiempo se parte en tramos de `RITE_CODE_ROTATION_S`
 * segundos (genoma). El código de un tramo son 6 dígitos sacados de
 * HMAC(secreto, "<sesión>:<tramo>"): quien no tiene el secreto no puede adivinar el
 * siguiente, y quien no está en el rito no ve el actual. Se acepta el tramo actual y
 * el anterior, para que nadie pierda su asistencia por escribir justo en el cambio.
 *
 * El secreto: `RITES_SECRET` (≥ 16) o, si no está, uno derivado de `SESSION_SECRET`
 * (≥ 32, que producción ya exige). Nunca vive en el repo: en producción, sin ninguno
 * de los dos, `ritesSecret` lanza (igual que `jwt.ts`); fuera de producción cae a
 * uno de desarrollo, que no sirve para nada real.
 */
import { timingSafeEqual } from "node:crypto";
import { hmacHex, sha256Hex } from "./crypto";
import type { RiteKind } from "./genome";

/** Etiqueta de derivación: el secreto de ritos nunca es el de sesión tal cual. */
const DERIVACION = "zelena-ritos-v1";
/** Solo desarrollo y tests (NODE_ENV ≠ production). No protege nada real. */
const SOLO_DESARROLLO = "dev-only-insecure-rites-secret-change-me";

export function ritesSecret(env: NodeJS.ProcessEnv = process.env): string {
  const propio = env.RITES_SECRET;
  if (typeof propio === "string" && propio.length >= 16) return propio;
  const sesion = env.SESSION_SECRET;
  if (typeof sesion === "string" && sesion.length >= 32) return hmacHex(sesion, DERIVACION);
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Falta el secreto de los ritos: configura RITES_SECRET (16 caracteres o más) o SESSION_SECRET (32 o más) antes de desplegar."
    );
  }
  return hmacHex(SOLO_DESARROLLO, DERIVACION);
}

function rotacionValida(rotacionS: number): number {
  const r = Math.floor(Number(rotacionS));
  if (!Number.isFinite(r) || r < 1) throw new RangeError(`Rotación del código inválida: ${String(rotacionS)}`);
  return r;
}

/** Tramo de tiempo al que pertenece un instante. */
export function bucketDe(ahoraMs: number, rotacionS: number): number {
  return Math.floor(ahoraMs / (rotacionValida(rotacionS) * 1000));
}

/** Segundos que le quedan al código actual (1 … rotación). */
export function expiraEnS(ahoraMs: number, rotacionS: number): number {
  const r = rotacionValida(rotacionS);
  const transcurrido = Math.floor((((ahoraMs % (r * 1000)) + r * 1000) % (r * 1000)) / 1000);
  return r - transcurrido;
}

/** Código de 6 dígitos (con ceros a la izquierda) de una sesión en un tramo. */
export function codigoRito(secret: string, sessionId: number, bucket: number): string {
  const n = parseInt(hmacHex(secret, `${sessionId}:${bucket}`).slice(0, 8), 16) % 1_000_000;
  return String(n).padStart(6, "0");
}

/**
 * ¿El código vale ahora para esa sesión? Tramo actual o anterior, comparación en
 * tiempo constante (se comparan los dos siempre, sin cortar al primer acierto).
 * El código ya viene normalizado (`normalizarCodigo`): 6 dígitos o nada.
 */
export function verificarCodigo(
  secret: string,
  sessionId: number,
  codigo: string,
  ahoraMs: number,
  rotacionS: number
): boolean {
  if (typeof codigo !== "string" || !/^\d{6}$/.test(codigo)) return false;
  const actual = bucketDe(ahoraMs, rotacionS);
  const dado = Buffer.from(codigo, "utf8");
  let ok = false;
  for (const b of [actual, actual - 1]) {
    const esperado = Buffer.from(codigoRito(secret, sessionId, b), "utf8");
    if (timingSafeEqual(esperado, dado)) ok = true;
  }
  return ok;
}

/**
 * Huella del cierre de un rito: sha256 de un JSON canónico (claves en orden fijo,
 * asistentes sin duplicados y ordenados). Es lo que se ancla en la red de pruebas.
 * La lista nominal de asistentes existe SOLO aquí dentro: no se publica en claro.
 */
export function hashCierre(i: {
  kind: RiteKind;
  scheduledFor: string;
  asistentes: string[];
  host: string | null;
  recorder: string | null;
  summary: string | null;
}): string {
  const canonico = JSON.stringify({
    asistentes: [...new Set(i.asistentes)].sort(),
    host: i.host ?? null,
    kind: i.kind,
    recorder: i.recorder ?? null,
    scheduledFor: i.scheduledFor,
    summary: i.summary ?? null,
  });
  return sha256Hex(canonico);
}
