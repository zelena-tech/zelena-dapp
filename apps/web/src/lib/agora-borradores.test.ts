/**
 * Borradores del Ágora (decisión del founder, 2026-10-21): los proyectos sembrados se
 * ocultan del público hasta que el founder publique proyectos reales. No se borra nada
 * y se pueden volver a publicar desde /admin.
 *
 * Se comprueba:
 *  - una base NUEVA siembra sus proyectos ya en borrador;
 *  - sobre una base con el esquema de PRODUCCIÓN (58ee2fd) la migración identifica las
 *    filas sembradas por su origen (sin nombres), no toca nada más y es idempotente;
 *  - un proyecto publicado por el founder no vuelve a borrador al reiniciar;
 *  - lo público (/agora, /agora/[id], la landing, las cifras) no ve los borradores y un
 *    borrador no recibe aplicaciones ni se asigna.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { openDb, prepararSqlite, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { marcarSembradosComoBorrador, publicarProyecto, ORIGEN_SEMBRADO } from "./agora-borradores";
import { cohortStats, getProject, listProjects } from "./repo";
import { cifrasEnVivo } from "./prueba-en-vivo";
import { approveApplication } from "./admin";
import { esBorrador, recibeAplicaciones } from "./state-machine";
import { tipoDesdeQuery } from "./agora-labels";

const WEB = process.cwd();
const LIB = path.join(WEB, "src", "lib");
const SCHEMA = fs.readFileSync(path.join(LIB, "schema.sql"), "utf8");
const FIXTURE = fs.readFileSync(path.join(LIB, "__fixtures__", "schema-58ee2fd.sql"), "utf8");
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

const g = globalThis as unknown as { __zelenaDb?: DB };

/** Las funciones de lectura de repo.ts usan la base global: se apunta a la del test. */
function usarComoGlobal(db: DB): void {
  g.__zelenaDb = db;
}

function baseSembrada(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedIfEmpty(db, {} as NodeJS.ProcessEnv);
  return db;
}

const FOUNDER_SEED = "GSEEDFOUNDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SUPERVISORA = "GSUPERVISORAREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CONTRIB = "GCONTRIBREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Base con la forma EXACTA de producción (58ee2fd) y cuatro proyectos:
 *  1 y 2 · sembrados (hitos desde 0, supervisor = fila is_founder, sin entrega enlazada);
 *  3 · publicado desde el tablero (hitos desde 1, enlazado a su entrega);
 *  4 · hitos desde 0 pero su supervisor no es la fila del founder (no es del seed).
 * Los textos son neutros: el criterio no depende de ningún nombre.
 */
function baseProduccion(file: string): DB {
  const db = openDb(file);
  db.exec(FIXTURE);
  db.exec(`
    INSERT INTO users (wallet, display_name, is_demo, is_founder, cla_signed, created_at) VALUES
      ('${FOUNDER_SEED}', 'Founder (seed)', 1, 1, 1, '2026-07-01 10:00:00'),
      ('${SUPERVISORA}', 'Supervisora', 0, 0, 1, '2026-08-01 10:00:00'),
      ('${CONTRIB}', 'Contribuidora', 0, 0, 1, '2026-08-02 10:00:00');
    INSERT INTO projects (id, campaign, title, type, budget_usd, weeks, state, supervisor_wallet, summary, description, acceptance, created_at) VALUES
      (1, 'Campaña A', 'Ejemplo uno', 'DAO', 500, 8, 'Open', '${FOUNDER_SEED}', 'resumen uno', 'detalle uno', 'criterio uno', '2026-07-01 10:00:00'),
      (2, 'Campaña B', 'Ejemplo dos', 'DAO', 1000, 12, 'Assigned', '${FOUNDER_SEED}', 'resumen dos', 'detalle dos', 'criterio dos', '2026-07-01 10:00:00'),
      (3, 'Zelena', 'Publicado desde el tablero', 'DAO', 300, 4, 'Open', '${FOUNDER_SEED}', 'resumen tres', 'detalle tres', 'criterio tres', '2026-09-01 10:00:00'),
      (4, 'Zelena', 'Otro supervisor', 'DAO', 300, 4, 'Open', '${SUPERVISORA}', 'resumen cuatro', 'detalle cuatro', 'criterio cuatro', '2026-09-02 10:00:00');
    INSERT INTO milestones (project_id, ord, code, name, week, pct, amount_usd) VALUES
      (1, 0, 'ANT', 'Anticipo', 'Sem 0', 20, 100), (1, 1, 'H1', 'Primer hito', 'Sem 3', 80, 400),
      (2, 0, 'ANT', 'Anticipo', 'Sem 0', 20, 200), (2, 1, 'A1', 'Arquitectura', 'Sem 2', 80, 800),
      (3, 1, 'H1', 'Hito uno', 'Sem 2', 50, 150), (3, 2, 'H2', 'Hito dos', 'Sem 4', 50, 150),
      (4, 0, 'H0', 'Arranque', 'Sem 0', 100, 300);
    INSERT INTO applications (project_id, wallet, approach, timeline) VALUES (1, '${CONTRIB}', 'mi enfoque', '2 semanas');
    INSERT INTO assignments (id, title, status, priority, size, published_as_project_id, created_by, created_at, updated_at)
      VALUES (20, 'Pieza publicada', 'Backlog', 'media', 'M', 3, '${FOUNDER_SEED}', '2026-09-01 09:00:00', '2026-09-01 10:00:00');
    INSERT INTO periods (name, epoch_budget, academia_budget) VALUES ('Época Génesis', 100000, 5000);
    INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-07-01', 'Génesis', 'arranque', 'h');
    INSERT INTO genome_versions (version, params, effective_from_epoch) VALUES (1, '{}', 1);
  `);
  return db;
}

