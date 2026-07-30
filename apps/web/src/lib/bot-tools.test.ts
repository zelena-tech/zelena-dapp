/**
 * WP19 — las cinco herramientas, la confirmación obligatoria y el backlog.
 *
 * Criterios que cubre:
 *  1. Cinco herramientas y NADA más: una inventada por el modelo se rechaza.
 *  2. Nada se crea sin confirmación: sin `Confirmar` no hay fila en `assignments`.
 *  3. `/pendientes` y su filtro devuelven exactamente lo que muestra la web (misma
 *     función de WP14).
 *  4. "sube la prioridad" y "ciérralo" operan sobre la misma fuente, y el cierre
 *     pasa por la máquina de estados pura (sin saltos).
 *  5. Los 3 focos salen de vencimientos, prioridad y lo que espera a John, y la
 *     hora sale del genoma versionado.
 *  6. Copys auditados: cero lenguaje de horas/presencia y ningún juicio sobre nadie.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, type TeamActor } from "./roles";
import {
  applyAssignmentAction,
  assignmentsForOwner,
  createAssignment,
  getAssignment,
  getCheckin,
  seedTeam,
  upsertInitiative,
} from "./team";
import { blockedWithAge, founderInbox } from "./dashboard";
import { BOT_COPY } from "./telegram";
import { createDraft, getDraft, listNotes, pendingDrafts } from "./bot-store";
import {
  BOT_DISPATCH,
  BOT_MIN_CONFIDENCE,
  BOT_TOOLS,
  BOT_TOOL_SPECS,
  BotToolError,
  FOCUS_COUNT,
  TeamError,
  avanzarPieza,
  confirmDraft,
  debeEnviarFocos,
  discardDraft,
  focosDelDia,
  horaDeLosFocos,
  isBotTool,
  isWriteTool,
  pendientesDe,
  renderFocos,
  renderPendientes,
  reordenarFocos,
  runBotTool,
  subirPrioridadPieza,
  type BotContext,
} from "./bot-tools";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const DAVID = pendingPrincipal("david");

/** Jueves 2026-07-30 al mediodía (hora local, para que no corra el día). */
const JUEVES = new Date(2026, 6, 30, 12, 0, 0);

const ACTOR_JOHN: TeamActor = { wallet: JOHN, name: "John", role: "founder", isSupervisor: true };
const ACTOR_DAVID: TeamActor = { wallet: DAVID, name: "David", role: "core", isSupervisor: false };

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

function ctxJohn(canWrite = true): BotContext {
  return { actor: ACTOR_JOHN, canWrite, now: JUEVES };
}

