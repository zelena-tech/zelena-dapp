/**
 * Prueba de caracterización · feature `admin` (/admin, /api/admin, /api/admin/epoca)
 * Ficha: docs/features/admin.md · DFD: docs/dfd/admin.json
 *
 * Recorre el FLUJO PRINCIPAL del founder de punta a punta, llamando a los handlers
 * reales y al `middleware.ts`, contra una base SQLite TEMPORAL arrancada con la misma
 * secuencia que producción (`prepararSqlite`: schema + migraciones + seed):
 *
 *   puertas (middleware + adminActor) → un contribuidor aplica (/api/apply)
 *   → el founder aprueba la aplicación → aprueba un hito (puntos + reputación)
 *   → avanza el estado → modera la Academia → fitness + "sin cambios" + firma
 *   → cierra la época (raíz Merkle encolada para la red de pruebas)
 *
 * Protege el comportamiento ACTUAL. Los `it` marcados "HALLAZGO" fijan conductas
 * que la ficha reporta como problema: si alguien las corrige, este test debe fallar
 * y la ficha debe actualizarse en el mismo cambio.
 *
 * Aislamiento (mismo patrón que login-y-sesion.test.ts): `next/headers` es un tarro
 * de cookies en memoria, los alias `@/lib/*` apuntan a los módulos REALES y
 * `getDb()` devuelve la base temporal. La cookie del founder se firma con
 * `signSession`, que es lo mismo que emite /api/login (la wallet demo del seed no es
 * una llave Stellar real y no puede firmar: ver la ficha de login-y-sesion).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const tarro = vi.hoisted(() => {
  const valores = new Map<string, string>();
  return {
    valores,
    api: {
      get: (n: string) => (valores.has(n) ? { name: n, value: valores.get(n)! } : undefined),
      set: (n: string, v: string) => {
        valores.set(n, v);
      },
      delete: (n: string) => {
        valores.delete(n);
      },
    },
  };
});

vi.mock("next/headers", () => ({ cookies: () => tarro.api }));
vi.mock("@/lib/jwt", async () => await import("../jwt"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/validation", async () => await import("../validation"));
vi.mock("@/lib/session", async () => await import("../session"));
vi.mock("@/lib/rate-limit", async () => await import("../rate-limit"));
vi.mock("@/lib/authz", async () => await import("../authz"));
vi.mock("@/lib/admin", async () => await import("../admin"));
vi.mock("@/lib/epochs", async () => await import("../epochs"));
vi.mock("@/lib/mutation", async () => await import("../mutation"));
vi.mock("@/lib/audits", async () => await import("../audits"));
vi.mock("@/lib/epocas", async () => await import("../epocas"));

import { openDb, prepararSqlite, type DB } from "../db";
import { FOUNDER_WALLET } from "../config";
import { SESSION_COOKIE, signSession, verifySession } from "../jwt";
import { adminActor } from "../authz";
import { FALTA_FITNESS, FALTA_MUTACION, SOLO_FOUNDER } from "../epocas";
import { POST as admin } from "../../../app/api/admin/route";
import { GET as epocaGet, POST as epocaPost } from "../../../app/api/admin/epoca/route";
import { POST as aplicar } from "../../../app/api/apply/route";
import { middleware } from "../../../middleware";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function post(ruta: string, cuerpo: unknown, ip = "10.1.0.1"): NextRequest {
  return new NextRequest(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(cuerpo),
  });
}

function pagina(ruta: string, token?: string): NextRequest {
  const r = new NextRequest(`http://localhost${ruta}`);
  if (token) r.cookies.set(SESSION_COOKIE, token);
  return r;
}

/** La cookie que emite /api/login para una fila del registro (claims = pista; la base manda). */
async function cookieDe(db: DB, wallet: string): Promise<string> {
  const u = db
    .prepare(`SELECT display_name, tier, role, is_supervisor, is_demo, cla_signed FROM users WHERE wallet = ?`)
    .get(wallet) as { display_name: string; tier: string; role: string; is_supervisor: number; is_demo: number; cla_signed: number };
  return signSession({
    wallet,
    name: u.display_name,
    tier: u.tier,
    isFounder: u.role === "founder",
    role: u.role,
    isSupervisor: !!u.is_supervisor,
    claSigned: !!u.cla_signed,
    isDemo: !!u.is_demo,
  });
}

