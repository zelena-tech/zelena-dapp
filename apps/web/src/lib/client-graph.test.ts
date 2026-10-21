/**
 * WP20 · grafo de operación del cliente.
 *
 * El repo es PÚBLICO (hallazgo A8): este archivo no nombra a ningún cliente.
 *  - La suite SINTÉTICA corre siempre (también en CI): un grafo inventado, en este
 *    archivo, con la misma forma que emite `construir_grafo.py`.
 *  - La suite del grafo PRIVADO (conocimiento real de un cliente) solo corre donde
 *    exista el archivo: `ZELENA_GRAFO_PRIVADO=<ruta>` o el primer
 *    `__fixtures__/*grafo*.json` (ignorado por git). Sin él, se salta entera. Sus ids
 *    se arman con el prefijo que traiga el propio archivo, sin escribirlo aquí.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { createClient, addMember, ClientAccessError, type Actor } from "./clients";
import {
  importGraph,
  listNodes,
  getNode,
  impactOf,
  coverage,
  coverageHistory,
  exposureMap,
  GraphImportError,
  type GraphJson,
} from "./client-graph";

const LIB = path.join(process.cwd(), "src", "lib");
const SCHEMA = path.join(LIB, "schema.sql");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA, "utf8"));
  db.prepare(`INSERT INTO users (wallet, display_name, is_founder) VALUES ('W_PLATAFORMA','Plataforma',0)`).run();
  db.prepare(`INSERT INTO users (wallet, display_name, is_founder) VALUES ('W_OTRO','Otro',0)`).run();
  return db;
}

const plataforma: Actor = { wallet: "W_PLATAFORMA", isFounder: false };
const extrano: Actor = { wallet: "W_OTRO", isFounder: false };

/* ------------------------------------------------------------------ *
 * Grafo SINTÉTICO (siempre corre)
 * ------------------------------------------------------------------ */

type Nodo = GraphJson["nodos"][number];

const nodo = (id: string, tipo: string, nombre: string, extra: Partial<Nodo> = {}): Nodo => ({
  id: `demo.${id}`,
  nombre,
  tipo,
  estado: "activo",
  confianza: "inferido",
  ...extra,
});

/** Una operación de facturación inventada: sistema → proceso → variantes. */
function grafoSintetico(): GraphJson {
  return {
    cliente: "demo",
    generado: "2026-10-21T10:00:00Z",
    nodos: [
      nodo("area.facturacion", "area", "Facturación", { confianza: "verificado" }),
      nodo("rol.auxiliar", "rol", "Auxiliar contable", { bus_factor: 1, owner_cliente: "Responsable A" }),
      nodo("sistema.erp", "sistema", "ERP de ejemplo", {
        bus_factor: 1,
        criticidad: "alta",
        owner_zelena: "Plataforma",
        n_abiertas: 2,
      }),
      nodo("proceso.facturacion-venta", "proceso", "Facturación de venta", { n_abiertas: 3, que_es: "Emitir la factura." }),
      nodo("variante.facturacion-credito", "variante", "Facturación a crédito", { n_abiertas: 1 }),
      nodo("variante.facturacion-retencion", "variante", "Facturación con retención en la fuente", {
        detalle: "Se aplica en `account.tax`.",
      }),
    ],
    aristas: [
      { origen: "demo.proceso.facturacion-venta", destino: "demo.area.facturacion", tipo: "pertenece_a" },
      { origen: "demo.proceso.facturacion-venta", destino: "demo.rol.auxiliar", tipo: "ejecutado_por" },
      { origen: "demo.proceso.facturacion-venta", destino: "demo.sistema.erp", tipo: "implementado_en" },
      { origen: "demo.variante.facturacion-credito", destino: "demo.proceso.facturacion-venta", tipo: "varia_de" },
      { origen: "demo.variante.facturacion-retencion", destino: "demo.proceso.facturacion-venta", tipo: "varia_de" },
    ],
  };
}

