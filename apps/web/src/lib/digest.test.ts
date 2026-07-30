/**
 * WP15 — el digest diario refleja EXACTAMENTE los check-ins y los cambios de
 * estado de ese día, y nada de otro día se cuela.
 *
 * También: la exportación en texto plano usa la misma puerta que el dashboard
 * (founder y supervisores) y no envía nada a nadie — el envío por correo/Teams
 * es NO-ALCANCE de v1.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal, type TeamActor } from "./roles";
import { TeamError, applyAssignmentAction, createAssignment, seedTeam, upsertCheckin } from "./team";
import {
  buildDailyDigest,
  buildTodayDigest,
  dailyDigestFor,
  digestFilename,
  renderDigestText,
} from "./digest";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const FAUSTO = pendingPrincipal("fausto");
const DAVID = pendingPrincipal("david");

/** Miércoles y jueves de la semana del lunes 2026-07-27, en hora local. */
const AYER = new Date(2026, 6, 29, 12, 0, 0);
const HOY = new Date(2026, 6, 30, 12, 0, 0);
const DIA_AYER = "2026-07-29";
const DIA_HOY = "2026-07-30";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

const ACTORS: Record<string, TeamActor> = {
  [JOHN]: { wallet: JOHN, name: "John", role: "founder", isSupervisor: true },
  [VALE]: { wallet: VALE, name: "Vale", role: "core", isSupervisor: true },
  [FAUSTO]: { wallet: FAUSTO, name: "Fausto", role: "core", isSupervisor: false },
  [DAVID]: { wallet: DAVID, name: "David", role: "core", isSupervisor: false },
};

