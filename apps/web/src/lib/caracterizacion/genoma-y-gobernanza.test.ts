/**
 * Prueba de caracterización · genoma-y-gobernanza
 * Ficha: docs/features/genoma-y-gobernanza.md (sección 8). Commit de referencia: 0e07d8f.
 *
 * Protege el comportamiento ACTUAL del flujo principal, a través de las rutas reales
 * (`POST /api/admin` y `POST /api/governance/vote`) y de las lecturas de `/gobernanza`:
 *
 *   1. El genoma activo se lee por época, mezclado con los defaults del código.
 *   2. El founder propone una mutación (≤ 2 genes, ≤ 15 %, justificación): nace una
 *      versión efectiva desde la época SIGUIENTE, con su acta en el decision log y la
 *      decisión de mutación de esa época. La época actual no cambia (nada retroactivo).
 *   3. Reglas duras: una sola decisión por época, tope de 15 %, solo genes numéricos
 *      v1, solo el founder.
 *   4. Fitness de la época: el algoritmo propone, el founder firma (acta).
 *   5. Auditoría latente enlazada a la decisión.
 *   6. Voto: uno por wallet, +2 de reputación en gobernanza con `period_id` explícito.
 *   7. `/gobernanza` lista decisiones (más reciente primero), votación y auditorías.
 *
 * Base: SQLite temporal en memoria con `schema.sql` + `seedIfEmpty` (como
 * src/lib/genome.test.ts y src/lib/epocas.test.ts). Las rutas y `lib/repo.ts` leen esa
 * base vía `globalThis.__zelenaDb`; la sesión se simula con un mock de `@/lib/session`.
 * Datos inventados.
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
vi.mock("@/lib/validation", () => import("../validation"));
vi.mock("@/lib/admin", () => import("../admin"));
vi.mock("@/lib/epochs", () => import("../epochs"));
vi.mock("@/lib/mutation", () => import("../mutation"));
vi.mock("@/lib/audits", () => import("../audits"));
vi.mock("@/lib/genome", () => import("../genome"));

import { openDb, type DB } from "../db";
import { seedIfEmpty } from "../seed";
import { sha256Hex } from "../crypto";
import { getActiveGenome } from "../genome";
import { genomeLineage, pendingMutation } from "../mutation";
import { listLatentAudits } from "../audits";
import { getOpenProposal, listDecisions, userVote, voteTally } from "../repo";
import { esActaDeRito } from "../agora-labels";
import { POST as postAdmin } from "../../../app/api/admin/route";
import { POST as postVoto } from "../../../app/api/governance/vote/route";

const FOUNDER = "GCARACFOUNDERGENOMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SUPERVISORA = "GCARACSUPERVISORAGENOMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VOTANTE = "GCARACVOTANTEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ALUMNI = "GCARACALUMNIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const JUSTIFICA = "Ajuste de prueba del presupuesto de la temporada.";

let db: DB;
let decisionMutacion = 0;
const g = globalThis as unknown as { __zelenaDb?: DB };

function sesion(wallet: string, claSigned = true): Record<string, unknown> {
  return { wallet, name: "prueba", tier: "Bronze", isFounder: false, claSigned, isDemo: false };
}

async function llamar(
  handler: (req: NextRequest) => Promise<Response>,
  url: string,
  body: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const req = new NextRequest(new URL(url, "http://localhost"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
  });
  const res = await handler(req);
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

function admin(body: Record<string, unknown>, wallet = FOUNDER) {
  estado.session = sesion(wallet);
  return llamar(postAdmin, "/api/admin", body);
}

beforeAll(() => {
  db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  const ins = db.prepare(
    `INSERT INTO users (wallet, display_name, role, is_supervisor, cla_signed, status) VALUES (?, ?, ?, ?, 1, ?)`
  );
  ins.run(FOUNDER, "Founder de prueba", "founder", 1, "active");
  ins.run(SUPERVISORA, "Supervisora de prueba", "core", 1, "active");
  ins.run(VOTANTE, "Votante de prueba", "contributor", 0, "active");
  ins.run(ALUMNI, "Persona dada de baja", "contributor", 0, "alumni");
  g.__zelenaDb = db;
});

afterAll(() => {
  delete g.__zelenaDb;
});

describe("caracterización · genoma-y-gobernanza (flujo principal)", () => {
  it("1. genoma activo por época: v1 en Génesis, v2 desde la 2, y los defaults del código rellenan lo que falta", () => {
    expect(genomeLineage(db).map((l) => [l.version, l.effectiveFromEpoch])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const g1 = getActiveGenome(db, 1);
    expect(g1.EPOCH_BUDGET).toBe(100_000);
    // HALLAZGO (ficha §9): la v1 guardada no trae TASK_POINTS; rige el default del código.
    expect(g1.TASK_POINTS).toEqual({ S: 10, M: 30, L: 80 });
    // La v2 solo añade claves: no es una mutación que anunciar.
    expect(pendingMutation(db)).toBeNull();
  });

  it("2. proponer una mutación crea la versión de la época siguiente, su acta y la decisión; no es retroactiva", async () => {
    const r = await admin({ action: "proposeMutation", genes: [{ key: "EPOCH_BUDGET", value: 110_000 }], justification: JUSTIFICA });
    expect(r.status).toBe(200);
    expect(r.data.mutation).toMatchObject({ version: 3, targetEpoch: 2 });
    decisionMutacion = (r.data.mutation as { decisionLogId: number }).decisionLogId;

    expect(getActiveGenome(db, 1).EPOCH_BUDGET).toBe(100_000);
    expect(getActiveGenome(db, 2).EPOCH_BUDGET).toBe(110_000);

    const acta = db.prepare(`SELECT date, title, reason, hash FROM decision_log WHERE id = ?`).get(decisionMutacion) as {
      date: string;
      title: string;
      reason: string;
      hash: string;
    };
    expect(acta.title).toBe("Mutación del genoma para la época 2 (v3)");
    expect(acta.reason).toBe(`Cambios: EPOCH_BUDGET: 100000 → 110000. Justificación: ${JUSTIFICA}`);
    // Huella: sha256(título|razón), sin la fecha (el seed sí la incluye: ficha §9).
    expect(acta.hash).toBe(sha256Hex(`${acta.title}|${acta.reason}`));
    expect(acta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(db.prepare(`SELECT epoch, kind, genome_version FROM mutation_decisions`).all()).toEqual([
      { epoch: 2, kind: "mutation", genome_version: 3 },
    ]);
    expect(pendingMutation(db)).toMatchObject({
      version: 3,
      targetEpoch: 2,
      changes: [{ key: "EPOCH_BUDGET", from: 100_000, to: 110_000 }],
    });
  });

  it("3. reglas duras: una decisión por época, ≤ 15 %, solo genes numéricos v1, justificación y solo founder", async () => {
    const otra = await admin({ action: "proposeMutation", genes: [{ key: "ACADEMIA_BUDGET", value: 5_100 }], justification: JUSTIFICA });
    expect(otra.status).toBe(400);
    expect(otra.data.error).toBe("Ya hay una decisión de genoma para la época 2.");

    const mucho = await admin({ action: "proposeMutation", genes: [{ key: "ACADEMIA_BUDGET", value: 9_000 }], justification: JUSTIFICA });
    expect(mucho.status).toBe(400);
    expect(mucho.data.error).toBe("El cambio de ACADEMIA_BUDGET es 80.0% y excede el máximo permitido (15%).");

    const noMutable = await admin({ action: "proposeMutation", genes: [{ key: "TASK_POINTS", value: 11 }], justification: JUSTIFICA });
    expect(noMutable.data.error).toBe("Gen no mutable: TASK_POINTS.");

    const corta = await admin({ action: "proposeMutation", genes: [{ key: "EPOCH_BUDGET", value: 101_000 }], justification: "corta" });
    expect(corta.data.error).toBe("La justificación es obligatoria (mínimo 10 caracteres).");

    const sup = await admin({ action: "proposeMutation", genes: [{ key: "EPOCH_BUDGET", value: 101_000 }], justification: JUSTIFICA }, SUPERVISORA);
    expect(sup.status).toBe(403);
    expect(sup.data.error).toBe("Solo el founder puede administrar.");
    expect(genomeLineage(db)).toHaveLength(3);
  });

  it("4. fitness de la época: el algoritmo propone y el founder firma (acta); firmar dos veces no se puede", async () => {
    const calc = await admin({ action: "computeEpochFitness", epoch: 1 });
    expect(calc.status).toBe(200);
    const rep = calc.data.report as Record<string, unknown> & { id: number; components: Array<{ key: string; value: number | null }> };
    expect(rep).toMatchObject({ epoch: 1, genomeVersion: 1, recommendation: "keep", prevScore: null, signed: false });
    expect(rep.components.map((c) => c.key)).toEqual(["retention", "quality", "participation", "disputes"]);
    expect(rep.components.find((c) => c.key === "quality")?.value).toBeNull();

    const firma = await admin({ action: "signEpochDecision", epochFitnessId: rep.id, decision: "revert" });
    expect(firma.status).toBe(200);
    const fila = db.prepare(`SELECT signed, signed_decision, decision_log_id FROM epoch_fitness WHERE id = ?`).get(rep.id) as {
      signed: number;
      signed_decision: string;
      decision_log_id: number;
    };
    expect(fila).toMatchObject({ signed: 1, signed_decision: "revert" });
    expect((db.prepare(`SELECT title FROM decision_log WHERE id = ?`).get(fila.decision_log_id) as { title: string }).title).toBe(
      "Cierre de época 1: revertir genoma"
    );
    // HALLAZGO (ficha §9): firmar «revertir» no revierte el genoma: la v3 sigue rigiendo en la época 2.
    expect(getActiveGenome(db, 2).EPOCH_BUDGET).toBe(110_000);

    const otraVez = await admin({ action: "signEpochDecision", epochFitnessId: rep.id, decision: "keep" });
    expect(otraVez.status).toBe(400);
    expect(otraVez.data.error).toBe("La decisión de esta época ya fue firmada.");
  });

  it("5. auditoría latente: se registra con su enlace a la decisión y se valida lo obligatorio", async () => {
    const r = await admin({
      action: "createLatentAudit",
      mechanism: "scoring",
      period: "Época 1",
      manifestFunction: "Premiar entregas aprobadas.",
      latentObserved: "Se parten piezas para cobrar más veces.",
      functionalFor: "Quien entrega rápido.",
      dysfunctionalFor: "Quien revisa.",
      auditAction: "mutation_proposed",
      auditDecisionLogId: decisionMutacion,
    });
    expect(r.status).toBe(200);
    const [ultima] = listLatentAudits(db);
    expect(ultima).toMatchObject({
      mechanism: "scoring",
      action: "mutation_proposed",
      decisionLogId: decisionMutacion,
      decisionTitle: "Mutación del genoma para la época 2 (v3)",
    });

    const mal = await admin({ action: "createLatentAudit", mechanism: "x", period: "Época 1" });
    expect(mal.status).toBe(400);
    expect(mal.data.error).toBe("Campo obligatorio: mecánica.");
  });

  it("6. voto: uno por wallet, +2 de reputación en gobernanza en la época actual; sin acuerdo firmado → 401", async () => {
    const propuesta = getOpenProposal()!;
    expect(propuesta.threshold).toBe(66);
    const antes = voteTally(propuesta.id);

    estado.session = sesion(VOTANTE);
    const r = await llamar(postVoto, "/api/governance/vote", { proposalId: propuesta.id, choice: "contra" });
    expect(r.status).toBe(200);
    expect(voteTally(propuesta.id)).toEqual({ ...antes, contra: antes.contra + 1 });
    expect(userVote(propuesta.id, VOTANTE)).toEqual({ choice: "contra" });
    expect(
      db.prepare(`SELECT axis, delta, ref, period_id FROM reputation_events WHERE wallet = ?`).all(VOTANTE)
    ).toEqual([{ axis: "gobernanza", delta: 2, ref: "Voto en propuesta", period_id: 1 }]);

    const doble = await llamar(postVoto, "/api/governance/vote", { proposalId: propuesta.id, choice: "favor" });
    expect(doble.status).toBe(409);
    expect(doble.data.error).toBe("Ya votaste en esta propuesta.");

    estado.session = sesion(VOTANTE, false);
    expect((await llamar(postVoto, "/api/governance/vote", { proposalId: propuesta.id, choice: "favor" })).status).toBe(401);

    estado.session = sesion(VOTANTE);
    expect((await llamar(postVoto, "/api/governance/vote", { proposalId: 9999, choice: "favor" })).status).toBe(404);

    // HALLAZGO (ficha §7 y §9): la ruta confía en `claSigned` de la cookie y no mira
    // `users.status`: una cuenta dada de baja con sesión vigente vota y suma reputación.
    estado.session = sesion(ALUMNI);
    expect((await llamar(postVoto, "/api/governance/vote", { proposalId: propuesta.id, choice: "favor" })).status).toBe(200);
  });

  it("7. /gobernanza: decisiones (sin actas de ritos) de la más reciente a la más vieja", () => {
    const decisiones = listDecisions()
      .filter((d) => !esActaDeRito(d.title))
      .reverse();
    expect(decisiones[0].title).toBe("Cierre de época 1: revertir genoma");
    expect(decisiones[1].title).toBe("Mutación del genoma para la época 2 (v3)");
    expect(decisiones.every((d) => /^[0-9a-f]{64}$/.test(d.hash))).toBe(true);
  });
});
