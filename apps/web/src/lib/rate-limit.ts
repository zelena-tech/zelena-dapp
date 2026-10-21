/**
 * Rate limiting simple en memoria por clave (IP+wallet). Suficiente para la
 * cohorte Génesis y endpoints sensibles (invitación, quiz, heartbeat).
 * Nota: en serverless multi-instancia esto no es global; ver decisions-pending.
 */
type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __zelenaRL?: Map<string, Bucket> };
const store = (g.__zelenaRL ??= new Map<string, Bucket>());

/** Con más claves que esto, se podan las vencidas antes de añadir otra (el mapa no crece sin tope). */
const PODAR_DESDE = 10_000;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now > b.resetAt) {
    if (!b && store.size >= PODAR_DESDE) {
      for (const [k, v] of store) if (now > v.resetAt) store.delete(k);
    }
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Quita el puerto que agregan algunos proxies (`1.2.3.4:5678`, `[2001:db8::1]:443`). */
function sinPuerto(v: string): string {
  const s = v.trim();
  const v6 = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(s);
  if (v6) return v6[1];
  const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s);
  return v4 ? v4[1] : s;
}

/**
 * IP del cliente para el límite de intentos, detrás de Azure Front Door.
 *
 *  1. `X-Azure-ClientIP`: la escribe Front Door con la IP que se le conectó. Es la buena
 *     siempre que App Service solo acepte tráfico de Front Door (restricción de acceso por
 *     la etiqueta `AzureFrontDoor.Backend` y la cabecera `X-Azure-FDID`): si se le puede
 *     hablar directo, el cliente también podría mandarla.
 *  2. Si no está, el ÚLTIMO valor de `X-Forwarded-For`: lo agrega el último proxy, que es
 *     de confianza. El PRIMERO lo puede mandar el propio cliente (con él se esquivaba el
 *     límite: hallazgo M4 de la auditoría).
 *  3. `x-real-ip`, o `"local"` si no hay nada (desarrollo).
 */
export function clientIp(headers: Headers): string {
  const azure = headers.get("x-azure-clientip");
  if (azure && azure.trim()) return sinPuerto(azure);
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const ultimo = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .pop();
    if (ultimo) return sinPuerto(ultimo);
  }
  return headers.get("x-real-ip")?.trim() || "local";
}
