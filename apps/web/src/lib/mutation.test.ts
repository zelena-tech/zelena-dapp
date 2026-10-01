import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import {
  GENOME_V1,
  GENOME_DEFAULTS,
  getActiveGenome,
  seedGenomeV1,
  seedGenomeV2,
  type Genome,
  type GenomeV1,
} from "./genome";
import {
  validateMutation,
  proposeMutation,
  revertToVersion,
  recordNoMutation,
  mutationDecidedFor,
  pendingMutation,
  genomeLineage,
  MutationError,
} from "./mutation";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1,'Génesis',100000,5000,'Open')`).run();
  seedGenomeV1(db);
  return db;
}

describe("validateMutation (WP08 — reglas duras, puro)", () => {
  it("acepta 1–2 genes con cambio ≤15% y justificación", () => {
    expect(() =>
      validateMutation(GENOME_V1, [{ key: "EPOCH_BUDGET", value: 110_000 }], "subir 10% para medir retención")
    ).not.toThrow();
  });
  it("rechaza más de 2 genes", () => {
    expect(() =>
      validateMutation(
        GENOME_V1,
        [
          { key: "EPOCH_BUDGET", value: 105_000 },
          { key: "ACADEMIA_BUDGET", value: 5_200 },
          { key: "ACADEMIA_DAILY_CAP", value: 3 },
        ],
        "tres genes no permitidos"
      )
    ).toThrow(MutationError);
  });
  it("rechaza un cambio > 15%", () => {
    expect(() =>
      validateMutation(GENOME_V1, [{ key: "EPOCH_BUDGET", value: 130_000 }], "subir 30% no permitido")
    ).toThrow(/excede/i);
  });
  it("rechaza un gen no mutable (p.ej. no numérico)", () => {
    expect(() =>
      validateMutation(GENOME_V1, [{ key: "TIER_INVITE_CAPS" as never, value: 5 }], "gen no mutable")
    ).toThrow(MutationError);
  });
  it("rechaza justificación vacía o demasiado corta", () => {
    expect(() => validateMutation(GENOME_V1, [{ key: "EPOCH_BUDGET", value: 105_000 }], "")).toThrow(/justificación/i);
  });
});

describe("proposeMutation / revert / linaje (WP08)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("una mutación propuesta es efectiva la época SIGUIENTE, nunca a mitad de la actual", () => {
    const before = getActiveGenome(db, 1).EPOCH_BUDGET;
    const r = proposeMutation(db, [{ key: "EPOCH_BUDGET", value: 110_000 }], "subir presupuesto 10% para medir retención");
    expect(r.targetEpoch).toBe(2);

    // La época en curso (1) NO cambia: nada retroactivo ni a mitad de época.
    expect(getActiveGenome(db, 1).EPOCH_BUDGET).toBe(before);
    // La época siguiente (2) ya ve el valor mutado.
    expect(getActiveGenome(db, 2).EPOCH_BUDGET).toBe(110_000);

    // Anuncio para la cohorte.
    const pending = pendingMutation(db);
    expect(pending?.targetEpoch).toBe(2);
    expect(pending?.changes).toEqual([{ key: "EPOCH_BUDGET", from: 100_000, to: 110_000 }]);
    expect(pending?.reason).toMatch(/retención/i);

    // Queda en el decision log y como decisión de la época 2.
    expect(mutationDecidedFor(db, 2)).toBe(true);
    const dec = db.prepare(`SELECT title FROM decision_log WHERE id = ?`).get(r.decisionLogId) as { title: string };
    expect(dec.title).toMatch(/Mutación del genoma para la época 2/);
  });

  it("no permite dos decisiones de genoma para la misma época", () => {
    proposeMutation(db, [{ key: "EPOCH_BUDGET", value: 105_000 }], "primer cambio propuesto para la época");
    expect(() =>
      proposeMutation(db, [{ key: "ACADEMIA_BUDGET", value: 5_200 }], "segundo cambio para la misma época")
    ).toThrow(/ya hay una decisión/i);
  });

  it("revertir crea una versión nueva con los valores previos (append-only) efectiva la época siguiente", () => {
    proposeMutation(db, [{ key: "EPOCH_BUDGET", value: 112_000 }], "subir 12% para probar in silico");
    expect(getActiveGenome(db, 2).EPOCH_BUDGET).toBe(112_000);

    // Avanza a la época 2 (la mutación ya es activa) y revierte a la v1.
    db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (2,'E2',112000,5000,'Open')`).run();
    const rev = revertToVersion(db, 1, "revertir: la mutación bajó la calidad media");
    expect(rev.targetEpoch).toBe(3);
    expect(getActiveGenome(db, 3).EPOCH_BUDGET).toBe(100_000); // valores de v1 restaurados

    // El linaje completo se reconstruye (auditoría): v1 → v2 (mutación) → v3 (reversión).
    const lineage = genomeLineage(db);
    expect(lineage.map((l) => l.version)).toEqual([1, 2, 3]);
    expect(lineage.map((l) => l.effectiveFromEpoch)).toEqual([1, 2, 3]);
    expect(lineage[1].params.EPOCH_BUDGET).toBe(112_000);
    expect(lineage[2].params.EPOCH_BUDGET).toBe(100_000);
    // WP31: la versión revertida se guarda completa (v1 + claves nuevas).
    expect(lineage[2].params).toEqual(GENOME_DEFAULTS);
  });

  it("recordNoMutation deja la decisión explícita de 'sin cambios'", () => {
    recordNoMutation(db, 2, "la época 1 fue estable, no mutamos");
    expect(mutationDecidedFor(db, 2)).toBe(true);
    const row = db.prepare(`SELECT kind FROM mutation_decisions WHERE epoch = 2`).get() as { kind: string };
    expect(row.kind).toBe("no_change");
  });
});

