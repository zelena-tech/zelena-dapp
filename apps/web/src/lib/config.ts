// Constantes de la fase Génesis (Milestone 1). Valores en decision log.

function founderWallet(): string {
  const w = process.env.FOUNDER_WALLET;
  const building = process.env.NEXT_PHASE === "phase-production-build";
  if (!w && process.env.NODE_ENV === "production" && !building) {
    // El fallback demo en producción permitiria suplantar al founder (hallazgo Alta #2).
    throw new Error("FOUNDER_WALLET ausente. Configúralo antes de desplegar.");
  }
  return w ?? "GA7ZELENAFOUNDERDEMOWALLET000000000000000000000000000AAA";
}
export const FOUNDER_WALLET = founderWallet();

// CLA_VERSION es legal, no evolutivo: NO va en el genoma (WP02).
export const CLA_VERSION = 1;

// NOTA (WP02): los parámetros EVOLUTIVOS del sistema (EPOCH_BUDGET, ACADEMIA_*,
// TIER_INVITE_CAPS) ya NO viven aquí. Son configuración versionada en DB: léelos
// SIEMPRE vía getActiveGenome() de lib/genome.ts. Nunca hardcodees valores nuevos.

// ---------------------------------------------------------------------------
// Puerta corporativa: Microsoft Entra ID (WP13)
// ---------------------------------------------------------------------------
// Todas estas funciones leen `process.env` EN CADA LLAMADA, a propósito:
//  - permiten testear el flag encendido y apagado sin recargar módulos;
//  - evitan que el build congele un valor (el flag se enciende en Azure App
//    Settings sin recompilar, que es justo el flujo del paso 4 de DESPLIEGUE-V1).
// Aquí NO se lee ningún secreto fuera de `process.env` ni se escribe en disco.

/** Dominio corporativo de Zelena. Configurable para no hardcodear el tenant en tests. */
export function corporateDomain(): string {
  return (process.env.ZELENA_CORPORATE_DOMAIN ?? "zelena.tech").trim().toLowerCase();
}

/**
 * Feature flag de la puerta corporativa. APAGADO por defecto: mientras John no
 * cree el app registration (paso A1) el flujo de invitación + wallet es el único
 * camino y no cambia en nada.
 */