describe("digest diario del equipo", () => {
  let db: DB;

  beforeEach(() => {
    db = freshDb();
  });

  it("consolida hecho / en curso / bloqueado del día a partir de check-ins y eventos reales", () => {
    // --- Ayer: ruido que NO debe aparecer en el digest de hoy ---
    upsertCheckin(db, DAVID, { done: "cosa de ayer", doing: "otra de ayer", blocked: "" }, AYER);
    const deAyer = createAssignment(db, { title: "Tarea de ayer", ownerWallet: DAVID, status: "Asignada" });
    applyAssignmentAction(db, { assignmentId: deAyer, action: "empezar", actor: ACTORS[DAVID], now: AYER });

    // --- Hoy ---
    const cerrada = createAssignment(db, { title: "Importador de CSV", ownerWallet: FAUSTO, status: "En revisión" });
    applyAssignmentAction(db, { assignmentId: cerrada, action: "aprobar", actor: ACTORS[VALE], now: HOY });

    const avanzada = createAssignment(db, { title: "Dashboard de seguimiento", ownerWallet: DAVID, status: "Asignada" });
    applyAssignmentAction(db, { assignmentId: avanzada, action: "empezar", actor: ACTORS[DAVID], now: HOY });

    const bloqueada = createAssignment(db, { title: "Integrar Odoo", ownerWallet: FAUSTO, status: "En curso" });
    applyAssignmentAction(db, {
      assignmentId: bloqueada,
      action: "bloquear",
      reason: "Falta la credencial del cliente",
      actor: ACTORS[FAUSTO],
      now: HOY,
    });

    upsertCheckin(db, VALE, { done: "cerré la spec de ritos", doing: "revisión de calidad", blocked: "" }, HOY);
    upsertCheckin(db, FAUSTO, { done: "", doing: "", blocked: "espero credencial de Odoo" }, HOY);

    const d = buildDailyDigest(db, DIA_HOY);

    expect(d.day).toBe(DIA_HOY);
    expect(d.empty).toBe(false);

    // Check-ins: exactamente los dos de hoy.
    expect(d.checkins.map((c) => c.name).sort()).toEqual(["Fausto", "Vale"]);
    expect(d.counts.checkins).toBe(2);

    // Hecho: la entrega aprobada hoy.
    expect(d.done.map((e) => e.title)).toEqual(["Importador de CSV"]);
    expect(d.done[0].actorName).toBe("Vale");

    // En curso: la que se movió hacia adelante hoy (no la de ayer).
    expect(d.advanced.map((e) => e.title)).toEqual(["Dashboard de seguimiento"]);
    expect(d.advanced[0].fromStatus).toBe("Asignada");
    expect(d.advanced[0].toStatus).toBe("En curso");

    // Bloqueado: el bloqueo nuevo de hoy, con su motivo.
    expect(d.blocked).toHaveLength(1);
    expect(d.blocked[0].title).toBe("Integrar Odoo");
    expect(d.blocked[0].reason).toBe("Falta la credencial del cliente");

    expect(d.unblocked).toHaveLength(0);
    expect(d.counts.events).toBe(3);
  });

  it("NO se cuela nada de otro día: cada digest solo trae su propio día", () => {
    upsertCheckin(db, DAVID, { done: "ayer", doing: "", blocked: "" }, AYER);
    upsertCheckin(db, VALE, { done: "hoy", doing: "", blocked: "" }, HOY);

    const ayerTask = createAssignment(db, { title: "De ayer", ownerWallet: DAVID, status: "Asignada" });
    applyAssignmentAction(db, { assignmentId: ayerTask, action: "empezar", actor: ACTORS[DAVID], now: AYER });
    const hoyTask = createAssignment(db, { title: "De hoy", ownerWallet: VALE, status: "Asignada" });
    applyAssignmentAction(db, { assignmentId: hoyTask, action: "empezar", actor: ACTORS[VALE], now: HOY });

    const hoy = buildDailyDigest(db, DIA_HOY);
    expect(hoy.checkins.map((c) => c.name)).toEqual(["Vale"]);
    expect(hoy.checkins[0].done).toBe("hoy");
    expect(hoy.advanced.map((e) => e.title)).toEqual(["De hoy"]);

    const ayer = buildDailyDigest(db, DIA_AYER);
    expect(ayer.checkins.map((c) => c.name)).toEqual(["David"]);
    expect(ayer.checkins[0].done).toBe("ayer");
    expect(ayer.advanced.map((e) => e.title)).toEqual(["De ayer"]);

    // Un día sin nada es vacío explícito, no un digest inventado.
    const otro = buildDailyDigest(db, "2026-07-20");
    expect(otro.empty).toBe(true);
    expect(otro.counts).toEqual({ checkins: 0, done: 0, advanced: 0, blocked: 0, unblocked: 0, events: 0 });
  });

  it("editar el check-in el mismo día no lo duplica en el digest", () => {
    upsertCheckin(db, VALE, { done: "primera versión", doing: "", blocked: "" }, HOY);
    upsertCheckin(db, VALE, { done: "versión corregida", doing: "", blocked: "" }, HOY);
    const d = buildDailyDigest(db, DIA_HOY);
    expect(d.checkins).toHaveLength(1);
    expect(d.checkins[0].done).toBe("versión corregida");
  });

  it("registra los desbloqueos del día como movimiento, no como cierre", () => {
    const id = createAssignment(db, { title: "Marca de Harmony", ownerWallet: DAVID, status: "En curso" });
    applyAssignmentAction(db, { assignmentId: id, action: "bloquear", reason: "espera diseño", actor: ACTORS[DAVID], now: AYER });
    applyAssignmentAction(db, { assignmentId: id, action: "desbloquear", actor: ACTORS[DAVID], now: HOY });

    const hoy = buildDailyDigest(db, DIA_HOY);
    expect(hoy.blocked).toHaveLength(0);
    expect(hoy.unblocked.map((e) => e.title)).toEqual(["Marca de Harmony"]);
    expect(hoy.unblocked[0].toStatus).toBe("En curso");
    expect(hoy.done).toHaveLength(0);

    const ayer = buildDailyDigest(db, DIA_AYER);
    expect(ayer.blocked.map((e) => e.title)).toEqual(["Marca de Harmony"]);
  });

  it("buildTodayDigest usa el día de la fecha que se le pasa", () => {
    upsertCheckin(db, VALE, { done: "hoy", doing: "", blocked: "" }, HOY);
    const d = buildTodayDigest(db, HOY);
    expect(d.day).toBe(DIA_HOY);
    expect(d.counts.checkins).toBe(1);
  });
});

