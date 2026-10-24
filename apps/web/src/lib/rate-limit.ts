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

/** ¿Ya se avisó que llega tráfico de Front Door sin `AZURE_FRONT_DOOR_ID`? (una vez por proceso) */
let avisadoSinFrontDoorId = false;

/**
 * ¿La petición viene de NUESTRO Front Door? Front Door escribe (y sobrescribe) `X-Azure-FDID`
 * con el ID de su perfil; se compara con `AZURE_FRONT_DOOR_ID` (Front Door → Overview →
 * "Front Door ID", un GUID). Quien le habla directo a App Service, o pasa por el Front Door de
 * otro, no trae ese ID. Sin la variable configurada no hay con qué comparar: no se confía.
 */
function deNuestroFrontDoor(headers: Headers): boolean {
  const fdid = headers.get("x-azure-fdid")?.trim().toLowerCase();
  if (!fdid) return false;
  const esperado = process.env.AZURE_FRONT_DOOR_ID?.trim().toLowerCase();
  if (!esperado) {
    if (!avisadoSinFrontDoorId) {
      avisadoSinFrontDoorId = true;
      console.warn(
        "[rate-limit] Llega tráfico de Azure Front Door (X-Azure-FDID) pero AZURE_FRONT_DOOR_ID no está " +
          "configurada: no se confía en X-Azure-ClientIP y el límite de intentos agrupa por la IP del borde " +
          "de Front Door. Ver docs/DESPLIEGUE-V1.md, A2."
      );
    }
    return false;
  }
  return fdid === esperado;
}

/**
 * IP del cliente para el límite de intentos, detrás de Azure Front Door.
 *
 *  1. `X-Azure-ClientIP`, SOLO si la petición trae `X-Azure-FDID` igual a
 *     `AZURE_FRONT_DOOR_ID`: la escribe Front Door con la IP que se le conectó. Sin esa
 *     comprobación, quien le hablara directo a App Service (`*.azurewebsites.net`) pondría
 *     ahí lo que quisiera y el límite desaparecería (revisión del release, 2026-10-21). La
 *     restricción de acceso de App Service (etiqueta `AzureFrontDoor.Backend` más la cabecera
 *     `X-Azure-FDID`, docs/DESPLIEGUE-V1.md A2) cierra además la puerta directa.
 *  2. Si no, el ÚLTIMO valor de `X-Forwarded-For`: lo agrega el último proxy (el frontal de
 *     App Service), que es de confianza. El PRIMERO lo puede mandar el propio cliente (con él
 *     se esquivaba el límite: hallazgo M4 de la auditoría).
 *  3. `x-real-ip`, o `"local"` si no hay nada (desarrollo).
 */
export function clientIp(headers: Headers): string {
  if (deNuestroFrontDoor(headers)) {
    const azure = headers.get("x-azure-clientip");
    if (azure && azure.trim()) return sinPuerto(azure);
  }
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
