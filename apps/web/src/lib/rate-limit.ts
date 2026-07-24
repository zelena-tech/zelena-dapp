/**
 * Rate limiting simple en memoria por clave (IP+wallet). Suficiente para la
 * cohorte Génesis y endpoints sensibles (invitación, quiz, heartbeat).
 * Nota: en serverless multi-instancia esto no es global; ver decisions-pending.
 */
type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __zelenaRL?: Map<string, Bucket> };
const store = (g.__zelenaRL ??= new Map<string, Bucket>());

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now > b.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "local";
}
