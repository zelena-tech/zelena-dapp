/**
 * Orquestación del asistente de Telegram (WP19): de un `update` a una respuesta.
 *
 * Reglas que este archivo hace cumplir:
 *  - TODO SE INYECTA. El cliente de Claude, el transporte de Telegram y el
 *    transcriptor son interfaces: la suite corre con dobles y CERO red.
 *  - El modelo solo puede pedir una de las cinco herramientas de lib/bot-tools.ts.
 *    Si pide otra cosa, se rechaza y se registra; si viene con poca confianza o con
 *    datos que no validan, se convierte en una PREGUNTA. El bot no adivina.
 *  - Un `telegram_user_id` no registrado se IGNORA (sin responderle, para no
 *    confirmarle que el bot existe) y queda en el log.
 *  - v1 = solo John escribe. Cualquier otra persona vinculada queda en lectura.
 *  - MINIMIZACIÓN: el texto del mensaje y el audio viven en memoria mientras se
 *    procesa la petición. Lo único que se persiste es la pieza resultante (nota,
 *    borrador, asignación, check-in) y una línea de log sin contenido.
 *  - v1 es 1:1: un update de grupo se ignora (NO-alcance).
 */
import type { DB } from "./db";
import { botModel } from "./config.ts";
import { TeamError, actorFromSession, listInitiatives, today } from "./team.ts";
import {
  BOT_MIN_CONFIDENCE,
  BOT_TOOL_SPECS,
  BotToolError,
  avanzarPieza,
  confirmDraft,
  discardDraft,
  focosDelDia,
  isBotTool,
  isWriteTool,
  renderFocos,
  renderPendientes,
  reordenarFocos,
  runBotTool,
  subirPrioridadPieza,
  type BotContext,
  type BotReply,
  type BotTool,
} from "./bot-tools.ts";
import {
  consumeLinkCode,
  linkForTelegramUser,
  logBotAction,
  normalizeLinkCode,
  type BotOutcome,
} from "./bot-store.ts";
import {
  BOT_COPY,
  answerCallback,
  parseCallbackData,
  parseUpdate,
  sendMessage,
  type BotUpdate,
  type FetchLike,
  type TelegramTransport,
} from "./telegram.ts";

// ---------------------------------------------------------------------------
// Cliente de Claude (inyectable)
// ---------------------------------------------------------------------------

export interface ClaudeDecision {
  /** Nombre de la herramienta que pidió el modelo. `string` a propósito: puede
   *  inventarse una, y ese caso hay que rechazarlo, no confiarlo al tipo. */
  tool: string;
  input: Record<string, unknown>;
}

export interface ClaudeRequest {
  message: string;
  /** Fuerza una herramienta concreta (p. ej. `/nota` siempre es guardar_nota). */
  forceTool?: BotTool;
  /** Contexto de solo lectura para que el modelo resuelva nombres e iniciativas. */
  hints?: string;
}

export interface ClaudeClient {
  decide(req: ClaudeRequest): Promise<ClaudeDecision>;
}

export class BotAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotAgentError";
  }
}

export const BOT_SYSTEM_PROMPT = [
  "Eres el asistente personal de John en la dapp de la Zelena DAO. Tu único trabajo es",
  "traducir lo que él escribe a UNA de las cinco herramientas disponibles. No conversas,",
  "no opinas y no redactas texto libre.",
  "",
  "Reglas:",
  "1. Usa exactamente una herramienta. No existe ninguna otra: no pagas, no cambias",
  "   configuración del sistema, no cierras épocas y no tocas datos de clientes.",
  "2. Si te falta un dato esencial o no estás seguro de lo que se pide, usa no_entendido",
  `   con una pregunta concreta. Nunca rellenes un hueco por tu cuenta. Si tu confianza`,
  `   es menor que ${BOT_MIN_CONFIDENCE}, usa no_entendido.`,
  "3. Solo existen estas personas en el equipo: John, Vale, Juan, David, Fausto y Angela.",
  "   Si el nombre que oyes no es uno de esos, deja el responsable vacío.",
  "4. Nada de lo que propongas se crea solo: la dapp le pide confirmación a John. No",
  "   prometas que ya está hecho.",
  "5. Escribe sobre la pieza de trabajo y la entrega, nunca sobre la persona. No hables de",
  "   horas, ubicación ni disponibilidad de nadie: aquí se sigue por objetivos.",
].join("\n");