// ---------------------------------------------------------------------------
// WP31 · genoma v2 (criterio B2): tipos GenomeV1, pendingMutation y revertToVersion
// ---------------------------------------------------------------------------
describe("genoma v2 y mutaciones (WP31, B2)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  const paramsDe = (version: number) =>
    JSON.parse(
      (db.prepare(`SELECT params FROM genome_versions WHERE version = ?`).get(version) as { params: string }).params
    ) as Record<string, unknown>;

  const periodo = (id: number) =>
    db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (?, ?, 100000, 5000, 'Open')`).run(
      id,
      `E${id}`
    );

  /** Una mutación pendiente como la dejaba el código previo a WP31: params solo con las claves v1. */
  function mutacionLegada(version: number, cambios: Partial<GenomeV1>, eff: number, razon: string): void {
    const dec = db
      .prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-09-30', ?, ?, 'h')`)
      .run(`Mutación del genoma para la época ${eff} (v${version})`, razon);
    const decId = Number(dec.lastInsertRowid);
    db.prepare(`INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (?, ?, ?, ?)`).run(
      version,
      JSON.stringify({ ...GENOME_V1, ...cambios }),
      eff,
      decId
    );
    db.prepare(`INSERT INTO mutation_decisions (epoch, kind, genome_version, decision_log_id) VALUES (?, 'mutation', ?, ?)`).run(
      eff,
      version,
      decId
    );
  }

  it("validateMutation acepta el genoma v1 y el completo (Genome extiende GenomeV1)", () => {
    const completo: Genome = getActiveGenome(db, 1);
    const v1: GenomeV1 = GENOME_V1;
    expect(() => validateMutation(v1, [{ key: "EPOCH_BUDGET", value: 110_000 }], "subir 10% para medir")).not.toThrow();
    expect(() => validateMutation(completo, [{ key: "EPOCH_BUDGET", value: 110_000 }], "subir 10% para medir")).not.toThrow();
  });

  it("pendingMutation no muestra la v2 de seedGenomeV2 (solo añade claves, ningún gen numérico cambia)", () => {
    expect(seedGenomeV2(db)).toEqual({ insertada: true, version: 2 });
    expect(pendingMutation(db)).toBeNull();
    // Y no ocupa la decisión de la época siguiente: se puede proponer una mutación.
    expect(mutationDecidedFor(db, 2)).toBe(false);
  });

  it("seedGenomeV2 conserva una mutación pendiente, y pendingMutation la sigue anunciando con su razón", () => {
    mutacionLegada(2, { EPOCH_BUDGET: 110_000 }, 2, "subir presupuesto 10% para medir retención");
    expect(seedGenomeV2(db)).toEqual({ insertada: true, version: 3 });

    // La v3 (claves nuevas) rige en la misma época que la mutación y conserva su valor.
    expect(
      (db.prepare(`SELECT effective_from_epoch AS e FROM genome_versions WHERE version = 3`).get() as { e: number }).e
    ).toBe(2);
    const g2 = getActiveGenome(db, 2);
    expect(g2.EPOCH_BUDGET).toBe(110_000);
    expect(g2.TASK_POINTS).toEqual(GENOME_DEFAULTS.TASK_POINTS);
    expect(getActiveGenome(db, 1).EPOCH_BUDGET).toBe(100_000);

    const pending = pendingMutation(db);
    expect(pending?.version).toBe(2);
    expect(pending?.changes).toEqual([{ key: "EPOCH_BUDGET", from: 100_000, to: 110_000 }]);
    expect(pending?.reason).toMatch(/retención/i);
  });

  it("con el código nuevo una mutación ya guarda la versión completa: seedGenomeV2 después no hace nada", () => {
    const r = proposeMutation(db, [{ key: "ACADEMIA_BUDGET", value: 5_500 }], "más Academia para la cohorte nueva");
    expect(paramsDe(r.version)).toEqual({ ...GENOME_DEFAULTS, ACADEMIA_BUDGET: 5_500 });
    expect(seedGenomeV2(db)).toEqual({ insertada: false, version: null });
    expect(pendingMutation(db)?.changes).toEqual([{ key: "ACADEMIA_BUDGET", from: 5_000, to: 5_500 }]);
  });

  it("una mutación propuesta después de la v2 se anuncia", () => {
    seedGenomeV2(db);
    const r = proposeMutation(db, [{ key: "ACADEMIA_BUDGET", value: 5_500 }], "más Academia para la cohorte nueva");
    expect(r.version).toBe(3);
    const pending = pendingMutation(db);
    expect(pending?.version).toBe(3);
    expect(pending?.changes).toEqual([{ key: "ACADEMIA_BUDGET", from: 5_000, to: 5_500 }]);
  });

  it("revertToVersion(1) guarda una versión completa: revertir a la v1 no borra las claves nuevas", () => {
    seedGenomeV2(db); // v2, época 2
    periodo(2);
    const rev = revertToVersion(db, 1, "volver a la v1 tal como se publicó");
    expect(rev.version).toBe(3);
    expect(paramsDe(3)).toEqual(GENOME_DEFAULTS);
    expect(paramsDe(3)).toHaveProperty("RITES_CADENCE");
    expect(genomeLineage(db)[2].params.TASK_POINTS).toEqual(GENOME_DEFAULTS.TASK_POINTS);
    // Sin cambios numéricos respecto a la versión que reemplaza: no se anuncia como mutación.
    expect(pendingMutation(db)).toBeNull();
  });

  it("revertir a la v1 tras una mutación y la v2: restaura el valor, completa el resto y se anuncia", () => {
    mutacionLegada(2, { EPOCH_BUDGET: 112_000 }, 2, "subir 12% para probar in silico");
    periodo(2);
    expect(seedGenomeV2(db)).toEqual({ insertada: true, version: 3 }); // época 3, sobre la mutación
    expect(paramsDe(3).EPOCH_BUDGET).toBe(112_000);
    periodo(3);
    revertToVersion(db, 1, "revertir: la mutación bajó la calidad media");
    expect(paramsDe(4)).toEqual(GENOME_DEFAULTS);
    expect(getActiveGenome(db, 4).EPOCH_BUDGET).toBe(100_000);
    expect(pendingMutation(db)?.changes).toEqual([{ key: "EPOCH_BUDGET", from: 112_000, to: 100_000 }]);
  });
});
