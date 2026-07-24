import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { createLatentAudit, listLatentAudits, AuditError } from "./audits";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

const base = {
  mechanism: "academia",
  period: "Época 3",
  manifestFunction: "Premiar el aprendizaje del sistema",
  latentObserved: "Farming de quizzes por repetición sin lectura real",
  functionalFor: "quienes maximizan puntos rápidos",
  dysfunctionalFor: "la señal de calidad de la reputación",
};

describe("auditoría de funciones latentes (WP12)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("crea una auditoría visible en el registro público", () => {
    const id = createLatentAudit(db, base);
    expect(id).toBeGreaterThan(0);
    const audits = listLatentAudits(db);
    expect(audits).toHaveLength(1);
    expect(audits[0].mechanism).toBe("academia");
    expect(audits[0].latentObserved).toMatch(/farming/i);
    expect(audits[0].action).toBe("none");
  });

  it("una auditoría con mutación propuesta enlaza a la entrada del decision log", () => {
    const dec = db
      .prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-07-01','Mutación propuesta: cap Academia','r','h')`)
      .run();
    const decId = dec.lastInsertRowid as number;
    const id = createLatentAudit(db, { ...base, action: "mutation_proposed", decisionLogId: decId });
    const audit = listLatentAudits(db).find((a) => a.id === id)!;
    expect(audit.action).toBe("mutation_proposed");
    expect(audit.decisionLogId).toBe(decId);
    expect(audit.decisionTitle).toMatch(/Mutación propuesta/);
  });

  it("rechaza campos obligatorios vacíos", () => {
    expect(() => createLatentAudit(db, { ...base, manifestFunction: "" })).toThrow(AuditError);
  });

  it("rechaza una acción inválida", () => {
    expect(() => createLatentAudit(db, { ...base, action: "borrar" as never })).toThrow(AuditError);
  });
});
