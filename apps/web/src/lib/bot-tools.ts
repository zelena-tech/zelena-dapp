/**
 * Las CINCO herramientas del asistente de Telegram (WP19) y nada más.
 *
 *   crear_asignacion · registrar_checkin · guardar_nota · consultar_estado · no_entendido
 *
 * Reglas que este archivo hace cumplir:
 *  - LÍMITE ESTRUCTURAL, no una promesa en un comentario: `BOT_DISPATCH` es una
 *    tabla CONGELADA con exactamente cinco entradas y `runBotTool` solo despacha
 *    por una clave que pasó `isBotTool`. Una herramienta inventada por el modelo
 *    no encuentra dónde ejecutarse: se rechaza. El bot no paga, no cambia el
 *    genoma, no cierra épocas y no toca clientes ni credenciales porque no existe
 *    la casilla desde la que hacerlo.
 *  - NADA SE CREA SIN CONFIRMACIÓN. Las tres herramientas de escritura devuelven
 *    un BORRADOR (lib/bot-store.ts) con botones. La única función de todo WP19 que
 *    escribe en `assignments`/`checkins`/`notes` es `confirmDraft`.
 *  - CERO AGREGADOS NUEVOS. El estado sale de lib/dashboard.ts (WP15) y de
 *    lib/team.ts (WP14): las mismas funciones que pinta la web, así que el bot
 *    devuelve exactamente lo que muestra el tablero. Los cambios de estado pasan
 *    por la máquina pura de lib/team-state-machine.ts.
 *  - Doc 16 y NO-alcance de WP19: se califican ENTREGAS. Ninguna respuesta mide
 *    horas, ubicación ni disponibilidad de nadie, y ninguna juzga a una persona.
 */
import { z } from "zod";
import type { DB } from "./db";
import { dailyFocusHour } from "./genome.ts";
import { puedeVerTodoElEquipo, findRosterMember, type TeamActor } from "./roles.ts";
import type { EquipoActor } from "./authz";
import { walletDeRoster } from "./talento.ts";
import { availableTeamActions, type TeamAction } from "./team-state-machine.ts";
import {
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  SIZES,
  TeamError,
  applyAssignmentAction,
  assignmentsForOwner,
  checkinSchema,
  createAssignment,
  getAssignment,
  listInitiatives,
  listTeamMembers,
  ownProgress,
  slugify,
  today,
  upsertCheckin,
  visibleAssignments,
  type AssignmentView,
  type Priority,
  type Size,
} from "./team.ts";
import {
  blockedWithAge,
  buildDashboard,
  epochSnapshot,
  founderInbox,
  initiativeBars,
  loadByPerson,
  riteHealth,
  LOAD_PURPOSE,
} from "./dashboard.ts";
import { buildTodayDigest, renderDigestText } from "./digest.ts";
import {
  createDraft,
  draftPayload,
  getDraft,
  resolveDraft,
  saveNote,
  type BotDraftRow,
  type BotOutcome,
} from "./bot-store.ts";
import { BOT_COPY, draftKeyboard, type InlineKeyboard } from "./telegram.ts";

// ---------------------------------------------------------------------------
// Vocabulario cerrado de herramientas
// ---------------------------------------------------------------------------

export const BOT_TOOLS = [
  "crear_asignacion",
  "registrar_checkin",
  "guardar_nota",
  "consultar_estado",
  "no_entendido",
] as const;
export type BotTool = (typeof BOT_TOOLS)[number];

/** Las que escriben. Requieren confirmación Y autorización (v1: solo John). */
export const WRITE_TOOLS = ["crear_asignacion", "registrar_checkin", "guardar_nota"] as const;
export type BotWriteTool = (typeof WRITE_TOOLS)[number];

export function isBotTool(v: unknown): v is BotTool {
  return typeof v === "string" && (BOT_TOOLS as readonly string[]).includes(v);
}

/** Estrecha el tipo: así el `switch` de `confirmDraft` es exhaustivo por
 *  construcción y una herramienta nueva no puede colarse sin compilar. */
export function isWriteTool(t: BotTool): t is BotWriteTool {
  return (WRITE_TOOLS as readonly BotTool[]).includes(t);
}

export class BotToolError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BotToolError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Entrada validada
// ---------------------------------------------------------------------------

const ESTADO_SCOPES = [
  "bloqueos",
  "esperando_a_mi",
  "iniciativas",
  "carga",
  "epoca",
  "ritos",
  "digest",
  "mis_pendientes",
  "equipo",
  "todo",
] as const;
export type EstadoScope = (typeof ESTADO_SCOPES)[number];

export const crearAsignacionSchema = z.object({
  titulo: z.string().trim().min(3).max(200),
  descripcion: z.string().trim().max(2000).optional(),
  responsable: z.string().trim().max(60).optional(),
  iniciativa: z.string().trim().max(80).optional(),
  prioridad: z.enum(PRIORITIES).optional(),
  tamano: z.enum(SIZES).optional(),
  fecha_limite: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va en formato YYYY-MM-DD.")
    .optional(),
  criterios_aceptacion: z.string().trim().max(1000).optional(),
  necesita_a_john: z.boolean().optional(),
  /** Qué tan seguro está el modelo (0-1). Por debajo del umbral se pregunta. */
  confianza: z.number().min(0).max(1).optional(),
  /** Tareas que quedan en la cola de una nota, para proponerlas una a una. */
  cola_tareas: z.array(z.string().trim().min(3).max(200)).max(20).optional(),
});
export type CrearAsignacionInput = z.infer<typeof crearAsignacionSchema>;

