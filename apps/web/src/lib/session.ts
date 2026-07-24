/**
 * Helpers de sesión que tocan cookies (server components / route handlers).
 * La lógica JWT pura vive en lib/jwt.ts (reutilizable en el edge middleware).
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE, signSession, verifySession, type SessionData } from "./jwt";

export { SESSION_COOKIE, signSession, verifySession };
export type { SessionData };

export async function getSession(): Promise<SessionData | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export async function setSessionCookie(data: Omit<SessionData, keyof import("jose").JWTPayload>): Promise<void> {
  const token = await signSession(data);
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
}

export function clearSessionCookie(): void {
  cookies().delete(SESSION_COOKIE);
}
