/**
 * Prueba de caracterización · gamificacion-y-epocas
 * Ficha: docs/features/gamificacion-y-epocas.md (sección 8). Commit de referencia: 0e07d8f.
 *
 * Protege el comportamiento ACTUAL del flujo principal, a través de las rutas reales
 * (`POST /api/equipo/asignacion` y `GET|POST /api/admin/epoca`):
 *
 *   1. La dueña empieza y envía a revisión; ella no puede aprobar lo suyo (403).
 *   2. Otra persona (supervisora) aprueba: en la MISMA operación se emiten puntos
 *      (tamaño + bono a tiempo) y reputación, con `period_id` de la época actual.
 *   3. La emisión es idempotente y no paga autoaprobaciones (defensa en profundidad).
 *   4. Tope por época: si el presupuesto no alcanza se emite el remanente y la
 *      reputación va completa, con el copy de "presupuesto completado".
 *   5. Insignias y "Tu progreso" se derivan de los eventos y de los ledgers.
 *   6. Cerrar la época exige fitness firmado y mutación decidida (409 si falta; 403 si
 *      no es founder); al cerrar se calcula la raíz Merkle, se encola para testnet, se
 *      escribe el acta y se abre la siguiente. Lo emitido después cae en la nueva y la
 *      raíz de la cerrada no cambia.
 *
 * Base: SQLite temporal en memoria con `schema.sql` + `seedIfEmpty` (como
 * src/lib/epocas.test.ts). Las rutas leen esa base vía `globalThis.__zelenaDb`; la
 * sesión se simula con un mock de `@/lib/session`. Datos inventados.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const estado = vi.hoisted(() => ({ session: null as Record<string, unknown> | null }));
vi.mock("@/lib/session", () => ({ getSession: async () => estado.session }));
vi.mock("@/lib/db", () => import("../db"));
vi.mock("@/lib/authz", () => import("../authz"));
vi.mock("@/lib/rate-limit", () => import("../rate-limit"));
vi.mock("@/lib/team", () => import("../team"));
vi.mock("@/lib/team-state-machine", () => import("../team-state-machine"));
vi.mock("@/lib/epocas", () => import("../epocas"));

import { openDb, type DB } from "../db";
import { seedIfEmpty } from "../seed";
import { merkleRoot } from "../crypto";
import { currentEpoch, getActiveGenome } from "../genome";
import { createAssignment, upsertInitiative } from "../team";
import {
  emitirPorAprobacion,
  insignias,
  presupuestoEjecucionRestante,
  progresoDeTareas,
  refTarea,
  senalesProgreso,
  textoInsignia,
} from "../gamificacion";
import { computeAndStoreEpochFitness, signEpochDecision } from "../epochs";
import { recordNoMutation } from "../mutation";
import { FALTA_FITNESS, FALTA_MUTACION, SOLO_FOUNDER, YA_HAY_ABIERTA, hojasDeEpoca } from "../epocas";
import { POST as postAsignacion } from "../../../app/api/equipo/asignacion/route";
import { GET as getEpoca, POST as postEpoca } from "../../../app/api/admin/epoca/route";

const FOUNDER = "GCARACFOUNDERGAMIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DUENA = "GCARACDUENAGAMIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REVISA = "GCARACREVISAGAMIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RELLENO = "GCARACRELLENOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

let db: DB;
let proyecto: number;
const piezas: Record<string, number> = {};
const g = globalThis as unknown as { __zelenaDb?: DB };

function sesion(wallet: string): Record<string, unknown> {
  return { wallet, name: "prueba", tier: "Bronze", isFounder: false, claSigned: true, isDemo: false };
}

async function llamar(
  handler: (req: NextRequest) => Promise<Response>,
  url: string,
  body?: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const req = new NextRequest(new URL(url, "http://localhost"), {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.8" },
  });
  const res = await handler(req);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

async function accion(wallet: string, assignmentId: number, action: string) {
  estado.session = sesion(wallet);
  return llamar(postAsignacion, "/api/equipo/asignacion", { assignmentId, action });
}

function pieza(titulo: string, size: "S" | "M" | "L"): number {
  return createAssignment(db, {
    title: titulo,
    initiativeId: proyecto,
    ownerWallet: DUENA,
    status: "Asignada",
    size,
    dueDate: "2099-12-31", // plazo lejano: se aprueba "a tiempo"
    createdBy: FOUNDER,
  });
}

/** La dueña empieza y envía a revisión; la supervisora aprueba. Devuelve la respuesta de aprobar. */
async function recorrer(id: number) {
  expect((await accion(DUENA, id, "empezar")).data.status).toBe("En curso");
  expect((await accion(DUENA, id, "enviar_a_revision")).data.status).toBe("En revisión");
  return accion(REVISA, id, "aprobar");
}

