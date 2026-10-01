/**
 * WP19 — orquestación de punta a punta, con dobles y CERO red.
 *
 * Criterios que cubre:
 *  - Mensaje de un telegram_id NO registrado: se ignora y queda en el log.
 *  - Baja confianza o herramienta inventada → el bot pregunta, no adivina.
 *  - v1 = solo John escribe: otra persona registrada no consigue escritura.
 *  - Flujo completo: mensaje → propuesta → Confirmar → visible en /equipo/hoy del
 *    asignado y en los agregados del dashboard.
 *  - Minimización: el mensaje crudo no queda en ninguna tabla.
 *  - Toda acción queda en `bot_actions` (visible en admin).
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, type TeamActor } from "./roles";
import {
  agregarMiembro,
  assignmentsForOwner,
  createAssignment,
  crearProyecto,
  getCheckin,
  seedTeam,
  upsertInitiative,
} from "./team";
import { createClient } from "./clients";
import { blockedWithAge, founderInbox, loadByPerson } from "./dashboard";
import { BOT_COPY, type TelegramTransport } from "./telegram";
import { consumeLinkCode, issueLinkCode, listBotActions, listNotes } from "./bot-store";
import {
  BOT_SYSTEM_PROMPT,
  decisionFromContent,
  fixedTranscriber,
  handleUpdate,
  type ClaudeClient,
  type ClaudeDecision,
  type ClaudeRequest,
} from "./bot-agent";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const DAVID = pendingPrincipal("david");

const AHORA = new Date(2026, 6, 30, 9, 0, 0);
const CHAT = 555;
const TG_JOHN = "42";
const TG_VALE = "77";
const TG_DESCONOCIDO = "666";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

function fakeTransport(): TelegramTransport & { calls: Array<{ method: string; payload: Record<string, unknown> }> } {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    async call(method, payload) {
      calls.push({ method, payload });
      return { message_id: calls.length };
    },
  };
}

function textosEnviados(t: ReturnType<typeof fakeTransport>): string[] {
  return t.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
}

/** Doble del cliente de Claude: devuelve la decisión que le digan y anota la petición. */
function fakeClaude(decision: ClaudeDecision | ((req: ClaudeRequest) => ClaudeDecision)): ClaudeClient & {
  requests: ClaudeRequest[];
} {
  const requests: ClaudeRequest[] = [];
  return {
    requests,
    async decide(req) {
      requests.push(req);
      return typeof decision === "function" ? decision(req) : decision;
    },
  };
}

/** Cliente que explota: sirve para probar que un camino NO llama al modelo. */
const claudeProhibido: ClaudeClient = {
  async decide() {
    throw new Error("este camino no debe llamar al modelo");
  },
};

function mensaje(text: string, telegramUserId = TG_JOHN, chatType = "private") {
  return { update_id: 1, message: { from: { id: Number(telegramUserId) }, chat: { id: CHAT, type: chatType }, text } };
}

function boton(data: string, telegramUserId = TG_JOHN) {
  return {
    update_id: 2,
    callback_query: {
      id: "cb1",
      from: { id: Number(telegramUserId) },
      data,
      message: { chat: { id: CHAT, type: "private" } },
    },
  };
}

function audio(fileId = "AwAC", telegramUserId = TG_JOHN) {
  return {
    update_id: 3,
    message: {
      from: { id: Number(telegramUserId) },
      chat: { id: CHAT, type: "private" },
      voice: { file_id: fileId, duration: 42 },
    },
  };
}

function vincularJohn(db: DB): void {
  consumeLinkCode(db, issueLinkCode(db, JOHN, AHORA).code, TG_JOHN, AHORA);
}

function vincularVale(db: DB): void {
  consumeLinkCode(db, issueLinkCode(db, VALE, AHORA).code, TG_VALE, AHORA);
}

