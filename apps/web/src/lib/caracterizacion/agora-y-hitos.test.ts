/**
 * Prueba de caracterización · Ágora y hitos (docs/features/agora-y-hitos.md, §8).
 *
 * Recorre el flujo principal DE PUNTA A PUNTA, llamando a los handlers reales de las
 * rutas contra una base SQLite temporal (en memoria, con `schema.sql`):
 *
 *   1. un supervisor/founder publica una pieza del backlog   → POST /api/equipo/publicar
 *   2. un contribuidor con el acuerdo firmado aplica         → POST /api/apply
 *   3. el founder aprueba la aplicación (asigna)              → POST /api/admin approveApplication
 *   4. el founder aprueba un hito: 1 USD = 1 punto            → POST /api/admin approveMilestone
 *
 * Protege el comportamiento ACTUAL (commit 0e07d8f): no lo corrige. Donde el
 * comportamiento actual es discutible se dice en el nombre del caso y en los
 * hallazgos de la ficha, para que quien lo arregle cambie la prueba a propósito.
 *
 * Cómo se aísla: `@/lib/session` devuelve la sesión que fija cada caso (no hay
 * cookies), y `globalThis.__zelenaDb` apunta a la base temporal, así `getDb()` nunca
 * abre `data/zelena.db`. Personas y textos ficticios.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { openDb, type DB } from "../db";

const estado = vi.hoisted(() => ({ sesion: null as null | Record<string, unknown> }));

vi.mock("@/lib/session", () => ({ getSession: async () => estado.sesion }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/validation", async () => await import("../validation"));
vi.mock("@/lib/rate-limit", async () => await import("../rate-limit"));
vi.mock("@/lib/authz", async () => await import("../authz"));
vi.mock("@/lib/roles", async () => await import("../roles"));
vi.mock("@/lib/team", async () => await import("../team"));
vi.mock("@/lib/agora-publicar", async () => await import("../agora-publicar"));
vi.mock("@/lib/admin", async () => await import("../admin"));
vi.mock("@/lib/epochs", async () => await import("../epochs"));
vi.mock("@/lib/mutation", async () => await import("../mutation"));
vi.mock("@/lib/audits", async () => await import("../audits"));

import { POST as publicarPOST } from "../../../app/api/equipo/publicar/route";
import { POST as aplicarPOST } from "../../../app/api/apply/route";
import { POST as adminPOST } from "../../../app/api/admin/route";
import { createAssignment, getAssignment, seedTeam } from "../team";
import { pendingPrincipal } from "../roles";
import { emitirPorAprobacion } from "../gamificacion";
import { FOUNDER_WALLET } from "../config";

const g = globalThis as unknown as { __zelenaDb?: DB };
const dbOriginal = g.__zelenaDb;

const JOHN = pendingPrincipal("john"); // founder del roster (role = founder)
const VALE = pendingPrincipal("vale"); // core + supervisora
const ADA = "GADACONTRIBUIDORAFICTICIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // contribuidora externa

const HITOS = [
  { nombre: "Anticipo", semana: "1", pct: 20 },
  { nombre: "Primera entrega", semana: "2", pct: 25 },
  { nombre: "Segunda entrega", semana: "4", pct: 25 },
  { nombre: "Entrega final", semana: "6", pct: 20 },
  { nombre: "Retención de calidad", semana: "8", pct: 10 },
];

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db); // roster como datos: pending:john (founder), pending:vale (core, supervisora)…
  // La contribuidora entró con una invitación emitida por la wallet del founder (dato).
  db.prepare(
    `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, cla_signed, role, is_supervisor)
     VALUES (?, 'Ada', 'Bronze', ?, 'active', 0, 1, 'contributor', 0)`
  ).run(ADA, FOUNDER_WALLET);
  return db;
}

function sesionDe(wallet: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { wallet, name: wallet, tier: "Bronze", isFounder: false, claSigned: true, isDemo: false, ...extra };
}

function req(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
    body: JSON.stringify(body),
  });
}

function entradaPublicar(assignmentId: number) {
  return {
    assignmentId,
    tipo: "comunidad",
    presupuestoUsd: 1000,
    semanas: 8,
    campana: "Zelena",
    titulo: "Panel público de entregas",
    resumen: "Un panel que muestra las entregas aprobadas de la comunidad.",
    descripcionPublica: "Construir el panel con filtros por estado y por fecha.",
    criterioPublico: "El panel carga en menos de dos segundos y pasa las pruebas.",
    hitos: HITOS,
  };
}

function contar(db: DB, sql: string, ...p: unknown[]): number {
  return Number((db.prepare(sql).get(...p) as { n: number }).n);
}

describe("Ágora y hitos · flujo principal (publicar → aplicar → asignar → aprobar hito)", () => {
  let db: DB;
  let piezaId: number;

  beforeEach(() => {
    db = freshDb();
    g.__zelenaDb = db;
    estado.sesion = null;
    piezaId = createAssignment(db, { title: "Panel interno de entregas", status: "Backlog" });
  });

  afterAll(() => {
    g.__zelenaDb = dbOriginal;
  });

  it("recorre el flujo completo y emite exactamente amount_usd puntos al aprobar un hito", async () => {
    // 1. Publicar desde el backlog (founder del roster).
    estado.sesion = sesionDe(JOHN, { isFounder: true, role: "founder", isSupervisor: true, claSigned: false });
    const rPub = await publicarPOST(req("/api/equipo/publicar", entradaPublicar(piezaId)));
    expect(rPub.status).toBe(200);
    const { projectId } = (await rPub.json()) as { projectId: number };

    const proyecto = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as Record<string, unknown>;
    expect(proyecto).toMatchObject({
      state: "Open",
      type: "DAO", // "comunidad" → valor interno (agora-labels.ts)
      budget_usd: 1000,
      supervisor_wallet: JOHN, // el actor que publica queda como supervisor
      assignee_wallet: null,
    });
    const hitos = db.prepare(`SELECT code, amount_usd FROM milestones WHERE project_id = ? ORDER BY ord`).all(projectId) as Array<{
      code: string;
      amount_usd: number;
    }>;
    expect(hitos.map((h) => h.code)).toEqual(["H1", "H2", "H3", "H4", "H5"]);
    expect(hitos.map((h) => h.amount_usd)).toEqual([200, 250, 250, 200, 100]);
    expect(getAssignment(db, piezaId)?.published_as_project_id).toBe(projectId);
    expect(contar(db, `SELECT COUNT(*) AS n FROM assignment_events WHERE assignment_id = ? AND action = 'publicar'`, piezaId)).toBe(1);

    // 2. Aplicar (contribuidora con el acuerdo firmado).
    estado.sesion = sesionDe(ADA, { role: "contributor" });
    const rApl = await aplicarPOST(
      req("/api/apply", { projectId, approach: "Lo resuelvo con componentes accesibles y pruebas.", timeline: "6 semanas" })
    );
    expect(rApl.status).toBe(200);
    const app = db.prepare(`SELECT id, status FROM applications WHERE project_id = ? AND wallet = ?`).get(projectId, ADA) as {
      id: number;
      status: string;
    };
    expect(app.status).toBe("pending");

    // 3. El founder aprueba la aplicación: Open → Assigned con ejecutora.
    estado.sesion = sesionDe(JOHN, { isFounder: true, role: "founder", isSupervisor: true });
    const rAsig = await adminPOST(req("/api/admin", { action: "approveApplication", applicationId: app.id }));
    expect(rAsig.status).toBe(200);
    expect(db.prepare(`SELECT state, assignee_wallet FROM projects WHERE id = ?`).get(projectId)).toEqual({
      state: "Assigned",
      assignee_wallet: ADA,
    });

    // 4. Aprobar H1: 1 USD = 1 punto en bucket `ejecucion` + reputación round(p/10).
    const h1 = db.prepare(`SELECT id, amount_usd FROM milestones WHERE project_id = ? AND ord = 1`).get(projectId) as {
      id: number;
      amount_usd: number;
    };
    const rHito = await adminPOST(req("/api/admin", { action: "approveMilestone", milestoneId: h1.id }));
    expect(rHito.status).toBe(200);
    expect(await rHito.json()).toEqual({ ok: true, points: 200, wallet: ADA });

    const puntos = db.prepare(`SELECT wallet, points, bucket, period_id, ref FROM points_ledger WHERE wallet = ?`).all(ADA);
    expect(puntos).toEqual([
      { wallet: ADA, points: 200, bucket: "ejecucion", period_id: 1, ref: "Panel público de entregas · Anticipo" },
    ]);
    const rep = db.prepare(`SELECT axis, delta, ref FROM reputation_events WHERE wallet = ?`).all(ADA);
    expect(rep).toEqual([{ axis: "ejecucion", delta: 20, ref: "Hito aprobado: Anticipo" }]);
    expect(contar(db, `SELECT approved AS n FROM milestones WHERE id = ?`, h1.id)).toBe(1);

    // El hito ya aprobado no se paga dos veces.
    const rOtraVez = await adminPOST(req("/api/admin", { action: "approveMilestone", milestoneId: h1.id }));
    expect(rOtraVez.status).toBe(400);
    expect(await rOtraVez.json()).toEqual({ error: "El hito ya fue aprobado." });
    expect(contar(db, `SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ?`, ADA)).toBe(1);

    // La pieza interna publicada no emite por aprobación interna (se paga por hitos),
    // aunque alguien del equipo la tome y se la aprueben: guarda contra el doble pago.
    const r = emitirPorAprobacion(db, {
      assignmentId: piezaId,
      ownerWallet: VALE,
      aprobadorWallet: JOHN,
      size: "S",
      aTiempo: false,
    });
    expect(r).toMatchObject({ emitido: false, motivo: "publicada_en_agora", puntos: 0 });
  });

  it("puertas: publicar exige founder o supervisor; aplicar exige acuerdo firmado; /api/admin exige rol founder", async () => {
    estado.sesion = null;
    expect((await publicarPOST(req("/api/equipo/publicar", entradaPublicar(piezaId)))).status).toBe(401);

    // Una contribuidora no tiene alcance de equipo (sin membresía) → 403.
    estado.sesion = sesionDe(ADA, { role: "contributor" });
    expect((await publicarPOST(req("/api/equipo/publicar", entradaPublicar(piezaId)))).status).toBe(403);

    // Supervisora (core) sí publica.
    estado.sesion = sesionDe(VALE, { role: "core", isSupervisor: true });
    const rPub = await publicarPOST(req("/api/equipo/publicar", entradaPublicar(piezaId)));
    expect(rPub.status).toBe(200);
    const { projectId } = (await rPub.json()) as { projectId: number };

    // La misma pieza no se publica dos veces.
    expect((await publicarPOST(req("/api/equipo/publicar", entradaPublicar(piezaId)))).status).toBe(409);

    // Aplicar sin acuerdo firmado → 401 (la cookie manda aquí: `session.claSigned`).
    estado.sesion = sesionDe(ADA, { claSigned: false });
    const sinCla = await aplicarPOST(req("/api/apply", { projectId, approach: "x".repeat(25), timeline: "2 semanas" }));
    expect(sinCla.status).toBe(401);

    // Aplicar dos veces → 409 por UNIQUE(project_id, wallet). El texto aún dice "bounty".
    estado.sesion = sesionDe(ADA);
    expect((await aplicarPOST(req("/api/apply", { projectId, approach: "x".repeat(25), timeline: "2 semanas" }))).status).toBe(200);
    const dup = await aplicarPOST(req("/api/apply", { projectId, approach: "x".repeat(25), timeline: "2 semanas" }));
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "Ya aplicaste a este bounty." });

    // /api/admin: la supervisora NO administra (solo rol founder leído de la base).
    estado.sesion = sesionDe(VALE, { role: "core", isSupervisor: true });
    const noAdmin = await adminPOST(req("/api/admin", { action: "advanceState", projectId }));
    expect(noAdmin.status).toBe(403);
  });

  it("regla B8 en approveMilestone: compara cadenas crudas y exime solo a FOUNDER_WALLET (comportamiento actual)", async () => {
    // La supervisora publica; la ejecutora entró con una invitación de ESA MISMA cadena.
    db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(VALE, ADA);
    estado.sesion = sesionDe(VALE, { role: "core", isSupervisor: true });
    const { projectId } = (await (await publicarPOST(req("/api/equipo/publicar", entradaPublicar(piezaId)))).json()) as {
      projectId: number;
    };
    db.prepare(`UPDATE projects SET assignee_wallet = ?, state = 'Assigned' WHERE id = ?`).run(ADA, projectId);
    const h1 = db.prepare(`SELECT id FROM milestones WHERE project_id = ? AND ord = 1`).get(projectId) as { id: number };

    estado.sesion = sesionDe(JOHN, { isFounder: true, role: "founder", isSupervisor: true });
    const r = await adminPOST(req("/api/admin", { action: "approveMilestone", milestoneId: h1.id }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Regla B8: un supervisor no puede evaluar a su invitado directo." });
    expect(contar(db, `SELECT COUNT(*) AS n FROM points_ledger`)).toBe(0);
  });

  it("comportamiento actual discutible: 'Avanzar' lleva un proyecto Open a Assigned sin ejecutor", async () => {
    estado.sesion = sesionDe(JOHN, { isFounder: true, role: "founder", isSupervisor: true });
    const { projectId } = (await (await publicarPOST(req("/api/equipo/publicar", entradaPublicar(piezaId)))).json()) as {
      projectId: number;
    };
    const r = await adminPOST(req("/api/admin", { action: "advanceState", projectId }));
    expect(await r.json()).toEqual({ ok: true, state: "Assigned" });
    expect(db.prepare(`SELECT state, assignee_wallet FROM projects WHERE id = ?`).get(projectId)).toEqual({
      state: "Assigned",
      assignee_wallet: null,
    });
    // Ya no recibe aplicaciones, y nadie puede cobrar sus hitos hasta que se apruebe una aplicación vieja.
    estado.sesion = sesionDe(ADA);
    const tarde = await aplicarPOST(req("/api/apply", { projectId, approach: "x".repeat(25), timeline: "2 semanas" }));
    expect(tarde.status).toBe(409);
  });
});
