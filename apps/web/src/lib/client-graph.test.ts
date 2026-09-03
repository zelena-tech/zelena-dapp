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

const SCHEMA = path.join(process.cwd(), "src", "lib", "schema.sql");
const FIXTURE = path.join(process.cwd(), "src", "lib", "__fixtures__", "montoc-grafo.json");

// El fixture del grafo de Montoc es conocimiento de cliente: NO viaja en el
// repo publico. Localmente existe y la suite corre; en CI no esta y se salta
// entera en vez de fallar. No borrar el fixture.
const HAY_FIXTURE = fs.existsSync(FIXTURE);
const describeGrafo = describe.skipIf(!HAY_FIXTURE);

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA, "utf8"));
  db.prepare(`INSERT INTO users (wallet, display_name, is_founder) VALUES ('W_FAUSTO','Fausto',0)`).run();
  db.prepare(`INSERT INTO users (wallet, display_name, is_founder) VALUES ('W_OTRO','Otro',0)`).run();
  return db;
}

function fixture(): GraphJson {
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as GraphJson;
}

const fausto: Actor = { wallet: "W_FAUSTO", isFounder: false };
const extrano: Actor = { wallet: "W_OTRO", isFounder: false };

describeGrafo("WP20 · importación del grafo de operación", () => {
  let db: DB;
  let montoc: number;

  beforeEach(() => {
    db = freshDb();
    montoc = createClient(db, { name: "Montoc", status: "activo" });
    addMember(db, montoc, "W_FAUSTO", "lead");
  });

  it("importa el grafo real de zelena-ops con sus nodos y aristas", () => {
    const r = importGraph(db, montoc, fixture(), "W_FAUSTO");
    expect(r.nodes).toBe(29);
    expect(r.edges).toBe(50);
    expect(r.pctVerified).toBeCloseTo(3.4, 1);
    expect(r.openQuestions).toBe(107);
    expect(r.busFactorCritical).toBe(27);
  });

  it("las cuatro variantes de facturación llegan como nodos consultables", () => {
    importGraph(db, montoc, fixture());
    const variantes = listNodes(db, montoc, fausto, { kind: "variante" });
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
    importGraph(db, montoc, fixture());
    const primera = listNodes(db, montoc, fausto).length;
    importGraph(db, montoc, fixture());
    expect(listNodes(db, montoc, fausto)).toHaveLength(primera);
    const aristas = (
      db.prepare(`SELECT COUNT(*) AS n FROM graph_edges WHERE client_id = ?`).get(montoc) as { n: number }
    ).n;
    expect(aristas).toBe(50);
  });

  it("borra de la proyección los nodos que desaparecieron del origen", () => {
    importGraph(db, montoc, fixture());
    const reducido = fixture();
    reducido.nodos = reducido.nodos.filter((n) => n.tipo !== "variante");
    const r = importGraph(db, montoc, reducido);
    expect(r.removed).toBe(4);
    expect(listNodes(db, montoc, fausto, { kind: "variante" })).toHaveLength(0);
  });

  it("ABORTA la importación si un nodo trae un secreto (defensa en profundidad)", () => {
    const g = fixture();
    g.nodos[0].detalle = `El token es shpat_${"a".repeat(32)}`;
    expect(() => importGraph(db, montoc, g)).toThrow(GraphImportError);
    // Y no escribió NADA: el escaneo corre antes de tocar la base.
    expect(listNodes(db, montoc, fausto)).toHaveLength(0);
  });

  it("rechaza un tipo de nodo desconocido en vez de guardarlo en silencio", () => {
    const g = fixture();
    g.nodos[0].tipo = "inventado";
    expect(() => importGraph(db, montoc, g)).toThrow(/tipo desconocido/i);
  });

  it("descarta aristas que apuntan a nodos inexistentes", () => {
    const g = fixture();
    g.aristas.push({ origen: "montoc.area.facturacion", destino: "montoc.no.existe", tipo: "depende_de" });
    const r = importGraph(db, montoc, g);
    expect(r.edges).toBe(50);
  });
});

describeGrafo("WP20 · consultas del grafo", () => {
  let db: DB;
  let montoc: number;

  beforeEach(() => {
    db = freshDb();
    montoc = createClient(db, { name: "Montoc", status: "activo" });
    addMember(db, montoc, "W_FAUSTO", "lead");
    importGraph(db, montoc, fixture(), "W_FAUSTO");
  });

  it("un no-miembro no puede leer el grafo del cliente", () => {
    expect(() => listNodes(db, montoc, extrano)).toThrow(ClientAccessError);
    expect(() => getNode(db, montoc, "montoc.sistema.odoo", extrano)).toThrow(ClientAccessError);
    expect(() => exposureMap(db, montoc, extrano)).toThrow(ClientAccessError);
  });

  it("un nodo trae sus vecinos con el tipo de arista", () => {
    const r = getNode(db, montoc, "montoc.proceso.facturacion-venta", fausto)!;
    expect(r.node.name).toBe("Facturación de venta");
    // Sale hacia su área, su rol y el sistema donde está implementado.
    expect(r.outgoing.map((o) => o.kind).sort()).toEqual(["ejecutado_por", "implementado_en", "pertenece_a"]);
    // Entran las 4 variantes que varían de él.
    const variantes = r.incoming.filter((i) => i.kind === "varia_de");
    expect(variantes).toHaveLength(4);
  });

  it("responde '¿qué se rompe si tumbamos esto?' recorriendo el impacto", () => {
    // Odoo sostiene los procesos; los procesos sostienen las variantes.
    const impacto = impactOf(db, montoc, "montoc.sistema.odoo", fausto);
    const ids = impacto.map((n) => n.nodeId);
    expect(ids).toContain("montoc.proceso.facturacion-venta");
    // Transitivo: las variantes cuelgan del proceso, no de Odoo directamente.
    expect(ids).toContain("montoc.variante.facturacion-retencion");
    expect(impacto.length).toBeGreaterThan(5);
  });

  it("la cobertura es la métrica que se le muestra al cliente", () => {
    const c = coverage(db, montoc);
    expect(c.total).toBe(29);
    expect(c.pctVerified).toBeCloseTo(3.4, 1);
    expect(c.openQuestions).toBe(107);
    expect(c.busFactorCritical).toBe(27);
    expect(c.byConfidence.inferido).toBeGreaterThan(0);
    expect(c.lastImport).toBeTruthy();
  });

  it("el historial de importaciones permite mostrar la evolución de la cobertura", () => {
    const mejor = fixture();
    for (const n of mejor.nodos) n.confianza = "verificado";
    importGraph(db, montoc, mejor, "W_FAUSTO");
    const h = coverageHistory(db, montoc);
    expect(h).toHaveLength(2);
    expect(h[0].pct_verified).toBeCloseTo(3.4, 1);
    expect(h[1].pct_verified).toBe(100);
  });

  it("el mapa de exposición agrupa por de quién depende cada pieza", () => {
    const m = exposureMap(db, montoc, fausto);
    expect(m.length).toBeGreaterThan(0);
    const total = m.reduce((s, g) => s + g.total, 0);
    expect(total).toBe(27);
    // Está ordenado por concentración: quien más piezas sostiene, primero.
    expect(m[0].total).toBeGreaterThanOrEqual(m[m.length - 1].total);
  });
});