function countAssignments(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM assignments`).get() as { n: number }).n;
}

// ---------------------------------------------------------------------------

describe("criterio — un telegram_id no registrado se ignora y se registra", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("no responde nada, no llama al modelo y deja la línea en el log", async () => {
    const t = fakeTransport();
    const res = await handleUpdate(
      { db, transport: t, claude: claudeProhibido, now: AHORA },
      mensaje("asigna a David el dashboard", TG_DESCONOCIDO)
    );

    expect(res.attended).toBe(false);
    expect(res.outcome).toBe("ignorado");
    expect(res.reason).toBe("no_registrado");
    expect(t.calls).toHaveLength(0); // ni un mensaje de vuelta

    const log = listBotActions(db);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ outcome: "ignorado", wallet: null, sender_ref: TG_DESCONOCIDO });
    expect(countAssignments(db)).toBe(0);
  });

  it("tampoco atiende grupos: v1 es 1:1", async () => {
    vincularJohn(db);
    const t = fakeTransport();
    const res = await handleUpdate(
      { db, transport: t, claude: claudeProhibido, now: AHORA },
      mensaje("hola", TG_JOHN, "supergroup")
    );
    expect(res.attended).toBe(false);
    expect(res.reason).toBe("grupo");
    expect(t.calls).toHaveLength(0);
    expect(listBotActions(db)[0].action).toBe("mensaje_de_grupo");
  });

  it("un `/start` con código bueno vincula; con código malo se rechaza y se registra", async () => {
    const { code } = issueLinkCode(db, JOHN, AHORA);
    const t = fakeTransport();
    const deps = { db, transport: t, claude: claudeProhibido, now: AHORA };

    const malo = await handleUpdate(deps, mensaje("/start ZBOT-NOEXISTE", TG_DESCONOCIDO));
    expect(malo.outcome).toBe("rechazado");
    expect(textosEnviados(t)).toEqual([BOT_COPY.codigoInvalido]);

    const bueno = await handleUpdate(deps, mensaje(`/start ${code}`, TG_JOHN));
    expect(bueno.outcome).toBe("ok");
    expect(textosEnviados(t)[1]).toContain(BOT_COPY.bienvenida);
    expect(listBotActions(db).map((l) => l.outcome)).toEqual(["ok", "rechazado"]);
  });
});

// ---------------------------------------------------------------------------

describe("criterio — baja confianza y herramientas inventadas: pregunta, no adivina", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    vincularJohn(db);
  });

  it("confianza por debajo del umbral → pregunta y no crea nada", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({
      tool: "crear_asignacion",
      input: { titulo: "algo de lo que hablamos", confianza: 0.3 },
    });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("eso que dijimos ayer"));

    expect(res.outcome).toBe("no_entendido");
    expect(textosEnviados(t)[0]).toContain(BOT_COPY.noEntendido);
    expect(countAssignments(db)).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM bot_drafts`).get()).toEqual({ n: 0 });
    expect(listBotActions(db)[0]).toMatchObject({ outcome: "no_entendido" });
  });

  it("una herramienta que no existe se rechaza y se registra", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "pagar_nomina", input: { monto: 5000 } });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("págale a Juan"));

    expect(res.outcome).toBe("rechazado");
    expect(res.tool).toBeNull();
    expect(textosEnviados(t)[0]).toContain(BOT_COPY.noEntendido);
    expect(listBotActions(db)[0]).toMatchObject({ action: "herramienta_desconocida", outcome: "rechazado" });
    expect(countAssignments(db)).toBe(0);
  });

  it("si el modelo contesta en prosa (sin herramienta), la decisión es preguntar", () => {
    expect(decisionFromContent([{ type: "text", text: "claro, ya lo hice" }])).toEqual({
      tool: "no_entendido",
      input: {},
    });
    expect(decisionFromContent(null)).toEqual({ tool: "no_entendido", input: {} });
    expect(decisionFromContent([{ type: "tool_use", name: "crear_asignacion", input: { titulo: "X" } }])).toEqual({
      tool: "crear_asignacion",
      input: { titulo: "X" },
    });
    expect(decisionFromContent([{ type: "tool_use", name: "crear_asignacion" }])).toEqual({
      tool: "crear_asignacion",
      input: {},
    });
  });

  it("datos que no validan terminan en pregunta, no en una pieza a medias", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "crear_asignacion", input: { titulo: "" } });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("crea algo"));
    expect(res.outcome).toBe("no_entendido");
    expect(countAssignments(db)).toBe(0);
  });

  it("el prompt del sistema le prohíbe explícitamente salirse de las cinco herramientas", () => {
    expect(BOT_SYSTEM_PROMPT).toContain("cinco herramientas");
    expect(BOT_SYSTEM_PROMPT).toContain("no_entendido");
    expect(BOT_SYSTEM_PROMPT.toLowerCase()).toContain("no pagas");
  });
});

