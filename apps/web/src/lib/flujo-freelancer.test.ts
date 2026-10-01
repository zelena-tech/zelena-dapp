/**
 * WP31 · criterio I7: el recorrido de un externo de punta a punta, con base en memoria
 * y las mismas funciones que usan las rutas.
 *
 * Invitación con acuerdo de contribución firmado → el founder lo suma a un proyecto
 * (`ejecuta`, externo) → entra a /equipo solo con alcance de proyectos y solo ve el
 * suyo → toma una pieza sin dueño, la empieza y la envía a revisión → OTRA persona del
 * proyecto (rol `revisa`, que no la envió ni tiene relación de invitación con él) la
 * aprueba → puntos y reputación con `ref='assignment:<id>'` en la época actual, una
 * sola vez → un proyecto ajeno sigue cerrado para él.
 *
 * Las personas son ficticias: wallets generadas en el momento, sin datos reales.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { openDb, type DB } from "./db";
import { claCanonicalHash } from "./cla";
import { claSigningPayload } from "./cla-signing";
import { generateInvite } from "./invites";
import { performOnboard } from "./onboard";
import { equipoActor, type EquipoActor } from "./authz";
import { GENOME_DEFAULTS, clearGenomeCache, currentEpoch } from "./genome";
import { MOTIVO_TRANSICION, pendingPrincipal } from "./roles";
import { InvalidTeamTransitionError } from "./team-state-machine";
import { calcularPremioTarea, refTarea } from "./gamificacion";
import {
  accionesPermitidas,
  agregarMiembro,
  aplicarAccionAsignacion,
  applyAssignmentAction,
  createAssignmentAs,
  crearProyecto,
  getAssignment,
  permisosDe,
  piezasSinResponsable,
  proyectosVisibles,
  puedeVerProyecto,
  seedTeam,
  TeamError,
} from "./team";

const JOHN = pendingPrincipal("john"); // founder (roster)
const G = GENOME_DEFAULTS;

// Calendario (Bogotá = UTC−5): lunes 5 de octubre de 2026.
const LUN_9AM = new Date("2026-10-05T14:00:00.000Z");
const LUN_10AM = new Date("2026-10-05T15:00:00.000Z");
const LUN_4PM = new Date("2026-10-05T21:00:00.000Z");
const MAR_11AM = new Date("2026-10-06T16:00:00.000Z");
const VENCE = "2026-10-07"; // miércoles

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  db.prepare(`INSERT INTO periods (name, epoch_budget, academia_budget) VALUES ('Génesis', ?, ?)`).run(
    G.EPOCH_BUDGET,
    G.ACADEMIA_BUDGET
  );
  clearGenomeCache(db);
  return db;
}

/** Alta real por la puerta de comunidad: invitación del founder + firma del acuerdo. */
function altaConInvitacion(db: DB, nombre: string): string {
  const code = generateInvite(db, JOHN, "Gold");
  const kp = Keypair.random();
  const claHash = claCanonicalHash();
  const signature = Buffer.from(kp.sign(Buffer.from(claSigningPayload(claHash), "utf8"))).toString("base64");
  performOnboard(db, { code, wallet: kp.publicKey(), name: nombre, isDemo: false, claHash, signature });
  return kp.publicKey();
}

