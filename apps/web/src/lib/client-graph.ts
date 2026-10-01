/**
 * WP20 · Grafo de operación del cliente — READ MODEL.
 *
 * La fuente de verdad es el repositorio PRIVADO `zelena-ops`: un nodo = un
 * archivo markdown versionado en git y revisado por PR. Estas tablas son una
 * proyección de solo lectura que `importGraph()` reconstruye de forma
 * idempotente desde el `grafo.json` que genera `construir_grafo.py`.
 *
 * La dapp NUNCA escribe de vuelta al grafo. Editar = PR en zelena-ops.
 * Motivo: el conocimiento operativo necesita historia, ramas y revisión —
 * cosas que una fila de SQL no da. Y una sola pieza vive en un solo lugar.
 *
 * SEGURIDAD: el importador vuelve a escanear cada cuerpo en busca de secretos
 * antes de guardarlo. zelena-ops ya lo valida en pre-commit; esto es defensa
 * en profundidad, porque el destino (Azure SQL) es un blast radius distinto.
 */
import type { DB } from "./db";
import { findSecretLike, accessLevelFor, ClientAccessError, type Actor } from "./clients";

export const NODE_KINDS = [
  "organizacion",
  "persona",
  "rol",
  "area",
  "proceso",
  "variante",
  "sistema",
  "modulo",
  "desarrollo",
  "integracion",
  "credencial",
  "dato",
  "iniciativa",
  "decision",
  "riesgo",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const CONFIDENCES = ["verificado", "declarado", "inferido", "sospechoso"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const EDGE_KINDS = [
  "pertenece_a",
  "varia_de",
  "depende_de",
  "implementado_en",
  "ejecutado_por",
  "usa_credencial",
  "bloquea",
  "documentado_en",
  "reemplaza",
  "sincroniza_con",
] as const;

export class GraphImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphImportError";
  }
}

/** Forma del grafo.json que emite herramientas/construir_grafo.py. */
export interface GraphJson {
  cliente: string;
  generado: string;
  nodos: Array<{
    id: string;
    nombre: string;
    tipo: string;
    estado: string;
    confianza: string;
    criticidad?: string | null;
    bus_factor?: number | null;
    owner_zelena?: string;
    owner_cliente?: string;
    fuente?: string;
    verificado_el?: string;
    tags?: string[];
    archivo?: string;
    que_es?: string;
    como_funciona?: string;
    detalle?: string;
    reglas?: string;
    abiertas?: string;
    n_abiertas?: number;
  }>;
  aristas: Array<{ origen: string; destino: string; tipo: string }>;
  resumen?: {
    nodos: number;
    aristas: number;
    pct_verificado: number;
    preguntas_abiertas: number;
    bus_factor_critico: number;
  };
}

export interface ImportResult {
  nodes: number;
  edges: number;
  removed: number;
  pctVerified: number;
  openQuestions: number;
  busFactorCritical: number;
  generatedAt: string;
}

/**
 * Reconstruye la proyección del grafo de un cliente. Idempotente: correrlo dos
 * veces con el mismo JSON deja exactamente el mismo estado. Los nodos que
 * desaparecieron del origen se borran de la proyección (no se acumula basura).
 */