beforeAll(() => {
  db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  const ins = db.prepare(
    `INSERT INTO users (wallet, display_name, role, is_supervisor, cla_signed, status) VALUES (?, ?, ?, ?, 1, 'active')`
  );
  ins.run(FOUNDER, "Founder de prueba", "founder", 1);
  ins.run(DUENA, "Dueña de prueba", "core", 0);
  ins.run(REVISA, "Supervisora de prueba", "core", 1);
  proyecto = upsertInitiative(db, "Huerto demo");
  g.__zelenaDb = db;
});

afterAll(() => {
  delete g.__zelenaDb;
});

describe("caracterización · gamificacion-y-epocas (flujo principal)", () => {
  it("1. la dueña no aprueba su propia entrega (403, cuatro ojos)", async () => {
    piezas.m = pieza("Pieza mediana", "M");
    await accion(DUENA, piezas.m, "empezar");
    await accion(DUENA, piezas.m, "enviar_a_revision");
    const r = await accion(DUENA, piezas.m, "aprobar");
    expect(r.status).toBe(403);
    expect(r.data.error).toBe("Quien entrega no aprueba su propia entrega.");
  });

  it("2. otra persona aprueba: puntos (tamaño + bono a tiempo) y reputación en la misma operación", async () => {
    const diaAntes = new Date().toISOString().slice(0, 10);
    const r = await accion(REVISA, piezas.m, "aprobar");
    const diaDespues = new Date().toISOString().slice(0, 10);
    expect(r.status).toBe(200);
    // M = 30 puntos + 25 % por a tiempo (Math.round(7.5) = 8) = 38; reputación M = 3.
    expect(r.data).toEqual({
      ok: true,
      status: "Hecha",
      blockedReason: null,
      emision: { emitido: true, motivo: null, puntos: 38, reputacion: 3, bono: 8 },
      textoEmision: null,
    });
    const ref = refTarea(piezas.m);
    expect(db.prepare(`SELECT wallet, points, period_id, bucket FROM points_ledger WHERE ref = ?`).all(ref)).toEqual([
      { wallet: DUENA, points: 38, period_id: 1, bucket: "ejecucion" },
    ]);
    expect(db.prepare(`SELECT wallet, axis, delta, period_id FROM reputation_events WHERE ref = ?`).all(ref)).toEqual([
      { wallet: DUENA, axis: "ejecucion", delta: 3, period_id: 1 },
    ]);
    // HALLAZGO (ficha §9): el `day` del evento sale de `today()` (hora del servidor,
    // UTC en Azure y aquí), no de `diaLocal(now, BUSINESS_TZ)` como el importador.
    const ev = db
      .prepare(`SELECT actor_wallet, day FROM assignment_events WHERE assignment_id = ? AND action = 'aprobar'`)
      .get(piezas.m) as { actor_wallet: string; day: string };
    expect(ev.actor_wallet).toBe(REVISA);
    expect([diaAntes, diaDespues]).toContain(ev.day);
  });

  it("3. la emisión es idempotente y no paga una autoaprobación", () => {
    const base = { assignmentId: piezas.m, ownerWallet: DUENA, size: "M" as const, aTiempo: true };
    expect(emitirPorAprobacion(db, { ...base, aprobadorWallet: REVISA })).toMatchObject({ emitido: false, motivo: "ya_emitido" });
    expect(emitirPorAprobacion(db, { ...base, aprobadorWallet: DUENA })).toMatchObject({
      emitido: false,
      motivo: "autoaprobacion",
    });
    expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE ref = ?`).get(refTarea(piezas.m)) as { n: number }).n)).toBe(1);
  });

  it("4. tope de época: sin presupuesto suficiente se emite el remanente y la reputación va completa", async () => {
    const restante = presupuestoEjecucionRestante(db, 1);
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, 1, 'ejecucion', 'relleno:prueba')`).run(
      RELLENO,
      restante - 5
    );
    piezas.l = pieza("Pieza grande", "L");
    const r = await recorrer(piezas.l);
    expect(r.status).toBe(200);
    expect(r.data.emision).toEqual({ emitido: true, motivo: "presupuesto_agotado", puntos: 5, reputacion: 8, bono: 0 });
    expect(r.data.textoEmision).toBe("Esta temporada el presupuesto de puntos se completó: tu reputación quedó entera.");
    expect(presupuestoEjecucionRestante(db, 1)).toBe(0);
  });

  it("5. insignias y progreso se derivan de lo aprobado por otra persona", () => {
    const s = senalesProgreso(db, DUENA);
    expect(s).toEqual({
      entregasAprobadas: 2,
      entregasATiempo: 2,
      entregasL: 1,
      revisionesHechas: 0,
      ritosAsistidos: 0,
      ritosAnfitrion: 0,
    });
    expect(senalesProgreso(db, REVISA).revisionesHechas).toBe(2);
    const lista = insignias(s, getActiveGenome(db, 1).BADGE_GOALS);
    const por = Object.fromEntries(lista.map((i) => [i.id, textoInsignia(i)]));
    expect(por["primera-entrega"]).toBe("Primera entrega · conseguida");
    expect(por["pieza-grande"]).toBe("Pieza grande · conseguida");
    expect(por["diez-entregas"]).toBe("Diez entregas · 2 de 10");
    expect(progresoDeTareas(db, DUENA, 1)).toEqual({ puntos: 43, reputacion: 11, entregas: 2 });
  });

  it("6a. cerrar la época sin fitness firmado ni mutación decidida → 409; quien no es founder → 403", async () => {
    estado.session = sesion(FOUNDER);
    const est = await llamar(getEpoca, "/api/admin/epoca");
    expect(est.status).toBe(200);
    expect(est.data).toMatchObject({
      ok: true,
      puedeCerrar: false,
      puedeAbrir: false,
      faltantes: [FALTA_FITNESS, FALTA_MUTACION],
    });
    expect((est.data.periodo as { id: number; state: string }).id).toBe(1);

    const r = await llamar(postEpoca, "/api/admin/epoca", { action: "cerrar", justificacion: "Cierre de prueba sin firmar" });
    expect(r.status).toBe(409);
    expect(r.data.faltantes).toEqual([FALTA_FITNESS, FALTA_MUTACION]);

    estado.session = sesion(REVISA); // supervisora: no administra
    const s = await llamar(postEpoca, "/api/admin/epoca", { action: "cerrar", justificacion: "Cierre de prueba sin permiso" });
    expect(s.status).toBe(403);
    expect(s.data.error).toBe(SOLO_FOUNDER);
  });

  it("6b. con fitness firmado y mutación decidida: raíz Merkle, cola de testnet, acta y época nueva", async () => {
    recordNoMutation(db, 2, "Sin cambios para la prueba de caracterización.");
    const reporte = computeAndStoreEpochFitness(db, 1);
    signEpochDecision(db, reporte.id, "keep");

    estado.session = sesion(FOUNDER);
    const r = await llamar(postEpoca, "/api/admin/epoca", {
      action: "cerrar",
      justificacion: "Cierre de la época de prueba con todo firmado.",
      nombreSiguiente: "Época de prueba 2",
    });
    expect(r.status).toBe(200);
    const raiz = merkleRoot(hojasDeEpoca(db, 1));
    expect(r.data).toMatchObject({ ok: true, cerrada: 1, abierta: 2, merkleRoot: raiz });

    expect(db.prepare(`SELECT id, state, merkle_root FROM periods ORDER BY id`).all()).toEqual([
      { id: 1, state: "Closed", merkle_root: raiz },
      { id: 2, state: "Open", merkle_root: null },
    ]);
    const nueva = db.prepare(`SELECT name, epoch_budget FROM periods WHERE id = 2`).get() as { name: string; epoch_budget: number };
    expect(nueva).toEqual({ name: "Época de prueba 2", epoch_budget: getActiveGenome(db, 2).EPOCH_BUDGET });
    expect(db.prepare(`SELECT kind, ref, data_key, payload_hash, status FROM anchor_queue WHERE id = ?`).get(r.data.anchorQueueId)).toEqual({
      kind: "merkle_root",
      ref: "1",
      data_key: "epoch:1",
      payload_hash: raiz,
      status: "pending",
    });
    const acta = db.prepare(`SELECT title, reason FROM decision_log WHERE id = ?`).get(r.data.decisionLogId) as {
      title: string;
      reason: string;
    };
    expect(acta.title).toBe("Cierre de la época 1 y apertura de la 2");
    expect(acta.reason).toContain(raiz);
    expect(currentEpoch(db)).toBe(2);

    const abrir = await llamar(postEpoca, "/api/admin/epoca", { action: "abrir", justificacion: "Intento de abrir otra época." });
    expect(abrir.status).toBe(409);
    expect(abrir.data.error).toBe(YA_HAY_ABIERTA);
  });

  it("6c. lo aprobado después cae en la época nueva y la raíz de la cerrada no cambia", async () => {
    const raizGuardada = (db.prepare(`SELECT merkle_root FROM periods WHERE id = 1`).get() as { merkle_root: string }).merkle_root;
    piezas.s = pieza("Pieza pequeña", "S");
    const r = await recorrer(piezas.s);
    // S = 10 puntos + 25 % (Math.round(2.5) = 3) = 13, con el presupuesto de la época 2 entero.
    expect(r.data.emision).toEqual({ emitido: true, motivo: null, puntos: 13, reputacion: 1, bono: 3 });
    expect(db.prepare(`SELECT period_id FROM points_ledger WHERE ref = ?`).get(refTarea(piezas.s))).toEqual({ period_id: 2 });
    expect(merkleRoot(hojasDeEpoca(db, 1))).toBe(raizGuardada);
  });
});
