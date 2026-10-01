/**
 * Épocas (WP31 §5.B.5): criterios B10 y B10b.
 *
 * Cerrar la época N y abrir la N+1 es una sola operación atómica: raíz Merkle
 * determinista de lo emitido en N, encolada para la red de pruebas y escrita en el
 * decision log; la N+1 nace con los presupuestos de su genoma. Después, nada nuevo
 * cae en N: su raíz sigue siendo reproducible.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { merkleRoot } from "./crypto";
import { clearGenomeCache, currentEpoch, getActiveGenome } from "./genome";
import { computeAndStoreEpochFitness, signEpochDecision } from "./epochs";
import { recordNoMutation } from "./mutation";
import { emitirPorAprobacion, refTarea } from "./gamificacion";
import { startReading, getQuiz, gradeQuiz } from "./academia";
import type { TeamActor } from "./roles";
import { translate } from "./sql-dialect";
import {
  EpocaError,
  FALTA_FITNESS,
  FALTA_JUSTIFICACION,
  FALTA_MUTACION,
  SIN_EPOCA_ABIERTA,
  abrirEpoca,
  cerrarYAbrirEpoca,
  estadoCierreEpoca,
  hojasDeEpoca,
} from "./epocas";

const FOUNDER: TeamActor = { wallet: "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", name: "Founder", role: "founder", isSupervisor: true };
const SUPERVISORA: TeamActor = { wallet: "GSUPERVISORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", name: "Sup", role: "core", isSupervisor: true };
const DUENA = "GDUENAEPOCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const REVISA = "GREVISAEPOCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const JUSTIFICA = "Cierre de prueba de la época con su fitness firmado.";

function seededDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  for (const w of [DUENA, REVISA]) {
    db.prepare(`INSERT INTO users (wallet, display_name, role, cla_signed) VALUES (?, ?, 'core', 1)`).run(w, w.slice(0, 8));
  }
  return db;
}

function listoParaCerrar(db: DB, epoch = currentEpoch(db)): void {
  recordNoMutation(db, epoch + 1, "Sin cambios de genoma para la siguiente.");
  const rep = computeAndStoreEpochFitness(db, epoch);
  signEpochDecision(db, rep.id, "keep");
}

function huella(db: DB): Record<string, unknown> {
  return {
    periods: db.prepare(`SELECT * FROM periods ORDER BY id`).all(),
    anchor: db.prepare(`SELECT * FROM anchor_queue ORDER BY id`).all(),
    decisiones: db.prepare(`SELECT COUNT(*) AS n FROM decision_log`).get(),
    puntos: db.prepare(`SELECT * FROM points_ledger ORDER BY id`).all(),
    rep: db.prepare(`SELECT * FROM reputation_events ORDER BY id`).all(),
  };
}

function capturar(fn: () => unknown): EpocaError {
  try {
    fn();
  } catch (e) {
    if (e instanceof EpocaError) return e;
    throw e;
  }
  throw new Error("se esperaba un EpocaError");
}

describe("cerrarYAbrirEpoca (criterio B10)", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("estadoCierreEpoca dice qué falta con el copy de §8.5", () => {
    const e = estadoCierreEpoca(db);
    expect(e.periodo).toMatchObject({ id: 1, state: "Open" });
    expect(e.fitnessFirmado).toBe(false);
    expect(e.mutacionDecidida).toBe(false);
    expect(e.puedeCerrar).toBe(false);
    expect(e.puedeAbrir).toBe(false);
    expect(e.faltantes).toEqual([FALTA_FITNESS, FALTA_MUTACION]);
    listoParaCerrar(db);
    expect(estadoCierreEpoca(db)).toMatchObject({ fitnessFirmado: true, mutacionDecidida: true, puedeCerrar: true, faltantes: [] });
  });

  it("precondiciones: founder, fitness firmado, mutación decidida y justificación ≥ 10; si falta algo no toca nada", () => {
    const antes = huella(db);
    expect(capturar(() => cerrarYAbrirEpoca(db, SUPERVISORA, { justificacion: JUSTIFICA })).status).toBe(403);
    const falta = capturar(() => cerrarYAbrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA }));
    expect(falta.status).toBe(409);
    expect(falta.faltantes).toEqual([FALTA_FITNESS, FALTA_MUTACION]);
    expect(falta.message).toContain(FALTA_FITNESS);

    recordNoMutation(db, 2, "Sin cambios de genoma para la siguiente.");
    expect(capturar(() => cerrarYAbrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA })).faltantes).toEqual([FALTA_FITNESS]);
    const rep = computeAndStoreEpochFitness(db, 1);
    signEpochDecision(db, rep.id, "keep");
    const corta = capturar(() => cerrarYAbrirEpoca(db, FOUNDER, { justificacion: "corta" }));
    expect(corta.status).toBe(400);
    expect(corta.faltantes).toEqual([FALTA_JUSTIFICACION]);
    const despues = huella(db);
    expect(despues.periods).toEqual(antes.periods);
    expect(despues.anchor).toEqual(antes.anchor);
    expect(despues.puntos).toEqual(antes.puntos);
  });

  it("cierra con raíz Merkle determinista, encola merkle_root, escribe la decisión y abre la siguiente con su genoma", () => {
    // Una versión del genoma que rige desde la época 2 con otros presupuestos.
    db.prepare(`INSERT INTO genome_versions (version, params, effective_from_epoch) VALUES (90, ?, 2)`).run(
      JSON.stringify({ ...getActiveGenome(db, 2), EPOCH_BUDGET: 112_000, ACADEMIA_BUDGET: 5_500 })
    );
    clearGenomeCache(db);
    listoParaCerrar(db);
    const hojas = hojasDeEpoca(db, 1);
    expect(hojas.length).toBeGreaterThan(0); // el seed emite en la época 1
    expect(hojasDeEpoca(db, 1)).toEqual(hojas); // determinista
    for (const h of hojas) expect(JSON.parse(h).period_id).toBe(1);
    const esperada = merkleRoot(hojas);
    const antes = huella(db);

    const r = cerrarYAbrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA, nombreSiguiente: "Temporada 2" }, new Date("2026-10-06T03:00:00Z"));
    expect(r.cerrada).toBe(1);
    expect(r.abierta).toBe(2);
    expect(r.merkleRoot).toBe(esperada);

    const p1 = db.prepare(`SELECT state, merkle_root FROM periods WHERE id = 1`).get() as { state: string; merkle_root: string };
    expect(p1).toEqual({ state: "Closed", merkle_root: esperada });
    const p2 = db.prepare(`SELECT name, state, epoch_budget, academia_budget FROM periods WHERE id = 2`).get();
    expect(p2).toEqual({ name: "Temporada 2", state: "Open", epoch_budget: 112_000, academia_budget: 5_500 });
    expect(currentEpoch(db)).toBe(2);

    const cola = db.prepare(`SELECT * FROM anchor_queue WHERE id = ?`).get(r.anchorQueueId) as Record<string, unknown>;
    expect(cola).toMatchObject({ kind: "merkle_root", ref: "1", data_key: "epoch:1", payload_hash: esperada, status: "pending" });
    const dec = db.prepare(`SELECT * FROM decision_log WHERE id = ?`).get(r.decisionLogId) as Record<string, string>;
    expect(dec.title).toBe("Cierre de la época 1 y apertura de la 2");
    expect(dec.reason).toContain(esperada);
    expect(dec.reason).toContain(JUSTIFICA);
    expect(dec.date).toBe("2026-10-05"); // 22:00 en Bogotá: la fecha es la del equipo, no la del servidor
    expect(dec.hash).toMatch(/^[0-9a-f]{64}$/);

    // Nunca toca ledgers.
    const despues = huella(db);
    expect(despues.puntos).toEqual(antes.puntos);
    expect(despues.rep).toEqual(antes.rep);
    // Y no se cierra dos veces: la época 2 aún no tiene fitness ni mutación decidida.
    expect(capturar(() => cerrarYAbrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA })).status).toBe(409);
  });

  it("sin nombre, la siguiente se llama «Época N+1» y toma los presupuestos del genoma de esa época", () => {
    listoParaCerrar(db);
    const r = cerrarYAbrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA });
    const p = db.prepare(`SELECT name, epoch_budget, academia_budget FROM periods WHERE id = ?`).get(r.abierta);
    expect(p).toEqual({
      name: "Época 2",
      epoch_budget: getActiveGenome(db, 2).EPOCH_BUDGET,
      academia_budget: getActiveGenome(db, 2).ACADEMIA_BUDGET,
    });
  });

  it("es atómica: si algo falla a mitad, no queda nada (ni cierre, ni cola, ni decisión)", () => {
    listoParaCerrar(db);
    db.exec(`CREATE TRIGGER sin_periodos BEFORE INSERT ON periods BEGIN SELECT RAISE(ABORT, 'falla de prueba'); END;`);
    const antes = huella(db);
    expect(() => cerrarYAbrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA })).toThrow(/falla de prueba/);
    expect(huella(db)).toEqual(antes);
    expect(estadoCierreEpoca(db).periodo).toMatchObject({ id: 1, state: "Open" });
  });

  it("abrirEpoca solo si no hay ninguna abierta, y solo el founder", () => {
    expect(capturar(() => abrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA })).status).toBe(409);
    db.prepare(`UPDATE periods SET state = 'Anchored' WHERE id = 1`).run(); // p. ej. cerrada y anclada
    const e = estadoCierreEpoca(db);
    expect(e.puedeAbrir).toBe(true);
    expect(e.puedeCerrar).toBe(false);
    expect(e.faltantes).toEqual([SIN_EPOCA_ABIERTA]);
    expect(capturar(() => abrirEpoca(db, SUPERVISORA, { justificacion: JUSTIFICA })).status).toBe(403);
    expect(capturar(() => abrirEpoca(db, FOUNDER, { justificacion: "no" })).status).toBe(400);
    const r = abrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA, nombre: "Segunda temporada" });
    expect(r.abierta).toBe(2);
    const p = db.prepare(`SELECT name, state, epoch_budget FROM periods WHERE id = 2`).get();
    expect(p).toEqual({ name: "Segunda temporada", state: "Open", epoch_budget: getActiveGenome(db, 2).EPOCH_BUDGET });
    const dec = db.prepare(`SELECT title, reason FROM decision_log WHERE id = ?`).get(r.decisionLogId) as { title: string; reason: string };
    expect(dec.title).toBe("Apertura de la época 2");
    expect(dec.reason).toContain(JUSTIFICA);
    expect(estadoCierreEpoca(db).puedeAbrir).toBe(false);
    expect(capturar(() => abrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA })).status).toBe(409);
  });

  it("todo el SQL de epocas.ts se traduce a T-SQL (Azure)", () => {
    listoParaCerrar(db);
    const sqls: string[] = [];
    const espia: DB = {
      prepare: (sql: string) => {
        sqls.push(sql);
        return db.prepare(sql);
      },
      exec: (sql: string) => db.exec(sql),
      pragma: (d: string) => db.pragma(d),
      transaction: db.transaction.bind(db) as DB["transaction"],
    };
    estadoCierreEpoca(espia);
    cerrarYAbrirEpoca(espia, FOUNDER, { justificacion: JUSTIFICA });
    db.prepare(`UPDATE periods SET state = 'Closed' WHERE id = 2`).run();
    abrirEpoca(espia, FOUNDER, { justificacion: JUSTIFICA });
    expect(sqls.length).toBeGreaterThan(8);
    for (const s of new Set(sqls)) expect(() => translate(s), s).not.toThrow();
  });

  it("abrirEpoca en una base sin épocas abre la 1", () => {
    const vacia = openDb(":memory:");
    vacia.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
    expect(estadoCierreEpoca(vacia)).toMatchObject({ periodo: null, puedeAbrir: true, puedeCerrar: false });
    expect(abrirEpoca(vacia, FOUNDER, { justificacion: JUSTIFICA }).abierta).toBe(1);
    expect(currentEpoch(vacia)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B10b: después de cerrar la época N, nada nuevo cae en N.
// ---------------------------------------------------------------------------

const RUTA_VOTO = path.join(process.cwd(), "app", "api", "governance", "vote", "route.ts");

/** La sentencia de reputación de la ruta de voto, tal cual está en el archivo. */
function sentenciaDeVoto(): string {
  const src = fs.readFileSync(RUTA_VOTO, "utf8");
  const m = /`(INSERT INTO reputation_events[^`]*)`/.exec(src);
  if (!m) throw new Error("No encuentro el INSERT de reputación en la ruta de voto.");
  return m[1];
}

describe("raíz reproducible tras el cierre (criterio B10b)", () => {
  it("la ruta de voto inserta con period_id = currentEpoch(db) (estático)", () => {
    const src = fs.readFileSync(RUTA_VOTO, "utf8");
    expect(sentenciaDeVoto()).toMatch(/\(wallet, axis, delta, ref, period_id\)/);
    expect(src).toMatch(/\.run\(session\.wallet, currentEpoch\(db\)\)/);
  });

  it("emitir una tarea, una reputación de voto y una Academia no cambia la raíz de la época cerrada", () => {
    const db = seededDb();
    listoParaCerrar(db);
    const { merkleRoot: raiz, cerrada, abierta } = cerrarYAbrirEpoca(db, FOUNDER, { justificacion: JUSTIFICA });
    const guardada = (db.prepare(`SELECT merkle_root FROM periods WHERE id = ?`).get(cerrada) as { merkle_root: string }).merkle_root;
    expect(guardada).toBe(raiz);

    // 1) Una tarea aprobada por otra persona.
    const tarea = Number(
      db.prepare(`INSERT INTO assignments (title, owner_wallet, status, size) VALUES ('Pieza', ?, 'Hecha', 'M')`).run(DUENA)
        .lastInsertRowid
    );
    const emision = emitirPorAprobacion(db, { assignmentId: tarea, ownerWallet: DUENA, aprobadorWallet: REVISA, size: "M", aTiempo: true });
    expect(emision).toMatchObject({ emitido: true, periodo: abierta });

    // 2) La reputación de un voto, con la misma sentencia que la ruta.
    db.prepare(sentenciaDeVoto()).run(REVISA, currentEpoch(db));

    // 3) Una Academia completada.
    const W = "GACADEMIAEPOCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const content = db.prepare(`SELECT id FROM academia_content WHERE enabled = 1 ORDER BY id LIMIT 1`).get() as { id: number };
    const { token } = startReading(db, W, content.id);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 999, started_at = ? WHERE token = ?`).run(Date.now() - 999_000, token);
    const quiz = getQuiz(db, W, token);
    const respuestas = quiz.map((q) => (db.prepare(`SELECT correct FROM academia_quiz WHERE id = ?`).get(q.id) as { correct: number }).correct);
    expect(gradeQuiz(db, W, token, quiz.map((q) => q.id), respuestas).points).toBeGreaterThan(0);

    // Todo cayó en la época abierta…
    const enAbierta = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM points_ledger WHERE period_id = ?) + (SELECT COUNT(*) FROM reputation_events WHERE period_id = ?) AS n`
      )
      .get(abierta, abierta) as { n: number };
    expect(Number(enAbierta.n)).toBe(5); // tarea: puntos + rep · voto: rep · Academia: puntos + rep
    expect((db.prepare(`SELECT period_id FROM points_ledger WHERE ref = ?`).get(refTarea(tarea)) as { period_id: number }).period_id).toBe(
      abierta
    );
    // …y la raíz de la cerrada se reproduce igual.
    expect(merkleRoot(hojasDeEpoca(db, cerrada))).toBe(guardada);
  });
});
