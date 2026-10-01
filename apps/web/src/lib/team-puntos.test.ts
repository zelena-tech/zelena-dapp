/**
 * WP31-I1 · gancho de emisión: aprobar una entrega emite sus puntos y su reputación
 * en la MISMA transacción que la aprobación (spec §5.B.3, criterios I1, I2, I3, I8, I9).
 *
 * Reglas que se prueban: lo ganado no se quita (nunca un delta negativo; llegar tarde
 * solo pierde el extra), se califica la entrega y no a la persona (quien la entrega
 * no cobra su propia aprobación), la emisión es una sola por entrega (`ref`), todo va
 * a la época actual con `period_id` explícito, y si la base falla al emitir no queda
 * una aprobación sin lo suyo. Las personas son ficticias (wallets de prueba).
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openDb, type DB } from "./db";
import { GENOME_DEFAULTS, clearGenomeCache, currentEpoch } from "./genome";
import { MOTIVO_TRANSICION, pendingPrincipal, type TeamActor } from "./roles";
import { InvalidTeamTransitionError } from "./team-state-machine";
import { calcularPremioTarea, refTarea, textoEmision } from "./gamificacion";
import {
  accionesPermitidas,
  agregarMiembro,
  aplicarAccionAsignacion,
  applyAssignmentAction,
  createAssignmentAs,
  crearProyecto,
  getAssignment,
  seedTeam,
  TeamError,
  type ResultadoAccion,
  type Size,
} from "./team";

const JOHN = pendingPrincipal("john"); // founder (roster)

// Personas ficticias (wallets de prueba).
const ANA = "GANAENTREGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // ejecuta
const RITA = "GRITAREVISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // revisa
const EJE2 = "GOTRAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // ejecuta (no revisa)
const MADRINA = "GMADRINAREVISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // revisa e invitó a quien entrega

const FOUNDER: TeamActor = { wallet: JOHN, name: "John", role: "founder", isSupervisor: true };
const actor = (wallet: string): TeamActor => ({ wallet, name: wallet.slice(1, 6), role: "contributor", isSupervisor: false });

// Calendario (Bogotá = UTC−5). Lunes 5 de octubre de 2026 = "hoy".
const HOY_9AM = new Date("2026-10-05T14:00:00.000Z"); // lun 09:00
const HOY_2PM = new Date("2026-10-05T19:00:00.000Z"); // lun 14:00 (entrega)
const MANANA = "2026-10-06"; // mar: vence a las 18:00 locales = 23:00Z
const MANANA_3PM = new Date("2026-10-06T20:00:00.000Z"); // mar 15:00
const MANANA_1730 = new Date("2026-10-06T22:30:00.000Z"); // mar 17:30, antes del cierre
const MANANA_1830 = new Date("2026-10-06T23:30:00.000Z"); // mar 18:30, pasó el cierre del día hábil
const PASADO_MANANA = new Date("2026-10-07T15:00:00.000Z"); // mié 10:00

const G = GENOME_DEFAULTS;

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  clearGenomeCache(db);
  return db;
}

function usuario(db: DB, wallet: string, o: { invitedBy?: string | null } = {}): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed, invited_by)
     VALUES (?, ?, 'contributor', 'active', 0, 1, ?)`
  ).run(wallet, wallet.slice(1, 6), o.invitedBy ?? null);
}

function periodo(db: DB, id: number, state = "Open"): void {
  db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    `Época ${id}`,
    G.EPOCH_BUDGET,
    G.ACADEMIA_BUDGET,
    state
  );
}

/** Filas de los ledgers de una entrega (por su `ref`). */
function filas(db: DB, assignmentId: number) {
  const ref = refTarea(assignmentId);
  return {
    puntos: db.prepare(`SELECT wallet, points, period_id, bucket FROM points_ledger WHERE ref = ? ORDER BY id`).all(ref) as Array<{
      wallet: string;
      points: number;
      period_id: number;
      bucket: string;
    }>,
    rep: db.prepare(`SELECT wallet, axis, delta, period_id FROM reputation_events WHERE ref = ? ORDER BY id`).all(ref) as Array<{
      wallet: string;
      axis: string;
      delta: number;
      period_id: number;
    }>,
  };
}

