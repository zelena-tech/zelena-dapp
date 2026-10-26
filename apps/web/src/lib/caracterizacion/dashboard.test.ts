/**
 * Prueba de caracterización · feature `dashboard` (docs/features/dashboard.md).
 *
 * Recorre el flujo principal de `/equipo/dashboard` contra una base SQLite temporal
 * (en memoria, mismo patrón que src/lib/dashboard.test.ts) y fija el comportamiento
 * ACTUAL, sin cambiarlo:
 *   1. El trabajo nace y se mueve con las funciones reales del módulo equipo
 *      (`createAssignmentAs`, `aplicarAccionAsignacion`, `upsertCheckin`).
 *   2. `buildDashboard` (lo que pinta la página) arma bloqueos, bandeja del founder,
 *      barras por proyecto, carga por persona, salud del rito y época.
 *   3. `plazosDelEquipo` separa lo vencido de lo que está por vencer.
 *   4. El digest del día (`buildDailyDigest` + `renderDigestText`) y su puerta
 *      (`dailyDigestFor`), que es lo que descarga `GET /api/equipo/digest`.
 *   5. La puerta: solo founder y supervisores; un `core` recibe 403. Un proyecto de
 *      cliente solo cuenta para quien participa (spec WP31 §4.A.12).
 *
 * Si una aserción marcada "COMPORTAMIENTO ACTUAL" deja de cumplirse porque se corrigió
 * el hallazgo que la acompaña, se actualiza la aserción y la ficha, no el código.
 * Personas: solo los slugs de la plantilla de roles del roster (Founder, Operaciones,
 * Plataforma, Producto…; repo público, A8 en b97448a); nada de datos reales.
 * Commit de referencia: 0e07d8f; revisada contra wp/32-release (4032c7c).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "../db";
import { pendingPrincipal, type TeamActor } from "../roles";
import {
  TeamError,
  agregarMiembro,
  aplicarAccionAsignacion,
  createAssignmentAs,
  crearProyecto,
  seedTeam,
  today,
  upsertCheckin,
} from "../team";
import { buildDashboard, plazosDelEquipo } from "../dashboard";
import { buildDailyDigest, dailyDigestFor, digestFilename, renderDigestText } from "../digest";
import { createClient } from "../clients";
import { clearGenomeCache } from "../genome";

const FILA_FOUNDER = pendingPrincipal("founder");
const OPERACIONES = pendingPrincipal("operaciones");
const PLATAFORMA = pendingPrincipal("plataforma");
const PRODUCTO = pendingPrincipal("producto");

const FOUNDER: TeamActor = { wallet: FILA_FOUNDER, name: "Founder", role: "founder", isSupervisor: true };
const SUPERVISORA: TeamActor = { wallet: OPERACIONES, name: "Operaciones", role: "core", isSupervisor: true };
const CORE_A: TeamActor = { wallet: PLATAFORMA, name: "Plataforma", role: "core", isSupervisor: false };
const CORE_B: TeamActor = { wallet: PRODUCTO, name: "Producto", role: "core", isSupervisor: false };

// Calendario en UTC (vitest.config.ts fija TZ=UTC, como Azure). Lunes 5 de octubre de 2026.
const LUN_09 = new Date("2026-10-05T14:00:00.000Z");
const LUN_10 = new Date("2026-10-05T15:00:00.000Z");
const LUN_11 = new Date("2026-10-05T16:00:00.000Z");
const JUE_10 = new Date("2026-10-08T15:00:00.000Z");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  vi.stubEnv("ZELENA_TEAM_ROSTER", ""); // sin roster del entorno: la plantilla de roles del código (A8)
  seedTeam(db);
  clearGenomeCache(db);
  return db;
}

function status(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof TeamError ? e.status : -1;
  }
}

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("caracterización · dashboard (flujo principal)", () => {
  let db: DB;
  let proyecto: number;
  let bloqueada: number;
  let conGate: number;
  let sinDueno: number;

  beforeEach(() => {
    db = freshDb();
    proyecto = crearProyecto(db, FOUNDER, { name: "Proyecto de prueba" }).id;

    // A: asignada a un core, que la empieza y la bloquea con motivo.
    bloqueada = createAssignmentAs(
      db,
      FOUNDER,
      { title: "Pieza que se bloquea", initiativeId: proyecto, ownerWallet: PLATAFORMA, priority: "High" },
      LUN_09
    );
    aplicarAccionAsignacion(db, { assignmentId: bloqueada, action: "empezar", actor: CORE_A, now: LUN_10 });
    aplicarAccionAsignacion(db, {
      assignmentId: bloqueada,
      action: "bloquear",
      reason: "falta el acceso al entorno",
      actor: CORE_A,
      now: LUN_11,
    });

    // B: espera decisión del founder y su fecha ya pasó.
    conGate = createAssignmentAs(
      db,
      FOUNDER,
      { title: "Pieza que espera decisión", initiativeId: proyecto, ownerWallet: PRODUCTO, needsFounder: true, dueDate: "2026-10-06" },
      LUN_09
    );
    aplicarAccionAsignacion(db, { assignmentId: conGate, action: "empezar", actor: CORE_B, now: LUN_10 });

    // C: sin responsable, en Backlog.
    sinDueno = createAssignmentAs(db, FOUNDER, { title: "Pieza sin responsable", initiativeId: proyecto }, LUN_09);

    // Check-in escrito el lunes.
    upsertCheckin(db, PLATAFORMA, { done: "revisé el inventario", doing: "migración", blocked: "acceso" }, LUN_10);
  });

  it("buildDashboard arma las seis secciones que pinta /equipo/dashboard", () => {
    const d = buildDashboard(db, SUPERVISORA, JUE_10);
    expect(d.day).toBe("2026-10-08");

    // 1. Bloqueos: motivo, desde cuándo (evento `bloquear`) y días bloqueada.
    expect(d.blocked).toHaveLength(1);
    expect(d.blocked[0].assignment.id).toBe(bloqueada);
    expect(d.blocked[0].reason).toBe("falta el acceso al entorno");
    expect(d.blocked[0].since).toBe("2026-10-05");
    expect(d.blocked[0].sinceSource).toBe("evento");
    expect(d.blocked[0].daysBlocked).toBe(3);

    // 2. Bandeja del founder: lo marcado needs_founder y no Hecha.
    expect(d.waitingOnFounder.map((a) => a.id)).toEqual([conGate]);

    // 3. Por proyecto: abiertas (incluye Backlog), bloqueadas y desglose por estado.
    const barra = d.initiatives.find((b) => b.initiative?.id === proyecto);
    expect(barra).toBeDefined();
    expect(barra!.open).toBe(2);
    expect(barra!.blocked).toBe(1);
    expect(barra!.byStatus).toEqual({
      Backlog: 1,
      Asignada: 0,
      "En curso": 1,
      "En revisión": 0,
      Hecha: 0,
      Bloqueada: 1,
    });
    // Sin época (tabla `periods` vacía) cuenta las cerradas de la semana.
    expect(barra!.closedThisEpoch).toBeNull();

    // 4. Carga por persona: orden ALFABÉTICO, sin el founder demo, con lo sin dueño aparte.
    const nombres = d.load.people.map((p) => p.name);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, "es")));
    expect(nombres).toHaveLength(6);
    const plataforma = d.load.people.find((p) => p.wallet === PLATAFORMA)!;
    const producto = d.load.people.find((p) => p.wallet === PRODUCTO)!;
    expect(plataforma).toMatchObject({ open: 0, blocked: 1, needsFounder: 0 });
    expect(producto).toMatchObject({ open: 1, inProgress: 1, needsFounder: 1 });
    expect(d.load.unassignedOpen).toBe(1);
    expect(d.load.totalOpen).toBe(2);

    // 5. Salud del rito: check-ins escritos / (miembros × días transcurridos).
    expect(d.rites).toMatchObject({ weekStart: "2026-10-05", daysElapsed: 4, members: 6, expected: 24, actual: 1, pct: 4 });

    // 6. Época: sin periodos no hay época; lo bloqueado sí se cuenta.
    expect(d.epoch.period).toBeNull();
    expect(d.epoch.closedThisEpoch).toBeNull();
    expect(d.epoch.blockedNow).toBe(1);
    expect(d.epoch.fitness).toBeNull();
  });

  it("plazosDelEquipo: lo vencido aparte, sin lo bloqueado ni lo hecho", () => {
    const p = plazosDelEquipo(db, SUPERVISORA, JUE_10);
    expect(p.vencidas.map((x) => x.assignment.id)).toEqual([conGate]);
    expect(p.vencidas[0].sla.fase).toBe("entrega");
    // La bloqueada no entra en plazos (tiene su sección); la de Backlog Normal no tiene plazo.
    const ids = [...p.vencidas, ...p.porVencer].map((x) => x.assignment.id);
    expect(ids).not.toContain(bloqueada);
    expect(ids).not.toContain(sinDueno);
    expect(p.sinPlazo).toBe(1);
  });

  it("el digest del día narra check-ins y cambios de estado, y se exporta como texto", () => {
    const dg = buildDailyDigest(db, "2026-10-05", SUPERVISORA);
    expect(dg.counts.checkins).toBe(1);
    // crear ×3, empezar ×2 y bloquear ×1, todos el lunes.
    expect(dg.counts.events).toBe(6);
    expect(dg.blocked.map((e) => e.assignmentId)).toEqual([bloqueada]);
    expect(dg.empty).toBe(false);

    const texto = renderDigestText(dailyDigestFor(db, SUPERVISORA, "2026-10-05"));
    expect(texto.split("\n")[0]).toBe("Digest del equipo - 2026-10-05");
    expect(texto).toContain("BLOQUEADO");
    expect(texto).toContain("Pieza que se bloquea - falta el acceso al entorno");
    expect(texto).toContain("No se envio a nadie: se copia a mano.");
    expect(digestFilename("2026-10-05")).toBe("digest-equipo-2026-10-05.txt");

    // Un día sin nada se dice, no se rellena.
    expect(renderDigestText(buildDailyDigest(db, "2026-10-04", SUPERVISORA))).toContain(
      "Sin check-ins ni cambios de estado registrados este dia."
    );
  });

  it("la puerta: founder y supervisión entran; un core recibe 403 en el tablero y en el digest", () => {
    expect(() => buildDashboard(db, FOUNDER, JUE_10)).not.toThrow();
    expect(status(() => buildDashboard(db, CORE_A, JUE_10))).toBe(403);
    expect(status(() => dailyDigestFor(db, CORE_A, "2026-10-05"))).toBe(403);
  });

  it("un proyecto de cliente solo cuenta para quien participa (§4.A.12): el founder sí, la supervisora no", () => {
    const cliente = createClient(db, { name: "Cliente de prueba" });
    const deCliente = crearProyecto(db, FOUNDER, { name: "Proyecto de cliente", clientId: cliente }).id;
    const pieza = createAssignmentAs(
      db,
      FOUNDER,
      { title: "Pieza de cliente", initiativeId: deCliente, ownerWallet: PLATAFORMA, needsFounder: true },
      LUN_09
    );
    aplicarAccionAsignacion(db, { assignmentId: pieza, action: "empezar", actor: CORE_A, now: LUN_10 });
    aplicarAccionAsignacion(db, { assignmentId: pieza, action: "bloquear", reason: "espera al cliente", actor: CORE_A, now: LUN_11 });

    const delFounder = buildDashboard(db, FOUNDER, JUE_10);
    const deLaSupervisora = buildDashboard(db, SUPERVISORA, JUE_10);
    expect(delFounder.blocked.map((b) => b.assignment.id)).toContain(pieza);
    expect(delFounder.waitingOnFounder.map((a) => a.id)).toContain(pieza);
    expect(deLaSupervisora.blocked.map((b) => b.assignment.id)).not.toContain(pieza);
    expect(deLaSupervisora.waitingOnFounder.map((a) => a.id)).not.toContain(pieza);
    expect(deLaSupervisora.initiatives.some((b) => b.initiative?.id === deCliente)).toBe(false);
    expect(deLaSupervisora.epoch.blockedNow).toBe(1);
    expect(delFounder.epoch.blockedNow).toBe(2);
    // Lo mismo en el digest: el bloqueo de la pieza de cliente no le llega a la supervisora.
    expect(buildDailyDigest(db, "2026-10-05", SUPERVISORA).blocked.map((e) => e.assignmentId)).not.toContain(pieza);
    expect(buildDailyDigest(db, "2026-10-05", FOUNDER).blocked.map((e) => e.assignmentId)).toContain(pieza);
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): el trabajo de una persona externa con rol en el proyecto no tiene fila en la carga", () => {
    const EXTERNA = "GEXTERNAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // wallet ficticia
    db.prepare(
      `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, 'Externa', 'contributor', 'active', 0, 1)`
    ).run(EXTERNA);
    agregarMiembro(db, FOUNDER, { initiativeId: proyecto, wallet: EXTERNA, rol: "ejecuta" });
    createAssignmentAs(db, FOUNDER, { title: "Pieza de la externa", initiativeId: proyecto, ownerWallet: EXTERNA }, LUN_09);

    const carga = buildDashboard(db, SUPERVISORA, JUE_10).load;
    expect(carga.people.some((p) => p.wallet === EXTERNA)).toBe(false);
    expect(carga.outsideRosterOpen).toBe(1); // se cuenta en los totales, sin fila propia
    expect(carga.totalOpen).toBe(3);
  });

  it("COMPORTAMIENTO ACTUAL (hallazgo): el día de la página y del digest sale del reloj del servidor, no de BUSINESS_TZ", () => {
    // 21:00 en Bogotá (UTC−5) del lunes = 02:00 UTC del martes. Con TZ=UTC (Azure),
    // `today()` ya devuelve el martes, aunque para el equipo sigue siendo lunes.
    expect(today(new Date("2026-10-06T02:00:00.000Z"))).toBe("2026-10-06");
  });
});
