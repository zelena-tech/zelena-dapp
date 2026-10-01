/**
 * Gamificación de las entregas (WP31 §5.B.3): criterios B3, B4, B9 y B12, más el
 * límite cliente/servidor de `gamificacion.ts`.
 *
 * Reglas que se prueban: lo ganado no se quita (solo créditos, nunca deltas
 * negativos), el tope es de la época y del bucket, se califica la entrega (quien la
 * entrega no cobra su propia aprobación, B8 en las dos direcciones) y todo INSERT
 * lleva el `period_id` de la época actual.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { GENOME_DEFAULTS, clearGenomeCache } from "./genome";
import { seedTeam } from "./team";
import { instanteDb, instanteLocal } from "./zona-horaria";
import { translate } from "./sql-dialect";
import { cargarPiezaSla, cargarPiezasAbiertas, slaDeAsignaciones } from "./sla-db";
import {
  INSIGNIAS,
  calcularPremioTarea,
  emitirPorAprobacion,
  insignias,
  presupuestoEjecucionRestante,
  progresoDeTareas,
  puntosDeEpoca,
  refTarea,
  senalesProgreso,
  textoEmision,
  textoInsignia,
  type SenalesProgreso,
} from "./gamificacion";

const SESION = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // wallet de sesión del founder
const PRINCIPAL = "pending:john"; // su fila de equipo (roster)
const DUENA = "GDUENAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REVISA = "GREVISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INVITA = "GINVITAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INVITADA = "GINVITADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DEL_FOUNDER = "GINVITADADELFOUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

function usuario(db: DB, wallet: string, o: { role?: string; invitedBy?: string | null } = {}): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, invited_by, cla_signed) VALUES (?, ?, ?, ?, 1)`
  ).run(wallet, wallet.slice(0, 10), o.role ?? "core", o.invitedBy ?? null);
}

function periodo(db: DB, id: number, state = "Open"): void {
  db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (?, ?, 100000, 5000, ?)`).run(
    id,
    `Época ${id}`,
    state
  );
}

function asignacion(db: DB, owner: string | null, o: { size?: string | null; publicada?: number | null } = {}): number {
  const info = db
    .prepare(
      `INSERT INTO assignments (title, owner_wallet, status, size, published_as_project_id) VALUES ('Pieza', ?, 'Hecha', ?, ?)`
    )
    .run(owner, o.size === undefined ? "M" : o.size, o.publicada ?? null);
  return Number(info.lastInsertRowid);
}

function filas(db: DB, ref: string): { puntos: Array<Record<string, unknown>>; rep: Array<Record<string, unknown>> } {
  return {
    puntos: db.prepare(`SELECT * FROM points_ledger WHERE ref = ? ORDER BY id`).all(ref) as Array<Record<string, unknown>>,
    rep: db.prepare(`SELECT * FROM reputation_events WHERE ref = ? ORDER BY id`).all(ref) as Array<Record<string, unknown>>,
  };
}

function negativos(db: DB): number {
  const p = db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE points < 0`).get() as { n: number };
  const r = db.prepare(`SELECT COUNT(*) AS n FROM reputation_events WHERE delta < 0`).get() as { n: number };
  return Number(p.n) + Number(r.n);
}

function presupuesto(db: DB, epochBudget: number): void {
  db.prepare(`INSERT INTO genome_versions (version, params, effective_from_epoch) VALUES (1, ?, 1)`).run(
    JSON.stringify({ EPOCH_BUDGET: epochBudget })
  );
  clearGenomeCache(db);
}

describe("calcularPremioTarea (criterio B3)", () => {
  const g = GENOME_DEFAULTS;
  it("S/M/L × a tiempo o no; sin tamaño cuenta como S", () => {
    expect(calcularPremioTarea({ size: "S", aTiempo: false }, g)).toEqual({ tamano: "S", base: 10, bono: 0, puntos: 10, reputacion: 1 });
    expect(calcularPremioTarea({ size: "S", aTiempo: true }, g)).toEqual({ tamano: "S", base: 10, bono: 3, puntos: 13, reputacion: 1 });
    expect(calcularPremioTarea({ size: "M", aTiempo: false }, g)).toEqual({ tamano: "M", base: 30, bono: 0, puntos: 30, reputacion: 3 });
    expect(calcularPremioTarea({ size: "M", aTiempo: true }, g)).toEqual({ tamano: "M", base: 30, bono: 8, puntos: 38, reputacion: 3 });
    expect(calcularPremioTarea({ size: "L", aTiempo: false }, g)).toEqual({ tamano: "L", base: 80, bono: 0, puntos: 80, reputacion: 8 });
    expect(calcularPremioTarea({ size: "L", aTiempo: true }, g)).toEqual({ tamano: "L", base: 80, bono: 20, puntos: 100, reputacion: 8 });
    expect(calcularPremioTarea({ size: null, aTiempo: false }, g)).toEqual({ tamano: "S", base: 10, bono: 0, puntos: 10, reputacion: 1 });
    expect(calcularPremioTarea({ size: null, aTiempo: true }, g).puntos).toBe(13);
  });

  it("los valores salen del genoma y nunca son negativos", () => {
    const propio = { TASK_POINTS: { S: 4, M: 9, L: 20 }, TASK_REP: { S: 2, M: 2, L: 5 }, ON_TIME_BONUS_PCT: 50 };
    expect(calcularPremioTarea({ size: "M", aTiempo: true }, propio)).toEqual({ tamano: "M", base: 9, bono: 5, puntos: 14, reputacion: 2 });
    const roto = { TASK_POINTS: { S: -5, M: -5, L: -5 }, TASK_REP: { S: -1, M: -1, L: -1 }, ON_TIME_BONUS_PCT: -20 };
    const r = calcularPremioTarea({ size: "L", aTiempo: true }, roto);
    expect(r.puntos).toBe(0);
    expect(r.bono).toBe(0);
    expect(r.reputacion).toBe(0);
    expect(refTarea(42)).toBe("assignment:42");
  });
});

describe("emitirPorAprobacion (criterio B4)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    periodo(db, 1);
    seedTeam(db); // pending:john (founder del roster), …
    usuario(db, SESION, { role: "founder" });
    usuario(db, DUENA, { role: "contributor" });
    usuario(db, REVISA);
    usuario(db, INVITA);
    usuario(db, INVITADA, { role: "contributor", invitedBy: INVITA });
    usuario(db, DEL_FOUNDER, { role: "contributor", invitedBy: SESION });
  });

  it("emite puntos en bucket ejecucion y reputación en eje ejecucion, con ref y period_id", () => {
    const id = asignacion(db, DUENA, { size: "M" });
    const r = emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: true });
    expect(r).toEqual({ emitido: true, puntos: 38, reputacion: 3, bono: 8, periodo: 1 });
    const { puntos, rep } = filas(db, refTarea(id));
    expect(puntos).toHaveLength(1);
    expect(puntos[0]).toMatchObject({ wallet: DUENA, points: 38, period_id: 1, bucket: "ejecucion", ref: `assignment:${id}` });
    expect(rep).toHaveLength(1);
    expect(rep[0]).toMatchObject({ wallet: DUENA, axis: "ejecucion", delta: 3, period_id: 1, ref: `assignment:${id}` });
  });

  it("la segunda vez es ya_emitido y no escribe nada", () => {
    const id = asignacion(db, DUENA);
    emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: false });
    const r = emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: true });
    expect(r).toMatchObject({ emitido: false, motivo: "ya_emitido", puntos: 0, reputacion: 0 });
    const { puntos, rep } = filas(db, refTarea(id));
    expect(puntos).toHaveLength(1);
    expect(rep).toHaveLength(1);
  });

  it("ya_emitido también si el ref está solo en points_ledger, o solo en reputation_events, de otra wallet", () => {
    const a = asignacion(db, DUENA);
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 10, 1, 'ejecucion', ?)`).run(
      "pending:otra",
      refTarea(a)
    );
    expect(emitirPorAprobacion(db, { assignmentId: a, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "S", aTiempo: false }).motivo).toBe(
      "ya_emitido"
    );
    expect(filas(db, refTarea(a)).rep).toHaveLength(0);

    const b = asignacion(db, DUENA);
    db.prepare(`INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, 'ejecucion', 1, ?, 1)`).run(
      "pending:otra",
      refTarea(b)
    );
    expect(emitirPorAprobacion(db, { assignmentId: b, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "S", aTiempo: false }).motivo).toBe(
      "ya_emitido"
    );
    expect(filas(db, refTarea(b)).puntos).toHaveLength(0);
  });

  it("misma persona → autoaprobacion, también con las dos identidades del founder", () => {
    const propia = asignacion(db, DUENA);
    expect(emitirPorAprobacion(db, { assignmentId: propia, ownerWallet: DUENA, aprobadorWallet: DUENA, size: "M", aTiempo: true })).toMatchObject({
      emitido: false,
      motivo: "autoaprobacion",
    });
    const delPrincipal = asignacion(db, PRINCIPAL);
    expect(
      emitirPorAprobacion(db, { assignmentId: delPrincipal, ownerWallet: PRINCIPAL, aprobadorWallet: SESION, size: "M", aTiempo: false }).motivo
    ).toBe("autoaprobacion");
    const deLaSesion = asignacion(db, SESION);
    expect(
      emitirPorAprobacion(db, { assignmentId: deLaSesion, ownerWallet: SESION, aprobadorWallet: PRINCIPAL, size: "M", aTiempo: false }).motivo
    ).toBe("autoaprobacion");
    for (const id of [propia, delPrincipal, deLaSesion]) {
      expect(filas(db, refTarea(id))).toEqual({ puntos: [], rep: [] });
    }
  });

  it("B8 en las dos direcciones → invitacion; el founder sí puede aprobar a su invitado", () => {
    const deLaInvitada = asignacion(db, INVITADA);
    expect(
      emitirPorAprobacion(db, { assignmentId: deLaInvitada, ownerWallet: INVITADA, aprobadorWallet: INVITA, size: "M", aTiempo: false }).motivo
    ).toBe("invitacion");
    const deQuienInvita = asignacion(db, INVITA);
    expect(
      emitirPorAprobacion(db, { assignmentId: deQuienInvita, ownerWallet: INVITA, aprobadorWallet: INVITADA, size: "M", aTiempo: false }).motivo
    ).toBe("invitacion");
    expect(filas(db, refTarea(deLaInvitada))).toEqual({ puntos: [], rep: [] });
    expect(filas(db, refTarea(deQuienInvita))).toEqual({ puntos: [], rep: [] });

    // Founder exento (por su rol, con cualquiera de sus identidades).
    const delInvitadoDelFounder = asignacion(db, DEL_FOUNDER);
    expect(
      emitirPorAprobacion(db, {
        assignmentId: delInvitadoDelFounder,
        ownerWallet: DEL_FOUNDER,
        aprobadorWallet: PRINCIPAL,
        size: "S",
        aTiempo: false,
      }).emitido
    ).toBe(true);
  });

  it("B8 exime al founder también como DUEÑO: su entrega la aprueba quien él invitó, y emite", () => {
    // Misma regla que la puerta (`puedeTransicionar`): si allí se aprueba, aquí se emite.
    // Con cualquiera de sus identidades como dueño (fila de equipo o cuenta de sesión).
    for (const dueno of [PRINCIPAL, SESION]) {
      const id = asignacion(db, dueno);
      const r = emitirPorAprobacion(db, { assignmentId: id, ownerWallet: dueno, aprobadorWallet: DEL_FOUNDER, size: "S", aTiempo: false });
      expect(r).toMatchObject({ emitido: true, puntos: 10, reputacion: 1 });
      expect(r.motivo).toBeUndefined();
      expect(filas(db, refTarea(id)).rep).toHaveLength(1);
    }
    // Y cuando la invitación salió de su fila de equipo (no de la sesión), igual.
    db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(PRINCIPAL, REVISA);
    const otra = asignacion(db, SESION);
    expect(
      emitirPorAprobacion(db, { assignmentId: otra, ownerWallet: SESION, aprobadorWallet: REVISA, size: "S", aTiempo: false }).emitido
    ).toBe(true);
  });

  it("B8 mira todas las identidades: la invitación de la fila de equipo cuenta para la cuenta vinculada", () => {
    // DUENA es la cuenta real de un slug del roster cuya fila de equipo entró invitada por
    // INVITA: la puerta no deja aprobar a INVITA, y la emisión tampoco paga.
    db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(INVITA, "pending:juan");
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('juan', ?, ?)`).run(DUENA, SESION);
    const id = asignacion(db, DUENA);
    expect(
      emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: INVITA, size: "S", aTiempo: false }).motivo
    ).toBe("invitacion");
    // Al revés: si DUENA aprueba a quien entró con la invitación de su fila de equipo, no se emite.
    const deSuInvitada = asignacion(db, INVITADA);
    db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run("pending:juan", INVITADA);
    expect(
      emitirPorAprobacion(db, { assignmentId: deSuInvitada, ownerWallet: INVITADA, aprobadorWallet: DUENA, size: "S", aTiempo: false })
        .motivo
    ).toBe("invitacion");
    expect(filas(db, refTarea(id))).toEqual({ puntos: [], rep: [] });
    expect(filas(db, refTarea(deSuInvitada))).toEqual({ puntos: [], rep: [] });
  });

  it("pieza publicada en el Ágora → publicada_en_agora, sin filas (se paga por sus hitos)", () => {
    const proyecto = db
      .prepare(
        `INSERT INTO projects (campaign, title, type, budget_usd, weeks, supervisor_wallet, summary, description, acceptance)
         VALUES ('Zelena', 'Pieza pública', 'DAO', 1000, 4, ?, 'r', 'd', 'a')`
      )
      .run(SESION);
    const id = asignacion(db, DUENA, { publicada: Number(proyecto.lastInsertRowid) });
    const r = emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "L", aTiempo: true });
    expect(r).toMatchObject({ emitido: false, motivo: "publicada_en_agora", puntos: 0, reputacion: 0 });
    expect(filas(db, refTarea(id))).toEqual({ puntos: [], rep: [] });
    expect(textoEmision(r)).toBe("Esta pieza se paga por sus hitos en el Ágora.");
  });

  it("sin responsable → sin_responsable", () => {
    const id = asignacion(db, null);
    expect(emitirPorAprobacion(db, { assignmentId: id, ownerWallet: null, aprobadorWallet: REVISA, size: "S", aTiempo: false }).motivo).toBe(
      "sin_responsable"
    );
    expect(filas(db, refTarea(id))).toEqual({ puntos: [], rep: [] });
  });

  it("clamp: presupuesto 100, gastado 90 → 10 puntos y reputación completa; agotado → 0 puntos y reputación igual", () => {
    presupuesto(db, 100);
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 90, 1, 'ejecucion', 'Hito previo')`).run(
      REVISA
    );
    expect(presupuestoEjecucionRestante(db, 1)).toBe(10);
    const a = asignacion(db, DUENA);
    const r = emitirPorAprobacion(db, { assignmentId: a, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: true });
    expect(r).toEqual({ emitido: true, motivo: "presupuesto_agotado", puntos: 10, reputacion: 3, bono: 0, periodo: 1 });
    expect(textoEmision(r)).toBe("Esta temporada el presupuesto de puntos se completó: tu reputación quedó entera.");
    expect(filas(db, refTarea(a)).puntos[0]).toMatchObject({ points: 10 });
    expect(filas(db, refTarea(a)).rep[0]).toMatchObject({ delta: 3 });
    expect(presupuestoEjecucionRestante(db, 1)).toBe(0);

    const b = asignacion(db, DUENA, { size: "L" });
    const r2 = emitirPorAprobacion(db, { assignmentId: b, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "L", aTiempo: false });
    expect(r2).toEqual({ emitido: true, motivo: "presupuesto_agotado", puntos: 0, reputacion: 8, bono: 0, periodo: 1 });
    expect(filas(db, refTarea(b)).puntos).toHaveLength(0); // nunca una fila de 0 ni negativa
    expect(filas(db, refTarea(b)).rep[0]).toMatchObject({ delta: 8 });
    // Y la reputación marca la emisión: no se vuelve a emitir.
    expect(emitirPorAprobacion(db, { assignmentId: b, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "L", aTiempo: false }).motivo).toBe(
      "ya_emitido"
    );
    expect(negativos(db)).toBe(0);
  });

  it("los puntos de otra época y los de Academia no cuentan para el tope; la fila va a la época actual", () => {
    presupuesto(db, 100);
    db.prepare(`UPDATE periods SET state = 'Closed' WHERE id = 1`).run();
    periodo(db, 2);
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 100, 1, 'ejecucion', 'Época vieja')`).run(REVISA);
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 95, 2, 'academia', 'Academia #1')`).run(REVISA);
    expect(puntosDeEpoca(db, 2, "ejecucion")).toBe(0);
    expect(puntosDeEpoca(db, 2, "academia")).toBe(95);
    expect(presupuestoEjecucionRestante(db, 2)).toBe(100);
    const id = asignacion(db, DUENA, { size: "L" });
    const r = emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "L", aTiempo: false });
    expect(r).toEqual({ emitido: true, puntos: 80, reputacion: 8, bono: 0, periodo: 2 });
    expect(filas(db, refTarea(id)).puntos[0]).toMatchObject({ period_id: 2 });
    expect(filas(db, refTarea(id)).rep[0]).toMatchObject({ period_id: 2 });
  });

  it("se une a la transacción del llamador: si el llamador revierte, no queda nada", () => {
    const id = asignacion(db, DUENA);
    expect(() =>
      db.transaction(() => {
        emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: false });
        throw new Error("la aprobación falló después");
      })()
    ).toThrow(/falló/);
    expect(filas(db, refTarea(id))).toEqual({ puntos: [], rep: [] });
  });

  it("nunca deltas negativos", () => {
    for (const size of ["S", "M", "L", null] as const) {
      const id = asignacion(db, DUENA, { size });
      emitirPorAprobacion(db, { assignmentId: id, ownerWallet: DUENA, aprobadorWallet: REVISA, size, aTiempo: size === "L" });
    }
    expect(negativos(db)).toBe(0);
  });
});

describe("insignias y señales de progreso (criterio B9)", () => {
  const cero: SenalesProgreso = {
    entregasAprobadas: 0,
    entregasATiempo: 0,
    entregasL: 0,
    revisionesHechas: 0,
    ritosAsistidos: 0,
    ritosAnfitrion: 0,
  };

  it("catálogo de §5.B.3 con metas del genoma: progreso actual/meta, nunca «perdida»", () => {
    expect(INSIGNIAS.map((i) => i.id)).toEqual([
      "primera-entrega",
      "diez-entregas",
      "a-tiempo",
      "pieza-grande",
      "ojo-de-revisor",
      "presente",
      "anfitrion",
    ]);
    const lista = insignias({ ...cero, entregasAprobadas: 4, ritosAsistidos: 3 }, GENOME_DEFAULTS.BADGE_GOALS);
    const por = Object.fromEntries(lista.map((i) => [i.id, i]));
    expect(por["primera-entrega"]).toMatchObject({ obtenida: true, actual: 4, meta: 1 });
    expect(por["diez-entregas"]).toMatchObject({ obtenida: false, actual: 4, meta: 10 });
    expect(por["presente"]).toMatchObject({ obtenida: true, actual: 3, meta: 3 });
    expect(por["anfitrion"]).toMatchObject({ obtenida: false, actual: 0, meta: 1 });
    expect(textoInsignia(por["primera-entrega"])).toBe("Primera entrega · conseguida");
    expect(textoInsignia(por["diez-entregas"])).toBe("Diez entregas · 4 de 10");
    const todo = JSON.stringify(lista) + lista.map(textoInsignia).join(" ");
    expect(todo).not.toMatch(/perdid|racha|ranking|posici/i);
  });

  it("la meta sale del genoma (y una meta inválida cae al valor por defecto)", () => {
    const metas = { ...GENOME_DEFAULTS.BADGE_GOALS, "diez-entregas": 3, presente: 0 };
    const por = Object.fromEntries(insignias({ ...cero, entregasAprobadas: 4 }, metas).map((i) => [i.id, i]));
    expect(por["diez-entregas"]).toMatchObject({ obtenida: true, meta: 3 });
    expect(por["presente"]).toMatchObject({ obtenida: false, meta: 3 });
  });

  describe("senalesProgreso y progresoDeTareas sobre la base", () => {
    let db: DB;
    const TZ = "America/Bogota";
    const lun = (hhmm: string) => instanteLocal("2026-10-05", hhmm, TZ);

    function aprobada(owner: string, aprobador: string, o: { size?: string; due?: string | null; aprobadaEn?: Date } = {}): number {
      const info = db
        .prepare(`INSERT INTO assignments (title, owner_wallet, status, size, due_date, created_at) VALUES ('P', ?, 'Hecha', ?, ?, ?)`)
        .run(owner, o.size ?? "S", o.due ?? null, instanteDb(lun("08:00")));
      const id = Number(info.lastInsertRowid);
      const ev = db.prepare(
        `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, actor_wallet, day, created_at)
         VALUES (?, ?, ?, ?, ?, '2026-10-05', ?)`
      );
      ev.run(id, "crear", "Backlog", "Asignada", owner, instanteDb(lun("08:00")));
      ev.run(id, "enviar_a_revision", "En curso", "En revisión", owner, instanteDb(lun("09:00")));
      ev.run(id, "aprobar", "En revisión", "Hecha", aprobador, instanteDb(o.aprobadaEn ?? lun("10:00")));
      return id;
    }

    function rito(id: number, state: string, host: string | null, recorder: string | null): void {
      db.prepare(
        `INSERT INTO rite_sessions (id, kind, scheduled_for, duration_min, state, host_wallet, recorder_wallet)
         VALUES (?, 'demo', ?, 60, ?, ?, ?)`
      ).run(id, `2026-10-0${id}T21:00:00.000Z`, state, host, recorder);
    }

    beforeEach(() => {
      db = freshDb();
      periodo(db, 1);
      seedTeam(db);
      usuario(db, SESION, { role: "founder" });
      usuario(db, REVISA);
      usuario(db, DUENA, { role: "contributor" });
    });

    it("cuenta solo aprobaciones de otra persona y suma las identidades del founder", () => {
      aprobada(PRINCIPAL, REVISA, { size: "L", due: "2026-10-05" }); // a tiempo (lun 10:00 ≤ lun 18:00)
      aprobada(SESION, REVISA, { due: "2026-10-02" }); // fuera de plazo (venció el viernes)
      aprobada(PRINCIPAL, SESION); // se la aprobó a sí mismo: no cuenta
      aprobada(DUENA, PRINCIPAL); // revisión del founder sobre una pieza ajena
      aprobada(REVISA, REVISA); // autoaprobación de otra persona: no es revisión de nadie

      const founder = senalesProgreso(db, SESION);
      expect(founder.entregasAprobadas).toBe(2);
      expect(founder.entregasATiempo).toBe(1);
      expect(founder.entregasL).toBe(1);
      expect(founder.revisionesHechas).toBe(1);
      expect(senalesProgreso(db, PRINCIPAL)).toEqual(founder); // misma persona, mismas señales

      const revisa = senalesProgreso(db, REVISA);
      expect(revisa.revisionesHechas).toBe(2); // las dos piezas del founder
      expect(revisa.entregasAprobadas).toBe(0); // la suya se la aprobó ella misma
    });

    it("ritos asistidos (capa 1) y ritos cerrados como anfitrión o relator", () => {
      rito(1, "Closed", SESION, null);
      rito(2, "Closed", REVISA, PRINCIPAL);
      rito(3, "Planned", SESION, null); // aún no se sostuvo
      rito(4, "Closed", PRINCIPAL, SESION); // anfitrión y relator a la vez: cuenta una vez
      const asiste = db.prepare(`INSERT INTO rite_attendance (session_id, wallet, layer) VALUES (?, ?, ?)`);
      asiste.run(1, SESION, 1);
      asiste.run(2, PRINCIPAL, 1);
      asiste.run(2, SESION, 1); // la misma persona con sus dos identidades en el mismo rito: una vez
      asiste.run(4, REVISA, 1);
      asiste.run(4, REVISA, 2); // otra capa no suma
      const s = senalesProgreso(db, SESION);
      expect(s.ritosAsistidos).toBe(2);
      expect(s.ritosAnfitrion).toBe(3);
      expect(senalesProgreso(db, REVISA)).toMatchObject({ ritosAsistidos: 1, ritosAnfitrion: 1 });
    });

    it("progresoDeTareas suma la época y todas las identidades, solo refs de entregas", () => {
      const a = aprobada(PRINCIPAL, REVISA, { size: "M" });
      const b = aprobada(SESION, REVISA, { size: "S" });
      emitirPorAprobacion(db, { assignmentId: a, ownerWallet: PRINCIPAL, aprobadorWallet: REVISA, size: "M", aTiempo: true });
      emitirPorAprobacion(db, { assignmentId: b, ownerWallet: SESION, aprobadorWallet: REVISA, size: "S", aTiempo: false });
      db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 500, 1, 'ejecucion', 'Hito aprobado: X')`).run(
        SESION
      );
      db.prepare(`INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, 'ejecucion', 7, 'assignment:999', 2)`).run(
        SESION
      );
      expect(progresoDeTareas(db, SESION, 1)).toEqual({ puntos: 38 + 10, reputacion: 3 + 1, entregas: 2 });
      expect(progresoDeTareas(db, PRINCIPAL, 1)).toEqual({ puntos: 48, reputacion: 4, entregas: 2 });
      expect(progresoDeTareas(db, SESION, 2)).toEqual({ puntos: 0, reputacion: 7, entregas: 1 });
      expect(progresoDeTareas(db, REVISA, 1)).toEqual({ puntos: 0, reputacion: 0, entregas: 0 });
    });
  });
});

// ---------------------------------------------------------------------------
// B12 y límite cliente/servidor
// ---------------------------------------------------------------------------

const LIB = path.join(process.cwd(), "src", "lib");

function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Especificadores de los imports y re-exports DE VALOR de un archivo. */
function importsDeValor(src: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const m of sinComentarios(src).matchAll(re)) {
    const cuerpo = m[2].trim();
    if (/^type\b/.test(cuerpo)) continue;
    const llaves = /^\{([\s\S]*)\}$/.exec(cuerpo);
    if (llaves && llaves[1].split(",").every((s) => !s.trim() || /^type\b/.test(s.trim()))) continue;
    out.push(m[3]);
  }
  return out;
}