// ---------------------------------------------------------------------------

describe("criterio — v1 = solo John escribe", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    vincularJohn(db);
    vincularVale(db);
  });

  it("otra persona registrada NO obtiene acceso de escritura", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "crear_asignacion", input: { titulo: "Tarea de Vale", confianza: 0.95 } });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("crea una tarea", TG_VALE));

    expect(res.outcome).toBe("rechazado");
    expect(textosEnviados(t)).toEqual([BOT_COPY.soloLectura]);
    expect(countAssignments(db)).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM bot_drafts`).get()).toEqual({ n: 0 });
  });

  it("y tampoco puede avanzar ni repriorizar piezas", async () => {
    const id = createAssignment(db, { title: "Pieza de Vale", ownerWallet: VALE, status: "Asignada" });
    const t = fakeTransport();
    const deps = { db, transport: t, claude: claudeProhibido, now: AHORA };

    expect((await handleUpdate(deps, mensaje(`/avanzar ${id}`, TG_VALE))).outcome).toBe("rechazado");
    expect((await handleUpdate(deps, mensaje(`/prioridad ${id}`, TG_VALE))).outcome).toBe("rechazado");
    expect(db.prepare(`SELECT status, priority FROM assignments WHERE id = ?`).get(id)).toEqual({
      status: "Asignada",
      priority: "Normal",
    });
  });

  it("pero sí puede leer lo suyo (lectura no es escritura)", async () => {
    createAssignment(db, { title: "Lo de Vale", ownerWallet: VALE, status: "Asignada" });
    const t = fakeTransport();
    const res = await handleUpdate(
      { db, transport: t, claude: claudeProhibido, now: AHORA },
      mensaje("/pendientes", TG_VALE)
    );
    expect(res.outcome).toBe("ok");
    expect(textosEnviados(t)[0]).toContain("Lo de Vale");
  });
});

// ---------------------------------------------------------------------------

describe("flujo completo: captura → propuesta → confirmación → tablero", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    upsertInitiative(db, "WMS");
    vincularJohn(db);
  });

  it("de un mensaje a una asignación visible en el día de David y en el dashboard", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({
      tool: "crear_asignacion",
      input: {
        titulo: "Dashboard de bloqueos",
        responsable: "David",
        iniciativa: "WMS",
        prioridad: "High",
        fecha_limite: "2026-08-07",
        confianza: 0.95,
      },
    });
    const deps = { db, transport: t, claude, now: AHORA };

    const propuesta = await handleUpdate(deps, mensaje("asigna a David: dashboard de bloqueos para el viernes"));
    expect(propuesta.tool).toBe("crear_asignacion");
    expect(countAssignments(db)).toBe(0); // todavía nada
    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;

    const confirmado = await handleUpdate(deps, boton(`ok:${draftId}`));
    expect(confirmado.outcome).toBe("ok");
    expect(t.calls.some((c) => c.method === "answerCallbackQuery")).toBe(true);

    // Visible donde lo ve el equipo: /equipo/hoy de David y la carga del dashboard.
    const deDavid = assignmentsForOwner(db, DAVID);
    expect(deDavid.map((a) => a.title)).toEqual(["Dashboard de bloqueos"]);
    expect(deDavid[0].due_date).toBe("2026-08-07");
    const carga = loadByPerson(db);
    expect(carga.people.find((p) => p.wallet === DAVID)!.open).toBe(1);
    expect(carga.totalOpen).toBe(1);
  });

  it("el botón Descartar no deja rastro en el tablero", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "crear_asignacion", input: { titulo: "Idea suelta", confianza: 0.9 } });
    const deps = { db, transport: t, claude, now: AHORA };
    await handleUpdate(deps, mensaje("apunta una idea suelta"));
    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;

    const res = await handleUpdate(deps, boton(`no:${draftId}`));
    expect(res.outcome).toBe("ok");
    expect(textosEnviados(t).at(-1)).toBe(BOT_COPY.descartada);
    expect(countAssignments(db)).toBe(0);
  });

  it("«Editar» pide el cambio y no escribe nada", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "crear_asignacion", input: { titulo: "Algo", confianza: 0.9 } });
    const deps = { db, transport: t, claude, now: AHORA };
    await handleUpdate(deps, mensaje("apunta algo"));
    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;

    await handleUpdate(deps, boton(`ed:${draftId}`));
    expect(textosEnviados(t).at(-1)).toBe(BOT_COPY.editarComo);
    expect(countAssignments(db)).toBe(0);
    expect(db.prepare(`SELECT status FROM bot_drafts WHERE id = ?`).get(draftId)).toEqual({ status: "pendiente" });
  });

  it("el check-in del día entra por el mismo camino de confirmación", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "registrar_checkin", input: { hecho: "cerré la propuesta", confianza: 0.9 } });
    const deps = { db, transport: t, claude, now: AHORA };
    await handleUpdate(deps, mensaje("hoy cerré la propuesta"));
    expect(getCheckin(db, JOHN, "2026-07-30")).toBeUndefined();

    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    await handleUpdate(deps, boton(`ok:${draftId}`));
    expect(getCheckin(db, JOHN, "2026-07-30")!.done).toBe("cerré la propuesta");
  });

  it("/nota fuerza la herramienta de notas y devuelve el resumen", async () => {
    const t = fakeTransport();
    const claude = fakeClaude((req) => {
      expect(req.forceTool).toBe("guardar_nota");
      return {
        tool: "guardar_nota",
        input: {
          texto: req.message,
          resumen: "Cliente Demo quiere analítica",
          referencia_reunion: "Cliente Demo",
          tareas: ["Revisar la propuesta de analítica"],
          confianza: 0.9,
        },
      };
    });
    const deps = { db, transport: t, claude, now: AHORA };
    await handleUpdate(deps, mensaje("/nota Cliente Demo pidió la propuesta de analítica"));
    expect(listNotes(db, JOHN)).toHaveLength(0);

    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    await handleUpdate(deps, boton(`ok:${draftId}`));
    const notas = listNotes(db, JOHN);
    expect(notas).toHaveLength(1);
    expect(notas[0].meeting_ref).toBe("Cliente Demo");
    expect(textosEnviados(t).at(-1)).toContain("Revisar la propuesta de analítica");
    expect(countAssignments(db)).toBe(0); // la tarea sigue siendo una propuesta
  });
});

// ---------------------------------------------------------------------------

describe("audio: la costura de transcripción, sin fingir", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    vincularJohn(db);
  });

  it("sin proveedor de transcripción lo dice claro y no llama al modelo", async () => {
    const t = fakeTransport();
    const res = await handleUpdate(
      { db, transport: t, claude: claudeProhibido, transcriber: null, now: AHORA },
      audio()
    );
    expect(res.outcome).toBe("rechazado");
    expect(textosEnviados(t)).toEqual([BOT_COPY.sinTranscripcion]);
    expect(listBotActions(db)[0]).toMatchObject({ action: "audio", outcome: "rechazado" });
  });

  it("con un transcriptor inyectado, el audio recorre el mismo flujo que el texto", async () => {
    const t = fakeTransport();
    const claude = fakeClaude((req) => {
      expect(req.message).toContain("dashboard de bloqueos");
      return {
        tool: "crear_asignacion",
        input: { titulo: "Dashboard de bloqueos", responsable: "David", confianza: 0.9 },
      };
    });
    const deps = {
      db,
      transport: t,
      claude,
      transcriber: fixedTranscriber("asigna a David el dashboard de bloqueos para el viernes"),
      now: AHORA,
    };

    const res = await handleUpdate(deps, audio());
    expect(res.tool).toBe("crear_asignacion");
    expect(countAssignments(db)).toBe(0);

    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    await handleUpdate(deps, boton(`ok:${draftId}`));
    expect(assignmentsForOwner(db, DAVID).map((a) => a.title)).toEqual(["Dashboard de bloqueos"]);
  });

  it("MINIMIZACIÓN: ni el audio ni el texto crudo quedan en ninguna tabla", async () => {
    const CRUDO = "eh, mira, esto es un audio larguísimo con mucha paja verbal irrelevante";
    const t = fakeTransport();
    const claude = fakeClaude({
      tool: "crear_asignacion",
      input: { titulo: "Dashboard de bloqueos", responsable: "David", confianza: 0.9 },
    });
    const deps = { db, transport: t, claude, transcriber: fixedTranscriber(CRUDO), now: AHORA };
    await handleUpdate(deps, audio("FILE-ID-DEL-AUDIO"));
    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    await handleUpdate(deps, boton(`ok:${draftId}`));

    const tablas = ["telegram_links", "notes", "bot_drafts", "bot_actions", "assignments", "assignment_events", "checkins"];
    const volcado = tablas
      .map((tabla) => JSON.stringify(db.prepare(`SELECT * FROM ${tabla}`).all()))
      .join(" ");
    expect(volcado).not.toContain(CRUDO);
    expect(volcado).not.toContain("paja verbal");
    expect(volcado).not.toContain("FILE-ID-DEL-AUDIO");
    // Lo que SÍ queda es la pieza resultante.
    expect(volcado).toContain("Dashboard de bloqueos");
  });
});

// ---------------------------------------------------------------------------

describe("comandos deterministas: no pasan por el modelo", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    upsertInitiative(db, "WMS");
    vincularJohn(db);
  });

  it("/pendientes, /focos, /ayuda y el reordenado no llaman al modelo", async () => {
    createAssignment(db, { title: "Revisar propuesta", ownerWallet: JOHN, status: "Asignada", priority: "High" });
    createAssignment(db, { title: "Otra cosa", ownerWallet: JOHN, status: "Asignada", priority: "Low" });
    const t = fakeTransport();
    const deps = { db, transport: t, claude: claudeProhibido, now: AHORA };

    for (const cmd of ["/pendientes", "pendientes wms", "/focos", "focos 2 1", "/ayuda", "ok"]) {
      const res = await handleUpdate(deps, mensaje(cmd));
      expect(res.outcome, cmd).toBe("ok");
    }
    expect(textosEnviados(t)).toHaveLength(6);
  });

  it("una captura que EMPIEZA como un comando no se confunde con el comando", async () => {
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "no_entendido", input: { pregunta: "¿Para quién?" } });
    const res = await handleUpdate(
      { db, transport: t, claude, now: AHORA },
      mensaje("pendiente con Cliente Demo: revisar propuesta de analítica")
    );
    // No lo trató como /pendientes: fue al modelo.
    expect(claude.requests).toHaveLength(1);
    expect(res.tool).toBe("no_entendido");
  });

  it("«ciérralo» sin número pregunta cuál, en vez de cerrar algo al azar", async () => {
    const id = createAssignment(db, { title: "Algo", ownerWallet: JOHN, status: "Asignada" });
    const t = fakeTransport();
    const res = await handleUpdate({ db, transport: t, claude: claudeProhibido, now: AHORA }, mensaje("eso ya está, ciérralo"));
    expect(res.outcome).toBe("no_entendido");
    expect(textosEnviados(t)[0]).toContain("¿Cuál cierro?");
    expect(db.prepare(`SELECT status FROM assignments WHERE id = ?`).get(id)).toEqual({ status: "Asignada" });
  });

  it("«cierra N» y «sube la prioridad de N» sí actúan, sobre la fuente de WP14", async () => {
    const id = createAssignment(db, { title: "Propuesta", ownerWallet: JOHN, status: "Asignada", priority: "Normal" });
    const t = fakeTransport();
    const deps = { db, transport: t, claude: claudeProhibido, now: AHORA };

    await handleUpdate(deps, mensaje(`sube la prioridad de ${id}`));
    expect(db.prepare(`SELECT priority FROM assignments WHERE id = ?`).get(id)).toEqual({ priority: "High" });

    await handleUpdate(deps, mensaje(`cierra ${id}`));
    expect(db.prepare(`SELECT status FROM assignments WHERE id = ?`).get(id)).toEqual({ status: "En curso" });
  });

  it("consultas de estado responden desde los agregados del dashboard", async () => {
    const id = createAssignment(db, { title: "Integración", ownerWallet: DAVID, status: "Asignada", needsFounder: true });
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "consultar_estado", input: { alcance: "esperando_a_mi" } });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("¿qué me está esperando?"));
    expect(res.outcome).toBe("ok");
    expect(textosEnviados(t)[0]).toContain("Integración");
    expect(founderInbox(db).map((a) => a.id)).toEqual([id]);
    expect(blockedWithAge(db, AHORA)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("log: toda acción del bot queda registrada (visible en admin)", () => {
  it("una sesión completa deja una línea por acción, sin el texto del usuario", async () => {
    const db = freshDb();
    vincularJohn(db);
    const t = fakeTransport();
    const claude = fakeClaude({
      tool: "crear_asignacion",
      input: { titulo: "Dashboard de bloqueos", responsable: "David", confianza: 0.9 },
    });
    const deps = { db, transport: t, claude, now: AHORA };

    await handleUpdate(deps, mensaje("MENSAJE-CRUDO-DE-JOHN sobre el dashboard"));
    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    await handleUpdate(deps, boton(`ok:${draftId}`));
    await handleUpdate(deps, mensaje("/pendientes"));

    // Más reciente primero. El alta se hizo desde la dapp, no por el bot.
    const log = listBotActions(db);
    expect(log.map((l) => l.action)).toEqual(["pendientes", "borrador_confirmar", "crear_asignacion"]);
    expect(log.every((l) => l.wallet === JOHN)).toBe(true);
    expect(JSON.stringify(log)).not.toContain("MENSAJE-CRUDO-DE-JOHN");
  });

  it("un error del modelo se registra y no rompe la conversación", async () => {
    const db = freshDb();
    vincularJohn(db);
    const t = fakeTransport();
    const res = await handleUpdate({ db, transport: t, claude: claudeProhibido, now: AHORA }, mensaje("haz algo raro"));
    expect(res.outcome).toBe("error");
    expect(textosEnviados(t)).toEqual([BOT_COPY.errorInterno]);
    expect(listBotActions(db)[0]).toMatchObject({ action: "clasificar", outcome: "error" });
  });
});

// ---------------------------------------------------------------------------
// WP31-C2 · Telegram para todo el equipo
// ---------------------------------------------------------------------------

const ACTOR_JOHN: TeamActor = { wallet: JOHN, name: "John", role: "founder", isSupervisor: true };
// Personas ficticias (wallets de prueba): nada de este bloque nombra a un cliente real.
const ANA = "GANAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BETO = "GBETOEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TG_ANA = "88";
const TG_DAVID = "99";

function contributor(db: DB, wallet: string, nombre: string): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, ?, 'contributor', 'active', 0, 1)`
  ).run(wallet, nombre);
}

