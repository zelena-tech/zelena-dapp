/**
 * Decisiones reemplazadas (decisión del founder, 2026-10-21): en /gobernanza y en
 * /comunidad se muestra SOLO la versión vigente; el original queda intacto en
 * decision_log con su huella y solo lo ve el founder en /admin. Nada se reescribe.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { openDb, prepararSqlite, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import {
  decisionesReemplazadas,
  decisionesVigentes,
  registrarReemplazo,
  vigenteDe,
  vincularReemplazosConocidos,
} from "./decisiones";
import { decisionesPublicas } from "./ritos";
import { REEMPLAZO_DECISION, tipoDesdeEtiqueta } from "./agora-labels";

const WEB = process.cwd();
const LIB = path.join(WEB, "src", "lib");
const FIXTURE = fs.readFileSync(path.join(LIB, "__fixtures__", "schema-58ee2fd.sql"), "utf8");
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

const FOUNDER = "GFOUNDERDECISIONESAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
/** La razón de la decisión histórica, con la etiqueta vieja (sin escribir el literal). */
const RAZON_VIEJA = `Se abren al Ágora las dos primeras campañas, etiquetadas ${tipoDesdeEtiqueta("cliente")}, con hitos públicos.`;

/** Base con el esquema de PRODUCCIÓN (58ee2fd) y la decisión histórica tal cual se sembró. */
function baseProduccion(file: string): DB {
  const db = openDb(file);
  db.exec(FIXTURE);
  db.exec(`
    INSERT INTO users (wallet, display_name, is_demo, is_founder, cla_signed) VALUES ('${FOUNDER}', 'Founder', 1, 1, 1);
    INSERT INTO periods (name, epoch_budget, academia_budget) VALUES ('Época Génesis', 100000, 5000);
    INSERT INTO genome_versions (version, params, effective_from_epoch) VALUES (1, '{}', 1);
  `);
  const ins = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (?, ?, ?, ?)`);
  const h = (...p: string[]) => createHash("sha256").update(p.join("|")).digest("hex");
  ins.run("2026-06-15", "Adopción del reglamento", "Marco de operación.", h("2026-06-15", "a", "b"));
  ins.run("2026-07-01", "Publicación de campañas", RAZON_VIEJA, h("2026-07-01", "Publicación de campañas", RAZON_VIEJA));
  return db;
}

const decisionLog = (db: DB) => db.prepare(`SELECT * FROM decision_log ORDER BY id`).all() as Array<Record<string, unknown>>;

describe("base con el esquema de producción: solo la vigente en público, el original intacto", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-decisiones-"));
    file = path.join(dir, "zelena.db");
  });
  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows puede retener el archivo */
    }
  });

  it("el arranque registra el reemplazo sin reescribir ni borrar el decision log", () => {
    const db = baseProduccion(file);
    const antes = decisionLog(db);
    prepararSqlite(db, { archivo: file, founderWallet: FOUNDER, ahora: new Date("2026-10-21T15:00:00Z") });

    const despues = decisionLog(db);
    // Lo que había, idéntico (texto, fecha y huella); solo se AÑADEN filas al final.
    expect(despues.slice(0, antes.length)).toEqual(antes);
    const vieja = antes.find((d) => d.reason === RAZON_VIEJA)!;
    const nueva = despues.find((d) => d.title === REEMPLAZO_DECISION)!;
    expect(nueva).toBeDefined();
    expect(db.prepare(`SELECT decision_id, replaced_by_id FROM decision_replacements`).all()).toEqual([
      { decision_id: vieja.id, replaced_by_id: nueva.id },
    ]);

    // Público: ni el título ni el texto del original; la vigente dice qué reemplaza.
    const vigentes = decisionesVigentes(db);
    expect(vigentes.some((d) => d.id === vieja.id || d.reason === RAZON_VIEJA)).toBe(false);
    expect(vigentes.find((d) => d.id === nueva.id)?.reemplazaA).toEqual([{ id: vieja.id, date: "2026-07-01" }]);
    const comunidad = decisionesPublicas(db, 100);
    expect(comunidad.some((d) => d.id === vieja.id || d.title === "Publicación de campañas")).toBe(false);
    expect(comunidad.some((d) => d.id === nueva.id)).toBe(true);

    // /admin: el original completo, con su huella y a qué lo llevó.
    expect(decisionesReemplazadas(db)).toEqual([
      {
        id: vieja.id,
        date: "2026-07-01",
        title: "Publicación de campañas",
        reason: RAZON_VIEJA,
        hash: vieja.hash,
        reemplazadaPor: { id: nueva.id, date: nueva.date, title: REEMPLAZO_DECISION },
      },
    ]);
    // Un enlace viejo (#dec-<original>) lleva a la vigente.
    expect(vigenteDe(db, Number(vieja.id))?.id).toBe(nueva.id);
  });

  it("es idempotente: el segundo arranque no añade nada", () => {
    const db = baseProduccion(file);
    prepararSqlite(db, { archivo: file, founderWallet: FOUNDER });
    const tras1 = { dl: decisionLog(db), r: db.prepare(`SELECT * FROM decision_replacements`).all() };
    prepararSqlite(db, { archivo: file, founderWallet: FOUNDER });
    expect(vincularReemplazosConocidos(db)).toBe(0);
    expect({ dl: decisionLog(db), r: db.prepare(`SELECT * FROM decision_replacements`).all() }).toEqual(tras1);
  });

  it("si la migración falla, el arranque sigue y el original tampoco se muestra en público", () => {
    const db = baseProduccion(file);
    const rota: DB = {
      ...db,
      prepare: (sql: string) => {
        if (sql.includes("INSERT INTO decision_replacements")) throw new Error("fallo simulado");
        return db.prepare(sql);
      },
    };
    expect(() => prepararSqlite(rota, { archivo: file, founderWallet: FOUNDER })).not.toThrow();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM decision_replacements`).get()).toEqual({ n: 0 });
    expect(decisionesVigentes(db).some((d) => d.reason === RAZON_VIEJA)).toBe(false);
  });
});

