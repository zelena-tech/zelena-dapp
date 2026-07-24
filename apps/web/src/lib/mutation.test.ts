import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { GENOME_V1, getActiveGenome, seedGenomeV1 } from "./genome";
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
  });

  it("recordNoMutation deja la decisión explícita de 'sin cambios'", () => {
    recordNoMutation(db, 2, "la época 1 fue estable, no mutamos");
    expect(mutationDecidedFor(db, 2)).toBe(true);
    const row = db.prepare(`SELECT kind FROM mutation_decisions WHERE epoch = 2`).get() as { kind: string };
    expect(row.kind).toBe("no_change");
  });
});