function como(token: string | null): void {
  if (token) tarro.valores.set(SESSION_COOKIE, token);
  else tarro.valores.delete(SESSION_COOKIE);
}

async function accion(cuerpo: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await admin(post("/api/admin", cuerpo));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Base temporal
// ---------------------------------------------------------------------------

let dir = "";
let db: DB;
let tokenFounder = "";
let tokenA = "";
let tokenB = "";
let walletA = "";
let walletB = "";
let proyecto = 0;
let hito = { id: 0, amount_usd: 0, name: "" };
let aplicacionA = 0;
let aplicacionB = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-caract-admin-"));
  const archivo = path.join(dir, "zelena.db");
  db = openDb(archivo);
  vi.stubEnv("FOUNDER_BOOTSTRAP_CODE", "");
  vi.stubEnv("SEED_COHORT", "");
  prepararSqlite(db, { archivo, founderWallet: FOUNDER_WALLET });
  (globalThis as unknown as { __zelenaDb?: DB }).__zelenaDb = db;

  // Dos contribuidores de la cohorte demo del seed (CLA firmado, invitados por el founder).
  const contribuidores = db
    .prepare(`SELECT wallet FROM users WHERE role = 'contributor' AND cla_signed = 1 AND is_demo = 1 ORDER BY wallet LIMIT 2`)
    .all() as Array<{ wallet: string }>;
  [walletA, walletB] = contribuidores.map((c) => c.wallet);
  tokenFounder = await cookieDe(db, FOUNDER_WALLET);
  tokenA = await cookieDe(db, walletA);
  tokenB = await cookieDe(db, walletB);

  proyecto = (db.prepare(`SELECT id FROM projects WHERE state = 'Open' ORDER BY id LIMIT 1`).get() as { id: number }).id;
  hito = db
    .prepare(`SELECT id, amount_usd, name FROM milestones WHERE project_id = ? ORDER BY ord LIMIT 1`)
    .get(proyecto) as typeof hito;
});

afterAll(() => {
  vi.unstubAllEnvs();
  (globalThis as unknown as { __zelenaDb?: DB }).__zelenaDb = undefined;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows puede retener el archivo: limpieza de cortesía */
  }
});

// ---------------------------------------------------------------------------
// Puertas
// ---------------------------------------------------------------------------