describe("registrarReemplazo: solo inserta y no admite vínculos dudosos", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    db.exec(fs.readFileSync(path.join(LIB, "schema.sql"), "utf8"));
    seedIfEmpty(db, {} as NodeJS.ProcessEnv);
  });

  it("valida, es idempotente y sigue la cadena de reemplazos", () => {
    const ins = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-10-01', ?, 'r', 'h')`);
    const a = Number(ins.run("A").lastInsertRowid);
    const b = Number(ins.run("B").lastInsertRowid);
    const c = Number(ins.run("C").lastInsertRowid);
    expect(() => registrarReemplazo(db, a, a)).toThrow(/a sí misma/);
    expect(() => registrarReemplazo(db, a, 99999)).toThrow(/no existe/);
    expect(registrarReemplazo(db, a, b)).toBe(true);
    expect(registrarReemplazo(db, a, b)).toBe(false);
    expect(() => registrarReemplazo(db, a, c)).toThrow(/otro reemplazo/);
    expect(registrarReemplazo(db, b, c)).toBe(true);
    expect(vigenteDe(db, a)?.title).toBe("C");
    expect(decisionesVigentes(db).map((d) => d.title)).not.toContain("A");
    expect(decisionesVigentes(db).find((d) => d.id === c)?.reemplazaA).toEqual([{ id: b, date: "2026-10-01" }]);
    // El decision log no cambió: A y B siguen ahí, tal cual.
    expect(db.prepare(`SELECT title FROM decision_log WHERE id IN (?, ?) ORDER BY id`).all(a, b)).toEqual([
      { title: "A" },
      { title: "B" },
    ]);
  });
});

describe("las páginas (estático)", () => {
  it("/gobernanza lista solo las vigentes y no pinta el original", () => {
    const src = leer("app/gobernanza/page.tsx");
    expect(src).toContain("decisionesVigentes(db)");
    expect(src).not.toMatch(/listDecisions|esDecisionReemplazada|Reemplazada por:/);
  });

  it("/admin muestra los originales con su hash completo", () => {
    const src = leer("app/admin/page.tsx");
    expect(src).toContain("decisionesReemplazadas(db)");
    expect(src).toContain("hash: {d.hash}");
  });

  it("decision_log solo recibe INSERT en lib/decisiones.ts", () => {
    const src = leer("src/lib/decisiones.ts");
    expect(src).not.toMatch(/UPDATE\s+decision_log|DELETE\s+FROM\s+decision_log|DELETE\s+FROM\s+decision_replacements/i);
  });
});