function contarBorradores(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM bot_drafts`).get() as { n: number }).n;
}

describe("C2-3 · sin ANTHROPIC_API_KEY el bot atiende comandos (claude = null)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("/start CODIGO vincula, /pendientes responde y el texto libre recibe soloComandos", async () => {
    createAssignment(db, { title: "Revisar propuesta", ownerWallet: JOHN, status: "Asignada" });
    const t = fakeTransport();
    const deps = { db, transport: t, claude: null, now: AHORA };

    const { code } = issueLinkCode(db, JOHN, AHORA);
    expect((await handleUpdate(deps, mensaje(`/start ${code}`))).outcome).toBe("ok");
    expect(textosEnviados(t)[0]).toContain(BOT_COPY.bienvenida);

    const pendientes = await handleUpdate(deps, mensaje("/pendientes"));
    expect(pendientes.outcome).toBe("ok");
    expect(textosEnviados(t)[1]).toContain("Revisar propuesta");

    const libre = await handleUpdate(deps, mensaje("asigna a David el dashboard de bloqueos"));
    expect(libre.reply?.text).toBe(BOT_COPY.soloComandos);
    expect(textosEnviados(t)[2]).toBe(BOT_COPY.soloComandos);
    expect(contarBorradores(db)).toBe(0);
    expect(listBotActions(db)[0]).toMatchObject({ action: "texto_libre", outcome: "rechazado", wallet: JOHN });
    // Minimización: el log no guarda el texto.
    expect(JSON.stringify(listBotActions(db))).not.toContain("dashboard de bloqueos");
  });

  it("/nota sin modelo se propone tal cual y se guarda solo al confirmar", async () => {
    vincularJohn(db);
    const t = fakeTransport();
    const deps = { db, transport: t, claude: null, now: AHORA };
    const res = await handleUpdate(deps, mensaje("/nota Acordamos revisar la propuesta con Cliente Demo"));
    expect(res.tool).toBe("guardar_nota");
    expect(res.reply?.keyboard).toBeDefined();
    expect(listNotes(db, JOHN)).toHaveLength(0);

    const draftId = (db.prepare(`SELECT id FROM bot_drafts ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    await handleUpdate(deps, boton(`ok:${draftId}`));
    const notas = listNotes(db, JOHN);
    expect(notas).toHaveLength(1);
    expect(notas[0].text).toBe("Acordamos revisar la propuesta con Cliente Demo");
  });

  it("quien no escribe por Telegram recibe soloComandosLectura (sin /nota, que sería rechazada)", async () => {
    vincularVale(db);
    const t = fakeTransport();
    const deps = { db, transport: t, claude: null, now: AHORA };
    await handleUpdate(deps, mensaje("¿qué está bloqueado?", TG_VALE));
    await handleUpdate(deps, mensaje("/ayuda", TG_VALE));
    expect(textosEnviados(t)).toEqual([BOT_COPY.soloComandosLectura, BOT_COPY.soloComandosLectura]);
    expect(BOT_COPY.soloComandosLectura).not.toContain("/nota");
    expect(BOT_COPY.soloComandos).toContain("/nota");
  });

  it("una supervisora sin escritura, con modelo, tampoco gasta una llamada en /nota", async () => {
    vincularVale(db);
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "guardar_nota", input: { texto: "x" } });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("/nota algo de la reunión", TG_VALE));
    expect(res.outcome).toBe("rechazado");
    expect(textosEnviados(t)).toEqual([BOT_COPY.soloLectura]);
    expect(claude.requests).toHaveLength(0);
  });
});