export function isEntraEnabled(): boolean {
  const v = (process.env.AUTH_ENTRA_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export interface EntraSettings {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

/** Variables que faltan para poder encender el flag (para diagnóstico, sin valores). */
export function entraMissingVars(): string[] {
  const missing: string[] = [];
  if (!process.env.AZURE_AD_CLIENT_ID) missing.push("AZURE_AD_CLIENT_ID");
  if (!process.env.AZURE_AD_CLIENT_SECRET) missing.push("AZURE_AD_CLIENT_SECRET");
  if (!process.env.AZURE_AD_TENANT_ID) missing.push("AZURE_AD_TENANT_ID");
  if (!process.env.NEXTAUTH_SECRET) missing.push("NEXTAUTH_SECRET");
  return missing;
}

/** Credenciales de Entra, o `null` si falta alguna. Nunca se registran en logs. */
export function entraSettings(): EntraSettings | null {
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;
  const tenantId = process.env.AZURE_AD_TENANT_ID;
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

/** Estado de la puerta corporativa para la UI y el diagnóstico. Sin secretos. */
export function entraStatus(): { enabled: boolean; configured: boolean; missing: string[] } {
  const missing = entraMissingVars();
  return { enabled: isEntraEnabled(), configured: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Asistente de Telegram (WP19)
// ---------------------------------------------------------------------------
// Mismo patrón que la puerta de Entra: se lee `process.env` EN CADA LLAMADA para
// poder testear el flag encendido y apagado sin recargar módulos, y para que el
// build no congele un valor. Ningún secreto se lee fuera de `process.env` ni se
// escribe en disco o en la base de datos.

/**
 * Feature flag del bot. APAGADO por defecto: mientras John no cree el bot con
 * @BotFather (paso A3 de DESPLIEGUE-V1) el scaffolding existe, está testeado con
 * mocks y no atiende ninguna petición real.
 */
export function isTelegramEnabled(): boolean {
  const v = (process.env.TELEGRAM_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Token del bot (Bot API). Nunca se registra en logs ni se guarda en la DB. */
export function telegramBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

/**
 * Secret token del webhook de Telegram. Solo hace falta en Azure: en local el
 * bot corre en modo polling (`getUpdates`) y no hay URL pública que proteger.
 */
export function telegramWebhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET ?? null;
}

/** API key de Anthropic para clasificar los mensajes. */
export function anthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? null;
}

/**
 * Modelo económico para el bot (WP19). Es una decisión de infraestructura, no un
 * parámetro evolutivo del sistema: no va al genoma (mismo criterio que
 * CLA_VERSION). Se puede sobreescribir por entorno sin recompilar.
 */
export const BOT_MODEL_DEFAULT = "claude-haiku-4-5-20251001";

export function botModel(): string {
  return (process.env.ANTHROPIC_BOT_MODEL ?? BOT_MODEL_DEFAULT).trim();
}

/** Variables que faltan para encender el flag (diagnóstico, sin valores). */
export function telegramMissingVars(opts: { webhook?: boolean } = {}): string[] {
  const missing: string[] = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  // El secret del webhook solo es obligatorio en el despliegue (modo webhook).
  if (opts.webhook && !process.env.TELEGRAM_WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  return missing;
}

/** Estado del bot para la UI y el diagnóstico. Sin secretos. */
export function telegramStatus(opts: { webhook?: boolean } = {}): {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  model: string;
} {
  const missing = telegramMissingVars(opts);
  return { enabled: isTelegramEnabled(), configured: missing.length === 0, missing, model: botModel() };
}

export const REPUTATION_AXES = [
  "ejecucion",
  "investigacion",
  "comunidad",
  "gobernanza",
] as const;
export type Axis = (typeof REPUTATION_AXES)[number];

export const AXIS_LABEL: Record<Axis, string> = {
  ejecucion: "Ejecución",
  investigacion: "Investigación / Contenido",
  comunidad: "Comunidad",
  gobernanza: "Gobernanza",
};

/**
 * Código de arranque del founder, para romper el DEADLOCK de un despliegue nuevo.
 *
 * El problema que resuelve: en producción no se siembran las invitaciones de demo
 * (son públicas), y NO existe camino de sesión para un usuario que ya está en la
 * base — `performOnboard` rechaza wallets registradas y la única otra puerta es
 * Entra. Resultado: en una base de producción fresca, si Entra no está configurado
 * o falla, NADIE puede entrar, ni el founder — y no puede emitir invitaciones porque
 * `/admin` exige sesión. Un despliegue capaz de dejarse fuera a sí mismo.
 *
 * ⚠️ ESTE CÓDIGO CONCEDE EL ROL `founder`. Trátalo como una contraseña de root:
 * quien lo tenga se convierte en administrador del sistema. Es de un solo uso (las
 * invitaciones se queman), vive solo en App Settings y exige >= 16 caracteres para
 * no ser adivinable. No reabre el agujero de los códigos GENESIS publicados porque
 * no está publicado en ninguna parte.
 *
 * Se normaliza a MAYÚSCULAS y debe medir entre 16 y 40 caracteres: /entrar pasa el
 * código a mayúsculas (input y `?code=`) y la validación de la API corta en 40. Antes
 * se sembraba tal cual, así que un valor en minúsculas o más largo nunca coincidía y
 * la escotilla quedaba inservible desde la web justo cuando hacía falta.
 *
 * Devuelve null si no está configurado o no cumple el largo.
 */
export const BOOTSTRAP_CODE_MIN = 16;
/** El mismo tope que `code` en `onboardSchema` / `inviteVerifySchema` (validation.ts). */
export const BOOTSTRAP_CODE_MAX = 40;

export function bootstrapInviteCode(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.FOUNDER_BOOTSTRAP_CODE ?? "").trim().toUpperCase();
  if (!raw) return null;
  return raw.length >= BOOTSTRAP_CODE_MIN && raw.length <= BOOTSTRAP_CODE_MAX ? raw : null;
}

/** ¿Este código de invitación es la escotilla de arranque del founder? */
export function isBootstrapCode(code: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const boot = bootstrapInviteCode(env);
  return !!boot && code.trim().toUpperCase() === boot;
}

// ---------------------------------------------------------------------------
// Recordatorios de SLA y su cron (WP31-C1)
// ---------------------------------------------------------------------------
// Mismo patrón que Entra y Telegram: `process.env` se lee EN CADA LLAMADA (se prueba
// la flag encendida y apagada sin recargar módulos, y el build no congela un valor).
// Ningún secreto se registra ni se escribe en disco o en la base.

/**
 * Flag del motor de recordatorios. Gobierna TODO el motor: apagada no escribe ni
 * envía nada. APAGADA por defecto en código; en producción se enciende (`=1`) tras
 * una corrida de simulación (`POST /api/cron/recordatorios?simular=1`).
 */
export function isSlaRemindersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SLA_REMINDERS_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Largo mínimo del secreto del cron: con menos, la ruta responde 503 (`sin_configurar`). */
export const CRON_SECRET_MIN = 32;

/**
 * Secreto que el workflow programado manda en `x-cron-secret`. `null` si falta o tiene
 * menos de `CRON_SECRET_MIN` caracteres. Nunca se registra en logs ni se devuelve.
 */
export function cronSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.CRON_SECRET ?? "").trim();
  return v.length >= CRON_SECRET_MIN ? v : null;
}

/** Host canónico de los enlaces de los mensajes (`ZELENA_APP_URL`), sin barra final. */
export const APP_URL_DEFAULT = "https://www.zelena.tech";

export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const v = (env.ZELENA_APP_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+$/i.test(v) ? v : APP_URL_DEFAULT;
}