/** El modelo habla español; el modelo de datos de WP14 usa done/doing/blocked. */
export const registrarCheckinSchema = z.object({
  hecho: z.string().trim().max(1000).optional(),
  haciendo: z.string().trim().max(1000).optional(),
  bloqueado: z.string().trim().max(1000).optional(),
  confianza: z.number().min(0).max(1).optional(),
});

export const guardarNotaSchema = z.object({
  texto: z.string().trim().min(3).max(8000),
  resumen: z.string().trim().max(1000).optional(),
  referencia_reunion: z.string().trim().max(120).optional(),
  tareas: z.array(z.string().trim().min(3).max(200)).max(20).optional(),
  confianza: z.number().min(0).max(1).optional(),
});

export const consultarEstadoSchema = z.object({
  alcance: z.enum(ESTADO_SCOPES),
  iniciativa: z.string().trim().max(80).optional(),
});

export const noEntendidoSchema = z.object({
  pregunta: z.string().trim().max(300).optional(),
});

// ---------------------------------------------------------------------------
// Contrato de herramientas para la API de Claude
// ---------------------------------------------------------------------------

export interface BotToolSpec {
  name: BotTool;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Umbral de confianza: por debajo de esto el bot PREGUNTA en vez de adivinar.
 * No es un parámetro evolutivo del sistema (no reparte puntos ni afecta a ninguna
 * época), así que no va al genoma — mismo criterio que el vocabulario de
 * prioridades de WP14 o `CLA_VERSION`.
 */
export const BOT_MIN_CONFIDENCE = 0.6;

const CONFIANZA_PROPERTY = {
  type: "number",
  description: `De 0 a 1: qué tan seguro estás de haber entendido. Si es menor que ${BOT_MIN_CONFIDENCE}, usa no_entendido en vez de esta herramienta.`,
} as const;

/**
 * Los esquemas que se le mandan al modelo. Se escriben a mano (JSON Schema plano)
 * a propósito: WP19 no añade dependencias, y así el contrato que ve el modelo es
 * exactamente el que valida zod arriba.
 */
export const BOT_TOOL_SPECS: readonly BotToolSpec[] = [
  {
    name: "crear_asignacion",
    description:
      "Propone una pieza de trabajo para el tablero del equipo: una asignación para alguien del roster o un pendiente propio de John. Devuelve una propuesta que John tiene que confirmar; no crea nada por sí sola.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string", description: "Qué hay que entregar, en una línea." },
        descripcion: { type: "string", description: "Contexto extra, si lo hay." },
        responsable: {
          type: "string",
          description: "Nombre de la persona del equipo (John, Vale, Juan, David, Fausto, Angela). Vacío si es un pendiente sin dueño.",
        },
        iniciativa: { type: "string", description: "Iniciativa o proyecto al que pertenece, si se menciona." },
        prioridad: { type: "string", enum: [...PRIORITIES] },
        tamano: { type: "string", enum: [...SIZES] },
        fecha_limite: { type: "string", description: "Fecha de entrega en formato YYYY-MM-DD, si se menciona." },
        criterios_aceptacion: { type: "string", description: "Cómo se sabrá que la entrega está lista." },
        necesita_a_john: { type: "boolean", description: "true si la pieza espera una decisión de John." },
        confianza: CONFIANZA_PROPERTY,
      },
      required: ["titulo"],
      additionalProperties: false,
    },
  },
  {
    name: "registrar_checkin",
    description:
      "Registra el check-in del día de John: qué quedó hecho, en qué está y qué lo tiene trabado. Uno por día, editable el mismo día.",
    input_schema: {
      type: "object",
      properties: {
        hecho: { type: "string" },
        haciendo: { type: "string" },
        bloqueado: { type: "string" },
        confianza: CONFIANZA_PROPERTY,
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "guardar_nota",
    description:
      "Guarda una nota de reunión y devuelve un resumen. Si el texto contiene tareas, se listan en `tareas` para proponerlas una por una.",
    input_schema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "La nota, ya limpia." },
        resumen: { type: "string", description: "Resumen corto de la nota." },
        referencia_reunion: { type: "string", description: "Con quién o de qué era la reunión." },
        tareas: {
          type: "array",
          items: { type: "string" },
          description: "Tareas concretas detectadas en la nota, una por elemento.",
        },
        confianza: CONFIANZA_PROPERTY,
      },
      required: ["texto"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_estado",
    description:
      "Responde preguntas de solo lectura sobre el tablero: qué está bloqueado, qué espera una decisión de John, cómo va una iniciativa, la época en curso o el resumen del día.",
    input_schema: {
      type: "object",
      properties: {
        alcance: { type: "string", enum: [...ESTADO_SCOPES] },
        iniciativa: { type: "string", description: "Para filtrar por iniciativa cuando el alcance lo admite." },
      },
      required: ["alcance"],
      additionalProperties: false,
    },
  },
  {
    name: "no_entendido",
    description:
      "Úsala SIEMPRE que no tengas claro qué se pide o falte un dato para armar la pieza. Pregunta en vez de adivinar.",
    input_schema: {
      type: "object",
      properties: {
        pregunta: { type: "string", description: "La pregunta concreta que hay que hacerle a John." },
      },
      required: [],
      additionalProperties: false,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export interface BotReply {
  text: string;
  keyboard?: InlineKeyboard;
}

export interface BotToolOutcome {
  tool: BotTool;
  reply: BotReply;
  /** Id del borrador cuando la herramienta propone una escritura. */
  draftId?: number;
  outcome: BotOutcome;
  target?: string | null;
  detail?: string | null;
}

export interface BotContext {
  actor: TeamActor;
  /** v1: solo John. Sin esto, ninguna herramienta de escritura llega a proponer. */
  canWrite: boolean;
  now: Date;
  /**
   * WP31-C2: la puerta de `/equipo` para esta persona (`equipoActor`), resuelta por
   * bot-agent contra la base. `null` = hoy no entra a `/equipo` (alumni, sin acuerdo o
   * sin proyectos): solo ve lo suyo. `undefined` (tests que arman el contexto a mano)
   * = se decide solo por el rol de `actor`.
   */
  equipo?: EquipoActor | null;
}

/**
 * ¿Esta persona ve por Telegram SOLO lo suyo? (spec WP31 §5.C.3). Todo el que no ve
 * todo el equipo en la web —un core sin supervisión, un contributor— y todo el que
 * hoy no entra a `/equipo`. Para ellos: su texto libre nunca llega al modelo, el
 * estado se limita a lo propio y los focos no traen la bandeja del founder.
 */
export function soloLoPropio(ctx: BotContext): boolean {
  return ctx.equipo === null || !puedeVerTodoElEquipo(ctx.actor);
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

function bullets(lines: string[]): string {
  return lines.map((l) => `· ${l}`).join("\n");
}

export function formatAssignmentLine(a: AssignmentView): string {
  const partes = [`#${a.id}`, `[${PRIORITY_LABEL[a.priority]}]`, a.title];
  if (a.owner_name) partes.push(`— ${a.owner_name}`);
  if (a.due_date) partes.push(`· vence ${a.due_date}`);
  partes.push(`· ${a.status}`);
  return partes.join(" ");
}

/** Ficha de la pieza propuesta, tal como la verá John antes de confirmar. */
export function formatDraftPreview(input: CrearAsignacionInput, resolved: ResolvedOwner): string {
  const lineas = [`Título: ${input.titulo}`];
  if (resolved.ownerName) lineas.push(`Responsable: ${resolved.ownerName}`);
  else if (input.responsable) lineas.push(`Responsable: sin resolver (no reconozco «${input.responsable}»)`);
  else lineas.push("Responsable: sin asignar");
  if (resolved.initiativeName) lineas.push(`Iniciativa: ${resolved.initiativeName}`);
  else if (input.iniciativa) lineas.push(`Iniciativa: sin resolver (no existe «${input.iniciativa}»)`);
  lineas.push(`Prioridad: ${PRIORITY_LABEL[input.prioridad ?? "Normal"]}`);
  if (input.fecha_limite) lineas.push(`Vence: ${input.fecha_limite}`);
  if (input.tamano) lineas.push(`Tamaño: ${input.tamano}`);
  if (input.criterios_aceptacion) lineas.push(`Criterios de aceptación: ${input.criterios_aceptacion}`);
  if (input.necesita_a_john) lineas.push("Espera una decisión tuya");
  return ["Asignación propuesta", bullets(lineas), BOT_COPY.confirmarPregunta].join("\n");
}

// ---------------------------------------------------------------------------
// Resolución de responsable e iniciativa
// ---------------------------------------------------------------------------

export interface ResolvedOwner {
  ownerWallet: string | null;
  ownerName: string | null;
  initiativeId: number | null;
  initiativeName: string | null;
}

/**
 * Traduce el nombre que dijo John al principal real del roster (WP14) y la
 * iniciativa a una que YA exista. Si no reconoce algo lo deja en null y lo dice en
 * la ficha: no inventa personas ni crea iniciativas de contrabando.
 *
 * WP31-C2: el roster es un dato. `walletDeRoster` respeta `roster_links`: si la fila
 * ya se vinculó con la cuenta real, el trabajo va a esa cuenta; si no, a
 * `pending:<slug>`.
 */
export function resolveOwnerAndInitiative(db: DB, input: CrearAsignacionInput): ResolvedOwner {
  let ownerWallet: string | null = null;
  let ownerName: string | null = null;
  if (input.responsable) {
    const miembro = findRosterMember(input.responsable);
    if (miembro) {
      const principal = walletDeRoster(db, miembro.slug);
      const enDb = principal ? listTeamMembers(db).find((m) => m.wallet === principal) : undefined;
      if (enDb) {
        ownerWallet = enDb.wallet;
        ownerName = enDb.display_name;
      }
    }
  }

  let initiativeId: number | null = null;
  let initiativeName: string | null = null;
  if (input.iniciativa) {
    const slug = slugify(input.iniciativa);
    const match = listInitiatives(db).find((i) => i.slug === slug);
    if (match) {
      initiativeId = match.id;
      initiativeName = match.name;
    }
  }
  return { ownerWallet, ownerName, initiativeId, initiativeName };
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

type Handler = (db: DB, ctx: BotContext, input: unknown) => BotToolOutcome;

function parseOr400<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new BotToolError(400, parsed.error.issues[0]?.message ?? "Faltan datos para armar la pieza.");
  }
  return parsed.data;
}

const crear_asignacion: Handler = (db, ctx, rawInput) => {
  const input = parseOr400(crearAsignacionSchema, rawInput);
  const resolved = resolveOwnerAndInitiative(db, input);
  // Solo un BORRADOR. Nada entra en `assignments` hasta `confirmDraft`.
  const draftId = createDraft(db, ctx.actor.wallet, "crear_asignacion", input);
  return {
    tool: "crear_asignacion",
    reply: { text: formatDraftPreview(input, resolved), keyboard: draftKeyboard(draftId) },
    draftId,
    outcome: "ok",
    target: `borrador:${draftId}`,
    detail: input.titulo,
  };
};

const registrar_checkin: Handler = (db, ctx, rawInput) => {
  const input = parseOr400(registrarCheckinSchema, rawInput);
  const payload = { hecho: input.hecho ?? "", haciendo: input.haciendo ?? "", bloqueado: input.bloqueado ?? "" };
  if (!payload.hecho && !payload.haciendo && !payload.bloqueado) {
    throw new BotToolError(400, "Para el check-in necesito al menos uno de los tres: hecho, haciendo o bloqueado.");
  }
  const draftId = createDraft(db, ctx.actor.wallet, "registrar_checkin", payload);
  const lineas: string[] = [];
  if (payload.hecho) lineas.push(`Hecho: ${payload.hecho}`);
  if (payload.haciendo) lineas.push(`Haciendo: ${payload.haciendo}`);
  if (payload.bloqueado) lineas.push(`Bloqueado: ${payload.bloqueado}`);
  return {
    tool: "registrar_checkin",
    reply: {
      text: ["Check-in propuesto", bullets(lineas), BOT_COPY.confirmarPregunta].join("\n"),
      keyboard: draftKeyboard(draftId),
    },
    draftId,
    outcome: "ok",
    target: `borrador:${draftId}`,
    detail: "check-in del día",
  };
};

const guardar_nota: Handler = (db, ctx, rawInput) => {
  const input = parseOr400(guardarNotaSchema, rawInput);
  const draftId = createDraft(db, ctx.actor.wallet, "guardar_nota", input);
  const lineas = [`Resumen: ${input.resumen ?? input.texto.slice(0, 200)}`];
  if (input.referencia_reunion) lineas.push(`Reunión: ${input.referencia_reunion}`);
  if (input.tareas && input.tareas.length > 0) {
    lineas.push(`Tareas detectadas: ${input.tareas.length}`);
  }
  return {
    tool: "guardar_nota",
    reply: {
      text: ["Nota propuesta", bullets(lineas), BOT_COPY.confirmarPregunta].join("\n"),
      keyboard: draftKeyboard(draftId),
    },
    draftId,
    outcome: "ok",
    target: `borrador:${draftId}`,
    detail: input.referencia_reunion ?? "nota de reunión",
  };
};

const consultar_estado: Handler = (db, ctx, rawInput) => {
  const input = parseOr400(consultarEstadoSchema, rawInput);
  const text = renderEstado(db, ctx, input.alcance, input.iniciativa);
  return {
    tool: "consultar_estado",
    reply: { text },
    outcome: "ok",
    target: input.alcance,
    detail: input.iniciativa ?? null,
  };
};

const no_entendido: Handler = (_db, _ctx, rawInput) => {
  const input = parseOr400(noEntendidoSchema, rawInput);
  const pregunta = input.pregunta?.trim();
  return {
    tool: "no_entendido",
    reply: { text: pregunta ? `${BOT_COPY.noEntendido} ${pregunta}` : BOT_COPY.noEntendido },
    outcome: "no_entendido",
    target: null,
    detail: pregunta ?? null,
  };
};

/**
 * TABLA CERRADA Y CONGELADA. Cinco entradas, ni una más. Añadir capacidades al bot
 * exige tocar este objeto y `BOT_TOOLS` a la vez, con revisión: no hay forma de
 * que el modelo, un mensaje o una respuesta de la API metan una sexta acción.
 */
export const BOT_DISPATCH: Readonly<Record<BotTool, Handler>> = Object.freeze({
  crear_asignacion,
  registrar_checkin,
  guardar_nota,
  consultar_estado,
  no_entendido,
});

/**
 * Punto ÚNICO de ejecución. Rechaza cualquier nombre fuera del vocabulario y
 * bloquea las escrituras de quien no está autorizado antes de proponer nada.
 */
export function runBotTool(db: DB, ctx: BotContext, name: string, input: unknown): BotToolOutcome {
  if (!isBotTool(name)) {
    throw new BotToolError(400, `El bot no tiene ninguna herramienta llamada '${name}'.`);
  }
  if (isWriteTool(name) && !ctx.canWrite) {
    return {
      tool: name,
      reply: { text: BOT_COPY.soloLectura },
      outcome: "rechazado",
      target: name,
      detail: "sin permiso de escritura en v1",
    };
  }
  return BOT_DISPATCH[name](db, ctx, input);
}

// ---------------------------------------------------------------------------
// consultar_estado — todo sale de WP14/WP15, nada se recalcula aquí
// ---------------------------------------------------------------------------

/**
 * Quien ve SOLO lo suyo (`soloLoPropio`, spec WP31 §5.C.3) recibe sus pendientes en
 * cualquier alcance que describa al equipo entero (bloqueos, la bandeja del founder,
 * las iniciativas, la carga por persona, la época, los ritos o el digest). Solo
 * conservan su camino `equipo`, que ya pasa por `visibleAssignments` (para esa persona,
 * lo propio), y `todo`, que se queda en la puerta de `buildDashboard` (403); y ni
 * esos dos si hoy no entra a `/equipo` (`equipo === null`).
 */
function soloSusPendientes(ctx: BotContext, alcance: EstadoScope): boolean {
  if (!soloLoPropio(ctx)) return false;
  const conPuertaPropia = ctx.equipo !== null && (alcance === "equipo" || alcance === "todo");
  return !conPuertaPropia;
}

function renderEstado(db: DB, ctx: BotContext, alcance: EstadoScope, iniciativa?: string): string {
  if (soloSusPendientes(ctx, alcance)) return renderPendientes(db, ctx);
  // Con `actor`, los agregados solo cuentan lo que esta persona ve (§4.A.12): nada de
  // un proyecto de cliente donde no participa. Al founder no le cambia nada.
  switch (alcance) {
    case "bloqueos": {
      const items = blockedWithAge(db, ctx.now, ctx.actor);
      if (items.length === 0) return BOT_COPY.sinBloqueos;
      return [
        `Bloqueado ahora (${items.length}), del bloqueo más viejo al más nuevo:`,
        ...items.map((b) => {
          const dias = b.daysBlocked === null ? "sin registro de cuándo" : `${b.daysBlocked} día(s)`;
          const motivo = b.reason ?? "sin motivo registrado";
          return `· ${formatAssignmentLine(b.assignment)} · ${dias} · ${motivo}`;
        }),
      ].join("\n");
    }
    case "esperando_a_mi": {
      const items = founderInbox(db, ctx.actor);
      if (items.length === 0) return BOT_COPY.sinEsperandoAJohn;
      return [`Esperando una decisión tuya (${items.length}):`, ...items.map((a) => `· ${formatAssignmentLine(a)}`)].join("\n");
    }
    case "iniciativas": {
      const slug = iniciativa ? slugify(iniciativa) : null;
      const barras = initiativeBars(db, ctx.now, ctx.actor).filter((b) => {
        if (!slug) return b.total > 0;
        return b.initiative ? b.initiative.slug === slug : false;
      });
      if (barras.length === 0) return "No encuentro trabajo en esa iniciativa.";
      return [
        "Por iniciativa:",
        ...barras.map((b) => {
          const cerradas = b.closedThisEpoch ?? b.closedThisWeek;
          return `· ${b.name}: ${b.open} abiertas · ${b.blocked} bloqueadas · ${cerradas} cerradas`;
        }),
      ].join("\n");
    }
    case "carga": {
      const carga = loadByPerson(db, ctx.actor);
      return [
        "Trabajo abierto por persona:",
        ...carga.people.map((p) => `· ${p.name}: ${p.open} abiertas · ${p.blocked} bloqueadas`),
        `· Sin responsable: ${carga.unassignedOpen} abiertas · ${carga.unassignedBlocked} bloqueadas`,
        LOAD_PURPOSE,
      ].join("\n");
    }
    case "epoca": {
      const snap = epochSnapshot(db, ctx.actor);
      if (!snap.period) return "Todavía no hay ninguna época abierta.";
      const lineas = [
        `Época ${snap.period.name} (${snap.period.state}), abierta desde ${snap.period.startDay}`,
        `Entregas cerradas en la época: ${snap.closedThisEpoch ?? 0}`,
        `Bloqueadas ahora: ${snap.blockedNow}`,
      ];
      if (snap.fitness) lineas.push(`Fitness del genoma: ${snap.fitness.score.toFixed(3)}`);
      return bullets(lineas);
    }
    case "ritos": {
      const salud = riteHealth(db, ctx.now);
      const pct = salud.pct === null ? "sin datos todavía" : `${salud.pct}%`;
      return bullets([
        `Semana del ${salud.weekStart}`,
        `Check-ins escritos: ${salud.actual} de ${salud.expected} posibles (${pct})`,
        "Cuenta participación en el rito, no horas ni disponibilidad.",
      ]);
    }
    case "digest":
      return renderDigestText(buildTodayDigest(db, ctx.now, ctx.actor));
    case "mis_pendientes":
      return renderPendientes(db, ctx);
    case "equipo": {
      // `visibleAssignments` es la regla ÚNICA de visibilidad de WP14: un `core`
      // normal ve solo lo suyo, el founder y los supervisores ven todo. La misma
      // función que usa /equipo/hoy.
      const items = visibleAssignments(db, ctx.actor);
      if (items.length === 0) return "No hay trabajo abierto ahora mismo.";
      return [`Trabajo abierto (${items.length}):`, ...items.map((a) => `· ${formatAssignmentLine(a)}`)].join("\n");
    }
    case "todo": {
      // Puerta ÚNICA: `buildDashboard` lanza TeamError 403 si el actor no puede ver
      // todo el equipo. Aquí no se relaja la regla.
      const d = buildDashboard(db, ctx.actor, ctx.now);
      return [
        `Tablero del ${d.day}`,
        bullets([
          `Bloqueadas: ${d.blocked.length}`,
          `Esperando una decisión tuya: ${d.waitingOnFounder.length}`,
          `Trabajo abierto del equipo: ${d.load.totalOpen} (en curso: ${d.load.totalInProgress})`,
          `Check-ins de la semana: ${d.rites.actual} de ${d.rites.expected}`,
          `Entregas cerradas en la época: ${d.epoch.closedThisEpoch ?? 0}`,
        ]),
      ].join("\n");
    }
  }
}

// ---------------------------------------------------------------------------
// Backlog conversacional — la MISMA fuente que /equipo/hoy
// ---------------------------------------------------------------------------

/**
 * Todo el trabajo abierto de John, agrupado por iniciativa. Llama exactamente a
 * `assignmentsForOwner`, que es la función con la que `/equipo/hoy` pinta "lo
 * mío": si la web y el bot difirieran, este es el único sitio donde podría pasar,
 * y no hay consulta propia que pueda desviarse.
 */
export function pendientesDe(db: DB, ctx: BotContext, filtro?: string): AssignmentView[] {
  const propias = assignmentsForOwner(db, ctx.actor.wallet);
  if (!filtro?.trim()) return propias;
  const slug = slugify(filtro);
  return propias.filter((a) => (a.initiative_name ? slugify(a.initiative_name) === slug : slug === "sin-iniciativa"));
}

export function renderPendientes(db: DB, ctx: BotContext, filtro?: string): string {
  const items = pendientesDe(db, ctx, filtro);
  if (items.length === 0) {
    return filtro?.trim() ? `No tienes trabajo abierto en «${filtro.trim()}».` : BOT_COPY.sinPendientes;
  }
  const porIniciativa = new Map<string, AssignmentView[]>();
  for (const a of items) {
    const clave = a.initiative_name ?? "Sin iniciativa";
    const lista = porIniciativa.get(clave);
    if (lista) lista.push(a);
    else porIniciativa.set(clave, [a]);
  }
  const bloques: string[] = [`Tu trabajo abierto (${items.length}):`];
  for (const [nombre, lista] of porIniciativa) {
    bloques.push(`\n${nombre}`);
    for (const a of lista) bloques.push(`· ${formatAssignmentLine(a)}`);
  }
  const progreso = ownProgress(db, ctx.actor.wallet, ctx.now);
  bloques.push(
    `\nTu progreso: ${progreso.closedThisWeek} entregas cerradas esta semana (la anterior, ${progreso.closedPrevWeek}).`
  );
  return bloques.join("\n");
}

/** Acciones que empujan la pieza hacia Hecha. Bloquear/desbloquear no van aquí. */
const ACCIONES_HACIA_ADELANTE: readonly TeamAction[] = ["asignar", "empezar", "enviar_a_revision", "aprobar"];

function autorizaSobrePieza(ctx: BotContext, ownerWallet: string | null): boolean {
  return puedeVerTodoElEquipo(ctx.actor) || (!!ownerWallet && ownerWallet === ctx.actor.wallet) || ownerWallet === null;
}

/**
 * "Eso ya está, ciérralo": aplica UN paso hacia Hecha con la máquina de estados
 * pura. No salta pasos ni inventa un cierre: si la pieza está en Backlog, avanza
 * un tramo y lo dice. El historial queda honesto en `assignment_events`.
 */
export function avanzarPieza(db: DB, ctx: BotContext, assignmentId: number): BotReply {
  const row = getAssignment(db, assignmentId);
  if (!row) return { text: BOT_COPY.piezaNoEncontrada };
  if (!autorizaSobrePieza(ctx, row.owner_wallet)) return { text: BOT_COPY.sinPermisoPieza };
  if (row.status === "Hecha") return { text: BOT_COPY.yaHecha };

  const disponible = availableTeamActions(row.status).find((a) => ACCIONES_HACIA_ADELANTE.includes(a));
  if (!disponible) return { text: BOT_COPY.sinAccionDisponible };

  const actualizado = applyAssignmentAction(db, {
    assignmentId,
    action: disponible,
    actor: ctx.actor,
    now: ctx.now,
  });
  const cola =
    actualizado.status === "Hecha"
      ? "Entrega aprobada."
      : "Vuelve a decírmelo para seguir avanzándola.";
  return { text: `#${assignmentId} «${row.title}» pasó a ${actualizado.status}. ${cola}` };
}

/**
 * "Sube la prioridad de X": mueve la pieza un escalón en el vocabulario de
 * prioridades de WP14 (Urgent > High > Normal > Low).
 *
 * Nota honesta de alcance: WP14 no expone ninguna función para cambiar la
 * prioridad (la web solo la fija al importar el CSV), así que este es el único
 * sitio de WP19 con un UPDATE propio sobre `assignments`. Se limita a la columna
 * `priority` y a `updated_at`: el `status` sigue siendo territorio exclusivo de la
 * máquina de estados.
 */
export function subirPrioridadPieza(db: DB, ctx: BotContext, assignmentId: number): BotReply {
  const row = getAssignment(db, assignmentId);
  if (!row) return { text: BOT_COPY.piezaNoEncontrada };
  if (!autorizaSobrePieza(ctx, row.owner_wallet)) return { text: BOT_COPY.sinPermisoPieza };

  const rank = PRIORITY_RANK[row.priority];
  if (rank === 0) return { text: BOT_COPY.yaEnMaximaPrioridad };
  const siguiente = PRIORITIES[rank - 1] as Priority;

  db.prepare(`UPDATE assignments SET priority = ?, updated_at = ? WHERE id = ?`).run(
    siguiente,
    ctx.now.toISOString(),
    assignmentId
  );
  return {
    text: `#${assignmentId} «${row.title}» pasó de prioridad ${PRIORITY_LABEL[row.priority]} a ${PRIORITY_LABEL[siguiente]}.`,
  };
}

// ---------------------------------------------------------------------------
// Los 3 focos del día
// ---------------------------------------------------------------------------

export const FOCUS_COUNT = 3;

/**
 * Orden de los focos: primero lo que vence (hoy o antes), luego lo que espera una
 * decisión de John —porque eso tiene a otra persona detenida—, luego la prioridad
 * y el vencimiento. Todo sale de WP14/WP15; no hay métrica nueva.
 */
function focusRank(a: AssignmentView, hoy: string): [number, number, number, string, number] {
  const vencida = a.due_date && a.due_date <= hoy ? 0 : 1;
  const esperaAJohn = a.needs_founder === 1 ? 0 : 1;
  return [vencida, esperaAJohn, PRIORITY_RANK[a.priority], a.due_date ?? "9999-12-31", a.id];
}

function compareRank(x: ReturnType<typeof focusRank>, y: ReturnType<typeof focusRank>): number {
  for (let i = 0; i < x.length; i++) {
    const a = x[i];
    const b = y[i];
    if (a === b) continue;
    return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * Las tres piezas candidatas del día: el trabajo abierto de John más lo que
 * espera una decisión suya (`founderInbox` de WP15), sin duplicados. Quien ve solo
 * lo suyo (`soloLoPropio`, WP31-C2) recibe solo su trabajo abierto: nunca la bandeja
 * del founder.
 */
export function focosDelDia(db: DB, ctx: BotContext): AssignmentView[] {
  const hoy = today(ctx.now);
  const candidatas = new Map<number, AssignmentView>();
  for (const a of assignmentsForOwner(db, ctx.actor.wallet)) candidatas.set(a.id, a);
  if (!soloLoPropio(ctx)) {
    for (const a of founderInbox(db, ctx.actor)) candidatas.set(a.id, a);
  }
  return [...candidatas.values()]
    .sort((a, b) => compareRank(focusRank(a, hoy), focusRank(b, hoy)))
    .slice(0, FOCUS_COUNT);
}

export function renderFocos(focos: AssignmentView[]): string {
  if (focos.length === 0) return BOT_COPY.sinFocos;
  return [
    BOT_COPY.focosCabecera,
    ...focos.map((a, i) => `${i + 1}. ${formatAssignmentLine(a)}`),
    "",
    "Responde «focos 2 1 3» para reordenarlos, o «ok» si están bien.",
  ].join("\n");
}

/**
 * Reordena la propuesta con el orden que respondió John (1-based). Los focos son
 * una propuesta DERIVADA, no un registro: reordenar no escribe estado nuevo, solo
 * cambia lo que el bot repite de vuelta y deja la línea en el log.
 */
export function reordenarFocos(focos: AssignmentView[], orden: number[]): AssignmentView[] {
  const vistos = new Set<number>();
  const salida: AssignmentView[] = [];
  for (const pos of orden) {
    const idx = pos - 1;
    if (idx < 0 || idx >= focos.length || vistos.has(idx)) continue;
    vistos.add(idx);
    salida.push(focos[idx]);
  }
  for (let i = 0; i < focos.length; i++) if (!vistos.has(i)) salida.push(focos[i]);
  return salida;
}

/**
 * ¿Toca mandar los focos? Función PURA: la hora sale del genoma versionado
 * (`dailyFocusHour`), nunca de un literal, y solo se manda una vez por día.
 */
export function debeEnviarFocos(hora: number, now: Date, ultimoDiaEnviado: string | null): boolean {
  const hoy = today(now);
  if (ultimoDiaEnviado === hoy) return false;
  return now.getHours() >= hora;
}

export function horaDeLosFocos(db: DB): number {
  return dailyFocusHour(db);
}

// ---------------------------------------------------------------------------
// Confirmación: el ÚNICO camino que escribe
// ---------------------------------------------------------------------------

export interface ConfirmResult {
  reply: BotReply;
  outcome: BotOutcome;
  target?: string | null;
  detail?: string | null;
  /** Borrador nuevo creado en cadena (la siguiente tarea de una nota). */
  nextDraftId?: number;
}

/**
 * Ejecuta un borrador confirmado. Es la única puerta de escritura de WP19 sobre
 * `assignments`, `checkins` y `notes`, y solo se llega aquí desde el botón
 * `Confirmar` (o desde un test que simule esa pulsación).
 */
export function confirmDraft(db: DB, ctx: BotContext, draftId: number): ConfirmResult {
  const draft = getDraft(db, draftId);
  if (!draft) return { reply: { text: BOT_COPY.borradorNoEncontrado }, outcome: "rechazado" };
  if (draft.wallet !== ctx.actor.wallet) {
    return { reply: { text: BOT_COPY.borradorNoEncontrado }, outcome: "rechazado" };
  }
  if (draft.status !== "pendiente") {
    return { reply: { text: BOT_COPY.borradorResuelto }, outcome: "rechazado" };
  }
  if (!ctx.canWrite) {
    return { reply: { text: BOT_COPY.soloLectura }, outcome: "rechazado" };
  }
  if (!isBotTool(draft.tool) || !isWriteTool(draft.tool)) {
    // Defensa en profundidad: un borrador con una herramienta desconocida no se
    // ejecuta, se descarta.
    resolveDraft(db, draftId, "descartado", ctx.now);
    return { reply: { text: BOT_COPY.borradorNoEncontrado }, outcome: "rechazado" };
  }

  if (!resolveDraft(db, draftId, "confirmado", ctx.now)) {
    return { reply: { text: BOT_COPY.borradorResuelto }, outcome: "rechazado" };
  }

  switch (draft.tool) {
    case "crear_asignacion":
      return confirmarAsignacion(db, ctx, draft);
    case "registrar_checkin":
      return confirmarCheckin(db, ctx, draft);
    case "guardar_nota":
      return confirmarNota(db, ctx, draft);
  }
}

function confirmarAsignacion(db: DB, ctx: BotContext, draft: BotDraftRow): ConfirmResult {
  const input = draftPayload<CrearAsignacionInput>(draft);
  const resolved = resolveOwnerAndInitiative(db, input);
  const id = createAssignment(db, {
    title: input.titulo,
    description: input.descripcion ?? "",
    initiativeId: resolved.initiativeId,
    ownerWallet: resolved.ownerWallet,
    status: resolved.ownerWallet ? "Asignada" : "Backlog",
    priority: (input.prioridad ?? "Normal") as Priority,
    size: (input.tamano ?? null) as Size | null,
    dueDate: input.fecha_limite ?? null,
    acceptanceCriteria: input.criterios_aceptacion ?? "",
    needsFounder: input.necesita_a_john ?? false,
    createdBy: ctx.actor.wallet,
  });

  const lineas = [`${BOT_COPY.creada} #${id} «${input.titulo}»`];
  if (resolved.ownerName) lineas.push(`Aparece en el día de ${resolved.ownerName} y en el tablero.`);
  else lineas.push("Queda en el Backlog, sin responsable todavía.");

  const siguiente = encolarSiguienteTarea(db, ctx, input.cola_tareas ?? []);
  if (siguiente) {
    return {
      reply: { text: [lineas.join("\n"), "", siguiente.reply.text].join("\n"), keyboard: siguiente.reply.keyboard },
      outcome: "ok",
      target: `asignacion:${id}`,
      detail: input.titulo,
      nextDraftId: siguiente.draftId,
    };
  }
  return { reply: { text: lineas.join("\n") }, outcome: "ok", target: `asignacion:${id}`, detail: input.titulo };
}

function confirmarCheckin(db: DB, ctx: BotContext, draft: BotDraftRow): ConfirmResult {
  const payload = draftPayload<{ hecho: string; haciendo: string; bloqueado: string }>(draft);
  const row = upsertCheckin(
    db,
    ctx.actor.wallet,
    { done: payload.hecho, doing: payload.haciendo, blocked: payload.bloqueado },
    ctx.now
  );
  return {
    reply: { text: `${BOT_COPY.checkinGuardado} (${row.day})` },
    outcome: "ok",
    target: `checkin:${row.day}`,
    detail: "check-in del día",
  };
}

function confirmarNota(db: DB, ctx: BotContext, draft: BotDraftRow): ConfirmResult {
  const input = draftPayload<z.infer<typeof guardarNotaSchema>>(draft);
  const nota = saveNote(db, {
    author: ctx.actor.wallet,
    text: input.texto,
    meetingRef: input.referencia_reunion ?? null,
  });
  const resumen = input.resumen?.trim() || input.texto.slice(0, 300);
  const lineas = [`${BOT_COPY.notaGuardada} #${nota.id}`, resumen];

  const siguiente = encolarSiguienteTarea(db, ctx, input.tareas ?? []);
  if (siguiente) {
    return {
      reply: {
        text: [lineas.join("\n"), "", BOT_COPY.tareasDetectadas, "", siguiente.reply.text].join("\n"),
        keyboard: siguiente.reply.keyboard,
      },
      outcome: "ok",
      target: `nota:${nota.id}`,
      detail: input.referencia_reunion ?? "nota de reunión",
      nextDraftId: siguiente.draftId,
    };
  }
  return {
    reply: { text: lineas.join("\n") },
    outcome: "ok",
    target: `nota:${nota.id}`,
    detail: input.referencia_reunion ?? "nota de reunión",
  };
}

/**
 * Propone las tareas de una nota UNA A UNA: crea el borrador de la primera y
 * arrastra el resto en su propia cola. Cada una necesita su propia confirmación.
 */
function encolarSiguienteTarea(
  db: DB,
  ctx: BotContext,
  cola: string[]
): { draftId: number; reply: BotReply } | null {
  const [primera, ...resto] = cola.filter((t) => t.trim().length >= 3);
  if (!primera) return null;
  const input: CrearAsignacionInput = { titulo: primera.trim(), cola_tareas: resto };
  const draftId = createDraft(db, ctx.actor.wallet, "crear_asignacion", input);
  const pendientes = resto.length > 0 ? `\n(quedan ${resto.length} por revisar)` : "";
  return {
    draftId,
    reply: {
      text: formatDraftPreview(input, resolveOwnerAndInitiative(db, input)) + pendientes,
      keyboard: draftKeyboard(draftId),
    },
  };
}

/** Descarta un borrador. No escribe nada en el tablero, por definición. */
export function discardDraft(db: DB, ctx: BotContext, draftId: number): ConfirmResult {
  const draft = getDraft(db, draftId);
  if (!draft || draft.wallet !== ctx.actor.wallet) {
    return { reply: { text: BOT_COPY.borradorNoEncontrado }, outcome: "rechazado" };
  }
  if (!resolveDraft(db, draftId, "descartado", ctx.now)) {
    return { reply: { text: BOT_COPY.borradorResuelto }, outcome: "rechazado" };
  }
  const payload = draftPayload<{ cola_tareas?: string[] }>(draft);
  const siguiente = encolarSiguienteTarea(db, ctx, payload.cola_tareas ?? []);
  if (siguiente) {
    return {
      reply: { text: [BOT_COPY.descartada, "", siguiente.reply.text].join("\n"), keyboard: siguiente.reply.keyboard },
      outcome: "ok",
      target: `borrador:${draftId}`,
      nextDraftId: siguiente.draftId,
    };
  }
  return { reply: { text: BOT_COPY.descartada }, outcome: "ok", target: `borrador:${draftId}` };
}

export { TeamError };