function cadena(archivo: string): { archivos: string[]; externos: string[] } {
  const visto = new Set<string>();
  const externos: string[] = [];
  const pend = [archivo];
  while (pend.length) {
    const f = pend.pop() as string;
    if (visto.has(f)) continue;
    visto.add(f);
    for (const spec of importsDeValor(fs.readFileSync(path.join(LIB, f), "utf8"))) {
      if (!spec.startsWith("./")) externos.push(spec);
      else pend.push(spec.endsWith(".ts") ? spec.slice(2) : `${spec.slice(2)}.ts`);
    }
  }
  return { archivos: [...visto], externos };
}

/** Envuelve una base para registrar cada SQL que se prepara (misma conexión). */
function espia(db: DB): { db: DB; sqls: string[] } {
  const sqls: string[] = [];
  return {
    sqls,
    db: {
      prepare: (sql: string) => {
        sqls.push(sql);
        return db.prepare(sql);
      },
      exec: (sql: string) => db.exec(sql),
      pragma: (d: string) => db.pragma(d),
      transaction: db.transaction.bind(db) as DB["transaction"],
    },
  };
}

describe("esquema y SQL portable (criterio B11)", () => {
  it("las tablas del paso 0 y los índices de idempotencia por ref existen", () => {
    const db = freshDb();
    const nombres = (db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','index')`).all() as Array<{ name: string }>).map(
      (r) => r.name
    );
    for (const t of [
      "project_members",
      "roster_links",
      "talent_events",
      "rite_sessions",
      "rite_attendance",
      "avisos",
      "reminders_sent",
      "idx_rep_ref",
      "idx_points_ref",
    ]) {
      expect(nombres).toContain(t);
    }
  });

  it("todo el SQL de gamificacion.ts y sla-db.ts se traduce a T-SQL (Azure)", () => {
    const real = freshDb();
    periodo(real, 1);
    seedTeam(real);
    usuario(real, SESION, { role: "founder" });
    usuario(real, DUENA, { role: "contributor" });
    usuario(real, REVISA);
    const { db, sqls } = espia(real);
    const a = asignacion(db, DUENA);
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, actor_wallet, day) VALUES (?, 'aprobar', 'En revisión', 'Hecha', ?, '2026-10-05')`
    ).run(a, REVISA);
    sqls.length = 0; // solo cuenta el SQL de los módulos
    emitirPorAprobacion(db, { assignmentId: a, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: true });
    emitirPorAprobacion(db, { assignmentId: a, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: true });
    senalesProgreso(db, DUENA);
    senalesProgreso(db, REVISA);
    progresoDeTareas(db, SESION, 1);
    presupuestoEjecucionRestante(db, 1);
    slaDeAsignaciones(db, [a], new Date());
    cargarPiezasAbiertas(db);
    cargarPiezaSla(db, a);
    expect(sqls.length).toBeGreaterThan(10);
    for (const s of new Set(sqls)) expect(() => translate(s), s).not.toThrow();
  });
});

describe("estático (criterio B12) y límite cliente/servidor", () => {
  it("gamificacion.ts y epocas.ts nunca actualizan ni borran ledgers", () => {
    for (const f of ["gamificacion.ts", "epocas.ts"]) {
      const src = fs.readFileSync(path.join(LIB, f), "utf8");
      expect(src).not.toMatch(/UPDATE\s+points_ledger/i);
      expect(src).not.toMatch(/DELETE\s+FROM\s+points_ledger/i);
      expect(src).not.toMatch(/UPDATE\s+reputation_events/i);
      expect(src).not.toMatch(/DELETE\s+FROM\s+reputation_events/i);
    }
  });

  it("todo INSERT de ledgers en gamificacion.ts lleva period_id", () => {
    const src = sinComentarios(fs.readFileSync(path.join(LIB, "gamificacion.ts"), "utf8"));
    const inserts = [...src.matchAll(/INSERT INTO (points_ledger|reputation_events) \(([^)]*)\)/g)];
    expect(inserts.length).toBe(2);
    for (const m of inserts) expect(m[2]).toMatch(/\bperiod_id\b/);
  });

  it("gamificacion.ts no arrastra db.ts, crypto.ts, session.ts ni node: (ni en cadena)", () => {
    const { archivos, externos } = cadena("gamificacion.ts");
    expect(archivos).toEqual(expect.arrayContaining(["gamificacion.ts", "sla.ts", "sla-db.ts", "identidades.ts", "genome.ts"]));
    for (const p of ["db.ts", "crypto.ts", "session.ts"]) expect(archivos).not.toContain(p);
    expect(externos).toEqual([]);
  });

  it("los imports de valor relativos de gamificacion.ts llevan sufijo .ts (CLI con type-stripping)", () => {
    const rel = importsDeValor(fs.readFileSync(path.join(LIB, "gamificacion.ts"), "utf8")).filter((s) => s.startsWith("./"));
    expect(rel.length).toBeGreaterThan(0);
    for (const s of rel) expect(s.endsWith(".ts")).toBe(true);
  });
});
