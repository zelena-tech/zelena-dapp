/** Firma/verificación JWT pura (jose). Sin next/headers → usable en edge. */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "zelena_session";
const ALG = "HS256";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") {
      // Nunca arrancar producción con secreto ausente o débil (hallazgo Alta #2).
      throw new Error("SESSION_SECRET ausente o <32 chars. Configúralo antes de desplegar.");
    }
    return new TextEncoder().encode("dev-only-insecure-secret-change-me-please-32bytes-min");
  }
  return new TextEncoder().encode(s);
}

export interface SessionData extends JWTPayload {
  wallet: string;
  name: string;
  tier: string;
  isFounder: boolean;
  claSigned: boolean;
  isDemo: boolean;
  /**
   * WP14 — OPCIONALES a propósito: una cookie firmada antes de WP14 no los trae y
   * debe seguir siendo válida. Léelos SIEMPRE con `effectiveRole` /
   * `effectiveIsSupervisor` de lib/roles.ts, que derivan el fallback de `isFounder`.
   * `role` ∈ founder | core | contributor (valores de WP13); `isSupervisor` es un
   * flag independiente (plano 07 §5: Vale es `core` Y supervisora).
   *
   * La cookie es una PISTA, no la autoridad: para autorizar, lib/team.ts resuelve
   * role/is_supervisor contra la tabla `users`.
   */
  role?: string;
  isSupervisor?: boolean;
}

export async function signSession(data: Omit<SessionData, keyof JWTPayload>): Promise<string> {
  return new SignJWT({ ...data })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionData | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as SessionData;
  } catch {
    return null;
  }
}