describe("WP20 · grafo sintético: importación", () => {
  let db: DB;
  let cliente: number;

  beforeEach(() => {
    db = freshDb();
    cliente = createClient(db, { name: "Cliente Demo", status: "activo" });
    addMember(db, cliente, "W_PLATAFORMA", "lead");
  });

  it("importa nodos y aristas con sus métricas", () => {
    const r = importGraph(db, cliente, grafoSintetico(), "W_PLATAFORMA");
    expect(r).toMatchObject({ nodes: 6, edges: 5, removed: 0, openQuestions: 6, busFactorCritical: 2 });
    expect(r.pctVerified).toBeCloseTo(16.7, 1);
  });

  it("es idempotente y borra lo que desapareció del origen", () => {
    importGraph(db, cliente, grafoSintetico());
    importGraph(db, cliente, grafoSintetico());
    expect(listNodes(db, cliente, plataforma)).toHaveLength(6);
    const reducido = grafoSintetico();
    reducido.nodos = reducido.nodos.filter((n) => n.tipo !== "variante");
    expect(importGraph(db, cliente, reducido).removed).toBe(2);
    expect(listNodes(db, cliente, plataforma, { kind: "variante" })).toHaveLength(0);
  });

  it("aborta si un nodo trae un secreto, sin escribir nada", () => {
    const g = grafoSintetico();
    g.nodos[0].detalle = `El token es shpat_${"a".repeat(32)}`;
    expect(() => importGraph(db, cliente, g)).toThrow(GraphImportError);
    expect(listNodes(db, cliente, plataforma)).toHaveLength(0);
  });

  it("rechaza un tipo de nodo desconocido y descarta aristas a nodos inexistentes", () => {
    const malo = grafoSintetico();
    malo.nodos[0].tipo = "inventado";
    expect(() => importGraph(db, cliente, malo)).toThrow(/tipo desconocido/i);
    const g = grafoSintetico();
    g.aristas.push({ origen: "demo.area.facturacion", destino: "demo.no.existe", tipo: "depende_de" });
    expect(importGraph(db, cliente, g).edges).toBe(5);
  });
});

describe("WP20 · grafo sintético: consultas", () => {
  let db: DB;
  let cliente: number;

  beforeEach(() => {
    db = freshDb();
    cliente = createClient(db, { name: "Cliente Demo", status: "activo" });
    addMember(db, cliente, "W_PLATAFORMA", "lead");
    importGraph(db, cliente, grafoSintetico(), "W_PLATAFORMA");
  });

  it("un no-miembro no puede leer el grafo del cliente", () => {
    expect(() => listNodes(db, cliente, extrano)).toThrow(ClientAccessError);
    expect(() => getNode(db, cliente, "demo.sistema.erp", extrano)).toThrow(ClientAccessError);
    expect(() => exposureMap(db, cliente, extrano)).toThrow(ClientAccessError);
  });

  it("un nodo trae sus vecinos con el tipo de arista", () => {
    const r = getNode(db, cliente, "demo.proceso.facturacion-venta", plataforma)!;
    expect(r.node.name).toBe("Facturación de venta");
    expect(r.outgoing.map((o) => o.kind).sort()).toEqual(["ejecutado_por", "implementado_en", "pertenece_a"]);
    expect(r.incoming.filter((i) => i.kind === "varia_de")).toHaveLength(2);
  });

  it("el impacto es transitivo: lo que depende del sistema y de lo que depende de él", () => {
    const ids = impactOf(db, cliente, "demo.sistema.erp", plataforma).map((n) => n.nodeId);
    expect(ids).toContain("demo.proceso.facturacion-venta");
    expect(ids).toContain("demo.variante.facturacion-retencion");
  });

  it("cobertura, historial y mapa de exposición", () => {
    const c = coverage(db, cliente);
    expect(c).toMatchObject({ total: 6, openQuestions: 6, busFactorCritical: 2 });
    const mejor = grafoSintetico();
    for (const n of mejor.nodos) n.confianza = "verificado";
    importGraph(db, cliente, mejor, "W_PLATAFORMA");
    const h = coverageHistory(db, cliente);
    expect(h.map((x) => x.pct_verified)).toEqual([16.7, 100]);
    const m = exposureMap(db, cliente, plataforma);
    expect(m.reduce((s, g) => s + g.total, 0)).toBe(2);
    expect(m.map((g) => g.persona).sort()).toEqual(["Plataforma", "Responsable A"]);
  });
});

/* ------------------------------------------------------------------ *
 * Grafo PRIVADO de un cliente real (solo donde exista el archivo)
 * ------------------------------------------------------------------ */

/** Ruta del grafo privado: la variable de entorno o el primer `*grafo*.json` ignorado por git. */
function rutaGrafoPrivado(): string | null {
  const env = (process.env.ZELENA_GRAFO_PRIVADO ?? "").trim();
  if (env) return fs.existsSync(env) ? env : null;
  const dir = path.join(LIB, "__fixtures__");
  const candidato = fs.existsSync(dir) ? fs.readdirSync(dir).find((n) => /grafo.*\.json$/.test(n)) : undefined;
  return candidato ? path.join(dir, candidato) : null;
}

const RUTA_PRIVADA = rutaGrafoPrivado();
const describePrivado = describe.skipIf(!RUTA_PRIVADA);

function privado(): GraphJson {
  return JSON.parse(fs.readFileSync(RUTA_PRIVADA!, "utf8")) as GraphJson;
}

/** Id de un nodo del grafo privado con el prefijo que trae el propio archivo. */
function id(resto: string): string {
  const prefijo = privado().nodos[0].id.split(".")[0];
  return `${prefijo}.${resto}`;
}

