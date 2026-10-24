/**
 * Prueba de caracterización · talento-e-importador
 * Ficha: docs/features/talento-e-importador.md (sección 8). Commit de referencia: 0e07d8f.
 *
 * Protege el comportamiento ACTUAL del flujo principal, de punta a punta y a través
 * de las rutas reales (`POST /api/equipo/importar` y `POST /api/equipo/talento`):
 *
 *   1. El founder importa un CSV: nacen el proyecto y dos piezas; el Assignee se
 *      resuelve por el roster a su fila `pending:<slug>`; no se emiten puntos.
 *   2. El directorio muestra la fila pendiente con su carga abierta.
 *   3. El founder simula la vinculación (no deja huella) y luego vincula la fila con
 *      la cuenta real: el trabajo pasa a la cuenta, la fila pendiente desaparece.
 *   4. Reimportar el mismo CSV no duplica ni reasigna; el arranque no recrea la fila.
 *   5. Cambiar el rol a contributor con piezas fuera de sus proyectos → 409; tras
 *      sumarle al proyecto, el cambio se guarda con su evento.
 *   6. Puertas: quien no es founder no cambia talento ni importa (403).
 *
 * Base: SQLite temporal en memoria con `schema.sql` (igual que los tests de
 * src/lib/*.test.ts). Las rutas leen esa base vía el singleton `globalThis.__zelenaDb`
 * de lib/db.ts; la sesión se simula con un mock de `@/lib/session`. Los alias `@/lib/*`
 * de las rutas se resuelven a los módulos reales (vitest no lee los `paths` del
 * tsconfig). Ningún dato real: wallets y nombres inventados; la persona del roster se
 * elige por su rol, sin escribir su nombre.
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
vi.mock("@/lib/talento", () => import("../talento"));
vi.mock("@/lib/roles", () => import("../roles"));
vi.mock("@/lib/team-import", () => import("../team-import"));

import { openDb, type DB } from "../db";
import { TEAM_ROSTER, pendingPrincipal, type TeamActor } from "../roles";
import { TeamError, agregarMiembro, seedTeam } from "../team";
import { cambiarRol, candidatosAVincular, directorioTalento } from "../talento";
import { POST as postImportar } from "../../../app/api/equipo/importar/route";
import { POST as postTalento } from "../../../app/api/equipo/talento/route";

const FOUNDER = "GCARACFOUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REAL = "GCARACCUENTAREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const AJENA = "GCARACCONTRIBUIDORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// Una persona del roster con rol core y sin supervisión (no el founder).
const MIEMBRO = TEAM_ROSTER.find((m) => m.role === "core" && !m.isSupervisor)!;
const PENDIENTE = pendingPrincipal(MIEMBRO.slug);
const ALIAS = MIEMBRO.aliases[0];

const CSV = [
  "Iniciativa,Title,Assignee,Status,Priority,Size,Due",
  `Huerto demo,Regar el huerto,${ALIAS},En curso,P2,M,2099-12-01`,
  "Huerto demo,Comprar semillas,,,,S,",
].join("\n");

let db: DB;
const g = globalThis as unknown as { __zelenaDb?: DB };

function sesion(wallet: string): Record<string, unknown> {
  return { wallet, name: "prueba", tier: "Bronze", isFounder: false, claSigned: true, isDemo: false };
}

async function llamar(
  handler: (req: NextRequest) => Promise<Response>,
  url: string,
  body: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const req = new NextRequest(new URL(url, "http://localhost"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
  });
  const res = await handler(req);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

function contar(sql: string, ...p: unknown[]): number {
  return Number((db.prepare(sql).get(...p) as { n: number }).n);
}

beforeAll(() => {
  db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db); // lo mismo que hace el arranque: filas pending:<slug> del roster
  const ins = db.prepare(
    `INSERT INTO users (wallet, display_name, role, is_supervisor, cla_signed, status) VALUES (?, ?, ?, ?, 1, 'active')`
  );
  ins.run(FOUNDER, "Founder de prueba", "founder", 1);
  ins.run(REAL, "Cuenta real de prueba", "contributor", 0);
  ins.run(AJENA, "Contribuidora de prueba", "contributor", 0);
  g.__zelenaDb = db;
});

afterAll(() => {
  delete g.__zelenaDb;
});

describe("caracterización · talento-e-importador (flujo principal)", () => {
  it("1. importar el CSV por la ruta crea proyecto y piezas, resuelve el Assignee al roster y no emite puntos", async () => {
    estado.session = sesion(FOUNDER);
    const r = await llamar(postImportar, "/api/equipo/importar", { csv: CSV });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ ok: true, created: 2, updated: 0, initiatives: 1, errors: [] });
    expect(r.data.warnings).toEqual([
      {
        line: 2,
        title: "Regar el huerto",
        warning: "'En curso' se importa como 'Asignada': quien la tiene la mueve desde el tablero",
      },
    ]);

    const regar = db
      .prepare(`SELECT owner_wallet, status, priority, size, due_date, created_by FROM assignments WHERE import_key = ?`)
      .get("csv:huerto-demo:regar-el-huerto") as Record<string, unknown>;
    expect(regar).toEqual({
      owner_wallet: PENDIENTE,
      status: "Asignada",
      priority: "High",
      size: "M",
      due_date: "2099-12-01",
      created_by: FOUNDER,
    });
    const semillas = db
      .prepare(`SELECT owner_wallet, status FROM assignments WHERE import_key = ?`)
      .get("csv:huerto-demo:comprar-semillas") as Record<string, unknown>;
    expect(semillas).toEqual({ owner_wallet: null, status: "Backlog" });

    // Cada pieza abre su historial con un evento `crear` de quien importa.
    const eventos = db
      .prepare(`SELECT action, from_status, to_status, actor_wallet FROM assignment_events ORDER BY id`)
      .all();
    expect(eventos).toEqual([
      { action: "crear", from_status: "Backlog", to_status: "Asignada", actor_wallet: FOUNDER },
      { action: "crear", from_status: "Backlog", to_status: "Backlog", actor_wallet: FOUNDER },
    ]);
    // Importar no da puntos ni reputación; deja un evento `importar` con conteos.
    expect(contar(`SELECT COUNT(*) AS n FROM points_ledger`)).toBe(0);
    expect(contar(`SELECT COUNT(*) AS n FROM reputation_events`)).toBe(0);
    const ev = db.prepare(`SELECT actor_wallet, detail FROM talent_events WHERE action = 'importar'`).get() as {
      actor_wallet: string;
      detail: string;
    };
    expect(ev.actor_wallet).toBe(FOUNDER);
    expect(JSON.parse(ev.detail)).toEqual({ creadas: 2, yaEstaban: 0, conError: 0, proyectos: 1 });
  });

  it("2. el directorio muestra la fila pendiente con su carga y la cuenta real como candidata", () => {
    const fila = directorioTalento(db).find((p) => p.wallet === PENDIENTE);
    expect(fila).toMatchObject({ pendiente: true, role: "core", abiertas: 1, vinculo: null, tieneCla: false });
    expect(candidatosAVincular(db, MIEMBRO.slug, FOUNDER).map((c) => c.wallet)).toContain(REAL);
  });

  it("3a. simular la vinculación devuelve los conteos y no deja huella", async () => {
    estado.session = sesion(FOUNDER);
    const r = await llamar(postTalento, "/api/equipo/talento", {
      action: "vincular",
      slug: MIEMBRO.slug,
      wallet: REAL,
      simular: true,
    });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      ok: true,
      simulado: true,
      movidas: { "assignments.owner_wallet": 1 },
      descartadas: {},
      resumen: { total: 1, detalle: "1 entregas a su nombre", descartadas: 0 },
    });
    expect(contar(`SELECT COUNT(*) AS n FROM users WHERE wallet = ?`, PENDIENTE)).toBe(1);
    expect(contar(`SELECT COUNT(*) AS n FROM roster_links`)).toBe(0);
    expect(contar(`SELECT COUNT(*) AS n FROM talent_events WHERE action = 'vincular'`)).toBe(0);
  });

  it("3b. vincular de verdad pasa el trabajo a la cuenta real y borra la fila pendiente", async () => {
    estado.session = sesion(FOUNDER);
    const r = await llamar(postTalento, "/api/equipo/talento", { action: "vincular", slug: MIEMBRO.slug, wallet: REAL });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ ok: true, simulado: false, movidas: { "assignments.owner_wallet": 1 } });

    expect(contar(`SELECT COUNT(*) AS n FROM users WHERE wallet = ?`, PENDIENTE)).toBe(0);
    expect(db.prepare(`SELECT slug, wallet, linked_by FROM roster_links`).all()).toEqual([
      { slug: MIEMBRO.slug, wallet: REAL, linked_by: FOUNDER },
    ]);
    // La cuenta toma el rol más alto de las dos (core > contributor).
    expect((db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(REAL) as { role: string }).role).toBe("core");
    expect(
      (db.prepare(`SELECT owner_wallet FROM assignments WHERE import_key = ?`).get("csv:huerto-demo:regar-el-huerto") as {
        owner_wallet: string;
      }).owner_wallet
    ).toBe(REAL);
    expect(contar(`SELECT COUNT(*) AS n FROM talent_events WHERE action = 'vincular' AND target_wallet = ?`, REAL)).toBe(1);

    // Una segunda vinculación de la misma fila → 409.
    const otra = await llamar(postTalento, "/api/equipo/talento", { action: "vincular", slug: MIEMBRO.slug, wallet: REAL });
    expect(otra.status).toBe(409);
    expect(otra.data.error).toBe("Esa fila del equipo ya está vinculada.");
  });

  it("4. reimportar el mismo CSV no duplica ni reasigna, y el arranque no recrea la fila pendiente", async () => {
    estado.session = sesion(FOUNDER);
    const eventosAntes = contar(`SELECT COUNT(*) AS n FROM assignment_events`);
    const r = await llamar(postImportar, "/api/equipo/importar", { csv: CSV });
    expect(r.status).toBe(200);
    // `updated` cuenta las filas que ya existían, aunque no cambie nada en ellas.
    expect(r.data).toMatchObject({ created: 0, updated: 2, initiatives: 1, errors: [], warnings: [] });
    expect(contar(`SELECT COUNT(*) AS n FROM assignments`)).toBe(2);
    expect(contar(`SELECT COUNT(*) AS n FROM assignment_events`)).toBe(eventosAntes);

    seedTeam(db);
    expect(contar(`SELECT COUNT(*) AS n FROM users WHERE wallet = ?`, PENDIENTE)).toBe(0);
    expect((db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(REAL) as { role: string }).role).toBe("core");
  });

  it("5. pasar a contributor exige membresía en los proyectos de sus piezas abiertas (409) y luego se guarda", async () => {
    estado.session = sesion(FOUNDER);
    const antes = await llamar(postTalento, "/api/equipo/talento", { action: "rol", wallet: REAL, role: "contributor" });
    expect(antes.status).toBe(409);
    expect(antes.data.error).toBe("Primero reasigna sus entregas abiertas o súmale a esos proyectos.");

    const founder: TeamActor = { wallet: FOUNDER, name: "Founder de prueba", role: "founder", isSupervisor: true };
    const proyecto = (db.prepare(`SELECT id FROM initiatives WHERE slug = 'huerto-demo'`).get() as { id: number }).id;
    agregarMiembro(db, founder, { initiativeId: proyecto, wallet: REAL, rol: "ejecuta" });

    const despues = await llamar(postTalento, "/api/equipo/talento", { action: "rol", wallet: REAL, role: "contributor" });
    expect(despues.status).toBe(200);
    expect((db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(REAL) as { role: string }).role).toBe("contributor");
    const ev = db
      .prepare(`SELECT detail FROM talent_events WHERE action = 'rol' AND target_wallet = ? ORDER BY id DESC`)
      .get(REAL) as { detail: string };
    expect(JSON.parse(ev.detail)).toEqual({ de: "core", a: "contributor" });
  });

  it("6. puertas: sin sesión 401; quien no es founder no cambia talento ni importa (403); nadie edita su propio rol", async () => {
    estado.session = null;
    expect((await llamar(postTalento, "/api/equipo/talento", { action: "rol", wallet: AJENA, role: "core" })).status).toBe(401);
    expect((await llamar(postImportar, "/api/equipo/importar", { csv: CSV })).status).toBe(401);

    estado.session = sesion(AJENA); // contributor: ni founder ni equipo interno
    const t = await llamar(postTalento, "/api/equipo/talento", { action: "rol", wallet: AJENA, role: "core" });
    expect(t.status).toBe(403);
    expect(t.data.error).toBe("Los cambios de rol, supervisión y vínculo los hace el founder.");
    const i = await llamar(postImportar, "/api/equipo/importar", { csv: CSV });
    expect(i.status).toBe(403);
    expect(i.data.error).toBe("Importar es del founder y los supervisores.");

    const founder: TeamActor = { wallet: FOUNDER, name: "Founder de prueba", role: "founder", isSupervisor: true };
    expect(() => cambiarRol(db, founder, { wallet: FOUNDER, role: "core" })).toThrow(TeamError);
    expect(() => cambiarRol(db, founder, { wallet: FOUNDER, role: "core" })).toThrow("Tus propios roles los cambia otra persona.");
  });
});