function equipo(db: DB, wallet: string): EquipoActor {
  const a = equipoActor({ wallet }, db);
  if (!a) throw new Error(`sin acceso a /equipo: ${wallet}`);
  return a;
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

function filas(db: DB, ref: string) {
  return {
    puntos: db.prepare(`SELECT wallet, points, period_id, bucket FROM points_ledger WHERE ref = ?`).all(ref) as Array<{
      wallet: string;
      points: number;
      period_id: number;
      bucket: string;
    }>,
    rep: db.prepare(`SELECT wallet, axis, delta, period_id FROM reputation_events WHERE ref = ?`).all(ref) as Array<{
      wallet: string;
      axis: string;
      delta: number;
      period_id: number;
    }>,
  };
}

describe("I7 · flujo de un freelancer, de la invitación a sus puntos", () => {
  it("invitación con acuerdo → miembro → toma → entrega → otra persona aprueba → puntos y reputación una sola vez", () => {
    const db = freshDb();
    const founder = equipo(db, JOHN);
    const p = crearProyecto(db, founder, { name: "Proyecto Abierto" }).id;
    const q = crearProyecto(db, founder, { name: "Proyecto Ajeno" }).id;

    // 1. Alta con invitación y acuerdo de contribución firmado.
    const externo = altaConInvitacion(db, "Persona Externa");
    const fila = db.prepare(`SELECT role, cla_signed, invited_by FROM users WHERE wallet = ?`).get(externo) as {
      role: string;
      cla_signed: number;
      invited_by: string;
    };
    expect(fila).toEqual({ role: "contributor", cla_signed: 1, invited_by: JOHN });
    expect(db.prepare(`SELECT 1 AS x FROM cla_signatures WHERE wallet = ?`).get(externo)).toBeTruthy();
    // Sin membresía todavía no entra a /equipo.
    expect(equipoActor({ wallet: externo }, db)).toBeNull();

    // La revisora: otra persona, con su propia invitación (ni invitó al externo ni él a ella).
    const revisora = altaConInvitacion(db, "Persona Revisora");

    // 2. El founder los suma: el externo ejecuta, la revisora revisa.
    agregarMiembro(db, founder, { initiativeId: p, wallet: externo, rol: "ejecuta", vinculo: "externo" });
    agregarMiembro(db, founder, { initiativeId: p, wallet: revisora, rol: "revisa", vinculo: "externo" });

    // 3. Entra con alcance de proyectos y solo ve el suyo.
    const yo = equipo(db, externo);
    expect(yo.alcance).toBe("proyectos");
    expect(yo.proyectos).toEqual([p]);
    expect(proyectosVisibles(db, yo).map((i) => i.id)).toEqual([p]);

    // 4. Hay una pieza sin dueño para tomar (la planificó el founder).
    const pieza = createAssignmentAs(
      db,
      founder,
      { title: "Pantalla de bienvenida", initiativeId: p, size: "M", dueDate: VENCE, acceptanceCriteria: "Se ve en móvil" },
      LUN_9AM
    );
    expect(getAssignment(db, pieza)!.status).toBe("Backlog");
    expect(piezasSinResponsable(db, p)).toBe(1);
    expect(accionesPermitidas(db, yo, getAssignment(db, pieza)!)).toContain("asignar");

    // 5. La toma, la empieza y la envía a revisión.
    expect(applyAssignmentAction(db, { assignmentId: pieza, action: "asignar", actor: yo, now: LUN_10AM }).owner_wallet).toBe(
      externo
    );
    applyAssignmentAction(db, { assignmentId: pieza, action: "empezar", actor: yo, now: LUN_10AM });
    applyAssignmentAction(db, { assignmentId: pieza, action: "enviar_a_revision", actor: yo, now: LUN_4PM });
    expect(getAssignment(db, pieza)!.status).toBe("En revisión");

    // Quien entrega no aprueba lo suyo: ni un punto por intentarlo.
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: pieza, action: "aprobar", actor: yo, now: MAR_11AM }))).toEqual(
      { status: 403, message: MOTIVO_TRANSICION.dueno }
    );
    expect(filas(db, refTarea(pieza))).toEqual({ puntos: [], rep: [] });

    // 6. Otra persona del proyecto, con rol revisa, la aprueba (a tiempo: vence el miércoles).
    const ella = equipo(db, revisora);
    expect(ella.alcance).toBe("proyectos");
    const r = aplicarAccionAsignacion(db, { assignmentId: pieza, action: "aprobar", actor: ella, now: MAR_11AM });
    expect(r.row.status).toBe("Hecha");

    // 7. Puntos y reputación con su ref, en la época actual, para quien entregó.
    const premio = calcularPremioTarea({ size: "M", aTiempo: true }, G);
    const epoca = currentEpoch(db);
    expect(r.emision).toMatchObject({ emitido: true, puntos: premio.puntos, reputacion: premio.reputacion, periodo: epoca });
    expect(filas(db, refTarea(pieza))).toEqual({
      puntos: [{ wallet: externo, points: premio.puntos, period_id: epoca, bucket: "ejecucion" }],
      rep: [{ wallet: externo, axis: "ejecucion", delta: premio.reputacion, period_id: epoca }],
    });
    // La revisora no cobra la entrega ajena.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ?`).get(revisora)).toEqual({ n: 0 });

    // Una sola vez: aprobar de nuevo no pasa y no duplica.
    expect(() =>
      applyAssignmentAction(db, { assignmentId: pieza, action: "aprobar", actor: ella, now: MAR_11AM })
    ).toThrow(InvalidTeamTransitionError);
    const total = filas(db, refTarea(pieza));
    expect(total.puntos).toHaveLength(1);
    expect(total.rep).toHaveLength(1);

    // 8. El proyecto ajeno sigue cerrado para él.
    expect(puedeVerProyecto(db, yo, q)).toBe(false);
    expect(permisosDe(db, yo, q)).toMatchObject({ ver: false, crear: false, tomar: false, revisar: false });
    const ajena = createAssignmentAs(db, founder, { title: "Pieza de otro proyecto", initiativeId: q }, LUN_9AM);
    expect(fallo(() => applyAssignmentAction(db, { assignmentId: ajena, action: "asignar", actor: yo, now: LUN_10AM }))?.status).toBe(
      403
    );
  });
});