describePrivado("WP20 · grafo privado: importación", () => {
  let db: DB;
  let cliente: number;

  beforeEach(() => {
    db = freshDb();
    cliente = createClient(db, { name: "Cliente privado", status: "activo" });
    addMember(db, cliente, "W_PLATAFORMA", "lead");
  });

  it("importa el grafo con sus nodos y aristas", () => {
    const r = importGraph(db, cliente, privado(), "W_PLATAFORMA");
    expect(r.nodes).toBe(29);
    expect(r.edges).toBe(50);
    expect(r.pctVerified).toBeCloseTo(3.4, 1);
    expect(r.openQuestions).toBe(107);
    expect(r.busFactorCritical).toBe(27);
  });

  it("las cuatro variantes de facturación llegan como nodos consultables", () => {
    importGraph(db, cliente, privado());
    const variantes = listNodes(db, cliente, plataforma, { kind: "variante" });
    expect(variantes).toHaveLength(4);
    expect(variantes.map((v) => v.name).sort()).toEqual([
      "Facturación a cliente exento de IVA",
      "Facturación a crédito",
      "Facturación con descuento por pronto pago",
      "Facturación con retención en la fuente",
    ]);
    // Los tres niveles de explicación viajan con el nodo (capa de enseñanza).
    const ret = variantes.find((v) => v.name.includes("retención"))!;
    expect(ret.whatIs).toMatch(/agente retenedor/i);
    expect(ret.techDetail).toMatch(/account\.tax/);
    expect(ret.confidence).toBe("inferido");
    expect(ret.openCount).toBeGreaterThan(0);
  });

  it("es idempotente: importar dos veces deja el mismo estado", () => {
    importGraph(db, cliente, privado());
    const primera = listNodes(db, cliente, plataforma).length;
    importGraph(db, cliente, privado());
    expect(listNodes(db, cliente, plataforma)).toHaveLength(primera);
    const aristas = (
      db.prepare(`SELECT COUNT(*) AS n FROM graph_edges WHERE client_id = ?`).get(cliente) as { n: number }
    ).n;
    expect(aristas).toBe(50);
  });

  it("borra de la proyección los nodos que desaparecieron del origen", () => {
    importGraph(db, cliente, privado());
    const reducido = privado();
    reducido.nodos = reducido.nodos.filter((n) => n.tipo !== "variante");
    const r = importGraph(db, cliente, reducido);
    expect(r.removed).toBe(4);
    expect(listNodes(db, cliente, plataforma, { kind: "variante" })).toHaveLength(0);
  });

  it("descarta aristas que apuntan a nodos inexistentes", () => {
    const g = privado();
    g.aristas.push({ origen: id("area.facturacion"), destino: id("no.existe"), tipo: "depende_de" });
    expect(importGraph(db, cliente, g).edges).toBe(50);
  });
});

describePrivado("WP20 · grafo privado: consultas", () => {
  let db: DB;
  let cliente: number;

  beforeEach(() => {
    db = freshDb();
    cliente = createClient(db, { name: "Cliente privado", status: "activo" });
    addMember(db, cliente, "W_PLATAFORMA", "lead");
    importGraph(db, cliente, privado(), "W_PLATAFORMA");
  });

  it("un nodo trae sus vecinos con el tipo de arista", () => {
    const r = getNode(db, cliente, id("proceso.facturacion-venta"), plataforma)!;
    expect(r.node.name).toBe("Facturación de venta");
    expect(r.outgoing.map((o) => o.kind).sort()).toEqual(["ejecutado_por", "implementado_en", "pertenece_a"]);
    expect(r.incoming.filter((i) => i.kind === "varia_de")).toHaveLength(4);
  });

  it("responde '¿qué se rompe si tumbamos esto?' recorriendo el impacto", () => {
    const impacto = impactOf(db, cliente, id("sistema.odoo"), plataforma);
    const ids = impacto.map((n) => n.nodeId);
    expect(ids).toContain(id("proceso.facturacion-venta"));
    expect(ids).toContain(id("variante.facturacion-retencion"));
    expect(impacto.length).toBeGreaterThan(5);
  });

  it("la cobertura y el mapa de exposición", () => {
    const c = coverage(db, cliente);
    expect(c.total).toBe(29);
    expect(c.pctVerified).toBeCloseTo(3.4, 1);
    expect(c.openQuestions).toBe(107);
    expect(c.busFactorCritical).toBe(27);
    const m = exposureMap(db, cliente, plataforma);
    expect(m.reduce((s, g) => s + g.total, 0)).toBe(27);
    expect(m[0].total).toBeGreaterThanOrEqual(m[m.length - 1].total);
  });
});