/**
 * Cliente real sobre `fetch` (sin SDK: WP19 no añade dependencias). Es lo único de
 * este archivo que abre una conexión y ningún test lo instancia.
 *
 * `tool_choice: {type: "any"}` obliga al modelo a elegir una herramienta del
 * contrato en vez de contestar en prosa.
 */
export function createClaudeClient(opts: {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
  maxTokens?: number;
}): ClaudeClient {
  if (!opts.apiKey) throw new BotAgentError("Falta ANTHROPIC_API_KEY.");
  const model = opts.model ?? botModel();
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async decide(req) {
      const body = {
        model,
        max_tokens: opts.maxTokens ?? 1024,
        system: req.hints ? `${BOT_SYSTEM_PROMPT}\n\n${req.hints}` : BOT_SYSTEM_PROMPT,
        tools: BOT_TOOL_SPECS.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        tool_choice: req.forceTool ? { type: "tool", name: req.forceTool } : { type: "any" },
        messages: [{ role: "user", content: req.message }],
      };
      const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // El cuerpo del error puede traer la petición; no se registra tal cual.
        throw new BotAgentError(`La API de Claude respondió ${res.status}.`);
      }
      const json = (await res.json().catch(() => null)) as { content?: unknown } | null;
      return decisionFromContent(json?.content);
    },
  };
}

/**
 * Extrae la herramienta del `content` de una respuesta de la API. Si no hay ningún
 * bloque `tool_use`, la decisión es preguntar: nunca se interpreta prosa libre como
 * una orden.
 */
export function decisionFromContent(content: unknown): ClaudeDecision {
  if (Array.isArray(content)) {
    for (const raw of content) {
      const block = raw as Record<string, unknown> | null;
      if (block && block.type === "tool_use" && typeof block.name === "string") {
        const input = block.input;
        return {
          tool: block.name,
          input: typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {},
        };
      }
    }
  }
  return { tool: "no_entendido", input: {} };
}

// ---------------------------------------------------------------------------
// Transcripción: la costura (seam), todavía sin proveedor
// ---------------------------------------------------------------------------

export interface VoiceInput {
  fileId: string;
  durationSeconds: number;
}

/**
 * Costura de transcripción. La API de Claude NO transcribe audio y John todavía no
 * ha decidido proveedor ni hay credencial, así que en v1 esto es una interfaz sin
 * implementación real: el flujo completo funciona sobre TEXTO y el audio recibe una
 * respuesta honesta. Cuando haya proveedor, se inyecta aquí y nada más cambia.
 */
export interface Transcriber {
  transcribe(input: VoiceInput): Promise<string>;
}