function ledgers(db: DB): number {
  const a = (db.prepare(`SELECT COUNT(*) AS n FROM points_ledger`).get() as { n: number }).n;
  const b = (db.prepare(`SELECT COUNT(*) AS n FROM reputation_events`).get() as { n: number }).n;
  return a + b;
}

function negativos(db: DB): number {
  const a = (db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE points < 0`).get() as { n: number }).n;
  const b = (db.prepare(`SELECT COUNT(*) AS n FROM reputation_events WHERE delta < 0`).get() as { n: number }).n;
  return a + b;
}

function eventos(db: DB, assignmentId: number, accion: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM assignment_events WHERE assignment_id = ? AND action = ?`).get(assignmentId, accion) as {
      n: number;
    }
  ).n;
}

function fallo(fn: () => unknown): { status: number; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof TeamError) return { status: e.status, message: e.message };
    throw e;
  }
}

describe("WP31-I1 · gancho de emisión al aprobar", () => {
  let db: DB;
  let p: number;

  beforeEach(() => {
    db = freshDb();
    periodo(db, 1);
    for (const w of [ANA, RITA, EJE2]) usuario(db, w);
    usuario(db, MADRINA);
    p = crearProyecto(db, FOUNDER, { name: "Proyecto Piloto" }).id;
    agregarMiembro(db, FOUNDER, { initiativeId: p, wallet: ANA, rol: "ejecuta" });
    agregarMiembro(db, FOUNDER, { initiativeId: p, wallet: EJE2, rol: "ejecuta" });
    agregarMiembro(db, FOUNDER, { initiativeId: p, wallet: RITA, rol: "revisa" });
    agregarMiembro(db, FOUNDER, { initiativeId: p, wallet: MADRINA, rol: "revisa" });
  });

  /** La planifica el founder y la entrega ANA (por defecto: empieza hoy 09:00 y la envía hoy 14:00). */
  function entregada(
    o: { size?: Size | null; dueDate?: string | null; inicio?: Date; envio?: Date } = {}
  ): number {
    const inicio = o.inicio ?? HOY_9AM;
    const envio = o.envio ?? HOY_2PM;
    const id = createAssignmentAs(
      db,
      FOUNDER,
      {
        title: "Pieza de prueba",
        initiativeId: p,
        ownerWallet: ANA,
        size: o.size === undefined ? "M" : o.size,
        dueDate: o.dueDate === undefined ? MANANA : o.dueDate,
      },
      inicio
    );
    applyAssignmentAction(db, { assignmentId: id, action: "empezar", actor: actor(ANA), now: inicio });
    applyAssignmentAction(db, { assignmentId: id, action: "enviar_a_revision", actor: actor(ANA), now: envio });
    return id;
  }

  function aprobar(id: number, now: Date, quien: TeamActor = actor(RITA)): ResultadoAccion {
    return aplicarAccionAsignacion(db, { assignmentId: id, action: "aprobar", actor: quien, now });
  }

  describe("I1 · aprobar emite en la misma transacción", () => {
    it("puntos (bucket ejecucion) y reputación (eje ejecucion) para quien entregó, en la época actual", () => {
      const id = entregada({ size: "M" });
      const r = aprobar(id, MANANA_3PM);
      expect(r.row.status).toBe("Hecha");

      const premio = calcularPremioTarea({ size: "M", aTiempo: true }, G);
      const { puntos, rep } = filas(db, id);
      expect(puntos).toEqual([{ wallet: ANA, points: premio.puntos, period_id: currentEpoch(db), bucket: "ejecucion" }]);
      expect(rep).toEqual([{ wallet: ANA, axis: "ejecucion", delta: G.TASK_REP.M, period_id: currentEpoch(db) }]);
      expect(r.emision).toEqual({
        emitido: true,
        puntos: premio.puntos,
        reputacion: G.TASK_REP.M,
        bono: premio.bono,
        periodo: currentEpoch(db),
      });
      // Nada que explicar: la aprobación habla sola.
      expect(r.textoEmision).toBeNull();
    });

    it("la firma de siempre (applyAssignmentAction, la que usa el bot) también emite", () => {
      const id = entregada();
      const row = applyAssignmentAction(db, { assignmentId: id, action: "aprobar", actor: actor(RITA), now: MANANA_3PM });
      expect(row.status).toBe("Hecha");
      expect(filas(db, id).puntos).toHaveLength(1);
      expect(filas(db, id).rep).toHaveLength(1);
    });

    it("las demás acciones no emiten nada (emision = null)", () => {
      const id = createAssignmentAs(db, FOUNDER, { title: "Otra", initiativeId: p, ownerWallet: ANA }, HOY_9AM);
      const r = aplicarAccionAsignacion(db, { assignmentId: id, action: "empezar", actor: actor(ANA), now: HOY_9AM });
      expect(r.emision).toBeNull();
      expect(r.textoEmision).toBeNull();
      const d = entregada();
      const dev = aplicarAccionAsignacion(db, {
        assignmentId: d,
        action: "devolver",
        reason: "falta el caso de borde",
        actor: actor(RITA),
        now: MANANA_3PM,
      });
      expect(dev.emision).toBeNull();
      expect(ledgers(db)).toBe(0);
    });

    it("si la aprobación se rechaza, quien entrega no recibe nada", () => {
      const id = entregada();
      // Quien entrega no aprueba lo suyo.
      expect(fallo(() => aprobar(id, MANANA_3PM, actor(ANA)))).toEqual({ status: 403, message: MOTIVO_TRANSICION.dueno });
      // Quien solo ejecuta no revisa.
      expect(fallo(() => aprobar(id, MANANA_3PM, actor(EJE2)))?.status).toBe(403);
      expect(getAssignment(db, id)!.status).toBe("En revisión");
      expect(ledgers(db)).toBe(0);
    });

    it("B8: quien invitó a quien entrega no la aprueba, y no se emite nada", () => {
      db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(MADRINA, ANA);
      const id = entregada();
      expect(fallo(() => aprobar(id, MANANA_3PM, actor(MADRINA)))).toEqual({
        status: 403,
        message: MOTIVO_TRANSICION.invitacion,
      });
      expect(ledgers(db)).toBe(0);
      // Otra persona sin relación de invitación sí, y emite una vez.
      aprobar(id, MANANA_3PM);
      expect(filas(db, id).rep).toHaveLength(1);
    });

    it("el founder (exento de B8) aprueba a quien invitó y la entrega emite", () => {
      db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(JOHN, ANA);
      const id = entregada();
      const r = aprobar(id, MANANA_3PM, FOUNDER);
      expect(r.emision?.emitido).toBe(true);
      expect(filas(db, id).puntos[0]?.wallet).toBe(ANA);
    });

    describe("B8 · el founder también está exento como DUEÑO: la puerta y la emisión aplican la misma regla", () => {
      // Casi todo el equipo entró con una invitación del founder (por su fila de equipo o
      // por la cuenta con la que firma). Si la puerta deja aprobar su entrega pero la
      // emisión la trata como B8, la pieza queda Hecha (estado final) sin lo suyo.
      const SESION_FOUNDER = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // rol founder en la base
      const SUPERVISORA = "GSUPERVISAINVITADAPORELFOUNDERAAAAAAAAAAAAAAAAAAAAAAAAAA";
      const SUPERVISORA_ACTOR: TeamActor = { wallet: SUPERVISORA, name: "Super", role: "core", isSupervisor: true };

      beforeEach(() => {
        db.prepare(
          `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, 'John', 'founder', 'active', 0, 1)`
        ).run(SESION_FOUNDER);
        db.prepare(
          `INSERT INTO users (wallet, display_name, role, is_supervisor, status, is_demo, cla_signed, invited_by)
           VALUES (?, 'Super', 'core', 1, 'active', 0, 1, ?)`
        ).run(SUPERVISORA, SESION_FOUNDER);
      });

      /** Una pieza del founder: él la planifica, la empieza y la envía a revisión con `quien`. */
      function delFounder(dueno: string, quien: TeamActor): number {
        const id = createAssignmentAs(
          db,
          FOUNDER,
          { title: "Pieza del founder", initiativeId: p, ownerWallet: dueno, size: "M", dueDate: MANANA },
          HOY_9AM
        );
        applyAssignmentAction(db, { assignmentId: id, action: "empezar", actor: quien, now: HOY_9AM });
        applyAssignmentAction(db, { assignmentId: id, action: "enviar_a_revision", actor: quien, now: HOY_2PM });
        return id;
      }

      it("su fila de equipo aún sin vincular: la aprueba una supervisora que él invitó y emite", () => {
        const id = delFounder(JOHN, FOUNDER);
        const r = aprobar(id, MANANA_3PM, SUPERVISORA_ACTOR);
        expect(r.row.status).toBe("Hecha");
        const premio = calcularPremioTarea({ size: "M", aTiempo: true }, G);
        expect(r.emision).toEqual({
          emitido: true,
          puntos: premio.puntos,
          reputacion: G.TASK_REP.M,
          bono: premio.bono,
          periodo: currentEpoch(db),
        });
        expect(filas(db, id).puntos).toEqual([
          { wallet: JOHN, points: premio.puntos, period_id: currentEpoch(db), bucket: "ejecucion" },
        ]);
        expect(filas(db, id).rep).toEqual([{ wallet: JOHN, axis: "ejecucion", delta: G.TASK_REP.M, period_id: currentEpoch(db) }]);
      });

      it("ya vinculada (su cuenta real es la de la sesión): la aprueba quien revisa, invitada por su fila de equipo, y emite", () => {
        db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('john', ?, ?)`).run(SESION_FOUNDER, SESION_FOUNDER);
        db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(JOHN, RITA);
        const founderSesion: TeamActor = { wallet: SESION_FOUNDER, name: "John", role: "founder", isSupervisor: true };
        const id = delFounder(SESION_FOUNDER, founderSesion);
        const r = aprobar(id, MANANA_3PM, actor(RITA));
        expect(r.row.status).toBe("Hecha");
        expect(r.emision?.emitido).toBe(true);
        expect(r.emision?.motivo).toBeUndefined();
        expect(filas(db, id).puntos.map((f) => f.wallet)).toEqual([SESION_FOUNDER]);
        expect(filas(db, id).rep.map((f) => f.wallet)).toEqual([SESION_FOUNDER]);
      });

      it("el founder sigue sin cobrar su propia aprobación con ninguna de sus identidades", () => {
        const founderSesion: TeamActor = { wallet: SESION_FOUNDER, name: "John", role: "founder", isSupervisor: true };
        const id = delFounder(JOHN, FOUNDER);
        expect(fallo(() => aprobar(id, MANANA_3PM, founderSesion))).toEqual({ status: 403, message: MOTIVO_TRANSICION.dueno });
        expect(ledgers(db)).toBe(0);
      });

      it("la puerta y la emisión dicen lo mismo: lo que se deja aprobar emite, lo que se frena no llega a Hecha", () => {
        // Invitaciones de las dos identidades del founder (sesión y fila de equipo) y una
        // entre dos personas del equipo (MADRINA invitó a ANA).
        db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(SESION_FOUNDER, RITA);
        db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(JOHN, MADRINA);
        db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(MADRINA, ANA);
        const founderSesion: TeamActor = { wallet: SESION_FOUNDER, name: "John", role: "founder", isSupervisor: true };
        const casos: Array<{ dueno: string; quien: TeamActor; aprobador: TeamActor; frena?: string }> = [
          // Su fila de equipo sin vincular la revisa un supervisor (otra regla, no B8).
          { dueno: JOHN, quien: FOUNDER, aprobador: SUPERVISORA_ACTOR },
          { dueno: JOHN, quien: FOUNDER, aprobador: actor(RITA), frena: MOTIVO_TRANSICION.pendiente },
          // Con la cuenta de su sesión, quien él invitó (por cualquiera de sus identidades) sí.
          { dueno: SESION_FOUNDER, quien: founderSesion, aprobador: actor(RITA) },
          { dueno: SESION_FOUNDER, quien: founderSesion, aprobador: actor(MADRINA) },
          // Entre dos personas del equipo, B8 sigue en pie.
          { dueno: ANA, quien: actor(ANA), aprobador: SUPERVISORA_ACTOR },
          { dueno: ANA, quien: actor(ANA), aprobador: actor(RITA) },
          { dueno: ANA, quien: actor(ANA), aprobador: actor(MADRINA), frena: MOTIVO_TRANSICION.invitacion },
        ];
        for (const c of casos) {
          const caso = `${c.dueno} aprobada por ${c.aprobador.wallet}`;
          const id = delFounder(c.dueno, c.quien);
          const puerta = accionesPermitidas(db, c.aprobador, getAssignment(db, id)!).includes("aprobar");
          expect(puerta, caso).toBe(!c.frena);
          if (!c.frena) {
            const r = aprobar(id, MANANA_3PM, c.aprobador);
            expect(r.row.status, caso).toBe("Hecha");
            expect(r.emision, caso).toMatchObject({ emitido: true });
            expect(r.emision?.motivo, caso).toBeUndefined();
            expect(filas(db, id).rep.map((f) => f.wallet), caso).toEqual([c.dueno]);
          } else {
            expect(fallo(() => aprobar(id, MANANA_3PM, c.aprobador)), caso).toEqual({ status: 403, message: c.frena });
            expect(getAssignment(db, id)!.status, caso).toBe("En revisión");
            expect(filas(db, id), caso).toEqual({ puntos: [], rep: [] });
          }
        }
      });
    });

    it("si la base falla al emitir, la aprobación entera se revierte (el gancho no lleva try/catch)", () => {
      const id = entregada();
      // Falla al insertar la reputación, DESPUÉS de haber insertado los puntos.
      db.exec(
        `CREATE TRIGGER falla_rep BEFORE INSERT ON reputation_events BEGIN SELECT RAISE(ABORT, 'falla de base simulada'); END;`
      );
      expect(() => aprobar(id, MANANA_3PM)).toThrow(/falla de base simulada/);

      const row = getAssignment(db, id)!;
      expect(row.status).toBe("En revisión");
      expect(row.closed_at).toBeNull();
      expect(eventos(db, id, "aprobar")).toBe(0);
      expect(ledgers(db)).toBe(0); // tampoco quedaron los puntos

      // Con la base sana, la misma aprobación pasa y emite una sola vez.
      db.exec(`DROP TRIGGER falla_rep;`);
      expect(aprobar(id, MANANA_3PM).row.status).toBe("Hecha");
      expect(filas(db, id).puntos).toHaveLength(1);
      expect(filas(db, id).rep).toHaveLength(1);
    });

    it("una entrega emite una sola vez: aprobar de nuevo no pasa y no duplica", () => {
      const id = entregada();
      aprobar(id, MANANA_3PM);
      expect(() => aprobar(id, PASADO_MANANA)).toThrow(InvalidTeamTransitionError);
      expect(filas(db, id).puntos).toHaveLength(1);
      expect(filas(db, id).rep).toHaveLength(1);
      expect(eventos(db, id, "aprobar")).toBe(1);
    });

    it("si el ref ya estaba emitido (p. ej. tras vincular cuentas), se aprueba sin emitir otra vez", () => {
      const id = entregada();
      db.prepare(`INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, 'ejecucion', 3, ?, 1)`).run(
        ANA,
        refTarea(id)
      );
      const r = aprobar(id, MANANA_3PM);
      expect(r.row.status).toBe("Hecha");
      expect(r.emision).toMatchObject({ emitido: false, motivo: "ya_emitido", puntos: 0, reputacion: 0 });
      expect(filas(db, id).puntos).toHaveLength(0);
      expect(filas(db, id).rep).toHaveLength(1);
    });

    it("todo va a la época actual con period_id explícito (nada cae en una época cerrada)", () => {
      db.prepare(`UPDATE periods SET state = 'Closed' WHERE id = 1`).run();
      periodo(db, 2);
      const id = entregada();
      aprobar(id, MANANA_3PM);
      const { puntos, rep } = filas(db, id);
      expect(puntos.map((f) => f.period_id)).toEqual([2]);
      expect(rep.map((f) => f.period_id)).toEqual([2]);
    });
  });

  describe("I2 · bono de puntualidad (literal: se mide al APROBAR)", () => {
    it("vence mañana y se aprueba mañana → con bono", () => {
      const id = entregada({ size: "M", dueDate: MANANA });
      const r = aprobar(id, MANANA_3PM);
      const base = G.TASK_POINTS.M;
      const bono = Math.round((base * G.ON_TIME_BONUS_PCT) / 100);
      expect(bono).toBeGreaterThan(0);
      expect(r.emision).toMatchObject({ emitido: true, puntos: base + bono, bono });
      expect(filas(db, id).puntos[0]?.points).toBe(base + bono);
    });

    it("entregada hoy y aprobada pasado mañana → sin bono y sin descuento (la reputación, completa)", () => {
      const id = entregada({ size: "M", dueDate: MANANA });
      const r = aprobar(id, PASADO_MANANA);
      expect(r.emision).toMatchObject({ emitido: true, puntos: G.TASK_POINTS.M, bono: 0, reputacion: G.TASK_REP.M });
      expect(filas(db, id).puntos[0]?.points).toBe(G.TASK_POINTS.M);
      expect(filas(db, id).rep[0]?.delta).toBe(G.TASK_REP.M);
      expect(negativos(db)).toBe(0);
    });

    it("el plazo es el fin del día hábil de Bogotá: 17:30 con bono, 18:30 sin bono", () => {
      const antes = entregada({ size: "L", dueDate: MANANA });
      const despues = entregada({ size: "L", dueDate: MANANA });
      expect(aprobar(antes, MANANA_1730).emision?.bono).toBe(Math.round((G.TASK_POINTS.L * G.ON_TIME_BONUS_PCT) / 100));
      expect(aprobar(despues, MANANA_1830).emision?.bono).toBe(0);
      expect(filas(db, despues).puntos[0]?.points).toBe(G.TASK_POINTS.L);
    });

    it("usa el instante de ESTA aprobación, no el reloj del sistema", () => {
      // Una historia de enero de 2026: para el reloj real ese plazo ya pasó, así que si
      // el gancho midiera con `new Date()` en vez del `now` de la aprobación, no habría bono.
      const id = entregada({
        size: "S",
        dueDate: "2026-01-06",
        inicio: new Date("2026-01-05T14:00:00.000Z"),
        envio: new Date("2026-01-05T19:00:00.000Z"),
      });
      const r = aprobar(id, new Date("2026-01-06T20:00:00.000Z"));
      expect(r.emision?.bono).toBe(Math.round((G.TASK_POINTS.S * G.ON_TIME_BONUS_PCT) / 100));
      expect(r.emision?.bono).toBeGreaterThan(0);
    });

    it("Low sin fecha no tiene plazo: no hay bono, y tampoco se resta nada", () => {
      const id = createAssignmentAs(
        db,
        FOUNDER,
        { title: "Sin plazo", initiativeId: p, ownerWallet: ANA, size: "M", priority: "Low" },
        HOY_9AM
      );
      applyAssignmentAction(db, { assignmentId: id, action: "empezar", actor: actor(ANA), now: HOY_9AM });
      applyAssignmentAction(db, { assignmentId: id, action: "enviar_a_revision", actor: actor(ANA), now: HOY_2PM });
      const r = aprobar(id, MANANA_3PM);
      expect(r.emision).toMatchObject({ emitido: true, puntos: G.TASK_POINTS.M, bono: 0 });
    });
  });

  describe("I3 · sin tamaño cuenta como S", () => {
    it("premio S: puntos de S (+ bono a tiempo) y reputación de S", () => {
      const id = entregada({ size: null, dueDate: MANANA });
      expect(getAssignment(db, id)!.size).toBeNull();
      const r = aprobar(id, MANANA_3PM);
      const premio = calcularPremioTarea({ size: "S", aTiempo: true }, G);
      expect(r.emision).toMatchObject({ emitido: true, puntos: premio.puntos, reputacion: G.TASK_REP.S });
      expect(filas(db, id).puntos[0]?.points).toBe(premio.puntos);
      expect(filas(db, id).rep[0]?.delta).toBe(G.TASK_REP.S);
    });
  });

  describe("I8 · una pieza publicada en el Ágora se paga por sus hitos", () => {
    it("aprobar → publicada_en_agora, sin filas de la tarea en los ledgers y con el copy de §8.5", () => {
      const proyecto = db
        .prepare(
          `INSERT INTO projects (campaign, title, type, budget_usd, weeks, supervisor_wallet, summary, description, acceptance)
           VALUES ('Zelena', 'Pieza publicada', 'comunidad', 500, 4, ?, 'Resumen', 'Descripción', 'Criterio')`
        )
        .run(JOHN);
      const id = entregada();
      db.prepare(`UPDATE assignments SET published_as_project_id = ? WHERE id = ?`).run(Number(proyecto.lastInsertRowid), id);

      const r = aprobar(id, MANANA_3PM);
      expect(r.row.status).toBe("Hecha");
      expect(r.emision).toMatchObject({ emitido: false, motivo: "publicada_en_agora", puntos: 0, reputacion: 0 });
      expect(r.textoEmision).toBe("Esta pieza se paga por sus hitos en el Ágora.");
      expect(filas(db, id)).toEqual({ puntos: [], rep: [] });
      expect(ledgers(db)).toBe(0);
    });
  });

  describe("tope de la época (presupuesto de ejecución)", () => {
    it("si no alcanza, emite el remanente, la reputación va entera y la respuesta lo explica", () => {
      db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, 1, 'ejecucion', 'otra')`).run(
        EJE2,
        G.EPOCH_BUDGET - 5
      );
      const id = entregada({ size: "L" });
      const r = aprobar(id, MANANA_3PM);
      expect(r.emision).toMatchObject({ emitido: true, motivo: "presupuesto_agotado", puntos: 5, reputacion: G.TASK_REP.L });
      expect(r.textoEmision).toBe(textoEmision(r.emision!));
      expect(r.textoEmision).toBe("Esta temporada el presupuesto de puntos se completó: tu reputación quedó entera.");
      expect(filas(db, id).puntos[0]?.points).toBe(5);
      expect(filas(db, id).rep[0]?.delta).toBe(G.TASK_REP.L);

      // Con el presupuesto en cero: sin fila de puntos (nunca 0 ni negativos), reputación completa.
      const otra = entregada({ size: "S" });
      const r2 = aprobar(otra, MANANA_3PM);
      expect(r2.emision).toMatchObject({ emitido: true, motivo: "presupuesto_agotado", puntos: 0, reputacion: G.TASK_REP.S });
      expect(filas(db, otra).puntos).toHaveLength(0);
      expect(filas(db, otra).rep).toHaveLength(1);
      expect(negativos(db)).toBe(0);
    });

    it("lo de una época cerrada no cuenta para el tope de la actual", () => {
      db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, 1, 'ejecucion', 'vieja')`).run(
        EJE2,
        G.EPOCH_BUDGET
      );
      db.prepare(`UPDATE periods SET state = 'Closed' WHERE id = 1`).run();
      periodo(db, 2);
      const id = entregada({ size: "M" });
      const r = aprobar(id, MANANA_3PM);
      expect(r.emision?.motivo).toBeUndefined();
      expect(r.emision?.puntos).toBe(calcularPremioTarea({ size: "M", aTiempo: true }, G).puntos);
    });
  });
});

// El type-stripping de Node existe desde la 22.6 (el CLI y el pipeline usan Node 22).
const [MAYOR, MENOR] = process.versions.node.split(".").map(Number);
const HAY_STRIP_TYPES = MAYOR > 22 || (MAYOR === 22 && MENOR >= 6);

describe("I9 · el CLI de importación sigue cargando la cadena de team.ts", () => {
  it.skipIf(!HAY_STRIP_TYPES)("node --experimental-strip-types importa team-import.ts sin error", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "-e",
        "import('./src/lib/team-import.ts').then(() => process.exit(0), (e) => { console.error(e); process.exit(1); })",
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 60_000 }
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  }, 70_000);
});
