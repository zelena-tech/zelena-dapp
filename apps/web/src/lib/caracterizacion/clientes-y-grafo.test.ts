/**
 * Prueba de caracterización · Clientes y grafo de operación (docs/features/clientes-y-grafo.md, §8).
 *
 * Flujo principal con el handler real de la ruta y una base SQLite temporal (en
 * memoria, con `schema.sql`):
 *
 *   1. el founder importa el grafo.json de un cliente       → POST /api/clientes/grafo
 *   2. un miembro del equipo interno entra a /clientes        → clientActor + listClientsFor
 *   3. abre el cliente y navega el grafo                      → getClientForActor + listNodes/getNode/impactOf
 *   4. la pestaña Accesos solo para `colaborador` o más, y cada consulta queda en el log.
 *
 * El grafo es SINTÉTICO (cliente, personas y procesos ficticios): el grafo privado de
 * `client-graph.test.ts` es conocimiento de cliente, no viaja en el repo y esa suite se
 * salta sin él (desde b97448a la acompaña una suite sintética que corre siempre). Esta
 * prueba no depende de él. Personas del equipo: slugs de la plantilla de roles (A8).
 *
 * Protege el comportamiento ACTUAL (commit 0e07d8f; revisada contra wp/32-release,
 * 4032c7c), incluido lo discutible que la ficha lista como hallazgo (un JSON mal
 * formado revienta en 500, no en 422).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { openDb, type DB } from "../db";

const estado = vi.hoisted(() => ({ sesion: null as null | Record<string, unknown> }));

vi.mock("@/lib/session", () => ({ getSession: async () => estado.sesion }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/clients", async () => await import("../clients"));
vi.mock("@/lib/client-graph", async () => await import("../client-graph"));
vi.mock("@/lib/authz", async () => await import("../authz"));

import { POST as importarPOST } from "../../../app/api/clientes/grafo/route";
import { clientActor } from "../authz";
import { pendingPrincipal } from "../roles";
import { seedTeam } from "../team";
import {
  addCredential,
  addMember,
  createClient,
  getClientForActor,
  listClientsFor,
  listCredentials,
  ClientAccessError,
  ClientError,
} from "../clients";
import { coverage, exposureMap, getNode, impactOf, listNodes, type GraphJson } from "../client-graph";

const g = globalThis as unknown as { __zelenaDb?: DB };
const dbOriginal = g.__zelenaDb;

const FILA_FOUNDER = pendingPrincipal("founder"); // founder (rol leído de la base)
const OPERACIONES = pendingPrincipal("operaciones"); // core: miembro del cliente con nivel `lectura`
const PRODUCTO = pendingPrincipal("producto"); // core: NO es miembro del cliente
const ADA = "GADACONTRIBUIDORAFICTICIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // contribuidora externa

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  vi.stubEnv("ZELENA_TEAM_ROSTER", ""); // sin roster del entorno: la plantilla de roles del código (A8)
  seedTeam(db);
  db.prepare(
    `INSERT INTO users (wallet, display_name, tier, status, is_demo, cla_signed, role, is_supervisor)
     VALUES (?, 'Ada', 'Bronze', 'active', 0, 1, 'contributor', 0)`
  ).run(ADA);
  return db;
}

function grafo(): GraphJson {
  return {
    cliente: "cliente-demo",
    generado: "2026-10-01",
    nodos: [
      {
        id: "demo.proceso.facturacion",
        nombre: "Facturación mensual",
        tipo: "proceso",
        estado: "activo",
        confianza: "verificado",
        criticidad: "alta",
        bus_factor: 1,
        owner_cliente: "Persona Ficticia A",
        que_es: "Cómo se factura cada mes.",
        n_abiertas: 2,
      },
      {
        id: "demo.sistema.erp",
        nombre: "ERP de prueba",
        tipo: "sistema",
        estado: "activo",
        confianza: "declarado",
        bus_factor: 2,
      },
      {
        id: "demo.modulo.cobros",
        nombre: "Módulo de cobros",
        tipo: "modulo",
        estado: "activo",
        confianza: "inferido",
        bus_factor: 1,
        owner_zelena: "Persona Ficticia B",
        n_abiertas: 1,
      },
    ],
    aristas: [
      { origen: "demo.proceso.facturacion", destino: "demo.sistema.erp", tipo: "depende_de" },
      { origen: "demo.modulo.cobros", destino: "demo.sistema.erp", tipo: "pertenece_a" },
      { origen: "demo.modulo.cobros", destino: "demo.no.existe", tipo: "depende_de" }, // destino desconocido: se descarta
      { origen: "demo.proceso.facturacion", destino: "demo.modulo.cobros", tipo: "inventada" }, // tipo desconocido: se descarta
    ],
  };
}

function sesionDe(wallet: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { wallet, name: wallet, tier: "Bronze", isFounder: false, claSigned: true, isDemo: false, ...extra };
}

function post(body: unknown): Request {
  return new NextRequest("http://localhost/api/clientes/grafo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function contar(db: DB, sql: string, ...p: unknown[]): number {
  return Number((db.prepare(sql).get(...p) as { n: number }).n);
}

describe("Clientes y grafo · flujo principal (importar → listar → navegar → accesos)", () => {
  let db: DB;
  let clienteId: number;

  beforeEach(() => {
    db = freshDb();
    g.__zelenaDb = db;
    estado.sesion = null;
    // Hoy no hay pantalla ni ruta para crear clientes ni miembros: solo estas funciones.
    clienteId = createClient(db, { name: "Cliente Demo", status: "activo", industry: "Servicios" });
    addMember(db, clienteId, OPERACIONES, "lectura");
  });

  afterAll(() => {
    g.__zelenaDb = dbOriginal;
    vi.unstubAllEnvs();
  });

  it("el founder importa el grafo; un miembro 'lectura' lo navega; un core ajeno no ve el cliente", async () => {
    // 1. Importar (founder por rol leído de la base).
    estado.sesion = sesionDe(FILA_FOUNDER, { isFounder: true, role: "founder", isSupervisor: true });
    const r = await importarPOST(post({ slug: "cliente-demo", grafo: grafo() }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      ok: true,
      nodes: 3,
      edges: 2, // las dos aristas inválidas se descartan en silencio
      removed: 0,
      pctVerified: 33.3,
      openQuestions: 3,
      busFactorCritical: 2,
      generatedAt: "2026-10-01",
    });
    expect(db.prepare(`SELECT imported_by FROM graph_imports WHERE client_id = ?`).all(clienteId)).toEqual([{ imported_by: FILA_FOUNDER }]);

    // 2. /clientes para un miembro del equipo interno.
    const operaciones = clientActor(sesionDe(OPERACIONES, { role: "core" }) as never, db);
    expect(operaciones).toEqual({ wallet: OPERACIONES, isFounder: false });
    expect(listClientsFor(db, operaciones!).map((c) => c.slug)).toEqual(["cliente-demo"]);

    // Un core que no es miembro: el cliente no existe para él (la página responde 404).
    const producto = clientActor(sesionDe(PRODUCTO, { role: "core" }) as never, db)!;
    expect(listClientsFor(db, producto)).toEqual([]);
    expect(getClientForActor(db, "cliente-demo", producto)).toBeNull();
    // Una contribuidora externa ni siquiera es actor de /clientes (el layout la manda a /perfil).
    expect(clientActor(sesionDe(ADA, { role: "contributor" }) as never, db)).toBeNull();

    // 3. Navegar el grafo como `lectura`.
    const cliente = getClientForActor(db, "cliente-demo", operaciones!)!;
    expect(listNodes(db, cliente.id, operaciones!).map((n) => n.nodeId)).toEqual([
      "demo.modulo.cobros",
      "demo.proceso.facturacion",
      "demo.sistema.erp",
    ]);
    const erp = getNode(db, cliente.id, "demo.sistema.erp", operaciones!)!;
    expect(erp.incoming.map((v) => [v.node.nodeId, v.kind]).sort()).toEqual([
      ["demo.modulo.cobros", "pertenece_a"],
      ["demo.proceso.facturacion", "depende_de"],
    ]);
    expect(impactOf(db, cliente.id, "demo.sistema.erp", operaciones!).map((n) => n.nodeId).sort()).toEqual([
      "demo.modulo.cobros",
      "demo.proceso.facturacion",
    ]);
    // Agrupa por responsable (owner_client, si no owner_zelena); el orden entre empates no se fija.
    expect(exposureMap(db, cliente.id, operaciones!).map((e) => [e.persona, e.total]).sort()).toEqual([
      ["Persona Ficticia A", 1],
      ["Persona Ficticia B", 1],
    ]);
    expect(coverage(db, cliente.id)).toMatchObject({ total: 3, pctVerified: 33.3, openQuestions: 3, busFactorCritical: 2 });
    expect(() => listNodes(db, cliente.id, producto)).toThrow(ClientAccessError);

    // Reimportar el mismo JSON es idempotente (misma proyección, una fila más de historia).
    await importarPOST(post({ slug: "cliente-demo", grafo: grafo() }));
    expect(contar(db, `SELECT COUNT(*) AS n FROM graph_nodes WHERE client_id = ?`, clienteId)).toBe(3);
    expect(contar(db, `SELECT COUNT(*) AS n FROM graph_edges WHERE client_id = ?`, clienteId)).toBe(2);
    expect(contar(db, `SELECT COUNT(*) AS n FROM graph_imports WHERE client_id = ?`, clienteId)).toBe(2);

    // Un nodo que desaparece del origen se borra de la proyección.
    const reducido = grafo();
    reducido.nodos = reducido.nodos.filter((n) => n.id !== "demo.modulo.cobros");
    const r2 = (await (await importarPOST(post({ slug: "cliente-demo", grafo: reducido }))).json()) as { removed: number; edges: number };
    expect(r2).toMatchObject({ removed: 1, edges: 1 });
  });

  it("puertas de la importación: 401 sin sesión, 403 si no es founder, 400 sin cuerpo, 404 slug desconocido", async () => {
    expect((await importarPOST(post({ slug: "cliente-demo", grafo: grafo() }))).status).toBe(401);
    // Supervisora (core) con cookie que dice founder: manda la base → 403.
    estado.sesion = sesionDe(OPERACIONES, { isFounder: true, role: "founder", isSupervisor: true });
    expect((await importarPOST(post({ slug: "cliente-demo", grafo: grafo() }))).status).toBe(403);

    estado.sesion = sesionDe(FILA_FOUNDER, { isFounder: true, role: "founder" });
    expect((await importarPOST(post({ slug: "cliente-demo" }))).status).toBe(400);
    expect((await importarPOST(post({ slug: "no-existe", grafo: grafo() }))).status).toBe(404);
    expect(contar(db, `SELECT COUNT(*) AS n FROM graph_nodes`)).toBe(0);
  });

  it("un secreto en el cuerpo de un nodo aborta TODO (422) y no escribe nada", async () => {
    estado.sesion = sesionDe(FILA_FOUNDER, { isFounder: true, role: "founder" });
    const sucio = grafo();
    sucio.nodos[1].detalle = "Conexión: https://usuario:clave-de-prueba@erp.ejemplo.test/api";
    const r = await importarPOST(post({ slug: "cliente-demo", grafo: sucio }));
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toMatch(/posible secreto \(credencial embebida en una URL\)/);
    expect(contar(db, `SELECT COUNT(*) AS n FROM graph_nodes`)).toBe(0);
    expect(contar(db, `SELECT COUNT(*) AS n FROM graph_imports`)).toBe(0);
  });

  it("comportamiento actual discutible: un nodo sin 'nombre' no es 422 sino una excepción sin capturar (500)", async () => {
    estado.sesion = sesionDe(FILA_FOUNDER, { isFounder: true, role: "founder" });
    const roto = grafo() as unknown as { nodos: Array<Record<string, unknown>> };
    delete roto.nodos[0].nombre;
    await expect(importarPOST(post({ slug: "cliente-demo", grafo: roto }))).rejects.toThrow(/NOT NULL/);
    expect(contar(db, `SELECT COUNT(*) AS n FROM graph_nodes`)).toBe(0); // la transacción revierte
  });

  it("credenciales sin secretos: 'lectura' no ve el inventario; 'colaborador' sí y queda en el log; un valor se rechaza", () => {
    addMember(db, clienteId, PRODUCTO, "colaborador");
    const founder = { wallet: FILA_FOUNDER, isFounder: true };
    addCredential(
      db,
      clienteId,
      { name: "Acceso al ERP", type: "servidor", location: "Bóveda del equipo / entrada erp-demo", ownerWallet: PRODUCTO },
      founder
    );

    expect(() => listCredentials(db, clienteId, { wallet: OPERACIONES, isFounder: false })).toThrow(ClientAccessError);
    const lista = listCredentials(db, clienteId, { wallet: PRODUCTO, isFounder: false });
    expect(lista.map((c) => [c.name, c.location])).toEqual([["Acceso al ERP", "Bóveda del equipo / entrada erp-demo"]]);
    expect(db.prepare(`SELECT wallet, action, credential_id FROM credential_access_log`).all()).toEqual([
      { wallet: PRODUCTO, action: "list", credential_id: null },
    ]);

    // Solo un lead registra, y nunca el valor.
    expect(() =>
      addCredential(db, clienteId, { name: "Otra", type: "api", location: "en la bóveda" }, { wallet: PRODUCTO, isFounder: false })
    ).toThrow(ClientAccessError);
    expect(() =>
      addCredential(db, clienteId, { name: "API", type: "api", location: "https://usuario:clave-de-prueba@api.ejemplo.test" }, founder)
    ).toThrow(ClientError);
    expect(contar(db, `SELECT COUNT(*) AS n FROM credential_inventory`)).toBe(1);
  });
});