/** Doble para tests y para dejar el flujo de audio recorrido de punta a punta. */
export function fixedTranscriber(text: string): Transcriber {
  return { transcribe: async () => text };
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

export interface BotDeps {
  db: DB;
  transport: TelegramTransport;
  claude: ClaudeClient;
  /** `null` = todavía no hay proveedor de transcripción (estado real de v1). */
  transcriber?: Transcriber | null;
  now?: Date;
}

export interface HandleResult {
  /** false = el bot no contestó (id no registrado, grupo, update no soportado). */
  attended: boolean;
  reply?: BotReply;
  tool?: BotTool | null;
  outcome: BotOutcome | "sin_accion";
  reason?: string;
}

/**
 * Contexto de solo lectura que se le pasa al modelo para resolver nombres. Sale de
 * `listInitiatives` (WP14), no de una consulta propia.
 */
function hintsFor(db: DB, ctx: BotContext): string {
  const iniciativas = listInitiatives(db);
  return [
    `Hoy es ${today(ctx.now)}.`,
    iniciativas.length > 0 ? `Iniciativas que existen: ${iniciativas.map((i) => i.name).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Punto de entrada único. Devuelve lo que respondió (o por qué no respondió) y deja
 * la línea correspondiente en `bot_actions`.
 */
export async function handleUpdate(deps: BotDeps, raw: unknown): Promise<HandleResult> {
  const db = deps.db;
  const now = deps.now ?? new Date();
  const update = parseUpdate(raw);
  if (!update) return { attended: false, outcome: "sin_accion", reason: "update_no_soportado" };

  // v1 es 1:1. Los ritos grupales siguen en sus canales (NO-alcance).
  if (update.isGroup) {
    logBotAction(db, { action: "mensaje_de_grupo", outcome: "ignorado", detail: "v1 solo atiende conversaciones 1:1" });
    return { attended: false, outcome: "ignorado", reason: "grupo" };
  }

  const link = linkForTelegramUser(db, update.telegramUserId);

  if (!link) {
    const alta = altaConCodigo(update);
    if (alta) return await intentarAlta(deps, update, alta, now);
    // Id no registrado: se ignora y se registra. No se le contesta nada.
    logBotAction(db, {
      senderRef: update.telegramUserId,
      action: "mensaje",
      outcome: "ignorado",
      detail: "telegram_user_id no registrado",
    });
    return { attended: false, outcome: "ignorado", reason: "no_registrado" };
  }

  const ctx: BotContext = {
    actor: actorFromSession(db, { wallet: link.wallet }),
    canWrite: link.is_authorized === 1,
    now,
  };

  try {
    const resultado = await atender(deps, ctx, update);
    if (update.callbackId) await answerCallback(deps.transport, update.callbackId);
    if (resultado.reply) await sendMessage(deps.transport, update.chatId, resultado.reply);
    return resultado;
  } catch (e) {
    const esperado = e instanceof BotToolError || e instanceof TeamError;
    const texto = esperado ? (e as Error).message : BOT_COPY.errorInterno;
    logBotAction(db, {
      wallet: ctx.actor.wallet,
      action: "error",
      outcome: "error",
      detail: esperado ? texto : (e as Error).name,
    });
    if (update.callbackId) await answerCallback(deps.transport, update.callbackId);
    await sendMessage(deps.transport, update.chatId, { text: texto });
    return { attended: true, outcome: "error", reply: { text: texto } };
  }
}

function altaConCodigo(update: BotUpdate): string | null {
  if (update.kind !== "texto") return null;
  const m = /^\/start(?:@\w+)?\s+(\S+)/i.exec(update.text.trim());
  return m ? normalizeLinkCode(m[1]) : null;
}

async function intentarAlta(
  deps: BotDeps,
  update: BotUpdate,
  code: string,
  now: Date
): Promise<HandleResult> {
  const res = consumeLinkCode(deps.db, code, update.telegramUserId, now);
  if (!res.ok) {
    const texto = res.reason === "telegram_ya_vinculado" ? BOT_COPY.yaVinculado : BOT_COPY.codigoInvalido;
    logBotAction(deps.db, {
      senderRef: update.telegramUserId,
      action: "alta",
      outcome: "rechazado",
      detail: res.reason,
    });
    await sendMessage(deps.transport, update.chatId, { text: texto });
    return { attended: true, outcome: "rechazado", reply: { text: texto }, reason: res.reason };
  }
  logBotAction(deps.db, { wallet: res.link.wallet, action: "alta", outcome: "ok", detail: "vínculo creado" });
  const texto = `${BOT_COPY.bienvenida}\n\n${BOT_COPY.ayuda}`;
  await sendMessage(deps.transport, update.chatId, { text: texto });
  return { attended: true, outcome: "ok", reply: { text: texto } };
}

async function atender(deps: BotDeps, ctx: BotContext, update: BotUpdate): Promise<HandleResult> {
  if (update.kind === "boton") return atenderBoton(deps, ctx, update);

  let texto = update.text;
  if (update.kind === "audio") {
    const transcriptor = deps.transcriber ?? null;
    if (!transcriptor || !update.voice) {
      logBotAction(deps.db, {
        wallet: ctx.actor.wallet,
        action: "audio",
        outcome: "rechazado",
        detail: "sin proveedor de transcripción",
      });
      return { attended: true, outcome: "rechazado", reply: { text: BOT_COPY.sinTranscripcion } };
    }
    // El texto transcrito vive en esta variable y en ningún campo de la base: solo
    // la pieza resultante se persiste.
    texto = await transcriptor.transcribe(update.voice);
    if (!texto.trim()) {
      return { attended: true, outcome: "no_entendido", reply: { text: BOT_COPY.noEntendido } };
    }
  }

  const resultado = atenderComando(deps, ctx, texto) ?? (await atenderConModelo(deps, ctx, texto));
  if (update.kind === "audio" && resultado.reply) {
    // Se le devuelve lo que se entendió para que pueda corregir antes de confirmar.
    return {
      ...resultado,
      reply: { ...resultado.reply, text: `${BOT_COPY.audioTranscrito} «${texto}»\n\n${resultado.reply.text}` },
    };
  }
  return resultado;
}

async function atenderBoton(deps: BotDeps, ctx: BotContext, update: BotUpdate): Promise<HandleResult> {
  const cb = parseCallbackData(update.callbackData);
  if (!cb) return { attended: true, outcome: "rechazado", reply: { text: BOT_COPY.borradorNoEncontrado } };

  if (cb.accion === "editar") {
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: "borrador_editar",
      outcome: "ok",
      target: `borrador:${cb.draftId}`,
    });
    return { attended: true, outcome: "ok", reply: { text: BOT_COPY.editarComo } };
  }

  const res =
    cb.accion === "confirmar" ? confirmDraft(deps.db, ctx, cb.draftId) : discardDraft(deps.db, ctx, cb.draftId);
  logBotAction(deps.db, {
    wallet: ctx.actor.wallet,
    action: cb.accion === "confirmar" ? "borrador_confirmar" : "borrador_descartar",
    outcome: res.outcome,
    target: res.target ?? `borrador:${cb.draftId}`,
    detail: res.detail ?? null,
  });
  return { attended: true, outcome: res.outcome, reply: res.reply };
}

// Los comandos se reconocen con anclas estrictas para no secuestrar una captura
// normal: «pendiente con Hogar Center: revisar propuesta» NO es `/pendientes`.
const RE_PENDIENTES = /^(?:\/pendientes(?:@\w+)?|pendientes)\s*([\wáéíóúñ-]{0,40})\s*$/i;
const RE_FOCOS = /^(?:\/focos(?:@\w+)?|focos)\s*([\d\s,]*)$/i;
const RE_AVANZAR =
  /^(?:\/avanzar|avanza|cierra|cerrar|ci[eé]rralo|ci[eé]rrala)(?:\s+(?:la|el))?\s*#?(\d+)\s*$/i;
const RE_PRIORIDAD =
  /^(?:\/prioridad|sube\s+la\s+prioridad(?:\s+de)?|s[uú]bele\s+la\s+prioridad(?:\s+a)?)\s*#?(\d+)\s*$/i;
/** "eso ya está, ciérralo" sin número: se pregunta cuál, no se adivina. */
const RE_CERRAR_SIN_ID = /^(?:eso\s+ya\s+est[aá].*|ya\s+est[aá]\s+(?:hecho|lista?|hecha)|ci[eé]rra(?:lo|la))\.?$/i;
const RE_NOTA = /^\/nota(?:@\w+)?\s+([\s\S]+)$/i;
const RE_AYUDA = /^\/(?:ayuda|help)(?:@\w+)?\s*$/i;
/** `/start` de alguien YA vinculado (con o sin código): no hay nada que vincular. */
const RE_START = /^\/start(?:@\w+)?(?:\s+\S+)?\s*$/i;
const RE_OK = /^(?:ok|vale|listo|as[ií]\s+est[aá]\s+bien)\.?$/i;

/**
 * Comandos DETERMINISTAS: no pasan por el modelo. Menos superficie generativa,
 * menos coste y respuestas idénticas a las de la web.
 */
function atenderComando(deps: BotDeps, ctx: BotContext, texto: string): HandleResult | null {
  const t = texto.trim();

  if (RE_AYUDA.test(t)) {
    logBotAction(deps.db, { wallet: ctx.actor.wallet, action: "ayuda", outcome: "ok" });
    return { attended: true, outcome: "ok", reply: { text: BOT_COPY.ayuda } };
  }

  if (RE_START.test(t)) {
    logBotAction(deps.db, { wallet: ctx.actor.wallet, action: "alta", outcome: "ok", detail: "ya estaba vinculado" });
    return { attended: true, outcome: "ok", reply: { text: `${BOT_COPY.yaVinculado}\n\n${BOT_COPY.ayuda}` } };
  }

  const pendientes = RE_PENDIENTES.exec(t);
  if (pendientes) {
    const filtro = pendientes[1]?.trim() || undefined;
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: "pendientes",
      outcome: "ok",
      target: filtro ?? "todo",
    });
    return { attended: true, outcome: "ok", reply: { text: renderPendientes(deps.db, ctx, filtro) } };
  }

  const focos = RE_FOCOS.exec(t);
  if (focos) {
    const propuesta = focosDelDia(deps.db, ctx);
    const orden = (focos[1] ?? "")
      .split(/[\s,]+/)
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (orden.length > 0) {
      const reordenados = reordenarFocos(propuesta, orden);
      logBotAction(deps.db, {
        wallet: ctx.actor.wallet,
        action: "focos_reordenados",
        outcome: "ok",
        detail: reordenados.map((a) => `#${a.id}`).join(" "),
      });
      return {
        attended: true,
        outcome: "ok",
        reply: { text: [BOT_COPY.focosReordenados, renderFocos(reordenados)].join("\n") },
      };
    }
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: "focos",
      outcome: "ok",
      detail: propuesta.map((a) => `#${a.id}`).join(" "),
    });
    return { attended: true, outcome: "ok", reply: { text: renderFocos(propuesta) } };
  }

  if (RE_OK.test(t)) {
    logBotAction(deps.db, { wallet: ctx.actor.wallet, action: "focos_confirmados", outcome: "ok" });
    return { attended: true, outcome: "ok", reply: { text: BOT_COPY.focosConfirmados } };
  }

  if (RE_CERRAR_SIN_ID.test(t)) {
    logBotAction(deps.db, { wallet: ctx.actor.wallet, action: "cerrar_sin_id", outcome: "no_entendido" });
    return {
      attended: true,
      outcome: "no_entendido",
      reply: { text: "¿Cuál cierro? Dime el número, por ejemplo «cierra 12». Con /pendientes te los listo." },
    };
  }

  const avanzar = RE_AVANZAR.exec(t);
  if (avanzar) {
    if (!ctx.canWrite) return rechazoSoloLectura(deps, ctx, "avanzar");
    const reply = avanzarPieza(deps.db, ctx, Number.parseInt(avanzar[1], 10));
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: "avanzar",
      outcome: "ok",
      target: `asignacion:${avanzar[1]}`,
    });
    return { attended: true, outcome: "ok", reply };
  }

  const prioridad = RE_PRIORIDAD.exec(t);
  if (prioridad) {
    if (!ctx.canWrite) return rechazoSoloLectura(deps, ctx, "prioridad");
    const reply = subirPrioridadPieza(deps.db, ctx, Number.parseInt(prioridad[1], 10));
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: "prioridad",
      outcome: "ok",
      target: `asignacion:${prioridad[1]}`,
    });
    return { attended: true, outcome: "ok", reply };
  }

  return null;
}