describe("admin · puertas", () => {
  it("middleware: /admin sin cookie → /entrar?next=/admin; con la cookie del founder pasa", async () => {
    const sin = await middleware(pagina("/admin"));
    expect(sin.status).toBe(307);
    expect(sin.headers.get("location")).toBe("http://localhost/entrar?next=%2Fadmin");
    expect((await middleware(pagina("/admin", tokenFounder))).headers.get("location")).toBeNull();
  });

  it("la página repite su propia puerta por rol leído de la base (test estático del código fuente)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "app", "admin", "page.tsx"), "utf8");
    expect(src).toContain(`if (!session) redirect("/entrar");`);
    expect(src).toContain(`if (!adminActor(session, db)) redirect("/perfil");`);
  });

  it("adminActor: founder sí; contribuidor no, aunque su cookie diga founder", async () => {
    expect(adminActor((await verifySession(tokenFounder))!, db)?.role).toBe("founder");
    const claimsA = (await verifySession(tokenA))!;
    expect(adminActor(claimsA, db)).toBeNull();
    expect(adminActor({ ...claimsA, role: "founder", isFounder: true }, db)).toBeNull();
  });

  it("/api/admin: sin sesión 403 y contribuidor 403; /api/admin/epoca: sin sesión 401, contribuidor 403", async () => {
    como(null);
    expect(await accion({ action: "toggleContent", contentId: 1 })).toEqual({
      status: 403,
      json: { error: "Solo el founder puede administrar." },
    });
    como(tokenA);
    expect((await accion({ action: "toggleContent", contentId: 1 })).status).toBe(403);

    como(null);
    const e1 = await epocaGet();
    expect(e1.status).toBe(401);
    expect(await e1.json()).toEqual({ error: "Entra para administrar." });
    como(tokenA);
    const e2 = await epocaGet();
    expect(e2.status).toBe(403);
    expect(await e2.json()).toEqual({ error: SOLO_FOUNDER });
    expect(e2.headers.get("cache-control")).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// Flujo principal del founder
// ---------------------------------------------------------------------------

describe("admin · flujo principal: aplicación → hito → estado → Academia → cierre de época", () => {
  it("1 · dos contribuidores aplican al mismo proyecto abierto (/api/apply)", async () => {
    como(tokenA);
    const ra = await aplicar(post("/api/apply", { projectId: proyecto, approach: "Propuesta de trabajo de la persona A.", timeline: "4 semanas" }));
    expect(ra.status).toBe(200);
    como(tokenB);
    const rb = await aplicar(post("/api/apply", { projectId: proyecto, approach: "Propuesta de trabajo de la persona B.", timeline: "5 semanas" }));
    expect(rb.status).toBe(200);
    aplicacionA = (db.prepare(`SELECT id FROM applications WHERE wallet = ? AND project_id = ?`).get(walletA, proyecto) as { id: number }).id;
    aplicacionB = (db.prepare(`SELECT id FROM applications WHERE wallet = ? AND project_id = ?`).get(walletB, proyecto) as { id: number }).id;
  });

  it("2 · approveApplication: el contribuidor no puede; el founder asigna (Open → Assigned)", async () => {
    como(tokenA);
    expect((await accion({ action: "approveApplication", applicationId: aplicacionA })).status).toBe(403);

    como(tokenFounder);
    expect(await accion({ action: "approveApplication", applicationId: aplicacionA })).toEqual({ status: 200, json: { ok: true } });
    expect(db.prepare(`SELECT status FROM applications WHERE id = ?`).get(aplicacionA)).toEqual({ status: "approved" });
    expect(db.prepare(`SELECT state, assignee_wallet FROM projects WHERE id = ?`).get(proyecto)).toEqual({
      state: "Assigned",
      assignee_wallet: walletA,
    });
    // La otra aplicación queda pendiente: nadie la rechaza automáticamente.
    expect(db.prepare(`SELECT status FROM applications WHERE id = ?`).get(aplicacionB)).toEqual({ status: "pending" });
  });

  it("3 · approveMilestone: emite puntos (1 USD = 1 punto) y reputación en ejecución, en la época actual", async () => {
    const antes = Number((db.prepare(`SELECT COUNT(*) AS n FROM points_ledger`).get() as { n: number }).n);
    como(tokenFounder);
    expect(await accion({ action: "approveMilestone", milestoneId: hito.id })).toEqual({
      status: 200,
      json: { ok: true, points: hito.amount_usd, wallet: walletA },
    });
    expect(db.prepare(`SELECT approved FROM milestones WHERE id = ?`).get(hito.id)).toEqual({ approved: 1 });
    expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM points_ledger`).get() as { n: number }).n)).toBe(antes + 1);
    const titulo = (db.prepare(`SELECT title FROM projects WHERE id = ?`).get(proyecto) as { title: string }).title;
    expect(
      db.prepare(`SELECT wallet, points, period_id, bucket, ref FROM points_ledger ORDER BY id DESC LIMIT 1`).get()
    ).toEqual({ wallet: walletA, points: hito.amount_usd, period_id: 1, bucket: "ejecucion", ref: `${titulo} · ${hito.name}` });
    expect(
      db.prepare(`SELECT wallet, axis, delta, period_id FROM reputation_events ORDER BY id DESC LIMIT 1`).get()
    ).toEqual({ wallet: walletA, axis: "ejecucion", delta: Math.max(1, Math.round(hito.amount_usd / 10)), period_id: 1 });
  });

  it("4 · el mismo hito dos veces → 400 con el mensaje de la regla, sin emitir de nuevo", async () => {
    const antes = Number((db.prepare(`SELECT COUNT(*) AS n FROM points_ledger`).get() as { n: number }).n);
    como(tokenFounder);
    expect(await accion({ action: "approveMilestone", milestoneId: hito.id })).toEqual({
      status: 400,
      json: { error: "El hito ya fue aprobado." },
    });
    expect(Number((db.prepare(`SELECT COUNT(*) AS n FROM points_ledger`).get() as { n: number }).n)).toBe(antes);
  });

  it("5 · advanceState sigue la máquina de estados pura (Assigned → Delivered)", async () => {
    como(tokenFounder);
    expect(await accion({ action: "advanceState", projectId: proyecto })).toEqual({
      status: 200,
      json: { ok: true, state: "Delivered" },
    });
  });

  it("6 · toggleContent apaga y vuelve a encender un contenido de la Academia", async () => {
    const id = (db.prepare(`SELECT id, enabled FROM academia_content ORDER BY id LIMIT 1`).get() as { id: number; enabled: number });
    como(tokenFounder);
    expect((await accion({ action: "toggleContent", contentId: id.id })).status).toBe(200);
    expect(db.prepare(`SELECT enabled FROM academia_content WHERE id = ?`).get(id.id)).toEqual({ enabled: id.enabled ? 0 : 1 });
    await accion({ action: "toggleContent", contentId: id.id });
    expect(db.prepare(`SELECT enabled FROM academia_content WHERE id = ?`).get(id.id)).toEqual({ enabled: id.enabled });
  });

  it("7 · la época no se cierra sin fitness firmado y mutación decidida (409 con lo que falta)", async () => {
    como(tokenFounder);
    const g = await epocaGet();
    expect(await g.json()).toMatchObject({
      ok: true,
      periodo: { id: 1, state: "Open" },
      puedeCerrar: false,
      faltantes: [FALTA_FITNESS, FALTA_MUTACION],
    });
    const p = await epocaPost(post("/api/admin/epoca", { action: "cerrar", justificacion: "Cierre de prueba de la época." }));
    expect(p.status).toBe(409);
    expect((await p.json()).faltantes).toEqual([FALTA_FITNESS, FALTA_MUTACION]);
  });

  it("8 · fitness → 'sin cambios' para la siguiente → firma; firmar antes de decidir la mutación falla", async () => {
    como(tokenFounder);
    const f = await accion({ action: "computeEpochFitness", epoch: 1 });
    expect(f.status).toBe(200);
    const reporte = f.json.report as { id: number; epoch: number; recommendation: string; signed: boolean };
    expect(reporte).toMatchObject({ epoch: 1, signed: false });

    const temprano = await accion({ action: "signEpochDecision", epochFitnessId: reporte.id, decision: "keep" });
    expect(temprano.status).toBe(400);
    expect(String(temprano.json.error)).toMatch(/^Antes de cerrar la época 1 debes decidir la mutación de la época 2/);

    expect(await accion({ action: "recordNoMutation", epoch: 2, justification: "Sin cambios en esta prueba." })).toEqual({
      status: 200,
      json: { ok: true },
    });
    expect(await accion({ action: "signEpochDecision", epochFitnessId: reporte.id, decision: "keep" })).toEqual({
      status: 200,
      json: { ok: true },
    });
  });

  it("9 · cerrar la época: raíz Merkle de lo emitido encolada para la red de pruebas y época 2 abierta", async () => {
    como(tokenFounder);
    const corta = await epocaPost(post("/api/admin/epoca", { action: "cerrar", justificacion: "corta" }));
    expect(corta.status).toBe(400);

    const res = await epocaPost(post("/api/admin/epoca", { action: "cerrar", justificacion: "Cierre de prueba de la época uno." }));
    expect(res.status).toBe(200);
    const r = (await res.json()) as { ok: boolean; cerrada: number; abierta: number; merkleRoot: string; anchorQueueId: number };
    expect(r).toMatchObject({ ok: true, cerrada: 1, abierta: 2 });
    expect(r.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(db.prepare(`SELECT state, merkle_root FROM periods WHERE id = 1`).get()).toEqual({ state: "Closed", merkle_root: r.merkleRoot });
    expect(db.prepare(`SELECT kind, ref, data_key, payload_hash, status FROM anchor_queue WHERE id = ?`).get(r.anchorQueueId)).toEqual({
      kind: "merkle_root",
      ref: "1",
      data_key: "epoch:1",
      payload_hash: r.merkleRoot,
      status: "pending",
    });
    expect(db.prepare(`SELECT state FROM periods WHERE id = 2`).get()).toEqual({ state: "Open" });
    // Dos actas distintas llevan "Cierre" en el título: la firma del fitness (epochs.ts)
    // y el cierre real del periodo (epocas.ts). Ver hallazgo "dos cierres" en la ficha.
    const titulos = (db.prepare(`SELECT title FROM decision_log ORDER BY id`).all() as Array<{ title: string }>).map((t) => t.title);
    expect(titulos).toContain("Cierre de época 1: mantener genoma");
    expect(titulos).toContain("Cierre de la época 1 y apertura de la 2");
  });

  it("10 · fallas de forma: acción desconocida 400 'Entrada inválida.', id faltante 400 con su mensaje", async () => {
    como(tokenFounder);
    expect(await accion({ action: "borrarTodo" })).toEqual({ status: 400, json: { error: "Entrada inválida." } });
    expect(await accion({ action: "approveApplication" })).toEqual({ status: 400, json: { error: "Falta applicationId." } });
    expect(await accion({ action: "approveMilestone", milestoneId: 999999 })).toEqual({
      status: 400,
      json: { error: "Hito no encontrado." },
    });
  });
});

// ---------------------------------------------------------------------------
// Hallazgos fijados (comportamiento actual que la ficha reporta)
// ---------------------------------------------------------------------------

describe("admin · HALLAZGOS (comportamiento actual)", () => {
  it("aprobar una SEGUNDA aplicación de un proyecto ya asignado reemplaza al ejecutor sin aviso", async () => {
    como(tokenFounder);
    expect(await accion({ action: "approveApplication", applicationId: aplicacionB })).toEqual({ status: 200, json: { ok: true } });
    expect(db.prepare(`SELECT assignee_wallet FROM projects WHERE id = ?`).get(proyecto)).toEqual({ assignee_wallet: walletB });
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM applications WHERE project_id = ? AND status = 'approved'`).get(proyecto)
    ).toEqual({ n: 2 });
  });

  it("rechazar una aplicación que no existe responde ok", async () => {
    como(tokenFounder);
    expect(await accion({ action: "rejectApplication", applicationId: 987654 })).toEqual({ status: 200, json: { ok: true } });
  });

  it("(no es hallazgo: schema.sql declara epoch_fitness append-only) calcular el fitness dos veces deja dos reportes", async () => {
    como(tokenFounder);
    await accion({ action: "computeEpochFitness", epoch: 2 });
    await accion({ action: "computeEpochFitness", epoch: 2 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM epoch_fitness WHERE epoch = 2`).get()).toEqual({ n: 2 });
  });

  it("un founder SIN CLA (p. ej. el que entra por Entra) no abre la PÁGINA /admin pero sí usa /api/admin", async () => {
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, status, is_demo, is_founder, cla_signed, role, is_supervisor, auth_provider)
       VALUES ('entra:oid-founder-prueba', 'Founder Corporativo', 'Bronze', 'active', 0, 0, 0, 'founder', 1, 'entra')`
    ).run();
    const token = await cookieDe(db, "entra:oid-founder-prueba");
    expect((await middleware(pagina("/admin", token))).headers.get("location")).toBe("http://localhost/entrar?next=%2Fadmin");
    como(token);
    const id = (db.prepare(`SELECT id FROM academia_content ORDER BY id LIMIT 1`).get() as { id: number }).id;
    expect((await accion({ action: "toggleContent", contentId: id })).status).toBe(200);
    await accion({ action: "toggleContent", contentId: id }); // deja el contenido como estaba
  });

  it("la excepción B8 'Stage 0' depende de la wallet FOUNDER_WALLET, no del rol founder", async () => {
    // Proyecto supervisado por OTRO founder (por rol) cuyo invitado es el ejecutor.
    const otro = db.prepare(`SELECT id FROM projects WHERE state = 'Open' AND id <> ? ORDER BY id LIMIT 1`).get(proyecto) as { id: number };
    db.prepare(`UPDATE projects SET supervisor_wallet = 'entra:oid-founder-prueba', assignee_wallet = ?, state = 'Assigned' WHERE id = ?`).run(
      walletA,
      otro.id
    );
    db.prepare(`UPDATE users SET invited_by = 'entra:oid-founder-prueba' WHERE wallet = ?`).run(walletA);
    const ms = db.prepare(`SELECT id FROM milestones WHERE project_id = ? ORDER BY ord LIMIT 1`).get(otro.id) as { id: number };
    como(tokenFounder);
    expect(await accion({ action: "approveMilestone", milestoneId: ms.id })).toEqual({
      status: 400,
      json: { error: "Regla B8: un supervisor no puede evaluar a su invitado directo." },
    });
  });
});