describe("C2-5 · Telegram sin fugas para quien no ve todo el equipo", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    contributor(db, ANA, "Ana");
    const p = crearProyecto(db, ACTOR_JOHN, { name: "Proyecto Abierto Demo" });
    agregarMiembro(db, ACTOR_JOHN, { initiativeId: p.id, wallet: ANA, rol: "ejecuta" });
    createAssignment(db, { title: "Lo de Ana", initiativeId: p.id, ownerWallet: ANA, status: "Asignada" });
    createAssignment(db, { title: "Lo de David", ownerWallet: DAVID, status: "Asignada" });
    createAssignment(db, { title: "Gate del founder", ownerWallet: VALE, status: "En curso", needsFounder: true });
    consumeLinkCode(db, issueLinkCode(db, ANA, AHORA).code, TG_ANA, AHORA);
    consumeLinkCode(db, issueLinkCode(db, DAVID, AHORA).code, TG_DAVID, AHORA);
  });

  it("su texto libre nunca llega al modelo, aunque haya clave: responde soloComandosLectura", async () => {
    for (const tg of [TG_ANA, TG_DAVID]) {
      const t = fakeTransport();
      const claude = fakeClaude({ tool: "consultar_estado", input: { alcance: "carga" } });
      for (const texto of [
        "¿cómo va la carga del equipo?",
        "qué está bloqueado",
        "¿qué espera una decisión del founder?",
        "resumen del día",
        "/nota algo de la reunión",
        "crea una tarea para Vale",
      ]) {
        const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje(texto, tg));
        expect(res.reply?.text, `${tg}: ${texto}`).toBe(BOT_COPY.soloComandosLectura);
      }
      expect(claude.requests, tg).toHaveLength(0); // el doble de Claude nunca se invocó
    }
    expect(contarBorradores(db)).toBe(0);
  });

  it("sus comandos muestran solo lo suyo: /pendientes y /focos sin la bandeja del founder", async () => {
    const t = fakeTransport();
    const deps = { db, transport: t, claude: claudeProhibido, now: AHORA };
    await handleUpdate(deps, mensaje("/pendientes", TG_ANA));
    await handleUpdate(deps, mensaje("/focos", TG_ANA));
    await handleUpdate(deps, mensaje("/focos", TG_DAVID));
    const [pendientes, focosAna, focosDavid] = textosEnviados(t);
    expect(pendientes).toContain("Lo de Ana");
    expect(pendientes).not.toContain("Lo de David");
    expect(focosAna).toContain("Lo de Ana");
    expect(focosDavid).toContain("Lo de David");
    for (const texto of [pendientes, focosAna, focosDavid]) expect(texto).not.toContain("Gate del founder");
  });

  it("al vincularse recibe la bienvenida de lectura, y su /ayuda no promete escribir", async () => {
    contributor(db, BETO, "Beto");
    const p = crearProyecto(db, ACTOR_JOHN, { name: "Otro Proyecto Demo" });
    agregarMiembro(db, ACTOR_JOHN, { initiativeId: p.id, wallet: BETO, rol: "ejecuta" });
    const t = fakeTransport();
    const deps = { db, transport: t, claude: claudeProhibido, now: AHORA };
    const alta = await handleUpdate(deps, mensaje(`/start ${issueLinkCode(db, BETO, AHORA).code}`, "111"));
    expect(alta.outcome).toBe("ok");
    expect(textosEnviados(t)[0]).toBe(`${BOT_COPY.bienvenidaLectura}\n\n${BOT_COPY.soloComandosLectura}`);
    expect(textosEnviados(t)[0]).not.toContain(BOT_COPY.bienvenida);

    await handleUpdate(deps, mensaje("/ayuda", TG_ANA));
    expect(textosEnviados(t)[1]).toBe(BOT_COPY.soloComandosLectura);
  });

  it("si deja de entrar a /equipo (pasa a alumni), por Telegram ve solo lo suyo y no llega al modelo", async () => {
    vincularVale(db);
    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet = ?`).run(VALE);
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "consultar_estado", input: { alcance: "bloqueos" } });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("¿qué está bloqueado?", TG_VALE));
    expect(res.reply?.text).toBe(BOT_COPY.soloComandosLectura);
    expect(claude.requests).toHaveLength(0);
  });

  it("el founder, en cambio, sigue usando el modelo y escribiendo", async () => {
    vincularJohn(db);
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "crear_asignacion", input: { titulo: "Pieza nueva", confianza: 0.9 } });
    const res = await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("apunta una pieza nueva"));
    expect(res.tool).toBe("crear_asignacion");
    expect(claude.requests).toHaveLength(1);
    expect(contarBorradores(db)).toBe(1);
  });
});

describe("supervisión con modelo: las pistas solo nombran los proyectos que ve", () => {
  it("un proyecto de cliente donde no participa no llega al modelo", async () => {
    const db = freshDb();
    crearProyecto(db, ACTOR_JOHN, { name: "Proyecto Interno Demo" });
    const cliente = createClient(db, { name: "Cliente Demo" });
    crearProyecto(db, ACTOR_JOHN, { name: "Proyecto Reservado Demo", clientId: cliente });
    vincularVale(db);
    const t = fakeTransport();
    const claude = fakeClaude({ tool: "consultar_estado", input: { alcance: "bloqueos" } });
    await handleUpdate({ db, transport: t, claude, now: AHORA }, mensaje("¿qué está bloqueado?", TG_VALE));
    expect(claude.requests).toHaveLength(1);
    expect(claude.requests[0].hints).toContain("Proyecto Interno Demo");
    expect(claude.requests[0].hints).not.toContain("Proyecto Reservado Demo");
    expect(claude.requests[0].hints).toMatch(/^Hoy es \d{4}-\d{2}-\d{2}\./);
  });
});