export function importGraph(db: DB, clientId: number, graph: GraphJson, importedBy?: string): ImportResult {
  if (!graph || !Array.isArray(graph.nodos)) throw new GraphImportError("grafo.json inválido: falta 'nodos'.");

  // 1. Escaneo de secretos ANTES de escribir nada.
  for (const n of graph.nodos) {
    for (const campo of ["que_es", "como_funciona", "detalle", "reglas", "abiertas", "fuente"] as const) {
      const hit = findSecretLike(n[campo] as string | undefined);
      if (hit) {
        throw new GraphImportError(
          `El nodo '${n.id}' contiene un posible secreto (${hit}) en '${campo}'. ` +
            `Importación abortada. Saca el secreto de zelena-ops y ROTA la credencial: ` +
            `el historial de git la conserva.`
        );
      }
    }
  }

  // 2. Validación de vocabulario: un tipo desconocido es un error de esquema,
  //    no algo que se guarde en silencio.
  for (const n of graph.nodos) {
    if (!(NODE_KINDS as readonly string[]).includes(n.tipo)) {
      throw new GraphImportError(`Nodo '${n.id}': tipo desconocido '${n.tipo}'.`);
    }
    if (!(CONFIDENCES as readonly string[]).includes(n.confianza)) {
      throw new GraphImportError(`Nodo '${n.id}': confianza desconocida '${n.confianza}'.`);
    }
  }

  const ids = new Set(graph.nodos.map((n) => n.id));
  const aristas = (graph.aristas ?? []).filter(
    (a) => ids.has(a.origen) && ids.has(a.destino) && (EDGE_KINDS as readonly string[]).includes(a.tipo)
  );

  const run = db.transaction(() => {
    const previos = db
      .prepare(`SELECT node_id FROM graph_nodes WHERE client_id = ?`)
      .all(clientId) as Array<{ node_id: string }>;
    const sobrantes = previos.map((p) => p.node_id).filter((id) => !ids.has(id));

    const upsert = db.prepare(
      `INSERT INTO graph_nodes
        (client_id, node_id, kind, name, state, confidence, criticality, bus_factor,
         owner_zelena, owner_client, source, verified_at, tags, source_path,
         what_is, how_it_works, tech_detail, business_rules, open_questions, open_count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (client_id, node_id) DO UPDATE SET
         kind = excluded.kind, name = excluded.name, state = excluded.state,
         confidence = excluded.confidence, criticality = excluded.criticality,
         bus_factor = excluded.bus_factor, owner_zelena = excluded.owner_zelena,
         owner_client = excluded.owner_client, source = excluded.source,
         verified_at = excluded.verified_at, tags = excluded.tags,
         source_path = excluded.source_path, what_is = excluded.what_is,
         how_it_works = excluded.how_it_works, tech_detail = excluded.tech_detail,
         business_rules = excluded.business_rules, open_questions = excluded.open_questions,
         open_count = excluded.open_count, imported_at = datetime('now')`
    );
    for (const n of graph.nodos) {
      upsert.run(
        clientId,
        n.id,
        n.tipo,
        n.nombre,
        n.estado,
        n.confianza,
        n.criticidad ?? null,
        typeof n.bus_factor === "number" ? n.bus_factor : null,
        n.owner_zelena ?? null,
        n.owner_cliente ?? null,
        n.fuente ?? null,
        n.verificado_el ?? null,
        JSON.stringify(n.tags ?? []),
        n.archivo ?? null,
        n.que_es ?? null,
        n.como_funciona ?? null,
        n.detalle ?? null,
        n.reglas ?? null,
        n.abiertas ?? null,
        n.n_abiertas ?? 0
      );
    }

    const del = db.prepare(`DELETE FROM graph_nodes WHERE client_id = ? AND node_id = ?`);
    for (const id of sobrantes) del.run(clientId, id);

    db.prepare(`DELETE FROM graph_edges WHERE client_id = ?`).run(clientId);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO graph_edges (client_id, from_node, to_node, kind) VALUES (?, ?, ?, ?)`
    );
    for (const a of aristas) ins.run(clientId, a.origen, a.destino, a.tipo);

    return sobrantes.length;
  });

  const removed = run();

  const verificados = graph.nodos.filter((n) => n.confianza === "verificado").length;
  const pctVerified = graph.nodos.length ? Math.round((1000 * verificados) / graph.nodos.length) / 10 : 0;
  const openQuestions = graph.nodos.reduce((s, n) => s + (n.n_abiertas ?? 0), 0);
  const busFactorCritical = graph.nodos.filter(
    (n) => typeof n.bus_factor === "number" && (n.bus_factor as number) <= 1
  ).length;

  db.prepare(
    `INSERT INTO graph_imports
      (client_id, generated_at, nodes, edges, pct_verified, open_questions, bus_factor_critical, imported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    clientId,
    graph.generado ?? "",
    graph.nodos.length,
    aristas.length,
    pctVerified,
    openQuestions,
    busFactorCritical,
    importedBy ?? null
  );

  return {
    nodes: graph.nodos.length,
    edges: aristas.length,
    removed,
    pctVerified,
    openQuestions,
    busFactorCritical,
    generatedAt: graph.generado ?? "",
  };
}

// ─── Lectura ─────────────────────────────────────────────────────────────

export interface GraphNode {
  nodeId: string;
  kind: string;
  name: string;
  state: string;
  confidence: Confidence;
  criticality: string | null;
  busFactor: number | null;
  ownerZelena: string | null;
  ownerClient: string | null;
  source: string | null;
  verifiedAt: string | null;
  sourcePath: string | null;
  whatIs: string | null;
  howItWorks: string | null;
  techDetail: string | null;
  businessRules: string | null;
  openQuestions: string | null;
  openCount: number;
}

function mapNode(r: Record<string, unknown>): GraphNode {
  return {
    nodeId: r.node_id as string,
    kind: r.kind as string,
    name: r.name as string,
    state: r.state as string,
    confidence: r.confidence as Confidence,
    criticality: (r.criticality as string) ?? null,
    busFactor: (r.bus_factor as number) ?? null,
    ownerZelena: (r.owner_zelena as string) ?? null,
    ownerClient: (r.owner_client as string) ?? null,
    source: (r.source as string) ?? null,
    verifiedAt: (r.verified_at as string) ?? null,
    sourcePath: (r.source_path as string) ?? null,
    whatIs: (r.what_is as string) ?? null,
    howItWorks: (r.how_it_works as string) ?? null,
    techDetail: (r.tech_detail as string) ?? null,
    businessRules: (r.business_rules as string) ?? null,
    openQuestions: (r.open_questions as string) ?? null,
    openCount: (r.open_count as number) ?? 0,
  };
}

/** Todo miembro del cliente puede leer el grafo, incluido nivel `lectura`. */
function assertMember(db: DB, clientId: number, actor: Actor): void {
  if (accessLevelFor(db, clientId, actor) === null) throw new ClientAccessError();
}

export function listNodes(
  db: DB,
  clientId: number,
  actor: Actor,
  filter?: { kind?: string; confidence?: string }
): GraphNode[] {
  assertMember(db, clientId, actor);
  const where: string[] = ["client_id = ?"];
  const params: unknown[] = [clientId];
  if (filter?.kind) {
    where.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter?.confidence) {
    where.push("confidence = ?");
    params.push(filter.confidence);
  }
  const rows = db
    .prepare(`SELECT * FROM graph_nodes WHERE ${where.join(" AND ")} ORDER BY kind, name`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapNode);
}

export interface NodeWithNeighbors {
  node: GraphNode;
  outgoing: Array<{ node: GraphNode; kind: string }>;
  incoming: Array<{ node: GraphNode; kind: string }>;
}

export function getNode(db: DB, clientId: number, nodeId: string, actor: Actor): NodeWithNeighbors | null {
  assertMember(db, clientId, actor);
  const row = db
    .prepare(`SELECT * FROM graph_nodes WHERE client_id = ? AND node_id = ?`)
    .get(clientId, nodeId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const out = db
    .prepare(
      `SELECT n.*, e.kind AS edge_kind FROM graph_edges e
         JOIN graph_nodes n ON n.client_id = e.client_id AND n.node_id = e.to_node
        WHERE e.client_id = ? AND e.from_node = ?`
    )
    .all(clientId, nodeId) as Array<Record<string, unknown>>;
  const inc = db
    .prepare(
      `SELECT n.*, e.kind AS edge_kind FROM graph_edges e
         JOIN graph_nodes n ON n.client_id = e.client_id AND n.node_id = e.from_node
        WHERE e.client_id = ? AND e.to_node = ?`
    )
    .all(clientId, nodeId) as Array<Record<string, unknown>>;

  return {
    node: mapNode(row),
    outgoing: out.map((r) => ({ node: mapNode(r), kind: r.edge_kind as string })),
    incoming: inc.map((r) => ({ node: mapNode(r), kind: r.edge_kind as string })),
  };
}

/**
 * Impacto: qué nodos se ven afectados si este falla o cambia. Recorre las
 * aristas entrantes de forma transitiva (quién depende de mí, y quién de ellos).
 * Responde "¿qué se rompe si tumbamos el módulo X?" sin que nadie lo adivine.
 */
export function impactOf(db: DB, clientId: number, nodeId: string, actor: Actor, maxDepth = 4): GraphNode[] {
  assertMember(db, clientId, actor);
  const visto = new Set<string>([nodeId]);
  let frontera = [nodeId];
  const acumulado: string[] = [];
  const q = db.prepare(`SELECT from_node FROM graph_edges WHERE client_id = ? AND to_node = ?`);
  for (let d = 0; d < maxDepth && frontera.length; d++) {
    const siguiente: string[] = [];
    for (const id of frontera) {
      const rows = q.all(clientId, id) as Array<{ from_node: string }>;
      for (const r of rows) {
        if (visto.has(r.from_node)) continue;
        visto.add(r.from_node);
        acumulado.push(r.from_node);
        siguiente.push(r.from_node);
      }
    }
    frontera = siguiente;
  }
  if (!acumulado.length) return [];
  const marks = acumulado.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM graph_nodes WHERE client_id = ? AND node_id IN (${marks}) ORDER BY criticality, kind, name`)
    .all(clientId, ...acumulado) as Array<Record<string, unknown>>;
  return rows.map(mapNode);
}

export interface Coverage {
  total: number;
  byConfidence: Record<string, number>;
  pctVerified: number;
  openQuestions: number;
  busFactorCritical: number;
  lastImport: string | null;
}

/** La métrica que se le muestra al cliente: cuánto de su operación está verificada. */
export function coverage(db: DB, clientId: number): Coverage {
  const rows = db
    .prepare(`SELECT confidence, COUNT(*) AS n FROM graph_nodes WHERE client_id = ? GROUP BY confidence`)
    .all(clientId) as Array<{ confidence: string; n: number }>;
  const byConfidence: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byConfidence[r.confidence] = r.n;
    total += r.n;
  }
  const agg = db
    .prepare(
      `SELECT COALESCE(SUM(open_count),0) AS q,
              COALESCE(SUM(CASE WHEN bus_factor IS NOT NULL AND bus_factor <= 1 THEN 1 ELSE 0 END),0) AS b
         FROM graph_nodes WHERE client_id = ?`
    )
    .get(clientId) as { q: number; b: number };
  const last = db
    .prepare(`SELECT created_at FROM graph_imports WHERE client_id = ? ORDER BY id DESC LIMIT 1`)
    .get(clientId) as { created_at: string } | undefined;
  return {
    total,
    byConfidence,
    pctVerified: total ? Math.round((1000 * (byConfidence.verificado ?? 0)) / total) / 10 : 0,
    openQuestions: agg.q,
    busFactorCritical: agg.b,
    lastImport: last?.created_at ?? null,
  };
}

/** Evolución de la cobertura: la gráfica que justifica el retainer. */
export function coverageHistory(db: DB, clientId: number) {
  return db
    .prepare(
      `SELECT generated_at, nodes, edges, pct_verified, open_questions, bus_factor_critical, created_at
         FROM graph_imports WHERE client_id = ? ORDER BY id`
    )
    .all(clientId) as Array<{
    generated_at: string;
    nodes: number;
    edges: number;
    pct_verified: number;
    open_questions: number;
    bus_factor_critical: number;
    created_at: string;
  }>;
}

/** Mapa de exposición: de quién depende cada pieza crítica del cliente. */
export function exposureMap(db: DB, clientId: number, actor: Actor) {
  assertMember(db, clientId, actor);
  const rows = db
    .prepare(
      `SELECT node_id, kind, name, bus_factor, criticality,
              COALESCE(NULLIF(owner_client,''), NULLIF(owner_zelena,''), 'sin responsable') AS depende_de
         FROM graph_nodes
        WHERE client_id = ? AND bus_factor IS NOT NULL AND bus_factor <= 1
        ORDER BY bus_factor, criticality, kind`
    )
    .all(clientId) as Array<{
    node_id: string;
    kind: string;
    name: string;
    bus_factor: number;
    criticality: string | null;
    depende_de: string;
  }>;
  const porPersona = new Map<string, typeof rows>();
  for (const r of rows) {
    const lista = porPersona.get(r.depende_de) ?? [];
    lista.push(r);
    porPersona.set(r.depende_de, lista);
  }
  return [...porPersona.entries()]
    .map(([persona, nodos]) => ({ persona, nodos, total: nodos.length }))
    .sort((a, b) => b.total - a.total);
}
