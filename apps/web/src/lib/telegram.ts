/**
 * Protocolo y transporte de Telegram (WP19). Capa DELGADA y sin base de datos:
 * verifica el secret del webhook, normaliza un `update` y sabe enviar mensajes.
 * Toda la lógica de negocio vive en lib/bot-tools.ts y lib/bot-agent.ts.
 *
 * Reglas que este archivo hace cumplir:
 *  - El secret token del webhook se compara en TIEMPO CONSTANTE y una petición
 *    sin él se rechaza (criterio de WP19). El token del bot no se registra nunca.
 *  - El transporte es una INTERFAZ inyectable: los tests corren con un doble y
 *    cero red. `createTelegramTransport` es la única cosa que habla con fetch.
 *  - Copys: se habla de ENTREGAS y de piezas de trabajo. Aquí no hay ni puede
 *    haber horas, ubicación ni telemetría de presencia (NO-alcance de WP19), ni un
 *    solo texto que juzgue a una persona (doc 16).
 *  - Los mensajes crudos no se guardan: este módulo los normaliza en memoria y
 *    los entrega; quien decide qué persistir es bot-agent, y solo la pieza
 *    resultante.
 */
import { timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Secret token del webhook
// ---------------------------------------------------------------------------

/** Header con el que Telegram firma cada petición al webhook. */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Comparación en tiempo constante de dos cadenas. `timingSafeEqual` exige buffers
 * del mismo largo, así que la diferencia de longitud se resuelve comparando el
 * buffer contra sí mismo (trabajo equivalente) y devolviendo `false`: no se filtra
 * la longitud del secreto por el tiempo de respuesta.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export type WebhookRejection =
  | "sin_secret_configurado"
  | "header_ausente"
  | "secret_incorrecto";

export type WebhookCheck = { ok: true } | { ok: false; reason: WebhookRejection };

/**
 * Valida el secret token en CADA petición del webhook.
 *
 * Si no hay secret configurado en el entorno se RECHAZA: un webhook público sin
 * secreto es un endpoint anónimo que escribe en la base de datos. Preferimos que
 * el despliegue falle ruidoso a aceptar cualquiera.
 */
export function verifyWebhookSecret(headerValue: string | null | undefined, expected: string | null | undefined): WebhookCheck {
  const secret = (expected ?? "").trim();
  if (!secret) return { ok: false, reason: "sin_secret_configurado" };
  const given = headerValue ?? "";
  if (!given) return { ok: false, reason: "header_ausente" };
  if (!constantTimeEquals(given, secret)) return { ok: false, reason: "secret_incorrecto" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Update normalizado
// ---------------------------------------------------------------------------

export type BotUpdateKind = "texto" | "audio" | "boton";

export interface VoiceRef {
  fileId: string;
  /** Duración que reporta Telegram. Se usa para decidir si es una nota larga,
   *  no para medir a nadie: no se persiste. */
  durationSeconds: number;
}

export interface BotUpdate {
  updateId: number;
  kind: BotUpdateKind;
  chatId: number;
  telegramUserId: string;
  /** Texto del mensaje (vacío en audio y en botón). */
  text: string;
  /** `callback_data` del botón pulsado. */
  callbackData: string | null;
  /** Id del callback, para responderle a Telegram y quitar el reloj de arena. */
  callbackId: string | null;
  voice: VoiceRef | null;
  /** true si el update llega de un grupo/canal: v1 es 1:1 y se ignora. */
  isGroup: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function numberOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Normaliza un `update` de la Bot API a la forma mínima que usa el bot. Devuelve
 * `null` para cualquier cosa que no sepamos atender (ediciones, stickers, un
 * miembro nuevo en un canal…) en vez de adivinar.
 */
export function parseUpdate(raw: unknown): BotUpdate | null {
  const root = asRecord(raw);
  if (!root) return null;
  const updateId = numberOf(root.update_id) ?? 0;

  const cb = asRecord(root.callback_query);
  if (cb) {
    const from = asRecord(cb.from);
    const msg = asRecord(cb.message);
    const chat = msg ? asRecord(msg.chat) : null;
    const userId = from ? numberOf(from.id) : null;
    const chatId = chat ? numberOf(chat.id) : null;
    if (userId === null || chatId === null) return null;
    return {
      updateId,
      kind: "boton",
      chatId,
      telegramUserId: String(userId),
      text: "",
      callbackData: typeof cb.data === "string" ? cb.data : null,
      callbackId: typeof cb.id === "string" ? cb.id : null,
      voice: null,
      isGroup: chatType(chat) !== "private",
    };
  }

  const msg = asRecord(root.message);
  if (!msg) return null;
  const from = asRecord(msg.from);
  const chat = asRecord(msg.chat);
  const userId = from ? numberOf(from.id) : null;
  const chatId = chat ? numberOf(chat.id) : null;
  if (userId === null || chatId === null) return null;
  const isGroup = chatType(chat) !== "private";

  const voice = asRecord(msg.voice) ?? asRecord(msg.audio);
  if (voice && typeof voice.file_id === "string") {
    return {
      updateId,
      kind: "audio",
      chatId,
      telegramUserId: String(userId),
      text: "",
      callbackData: null,
      callbackId: null,
      voice: { fileId: voice.file_id, durationSeconds: numberOf(voice.duration) ?? 0 },
      isGroup,
    };
  }

  const text = typeof msg.text === "string" ? msg.text : typeof msg.caption === "string" ? msg.caption : "";
  if (!text.trim()) return null;
  return {
    updateId,
    kind: "texto",
    chatId,
    telegramUserId: String(userId),
    text,
    callbackData: null,
    callbackId: null,
    voice: null,
    isGroup,
  };
}

function chatType(chat: Record<string, unknown> | null): string {
  return chat && typeof chat.type === "string" ? chat.type : "private";
}

// ---------------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------------

export interface InlineButton {
  text: string;
  data: string;
}
export type InlineKeyboard = InlineButton[][];

/** Prefijos de `callback_data`. Cortos: Telegram limita a 64 bytes. */
export const CALLBACK = { confirmar: "ok", editar: "ed", descartar: "no" } as const;

export function draftKeyboard(draftId: number): InlineKeyboard {
  return [
    [
      { text: "Confirmar", data: `${CALLBACK.confirmar}:${draftId}` },
      { text: "Editar", data: `${CALLBACK.editar}:${draftId}` },
      { text: "Descartar", data: `${CALLBACK.descartar}:${draftId}` },
    ],
  ];
}

export interface ParsedCallback {
  accion: "confirmar" | "editar" | "descartar";
  draftId: number;
}

export function parseCallbackData(data: string | null): ParsedCallback | null {
  if (!data) return null;
  const [prefix, rawId] = data.split(":");
  const draftId = Number.parseInt(rawId ?? "", 10);
  if (!Number.isInteger(draftId) || draftId <= 0) return null;
  if (prefix === CALLBACK.confirmar) return { accion: "confirmar", draftId };
  if (prefix === CALLBACK.editar) return { accion: "editar", draftId };
  if (prefix === CALLBACK.descartar) return { accion: "descartar", draftId };
  return null;
}

// ---------------------------------------------------------------------------
// Transporte (inyectable: cero red en los tests)
// ---------------------------------------------------------------------------

export interface TelegramTransport {
  /** Llama un método de la Bot API. Devuelve el `result` crudo. */
  call(method: string, payload: Record<string, unknown>): Promise<unknown>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramError";
  }
}

/**
 * Transporte real sobre `fetch`. Es lo ÚNICO de WP19 que abre una conexión, y por
 * eso está aislado detrás de la interfaz: ni un test lo instancia.
 * El token va en la URL (así funciona la Bot API) y NUNCA en un mensaje de error.
 */
export function createTelegramTransport(token: string, fetchImpl: FetchLike = fetch): TelegramTransport {
  if (!token) throw new TelegramError("Falta TELEGRAM_BOT_TOKEN.");
  return {
    async call(method, payload) {
      const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !body || body.ok !== true) {
        const desc = body && typeof body.description === "string" ? body.description : `HTTP ${res.status}`;
        throw new TelegramError(`Telegram rechazó ${method}: ${desc}`);
      }
      return body.result;
    },
  };
}

export interface OutgoingMessage {
  text: string;
  keyboard?: InlineKeyboard;
}

export async function sendMessage(
  transport: TelegramTransport,
  chatId: number,
  message: OutgoingMessage
): Promise<void> {
  const payload: Record<string, unknown> = { chat_id: chatId, text: message.text };
  if (message.keyboard && message.keyboard.length > 0) {
    payload.reply_markup = {
      inline_keyboard: message.keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
    };
  }
  await transport.call("sendMessage", payload);
}

/** Quita el reloj de arena del botón. Sin texto: el mensaje va aparte. */
export async function answerCallback(transport: TelegramTransport, callbackId: string): Promise<void> {
  await transport.call("answerCallbackQuery", { callback_query_id: callbackId });
}

/** Modo polling (desarrollo local): no necesita URL pública ni secret. */
export async function getUpdates(
  transport: TelegramTransport,
  offset: number,
  timeoutSeconds = 25
): Promise<unknown[]> {
  const result = await transport.call("getUpdates", {
    offset,
    timeout: timeoutSeconds,
    allowed_updates: ["message", "callback_query"],
  });
  return Array.isArray(result) ? result : [];
}

// ---------------------------------------------------------------------------
// Copys — auditados (doc 16 + NO-alcance de WP19)
// ---------------------------------------------------------------------------

/**
 * TODOS los textos del bot viven aquí, en un solo objeto, para que el test de
 * vocabulario los pueda recorrer entero. Se habla de la pieza de trabajo y de la
 * entrega; nunca de la persona, sus horas o su disponibilidad.
 */
export const BOT_COPY = {
  bienvenida:
    "Listo, quedaste vinculado. Escríbeme lo que haya que capturar y te lo propongo antes de crear nada.",
  ayuda: [
    "Esto es lo que sé hacer:",
    "· Escríbeme una tarea y te la propongo estructurada; nada se crea sin que confirmes.",
    "· /pendientes — todo tu trabajo abierto, agrupado por iniciativa. /pendientes wms para filtrar.",
    "· /focos — las 3 prioridades del día, para confirmar o reordenar.",
    "· /nota <texto> — guarda una nota de reunión y te devuelvo el resumen.",
    "· /avanzar N y /prioridad N — mueve la pieza N del tablero.",
    "· Pregúntame qué está bloqueado o cómo va una iniciativa.",
  ].join("\n"),
  codigoInvalido: "Ese código no sirve: o ya se usó, o venció, o no es el que generó la dapp.",
  codigoConsumido: "Ese código ya se usó. Genera otro en la dapp.",
  yaVinculado: "Esta cuenta de Telegram ya está vinculada.",
  soloLectura:
    "En esta versión solo John escribe en el tablero desde Telegram. Puedo mostrarte lo tuyo, pero no crear ni mover piezas.",
  sinTranscripcion: [
    "Todavía no puedo convertir audio a texto: falta decidir el proveedor de transcripción.",
    "Escríbeme el mismo contenido y lo capturo igual.",
  ].join(" "),
  audioTranscrito: "Escuché el audio. Esto entendí:",
  noEntendido: "No me quedó claro y prefiero no adivinar.",
  confirmarPregunta: "¿Lo creo así?",
  creada: "Creada.",
  descartada: "Descartada. No quedó nada en el tablero.",
  editarComo:
    "Dime qué cambio y te la vuelvo a proponer. También puedes reescribirla completa.",
  borradorNoEncontrado: "Ese borrador ya no está disponible. Vuelve a proponerlo y lo creamos.",
  borradorResuelto: "Ese borrador ya estaba resuelto.",
  sinPendientes: "No tienes trabajo abierto. Todo lo tuyo está cerrado o sin asignar.",
  sinBloqueos: "No hay nada bloqueado ahora mismo.",
  sinEsperandoAJohn: "Nada está esperando una decisión tuya.",
  sinFocos: "No hay piezas abiertas para proponer focos hoy.",
  focosCabecera: "Tus 3 focos de hoy, por vencimiento, prioridad y lo que espera una decisión tuya:",
  focosReordenados: "Anotado, en ese orden:",
  focosConfirmados: "Confirmado.",
  notaGuardada: "Nota guardada.",
  tareasDetectadas: "Vi posibles tareas en la nota. Te las propongo una por una.",
  checkinGuardado: "Check-in del día guardado.",
  errorInterno: "Algo falló de mi lado y no hice el cambio. Vuelve a intentarlo.",
  sinPermisoPieza: "Esa pieza no es tuya y no puedo moverla desde aquí.",
  piezaNoEncontrada: "No encuentro esa pieza.",
  yaEnMaximaPrioridad: "Esa pieza ya está en la prioridad más alta.",
  yaHecha: "Esa entrega ya está aprobada.",
  sinAccionDisponible: "Esa pieza está bloqueada; primero hay que destrabarla en el tablero.",
} as const;