/** Huella de lo que la migración NO puede tocar: las columnas originales de los proyectos y todo lo demás. */
function huellaIntocable(db: DB): string {
  const q = [
    `SELECT id, campaign, title, type, budget_usd, weeks, state, supervisor_wallet, assignee_wallet, summary, description, acceptance, created_at FROM projects ORDER BY id`,
    `SELECT * FROM milestones ORDER BY id`,
    `SELECT * FROM applications ORDER BY id`,
  ];
  return createHash("sha256")
    .update(JSON.stringify(q.map((s) => db.prepare(s).all())))
    .digest("hex");
}

const borradores = (db: DB) =>
  (db.prepare(`SELECT id FROM projects WHERE draft = 1 ORDER BY id`).all() as Array<{ id: number }>).map((r) => r.id);

describe("base nueva: los proyectos sembrados nacen en borrador", () => {
  let db: DB;
  beforeEach(() => {
    db = baseSembrada();
    usarComoGlobal(db);
  });
  afterEach(() => {
    delete g.__zelenaDb;
  });

  it("todos los sembrados quedan draft = 1 y origin = 'seed', sin borrar ninguno", () => {
    const filas = db.prepare(`SELECT draft, origin FROM projects`).all() as Array<{ draft: number; origin: string }>;
    expect(filas.length).toBe(5);
    expect(filas.every((f) => f.draft === 1 && f.origin === ORIGEN_SEMBRADO)).toBe(true);
    // La migración de arranque no encuentra nada más que hacer en una base nueva.
    expect(marcarSembradosComoBorrador(db)).toBe(0);
  });

  it("lo público no los ve: /agora, /agora/[id], la landing y las cifras", () => {
    expect(listProjects()).toEqual([]);
    expect(listProjects({ type: tipoDesdeQuery("cliente") })).toEqual([]);
    expect(getProject(1)).toBeUndefined();
    expect(cifrasEnVivo(db).proyectosAbiertos).toBe(0);
    expect(cohortStats(db).bounties).toBe(0);
    // /admin sí (para publicarlos).
    expect(listProjects({ incluirBorradores: true }).length).toBe(5);
    expect(getProject(1, { incluirBorradores: true })?.draft).toBe(1);
  });

  it("publicar un borrador lo devuelve al Ágora con su estado intacto; un publicado da 409", () => {
    const antes = getProject(2, { incluirBorradores: true })!;
    publicarProyecto(db, 2);
    const despues = getProject(2)!;
    expect(despues.draft).toBe(0);
    expect({ ...despues, draft: 1 }).toEqual(antes);
    expect(listProjects().map((p) => p.id)).toEqual([2]);
    expect(() => publicarProyecto(db, 2)).toThrow(/ya está publicado/);
    expect(() => publicarProyecto(db, 999)).toThrow(/no encontrado/);
  });

  it("un borrador no recibe aplicaciones ni se asigna", () => {
    expect(recibeAplicaciones({ state: "Open", draft: 1 })).toBe(false);
    expect(recibeAplicaciones({ state: "Open", draft: 0 })).toBe(true);
    expect(recibeAplicaciones({ state: "Assigned", draft: 0 })).toBe(false);
    expect(esBorrador({ draft: 1 })).toBe(true);
    // Una aplicación vieja sobre un borrador no se puede aprobar hasta publicarlo.
    const w = (db.prepare(`SELECT wallet FROM users WHERE is_founder = 0 LIMIT 1`).get() as { wallet: string }).wallet;
    const app = db
      .prepare(`INSERT INTO applications (project_id, wallet, approach, timeline) VALUES (1, ?, 'enfoque largo de prueba', '1 semana')`)
      .run(w);
    expect(() => approveApplication(Number(app.lastInsertRowid))).toThrow(/borrador/);
    expect(db.prepare(`SELECT state, assignee_wallet FROM projects WHERE id = 1`).get()).toEqual({
      state: "Open",
      assignee_wallet: null,
    });
  });
});