describe("exportación en texto plano", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("rinde las tres secciones con los datos del día y no menciona ningún envío automático", () => {
    const cerrada = createAssignment(db, { title: "Importador de CSV", ownerWallet: FAUSTO, status: "En revisión" });
    applyAssignmentAction(db, { assignmentId: cerrada, action: "aprobar", actor: ACTORS[VALE], now: HOY });
    const bloqueada = createAssignment(db, { title: "Integrar Odoo", ownerWallet: FAUSTO, status: "En curso" });
    applyAssignmentAction(db, {
      assignmentId: bloqueada,
      action: "bloquear",
      reason: "Falta la credencial del cliente",
      actor: ACTORS[FAUSTO],
      now: HOY,
    });
    upsertCheckin(db, VALE, { done: "cerré la spec", doing: "revisión de calidad", blocked: "" }, HOY);

    const text = renderDigestText(buildDailyDigest(db, DIA_HOY));

    expect(text).toContain(`Digest del equipo - ${DIA_HOY}`);
    expect(text).toContain("HECHO");
    expect(text).toContain("Importador de CSV - entrega aprobada (Vale)");
    expect(text).toContain("Vale: cerré la spec");
    expect(text).toContain("EN CURSO");
    expect(text).toContain("Vale: revisión de calidad");
    expect(text).toContain("BLOQUEADO");
    expect(text).toContain("Integrar Odoo - Falta la credencial del cliente (Fausto)");
    expect(text).toContain("1 check-ins - 1 entregas cerradas - 1 bloqueos nuevos");
    // Texto plano de verdad: sin markdown que estorbe al pegarlo.
    expect(text).not.toMatch(/[*#`|]/);
    // v1 NO envía: el texto lo dice para que nadie asume lo contrario.
    expect(text).toContain("No se envio a nadie");

    // Determinista: el mismo digest siempre rinde el mismo texto.
    expect(renderDigestText(buildDailyDigest(db, DIA_HOY))).toBe(text);
  });

  it("un día sin novedades lo dice en vez de rellenar secciones", () => {
    const text = renderDigestText(buildDailyDigest(db, DIA_HOY));
    expect(text).toContain("Sin check-ins ni cambios de estado registrados este dia.");
    expect(text).not.toContain("HECHO");
    expect(text).not.toContain("BLOQUEADO");
  });

  it("nombra el archivo de descarga por día", () => {
    expect(digestFilename(DIA_HOY)).toBe("digest-equipo-2026-07-30.txt");
  });
});

describe("puerta de acceso del digest (misma que el dashboard)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("un core normal recibe 403 al pedir el digest del equipo", () => {
    try {
      dailyDigestFor(db, ACTORS[FAUSTO], DIA_HOY);
      throw new Error("debió lanzar");
    } catch (e) {
      expect(e).toBeInstanceOf(TeamError);
      expect((e as TeamError).status).toBe(403);
    }
  });

  it("un contributor recibe 403", () => {
    const actor: TeamActor = { wallet: "GDEMO", name: "Alguien", role: "contributor", isSupervisor: false };
    try {
      dailyDigestFor(db, actor, DIA_HOY);
      throw new Error("debió lanzar");
    } catch (e) {
      expect((e as TeamError).status).toBe(403);
    }
  });

  it("founder y supervisora entran", () => {
    expect(dailyDigestFor(db, ACTORS[JOHN], DIA_HOY).day).toBe(DIA_HOY);
    expect(dailyDigestFor(db, ACTORS[VALE], DIA_HOY).day).toBe(DIA_HOY);
  });
});