function rechazoSoloLectura(deps: BotDeps, ctx: BotContext, action: string): HandleResult {
  logBotAction(deps.db, {
    wallet: ctx.actor.wallet,
    action,
    outcome: "rechazado",
    detail: "sin permiso de escritura en v1",
  });
  return { attended: true, outcome: "rechazado", reply: { text: BOT_COPY.soloLectura } };
}

/**
 * Camino con modelo: una llamada, una herramienta. Cualquier desvío —herramienta
 * inventada, datos que no validan, confianza baja— termina en una pregunta y en el
 * log, nunca en una escritura.
 */
async function atenderConModelo(deps: BotDeps, ctx: BotContext, texto: string): Promise<HandleResult> {
  const nota = RE_NOTA.exec(texto.trim());
  const req: ClaudeRequest = nota
    ? { message: nota[1], forceTool: "guardar_nota", hints: hintsFor(deps.db, ctx) }
    : { message: texto, forceTool: undefined, hints: hintsFor(deps.db, ctx) };

  let decision: ClaudeDecision;
  try {
    decision = await deps.claude.decide(req);
  } catch (e) {
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: "clasificar",
      outcome: "error",
      detail: (e as Error).name,
    });
    return { attended: true, outcome: "error", reply: { text: BOT_COPY.errorInterno } };
  }

  if (!isBotTool(decision.tool)) {
    // Herramienta inventada: se rechaza y se pregunta. No hay casilla donde correrla.
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: "herramienta_desconocida",
      outcome: "rechazado",
      detail: decision.tool.slice(0, 60),
    });
    return {
      attended: true,
      outcome: "rechazado",
      tool: null,
      reply: { text: `${BOT_COPY.noEntendido} ¿Me lo dices de otra forma?` },
    };
  }

  if (isWriteTool(decision.tool) && confianzaBaja(decision.input)) {
    logBotAction(deps.db, {
      wallet: ctx.actor.wallet,
      action: decision.tool,
      outcome: "no_entendido",
      detail: "confianza por debajo del umbral",
    });
    return {
      attended: true,
      outcome: "no_entendido",
      tool: "no_entendido",
      reply: { text: `${BOT_COPY.noEntendido} ¿Me lo confirmas con más detalle?` },
    };
  }

  let salida;
  try {
    salida = runBotTool(deps.db, ctx, decision.tool, decision.input);
  } catch (e) {
    if (e instanceof BotToolError) {
      // Faltan datos: se pregunta, no se rellena el hueco.
      logBotAction(deps.db, {
        wallet: ctx.actor.wallet,
        action: decision.tool,
        outcome: "no_entendido",
        detail: e.message,
      });
      return {
        attended: true,
        outcome: "no_entendido",
        tool: "no_entendido",
        reply: { text: `${BOT_COPY.noEntendido} ${e.message}` },
      };
    }
    throw e;
  }

  logBotAction(deps.db, {
    wallet: ctx.actor.wallet,
    action: salida.tool,
    outcome: salida.outcome,
    target: salida.target ?? null,
    detail: salida.detail ?? null,
  });
  return { attended: true, outcome: salida.outcome, tool: salida.tool, reply: salida.reply };
}

export function confianzaBaja(input: Record<string, unknown>): boolean {
  const c = input.confianza;
  return typeof c === "number" && c < BOT_MIN_CONFIDENCE;
}