describe("base con el esquema de producción (58ee2fd): migración por origen de seed", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-borradores-"));
    file = path.join(dir, "zelena.db");
  });
  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows puede retener el archivo: limpieza de cortesía */
    }
  });

  it("el arranque pasa a borrador SOLO las filas sembradas y no toca nada más", () => {
    const db = baseProduccion(file);
    const antes = huellaIntocable(db);
    const cuentas = () =>
      ["projects", "milestones", "applications"].map(
        (t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
      );
    const cuentasAntes = cuentas();

    prepararSqlite(db, { archivo: file, founderWallet: FOUNDER_SEED, ahora: new Date("2026-10-21T15:00:00Z") });

    expect(borradores(db)).toEqual([1, 2]);
    expect(db.prepare(`SELECT id, origin FROM projects ORDER BY id`).all()).toEqual([
      { id: 1, origin: ORIGEN_SEMBRADO },
      { id: 2, origin: ORIGEN_SEMBRADO },
      { id: 3, origin: null },
      { id: 4, origin: null },
    ]);
    // Nada se borra ni cambia fuera de draft/origin (estado, textos, hitos, aplicaciones).
    expect(cuentas()).toEqual(cuentasAntes);
    expect(huellaIntocable(db)).toBe(antes);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("es idempotente y respeta lo que el founder publicó: reiniciar no vuelve a ocultarlo", () => {
    const db = baseProduccion(file);
    prepararSqlite(db, { archivo: file, founderWallet: FOUNDER_SEED });
    expect(marcarSembradosComoBorrador(db)).toBe(0);

    publicarProyecto(db, 1);
    prepararSqlite(db, { archivo: file, founderWallet: FOUNDER_SEED });
    expect(borradores(db)).toEqual([2]);
    expect(marcarSembradosComoBorrador(db)).toBe(0);
  });

  it("si la migración falla, el arranque sigue (try/catch como las de contenido)", () => {
    const db = baseProduccion(file);
    prepararSqlite(db, { archivo: file, founderWallet: FOUNDER_SEED });
    db.exec(`UPDATE projects SET origin = NULL, draft = 0`);
    const rota: DB = {
      ...db,
      prepare: (sql: string) => {
        if (sql.includes("UPDATE projects SET draft = 1")) throw new Error("fallo simulado");
        return db.prepare(sql);
      },
    };
    expect(() => seedIfEmpty(rota, {} as NodeJS.ProcessEnv)).not.toThrow();
    expect(borradores(db)).toEqual([]);
  });
});

describe("las superficies públicas usan la regla (estático)", () => {
  it("/api/apply responde 404 a un borrador y usa recibeAplicaciones", () => {
    const src = leer("app/api/apply/route.ts");
    expect(src).toMatch(/if \(!project \|\| esBorrador\(project\)\)/);
    expect(src).toContain("recibeAplicaciones(project)");
    expect(src).not.toMatch(/project\.state !== "Open"/);
  });

  it("/agora/[id] lee con getProject (que excluye borradores) y ofrece aplicar con recibeAplicaciones", () => {
    const src = leer("app/agora/[id]/page.tsx");
    expect(src).toMatch(/const project = getProject\(id\);\s*\n\s*if \(!project\) notFound\(\);/);
    expect(src).toContain("recibeAplicaciones(project)");
  });

  it("/agora no pide borradores; /admin sí y ofrece Publicar", () => {
    expect(leer("app/agora/page.tsx")).not.toContain("incluirBorradores");
    const admin = leer("app/admin/page.tsx");
    expect(admin).toContain("listProjects({ incluirBorradores: true })");
    expect(admin).toContain('action="publishProject"');
    expect(admin).toContain('label="Publicar"');
    expect(leer("app/api/admin/route.ts")).toMatch(/case "publishProject":[\s\S]*publicarProyecto\(getDb\(\), projectId\)/);
  });
});