function countAssignments(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM assignments`).get() as { n: number }).n;
}

// ---------------------------------------------------------------------------

describe("criterio 1 — cinco herramientas y nada más", () => {
  it("el vocabulario, la tabla de despacho y el contrato del modelo coinciden", () => {
    expect([...BOT_TOOLS]).toEqual([
      "crear_asignacion",
      "registrar_checkin",
      "guardar_nota",
      "consultar_estado",
      "no_entendido",
    ]);
    expect(Object.keys(BOT_DISPATCH).sort()).toEqual([...BOT_TOOLS].sort());
    expect(BOT_TOOL_SPECS.map((t) => t.name).sort()).toEqual([...BOT_TOOLS].sort());
    expect(Object.isFrozen(BOT_DISPATCH)).toBe(true);
  });

  it("una herramienta inventada por el modelo se RECHAZA (límite estructural)", () => {
    const db = freshDb();
    for (const inventada of [
      "pagar_nomina",
      "cambiar_genoma",
      "cerrar_epoca",
      "guardar_credencial",
      "transferir_puntos",
      "crear_asignacion_v2",
      "__proto__",
      "constructor",
      "toString",
    ]) {
      expect(isBotTool(inventada)).toBe(false);
      expect(() => runBotTool(db, ctxJohn(), inventada, {})).toThrow(BotToolError);
    }
    expect(countAssignments(db)).toBe(0);
  });

  it("las herramientas de escritura están marcadas como tales", () => {
    expect(isWriteTool("crear_asignacion")).toBe(true);
    expect(isWriteTool("registrar_checkin")).toBe(true);
    expect(isWriteTool("guardar_nota")).toBe(true);
    expect(isWriteTool("consultar_estado")).toBe(false);
    expect(isWriteTool("no_entendido")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("criterio 2 — nada se crea sin confirmación", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    upsertInitiative(db, "WMS");
  });

  it("la herramienta solo PROPONE: no hay fila en assignments hasta confirmar", () => {
    const out = runBotTool(db, ctxJohn(), "crear_asignacion", {
      titulo: "Dashboard de bloqueos",
      responsable: "David",
      iniciativa: "WMS",
      prioridad: "High",
      fecha_limite: "2026-08-07",
    });

    expect(out.tool).toBe("crear_asignacion");
    expect(out.draftId).toBeGreaterThan(0);
    expect(out.reply.keyboard?.[0].map((b) => b.text)).toEqual(["Confirmar", "Editar", "Descartar"]);
    expect(out.reply.text).toContain("Dashboard de bloqueos");
    expect(out.reply.text).toContain("David");
    expect(out.reply.text).toContain(BOT_COPY.confirmarPregunta);

    // El candado: nada en el tablero.
    expect(countAssignments(db)).toBe(0);
    expect(pendingDrafts(db, JOHN)).toHaveLength(1);
  });

  it("confirmar crea la pieza y aparece en el día del asignado (misma fuente que la web)", () => {
    const out = runBotTool(db, ctxJohn(), "crear_asignacion", {
      titulo: "Dashboard de bloqueos",
      responsable: "David",
      iniciativa: "WMS",
      prioridad: "High",
      fecha_limite: "2026-08-07",
      criterios_aceptacion: "Bloqueos ordenados por antigüedad",
    });
    const res = confirmDraft(db, ctxJohn(), out.draftId!);

    expect(res.outcome).toBe("ok");
    expect(countAssignments(db)).toBe(1);

    // `assignmentsForOwner` es la función con la que /equipo/hoy pinta el día.
    const deDavid = assignmentsForOwner(db, DAVID);
    expect(deDavid).toHaveLength(1);
    expect(deDavid[0].title).toBe("Dashboard de bloqueos");
    expect(deDavid[0].status).toBe("Asignada");
    expect(deDavid[0].priority).toBe("High");
    expect(deDavid[0].due_date).toBe("2026-08-07");
    expect(deDavid[0].initiative_name).toBe("WMS");
    expect(deDavid[0].acceptance_criteria).toBe("Bloqueos ordenados por antigüedad");
    expect(getDraft(db, out.draftId!)!.status).toBe("confirmado");
  });

  it("descartar no deja nada, y confirmar dos veces no crea dos piezas", () => {
    const primera = runBotTool(db, ctxJohn(), "crear_asignacion", { titulo: "Pieza descartada" });
    expect(discardDraft(db, ctxJohn(), primera.draftId!).outcome).toBe("ok");
    expect(countAssignments(db)).toBe(0);
    expect(confirmDraft(db, ctxJohn(), primera.draftId!).outcome).toBe("rechazado");
    expect(countAssignments(db)).toBe(0);

    const segunda = runBotTool(db, ctxJohn(), "crear_asignacion", { titulo: "Pieza buena" });
    expect(confirmDraft(db, ctxJohn(), segunda.draftId!).outcome).toBe("ok");
    expect(confirmDraft(db, ctxJohn(), segunda.draftId!).outcome).toBe("rechazado");
    expect(countAssignments(db)).toBe(1);
  });

  it("un responsable que no está en el roster no se inventa: queda sin asignar y se dice", () => {
    const out = runBotTool(db, ctxJohn(), "crear_asignacion", { titulo: "Algo", responsable: "Pepito" });
    expect(out.reply.text).toContain("sin resolver");
    confirmDraft(db, ctxJohn(), out.draftId!);
    const row = getAssignment(db, 1)!;
    expect(row.owner_wallet).toBeNull();
    expect(row.status).toBe("Backlog");
  });

  it("una iniciativa inexistente no se crea de contrabando", () => {
    const out = runBotTool(db, ctxJohn(), "crear_asignacion", { titulo: "Algo", iniciativa: "Cliente Nuevo SA" });
    confirmDraft(db, ctxJohn(), out.draftId!);
    expect(getAssignment(db, 1)!.initiative_id).toBeNull();
    const iniciativas = db.prepare(`SELECT slug FROM initiatives WHERE slug = 'cliente-nuevo-sa'`).all();
    expect(iniciativas).toHaveLength(0);
  });

  it("faltando el título, se pregunta: no se crea una pieza vacía", () => {
    expect(() => runBotTool(db, ctxJohn(), "crear_asignacion", { titulo: "ok" })).toThrow(BotToolError);
    expect(() => runBotTool(db, ctxJohn(), "crear_asignacion", {})).toThrow(BotToolError);
    expect(countAssignments(db)).toBe(0);
  });

  it("el check-in también espera confirmación y luego usa el upsert de WP14", () => {
    const out = runBotTool(db, ctxJohn(), "registrar_checkin", {
      hecho: "cerré la propuesta",
      haciendo: "revisando el tablero",
    });
    expect(getCheckin(db, JOHN, "2026-07-30")).toBeUndefined();

    confirmDraft(db, ctxJohn(), out.draftId!);
    const checkin = getCheckin(db, JOHN, "2026-07-30")!;
    expect(checkin.done).toBe("cerré la propuesta");
    expect(checkin.doing).toBe("revisando el tablero");

    expect(() => runBotTool(db, ctxJohn(), "registrar_checkin", {})).toThrow(BotToolError);
  });

  it("la nota se guarda al confirmar y las tareas se proponen UNA A UNA", () => {
    const out = runBotTool(db, ctxJohn(), "guardar_nota", {
      texto: "Reunión con el equipo: revisar la propuesta y preparar el tablero.",
      resumen: "Revisar propuesta y preparar tablero",
      referencia_reunion: "Comité de producto",
      tareas: ["Revisar la propuesta de analítica", "Preparar el tablero de la semana"],
    });
    expect(listNotes(db, JOHN)).toHaveLength(0);

    const confirmada = confirmDraft(db, ctxJohn(), out.draftId!);
    expect(listNotes(db, JOHN)).toHaveLength(1);
    expect(confirmada.reply.text).toContain(BOT_COPY.notaGuardada);
    expect(confirmada.reply.text).toContain(BOT_COPY.tareasDetectadas);
    // Solo la PRIMERA tarea se propone, y sigue sin crear nada.
    expect(confirmada.reply.text).toContain("Revisar la propuesta de analítica");
    expect(confirmada.reply.text).not.toContain("Preparar el tablero de la semana");
    expect(countAssignments(db)).toBe(0);
    expect(confirmada.nextDraftId).toBeGreaterThan(0);

    // Al confirmar la primera aparece la segunda.
    const segunda = confirmDraft(db, ctxJohn(), confirmada.nextDraftId!);
    expect(countAssignments(db)).toBe(1);
    expect(segunda.reply.text).toContain("Preparar el tablero de la semana");
    expect(segunda.nextDraftId).toBeGreaterThan(0);

    // Y descartar la última tampoco deja cola pendiente.
    discardDraft(db, ctxJohn(), segunda.nextDraftId!);
    expect(countAssignments(db)).toBe(1);
  });

  it("sin permiso de escritura (v1: solo John) no se propone ni se confirma nada", () => {
    const soloLectura: BotContext = { actor: ACTOR_DAVID, canWrite: false, now: JUEVES };
    const out = runBotTool(db, soloLectura, "crear_asignacion", { titulo: "Pieza de otro" });
    expect(out.outcome).toBe("rechazado");
    expect(out.reply.text).toBe(BOT_COPY.soloLectura);
    expect(out.draftId).toBeUndefined();
    expect(pendingDrafts(db, DAVID)).toHaveLength(0);
    expect(countAssignments(db)).toBe(0);

    // Y si alguien le pasa un id de borrador ajeno, tampoco.
    const draftId = createDraft(db, DAVID, "crear_asignacion", { titulo: "Colado" });
    expect(confirmDraft(db, soloLectura, draftId).outcome).toBe("rechazado");
    expect(countAssignments(db)).toBe(0);
  });

  it("nadie confirma el borrador de otra persona", () => {
    const draftId = createDraft(db, VALE, "crear_asignacion", { titulo: "De Vale" });
    expect(confirmDraft(db, ctxJohn(), draftId).outcome).toBe("rechazado");
    expect(countAssignments(db)).toBe(0);
  });

  it("un borrador con una herramienta desconocida se descarta, no se ejecuta", () => {
    const draftId = createDraft(db, JOHN, "pagar_nomina", { monto: 1000 });
    expect(confirmDraft(db, ctxJohn(), draftId).outcome).toBe("rechazado");
    expect(getDraft(db, draftId)!.status).toBe("descartado");
    expect(countAssignments(db)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("criterio 3 — /pendientes devuelve lo mismo que la web", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    const wms = upsertInitiative(db, "WMS");
    const dao = upsertInitiative(db, "DAO");
    createAssignment(db, { title: "Revisar propuesta", initiativeId: wms, ownerWallet: JOHN, status: "Asignada", priority: "High" });
    createAssignment(db, { title: "Gate de inversión", initiativeId: dao, ownerWallet: JOHN, status: "En curso" });
    createAssignment(db, { title: "Pieza de David", initiativeId: wms, ownerWallet: DAVID, status: "Asignada" });
    createAssignment(db, { title: "Ya cerrada", initiativeId: wms, ownerWallet: JOHN, status: "Hecha" });
  });

  it("la lista del bot es exactamente `assignmentsForOwner` (la de /equipo/hoy)", () => {
    const web = assignmentsForOwner(db, JOHN);
    const bot = pendientesDe(db, ctxJohn());
    expect(bot.map((a) => a.id)).toEqual(web.map((a) => a.id));
    expect(bot.map((a) => a.title)).toEqual(["Revisar propuesta", "Gate de inversión"]);
  });

  it("el filtro por iniciativa recorta sobre la misma fuente", () => {
    expect(pendientesDe(db, ctxJohn(), "WMS").map((a) => a.title)).toEqual(["Revisar propuesta"]);
    expect(pendientesDe(db, ctxJohn(), "dao").map((a) => a.title)).toEqual(["Gate de inversión"]);
    expect(pendientesDe(db, ctxJohn(), "harmony")).toHaveLength(0);
  });

  it("el texto agrupa por iniciativa y muestra el progreso propio al lado (WP09)", () => {
    const texto = renderPendientes(db, ctxJohn());
    expect(texto).toContain("WMS");
    expect(texto).toContain("DAO");
    expect(texto).toContain("Revisar propuesta");
    expect(texto).not.toContain("Pieza de David");
    expect(texto).toContain("Tu progreso");
  });

  it("sin trabajo abierto lo dice, no inventa", () => {
    const vacio = freshDb();
    expect(renderPendientes(vacio, ctxJohn())).toBe(BOT_COPY.sinPendientes);
  });
});

// ---------------------------------------------------------------------------

describe("criterio 4 — backlog conversacional sobre la misma fuente", () => {
  let db: DB;
  let id: number;
  beforeEach(() => {
    db = freshDb();
    id = createAssignment(db, { title: "Propuesta de analítica", ownerWallet: JOHN, status: "Backlog", priority: "Normal" });
  });

  it("«ciérralo» avanza UN paso con la máquina de estados, sin saltos", () => {
    expect(avanzarPieza(db, ctxJohn(), id).text).toContain("Asignada");
    expect(getAssignment(db, id)!.status).toBe("Asignada");
    avanzarPieza(db, ctxJohn(), id);
    expect(getAssignment(db, id)!.status).toBe("En curso");
    avanzarPieza(db, ctxJohn(), id);
    expect(getAssignment(db, id)!.status).toBe("En revisión");
    const ultima = avanzarPieza(db, ctxJohn(), id);
    expect(getAssignment(db, id)!.status).toBe("Hecha");
    expect(ultima.text).toContain("aprobada");

    // El historial quedó completo y honesto (append-only de WP14).
    const eventos = db.prepare(`SELECT action, to_status FROM assignment_events WHERE assignment_id = ? ORDER BY id`).all(id);
    expect(eventos).toEqual([
      { action: "asignar", to_status: "Asignada" },
      { action: "empezar", to_status: "En curso" },
      { action: "enviar_a_revision", to_status: "En revisión" },
      { action: "aprobar", to_status: "Hecha" },
    ]);
    expect(avanzarPieza(db, ctxJohn(), id).text).toBe(BOT_COPY.yaHecha);
  });

  it("una pieza bloqueada no se cierra a la fuerza: primero se destraba en el tablero", () => {
    applyAssignmentAction(db, { assignmentId: id, action: "asignar", actor: ACTOR_JOHN, now: JUEVES });
    applyAssignmentAction(db, { assignmentId: id, action: "bloquear", reason: "falta un dato del cliente", actor: ACTOR_JOHN, now: JUEVES });
    expect(avanzarPieza(db, ctxJohn(), id).text).toBe(BOT_COPY.sinAccionDisponible);
    expect(getAssignment(db, id)!.status).toBe("Bloqueada");
  });

  it("«sube la prioridad» mueve un escalón y se detiene en la máxima", () => {
    expect(subirPrioridadPieza(db, ctxJohn(), id).text).toContain("Alta");
    expect(getAssignment(db, id)!.priority).toBe("High");
    subirPrioridadPieza(db, ctxJohn(), id);
    expect(getAssignment(db, id)!.priority).toBe("Urgent");
    expect(subirPrioridadPieza(db, ctxJohn(), id).text).toBe(BOT_COPY.yaEnMaximaPrioridad);
    expect(getAssignment(db, id)!.priority).toBe("Urgent");
    // Subir prioridad no toca el estado: eso es territorio de la máquina.
    expect(getAssignment(db, id)!.status).toBe("Backlog");
  });

  it("no se mueve la pieza de otra persona", () => {
    const ajena = createAssignment(db, { title: "De Vale", ownerWallet: VALE, status: "Asignada" });
    const ctxDavid: BotContext = { actor: ACTOR_DAVID, canWrite: true, now: JUEVES };
    expect(avanzarPieza(db, ctxDavid, ajena).text).toBe(BOT_COPY.sinPermisoPieza);
    expect(subirPrioridadPieza(db, ctxDavid, ajena).text).toBe(BOT_COPY.sinPermisoPieza);
    expect(getAssignment(db, ajena)!.status).toBe("Asignada");
  });

  it("una pieza que no existe se dice, no se crea", () => {
    expect(avanzarPieza(db, ctxJohn(), 9999).text).toBe(BOT_COPY.piezaNoEncontrada);
    expect(subirPrioridadPieza(db, ctxJohn(), 9999).text).toBe(BOT_COPY.piezaNoEncontrada);
  });
});

// ---------------------------------------------------------------------------

describe("criterio 5 — los 3 focos del día", () => {
  let db: DB;
  let vencida: number;
  let esperaAJohn: number;
  let urgente: number;
  beforeEach(() => {
    db = freshDb();
    vencida = createAssignment(db, { title: "Vence ayer", ownerWallet: JOHN, status: "Asignada", priority: "Normal", dueDate: "2026-07-29" });
    esperaAJohn = createAssignment(db, { title: "Gate de John", ownerWallet: DAVID, status: "En curso", priority: "Low", needsFounder: true });
    urgente = createAssignment(db, { title: "Urgente sin fecha", ownerWallet: JOHN, status: "Asignada", priority: "Urgent" });
    createAssignment(db, { title: "Baja sin fecha", ownerWallet: JOHN, status: "Asignada", priority: "Low" });
  });

  it("propone tres: primero el vencimiento, luego lo que lo espera a él, luego la prioridad", () => {
    const focos = focosDelDia(db, ctxJohn());
    expect(focos).toHaveLength(FOCUS_COUNT);
    expect(focos.map((a) => a.id)).toEqual([vencida, esperaAJohn, urgente]);
    // Lo que espera una decisión suya sale de `founderInbox` de WP15.
    expect(founderInbox(db).map((a) => a.id)).toContain(esperaAJohn);
  });

  it("el texto se puede reordenar respondiendo y el orden se respeta", () => {
    const focos = focosDelDia(db, ctxJohn());
    const reordenados = reordenarFocos(focos, [3, 1, 2]);
    expect(reordenados.map((a) => a.id)).toEqual([urgente, vencida, esperaAJohn]);
    expect(renderFocos(reordenados)).toContain("1. #" + urgente);

    // Un orden parcial o con basura no pierde piezas ni duplica.
    expect(reordenarFocos(focos, [2]).map((a) => a.id)).toEqual([esperaAJohn, vencida, urgente]);
    expect(reordenarFocos(focos, [9, 0, -1, 2, 2]).map((a) => a.id)).toEqual([esperaAJohn, vencida, urgente]);
    expect(reordenarFocos([], [1, 2])).toEqual([]);
  });

  it("sin piezas abiertas lo dice", () => {
    expect(renderFocos([])).toBe(BOT_COPY.sinFocos);
  });

  it("la HORA sale del genoma versionado, no de un literal del bot", () => {
    expect(horaDeLosFocos(db)).toBe(7);

    const hora = horaDeLosFocos(db);
    expect(debeEnviarFocos(hora, new Date(2026, 6, 30, 9, 0, 0), null)).toBe(true);
    expect(debeEnviarFocos(hora, new Date(2026, 6, 30, 6, 59, 0), null)).toBe(false);
    // Una vez al día y no más.
    expect(debeEnviarFocos(hora, new Date(2026, 6, 30, 9, 0, 0), "2026-07-30")).toBe(false);
    expect(debeEnviarFocos(hora, new Date(2026, 6, 30, 9, 0, 0), "2026-07-29")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("consultar_estado sale de los agregados de WP15, no de consultas propias", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    const wms = upsertInitiative(db, "WMS");
    const id = createAssignment(db, { title: "Integración pendiente", initiativeId: wms, ownerWallet: DAVID, status: "Asignada" });
    applyAssignmentAction(db, { assignmentId: id, action: "bloquear", reason: "falta el acceso al ambiente", actor: ACTOR_JOHN, now: JUEVES });
    createAssignment(db, { title: "Gate de inversión", ownerWallet: DAVID, status: "En curso", needsFounder: true });
  });

  it("los bloqueos son los de `blockedWithAge`, con motivo y antigüedad", () => {
    const out = runBotTool(db, ctxJohn(), "consultar_estado", { alcance: "bloqueos" });
    expect(out.outcome).toBe("ok");
    expect(out.reply.text).toContain("Integración pendiente");
    expect(out.reply.text).toContain("falta el acceso al ambiente");
    expect(blockedWithAge(db, JUEVES)).toHaveLength(1);
    expect(out.reply.keyboard).toBeUndefined(); // solo lectura: sin botones
  });

  it("la bandeja «esperando a mí» es `founderInbox`", () => {
    const out = runBotTool(db, ctxJohn(), "consultar_estado", { alcance: "esperando_a_mi" });
    expect(out.reply.text).toContain("Gate de inversión");
  });

  it("el tablero completo pasa por la puerta de `buildDashboard`: un core normal recibe 403", () => {
    const ctxDavid: BotContext = { actor: ACTOR_DAVID, canWrite: false, now: JUEVES };
    expect(() => runBotTool(db, ctxDavid, "consultar_estado", { alcance: "todo" })).toThrow(TeamError);
    const out = runBotTool(db, ctxJohn(), "consultar_estado", { alcance: "todo" });
    expect(out.reply.text).toContain("Bloqueadas: 1");
  });

  it("un alcance inventado se rechaza", () => {
    expect(() => runBotTool(db, ctxJohn(), "consultar_estado", { alcance: "nomina" })).toThrow(BotToolError);
    expect(() => runBotTool(db, ctxJohn(), "consultar_estado", {})).toThrow(BotToolError);
  });

  it("todos los alcances responden algo sin explotar", () => {
    const alcances = ["bloqueos", "esperando_a_mi", "iniciativas", "carga", "epoca", "ritos", "digest", "mis_pendientes", "equipo", "todo"];
    for (const alcance of alcances) {
      const out = runBotTool(db, ctxJohn(), "consultar_estado", { alcance });
      expect(out.reply.text.length, alcance).toBeGreaterThan(0);
    }
  });

  it("no_entendido pregunta en vez de adivinar y no escribe nada", () => {
    const out = runBotTool(db, ctxJohn(), "no_entendido", { pregunta: "¿Para quién es la tarea?" });
    expect(out.outcome).toBe("no_entendido");
    expect(out.reply.text).toContain(BOT_COPY.noEntendido);
    expect(out.reply.text).toContain("¿Para quién es la tarea?");
    expect(countAssignments(db)).toBe(2); // las del fixture, ninguna nueva
  });
});

// ---------------------------------------------------------------------------

describe("criterio 6 — copys auditados", () => {
  const PROHIBIDO = [
    "bajo desempeño",
    "bajo rendimiento",
    "mal desempeño",
    "no cumple",
    "incumplido",
    "improductiv",
    "ranking de personas",
    "última conexión",
    "ultima conexion",
    "en línea",
    "horas trabajadas",
    "tiempo conectado",
    "vigilancia",
    "vigilar",
    "monitorear",
    "última vez visto",
  ];

  it("ningún copy del bot habla de horas, presencia o del valor de una persona", () => {
    const copys = Object.values(BOT_COPY).join(" ").toLowerCase();
    for (const p of PROHIBIDO) {
      expect(copys, `copy prohibido: '${p}'`).not.toContain(p);
    }
  });

  it("el código del bot tampoco (grep de las fuentes de WP19)", () => {
    const fuentes = ["telegram.ts", "bot-store.ts", "bot-tools.ts", "bot-agent.ts"]
      .map((f) => fs.readFileSync(path.join(process.cwd(), "src", "lib", f), "utf8"))
      .join("\n")
      .toLowerCase();
    for (const p of PROHIBIDO) {
      expect(fuentes, `vocabulario prohibido en el código: '${p}'`).not.toContain(p);
    }
  });

  it("los copys hablan de la pieza y de la entrega", () => {
    expect(BOT_COPY.soloLectura).toContain("tablero");
    expect(BOT_COPY.descartada).toContain("tablero");
    expect(BOT_COPY.sinTranscripcion).toContain("audio");
    expect(BOT_MIN_CONFIDENCE).toBeGreaterThan(0);
    expect(BOT_MIN_CONFIDENCE).toBeLessThan(1);
  });

  it("las descripciones que ve el modelo no le sugieren nada fuera de las 5 herramientas", () => {
    const contrato = JSON.stringify(BOT_TOOL_SPECS).toLowerCase();
    for (const p of ["pagar", "nómina", "nomina", "genoma", "credencial", "contraseña", "transferir", "cerrar la época"]) {
      expect(contrato, `el contrato del modelo menciona '${p}'`).not.toContain(p);
    }
  });
});
