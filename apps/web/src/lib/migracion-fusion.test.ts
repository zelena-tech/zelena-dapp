/**
 * Fusión v1 ← línea desplegada (2026-09-30) · plan §4.4.1.
 *
 * La base de PRODUCCIÓN nació con el esquema de 58ee2fd (fixture
 * `__fixtures__/schema-58ee2fd.sql`, copia byte a byte del desplegado). Estos tests
 * arrancan `prepararSqlite` — la MISMA secuencia que corre `init()` — sobre una
 * base con esa forma y con filas, y comprueban:
 *  (a) arranca y deja intactos los datos reales (huella por tabla) + respaldo;
 *  (b) el segundo arranque no hace nada;
 *  (c) el mapeo de valores del módulo equipo;
 *  (d) paridad de columnas con una base nueva, salvo el legado tolerado;
 *  (e) un valor desconocido aborta sin tocar los datos;
 *  (f) el hash del CLA es el que firmaron las altas reales.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { openDb, prepararSqlite, MigracionEquipoError, type DB } from "./db";
import { claCanonicalHash, readClaText } from "./cla";

const LIB = path.join(process.cwd(), "src", "lib");
const FIXTURE = fs.readFileSync(path.join(LIB, "__fixtures__", "schema-58ee2fd.sql"), "utf8");

const FOUNDER_DEMO = "GA7ZELENAFOUNDERDEMOWALLET000000000000000000000000000AAA";
const JOHN_REAL = "GJOHNREALFOUNDERWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CONTRIB = "GCONTRIBUIDORREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DAVID = "GDAVIDREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Columnas toleradas de más en una base migrada (legado de la línea desplegada). */
const LEGADO_TOLERADO = ["users.email", "users.recovery_email"];
const INDICES_LEGADO_TOLERADOS = ["idx_users_email"];

/** Datos reales que la migración NO puede tocar, con las columnas que ya existían. */
const HUELLA: Record<string, string> = {
  users:
    "SELECT wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, email, recovery_email, created_at FROM users WHERE wallet NOT LIKE 'pending:%' ORDER BY wallet",
  invites: "SELECT code, issuer_wallet, used_by, expires_at, max_uses, uses, created_at FROM invites ORDER BY code",
  cla_signatures: "SELECT * FROM cla_signatures ORDER BY id",
  anchor_queue: "SELECT * FROM anchor_queue ORDER BY id",
  projects: "SELECT * FROM projects ORDER BY id",
  milestones: "SELECT * FROM milestones ORDER BY id",
  applications: "SELECT * FROM applications ORDER BY id",
  reputation_events: "SELECT * FROM reputation_events ORDER BY id",
  points_ledger: "SELECT * FROM points_ledger ORDER BY id",
  periods: "SELECT * FROM periods ORDER BY id",
  decision_log: "SELECT * FROM decision_log ORDER BY id",
  genome_versions: "SELECT * FROM genome_versions ORDER BY id",
  proposals: "SELECT * FROM proposals ORDER BY id",
  votes: "SELECT * FROM votes ORDER BY id",
  clients: "SELECT * FROM clients ORDER BY id",
  client_members: "SELECT * FROM client_members ORDER BY id",
  leads: "SELECT * FROM leads ORDER BY id",
};

function huella(db: DB): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [t, q] of Object.entries(HUELLA)) {
    out[t] = createHash("sha256").update(JSON.stringify(db.prepare(q).all())).digest("hex");
  }
  return out;
}

const cuenta = (db: DB, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
const tablas = (db: DB) =>
  (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
const indices = (db: DB) =>
  new Map(
    (
      db.prepare(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`).all() as Array<{
        name: string;
        tbl_name: string;
        sql: string;
      }>
    ).map((r) => [r.name, `${r.tbl_name}|${r.sql.replace(/\s+/g, " ")}`])
  );
const columnas = (db: DB, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => `${t}.${c.name}`);

/** Base con la forma EXACTA de producción (58ee2fd) y filas reales y del módulo equipo. */
function baseDesplegada(file: string, opts: { prioridadRara?: boolean } = {}): DB {
  const db = openDb(file);
  db.exec(FIXTURE);
  db.exec(`
    INSERT INTO users (wallet, display_name, is_demo, is_founder, cla_signed, created_at) VALUES
      ('${FOUNDER_DEMO}', 'Founder demo', 1, 1, 1, '2026-08-01 10:00:00'),
      ('${JOHN_REAL}', 'John', 0, 0, 1, '2026-08-02 10:00:00'),
      ('${CONTRIB}', 'Contribuidora', 0, 0, 1, '2026-08-03 10:00:00'),
      ('${DAVID}', 'David', 0, 0, 1, '2026-08-04 10:00:00');
    INSERT INTO invites (code, issuer_wallet, used_by, expires_at, max_uses, uses) VALUES
      ('COHORTE-X', '${FOUNDER_DEMO}', NULL, '2026-10-25 00:00:00', 400, 7),
      ('UNO-SOLO', '${FOUNDER_DEMO}', '${CONTRIB}', '2026-09-01 00:00:00', NULL, 0);
    INSERT INTO cla_signatures (wallet, cla_hash, signature, anchor_status, tx_id) VALUES
      ('${JOHN_REAL}', '03293c9378146cbd7fcbd49a0df467134a118d7a7e0379664c5d069c0398edb9', 'sig-john', 'anchored', 'tx1'),
      ('${CONTRIB}', '03293c9378146cbd7fcbd49a0df467134a118d7a7e0379664c5d069c0398edb9', 'sig-c', 'pending', NULL);
    INSERT INTO anchor_queue (kind, ref, data_key, payload_hash) VALUES ('cla', '${CONTRIB}', 'cla:c', 'abc');
    INSERT INTO projects (campaign, title, type, budget_usd, weeks, supervisor_wallet, summary, description, acceptance)
      VALUES ('LUMA', 'Bounty', 'SAS', 500, 2, '${FOUNDER_DEMO}', 's', 'd', 'a');
    INSERT INTO milestones (project_id, ord, code, name, week, pct, amount_usd) VALUES (1, 1, 'M1', 'Hito', 'S1', 100, 500);
    INSERT INTO applications (project_id, wallet, approach, timeline) VALUES (1, '${CONTRIB}', 'enfoque', '2 semanas');
    INSERT INTO periods (name, epoch_budget, academia_budget) VALUES ('Época Génesis', 100000, 5000);
    INSERT INTO reputation_events (wallet, axis, delta, ref) VALUES ('${CONTRIB}', 'ejecucion', 5, 'm:1');
    INSERT INTO points_ledger (wallet, points, period_id, ref) VALUES ('${CONTRIB}', 50, 1, 'm:1');
    INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-08-01', 'Génesis', 'arranque', 'h');
    INSERT INTO genome_versions (version, params, effective_from_epoch) VALUES (1, '{}', 1);
    INSERT INTO proposals (title, description) VALUES ('Ratificar', 'd');
    INSERT INTO votes (proposal_id, wallet, choice) VALUES (1, '${CONTRIB}', 'favor');
    INSERT INTO leads (nombre, email, interes) VALUES ('Prospecto', 'p@empresa.co', 'wms');

    INSERT INTO clients (id, slug, name) VALUES (1, 'montoc', 'Montoc');
    INSERT INTO client_members (client_id, wallet, access_level) VALUES (1, '${DAVID}', 'lead');
    INSERT INTO initiatives (id, slug, name, horizon, client_id, notes) VALUES
      (1, 'wms-montoc', 'WMS Montoc', 'siguiente', 1, 'nota'),
      (2, 'interno', 'Interno', 'parqueado', NULL, NULL);
    INSERT INTO assignments (id, title, description, initiative_id, client_id, owner_wallet, status, priority, size,
        acceptance_criteria, graph_node_id, blocked_reason, created_by, created_at, updated_at) VALUES
      (10, 'Bloqueada', NULL, 1, 1, '${DAVID}', 'Bloqueada', '${opts.prioridadRara ? "urgentisima" : "alta"}', 'M',
        NULL, 'montoc.x', 'falta acceso', '${JOHN_REAL}', '2026-08-30 09:00:00', '2026-09-01 10:00:00'),
      (11, 'Hecha', 'desc', 2, NULL, '${DAVID}', 'Hecha', 'media', 'S',
        'criterio', NULL, NULL, '${JOHN_REAL}', '2026-08-30 09:00:00', '2026-09-02 12:00:00'),
      (12, 'Sin dueño', NULL, NULL, NULL, NULL, 'Backlog', 'baja', 'L',
        NULL, NULL, NULL, '${JOHN_REAL}', '2026-08-30 09:00:00', '2026-08-30 09:00:00');
    INSERT INTO assignment_events (id, assignment_id, from_status, to_status, action, actor_wallet, reason, created_at) VALUES
      (100, 10, NULL, 'Asignada', 'crear', '${JOHN_REAL}', NULL, '2026-08-30 09:00:00'),
      (101, 10, 'Asignada', 'En curso', 'empezar', '${DAVID}', NULL, '2026-08-31 09:00:00'),
      (102, 10, 'En curso', 'Bloqueada', 'bloquear', '${DAVID}', 'falta acceso', '2026-09-01 10:00:00'),
      (103, 11, 'En curso', 'En revisión', 'a_revision', '${DAVID}', NULL, '2026-09-02 09:00:00'),
      (104, 11, 'En revisión', 'Hecha', 'aprobar', '${JOHN_REAL}', NULL, '2026-09-02 12:00:00');
    INSERT INTO checkins (id, wallet, day, done, doing, blocked, updated_at) VALUES
      (5, '${DAVID}', '2026-09-01', 'a', 'b', NULL, '2026-09-01 18:00:00');
  `);
  return db;
}

describe("migración de la base de producción (forma 58ee2fd → v1)", () => {
  let dir: string;
  let file: string;
  const AHORA = new Date("2026-09-30T23:00:00.000Z");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-fusion-"));
    file = path.join(dir, "zelena.db");
  });
  afterEach(() => {
    // Windows puede retener el archivo abierto: la limpieza es de cortesía.
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* tmp */
    }
  });

  it("(a) arranca sobre la base desplegada, respalda antes y deja intactos los datos reales", () => {
    const db = baseDesplegada(file);
    const antes = huella(db);

    const inf = prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, ahora: AHORA });

    expect(inf.migro).toBe(true);
    expect(inf.preColumnas).toEqual(["users.role", "users.entra_oid", "users.auth_provider"]);
    expect(inf.apartado).toBe(true);
    expect(inf.copiado).toEqual({ assignment_events: 5, checkins: 1, assignments: 3, initiatives: 2 });
    expect(huella(db)).toEqual(antes);

    // Respaldo consistente ANTES de migrar, junto a la base, con la forma vieja.
    expect(inf.respaldo).toBe(`${file}.pre-fusion-2026-09-30T23-00-00-000Z.db`);
    const respaldo = openDb(inf.respaldo!);
    expect(columnas(respaldo, "assignments")).not.toContain("assignments.needs_founder");
    expect(cuenta(respaldo, "assignments")).toBe(3);
    expect(huella(respaldo)).toEqual(antes);

    // Integridad y claves foráneas.
    expect(db.prepare(`PRAGMA integrity_check`).get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
    expect(tablas(db).filter((t) => t.startsWith("_legado_"))).toEqual([]);

    // Backfill del founder: el gate de antes (wallet === FOUNDER_WALLET) queda como DATO.
    const rol = (w: string) => db.prepare(`SELECT role, is_supervisor FROM users WHERE wallet = ?`).get(w);
    expect(rol(JOHN_REAL)).toEqual({ role: "founder", is_supervisor: 1 });
    expect(rol(FOUNDER_DEMO)).toEqual({ role: "founder", is_supervisor: 1 });
    expect(rol(CONTRIB)).toEqual({ role: "contributor", is_supervisor: 0 });
    expect(rol(DAVID)).toEqual({ role: "contributor", is_supervisor: 0 });

    // La siembra corrió sobre la base migrada: roster pending:* + iniciativas fijas.
    expect(cuenta(db, "users")).toBe(4 + 6);
    expect(cuenta(db, "initiatives")).toBe(2 + 6);
  });

  it("(b) el segundo arranque no hace nada: ni respaldo, ni columnas, ni copia, ni cambios", () => {
    const db = baseDesplegada(file);
    prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, ahora: AHORA });
    const tras1 = { h: huella(db), eq: db.prepare(`SELECT * FROM assignments ORDER BY id`).all() };
    const respaldos1 = fs.readdirSync(dir).filter((f) => f.includes(".pre-fusion-")).length;

    const inf2 = prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, ahora: new Date() });
    expect(inf2).toEqual({
      migro: false,
      respaldo: null,
      preColumnas: [],
      apartado: false,
      postColumnas: [],
      copiado: null,
      correosCopiados: 0,
      founderPromovidos: 0,
    });
    expect({ h: huella(db), eq: db.prepare(`SELECT * FROM assignments ORDER BY id`).all() }).toEqual(tras1);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".pre-fusion-")).length).toBe(respaldos1);
  });

  it("(b') una base NUEVA no migra ni respalda", () => {
    const db = openDb(file);
    const inf = prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, sembrar: false });
    expect(inf.migro).toBe(false);
    expect(inf.respaldo).toBeNull();
    expect(fs.readdirSync(dir).filter((f) => f.includes(".pre-fusion-"))).toEqual([]);
  });

  it("(c) mapea prioridad, horizonte, estados, eventos y check-ins a los valores de v1, conservando ids", () => {
    const db = baseDesplegada(file);
    prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, sembrar: false, ahora: AHORA });

    const a = (id: number) =>
      db
        .prepare(
          `SELECT priority, horizon, status, status_before_block, blocked_at, closed_at, description,
                  acceptance_criteria, client_id, graph_node_id, owner_wallet, needs_founder, import_key
             FROM assignments WHERE id = ?`
        )
        .get(id);
    expect(a(10)).toEqual({
      priority: "High",
      horizon: "Siguiente",
      status: "Bloqueada",
      status_before_block: "En curso",
      blocked_at: "2026-09-01 10:00:00",
      closed_at: null,
      description: "",
      acceptance_criteria: "",
      client_id: 1,
      graph_node_id: "montoc.x",
      owner_wallet: DAVID,
      needs_founder: 0,
      import_key: null,
    });
    expect(a(11)).toMatchObject({ priority: "Normal", horizon: "Parqueado", status: "Hecha", closed_at: "2026-09-02 12:00:00" });
    expect(a(12)).toMatchObject({ priority: "Low", horizon: "Ahora", status: "Backlog", owner_wallet: null });

    expect(db.prepare(`SELECT horizon, client_id, notes FROM initiatives WHERE id = 1`).get()).toEqual({
      horizon: "Siguiente",
      client_id: 1,
      notes: "nota",
    });
    const ev = db
      .prepare(`SELECT id, action, from_status, day FROM assignment_events ORDER BY id`)
      .all() as Array<{ id: number; action: string; from_status: string; day: string }>;
    expect(ev.map((e) => e.id)).toEqual([100, 101, 102, 103, 104]);
    expect(ev[0]).toEqual({ id: 100, action: "crear", from_status: "Backlog", day: "2026-08-30" });
    expect(ev[3].action).toBe("enviar_a_revision");
    expect(db.prepare(`SELECT blocked, created_at, updated_at FROM checkins WHERE id = 5`).get()).toEqual({
      blocked: "",
      created_at: "2026-09-01 18:00:00",
      updated_at: "2026-09-01 18:00:00",
    });

    // El índice que v1 reusa con OTRAS columnas quedó con la forma de v1, sobre la tabla nueva.
    const idx = indices(db).get("idx_assign_owner")!;
    expect(idx).toContain("assignments|");
    expect(idx).toMatch(/ON assignments\s*\(owner_wallet\)/);
  });

  it("(d) paridad con una base nueva: mismas tablas, columnas e índices, salvo el legado tolerado", () => {
    const db = baseDesplegada(file);
    prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, sembrar: false, ahora: AHORA });
    const nueva = openDb(":memory:");
    prepararSqlite(nueva, { archivo: null, sembrar: false });

    expect(tablas(db)).toEqual(tablas(nueva));
    for (const t of tablas(nueva)) {
      const sobran = columnas(db, t).filter((c) => !columnas(nueva, t).includes(c));
      const faltan = columnas(nueva, t).filter((c) => !columnas(db, t).includes(c));
      expect({ t, faltan }).toEqual({ t, faltan: [] });
      expect(sobran.every((c) => LEGADO_TOLERADO.includes(c))).toBe(true);
    }
    const iDb = indices(db);
    const iNueva = indices(nueva);
    for (const [nombre, def] of iNueva) expect({ nombre, def: iDb.get(nombre) }).toEqual({ nombre, def });
    expect([...iDb.keys()].filter((n) => !iNueva.has(n))).toEqual(INDICES_LEGADO_TOLERADOS);
  });

  it("(e) un valor desconocido aborta la copia (no se adivina) y no toca datos; corregido, arranca", () => {
    const db = baseDesplegada(file, { prioridadRara: true });
    const antes = huella(db);

    expect(() => prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, sembrar: false, ahora: AHORA })).toThrow(
      MigracionEquipoError
    );
    // Nada se copió a medias: las tablas v1 quedan vacías y el legado apartado, intacto.
    expect(cuenta(db, "assignments")).toBe(0);
    expect(cuenta(db, "assignment_events")).toBe(0);
    expect(cuenta(db, "_legado_assignments")).toBe(3);
    expect(cuenta(db, "_legado_assignment_events")).toBe(5);
    expect(huella(db)).toEqual(antes);
    // Y el respaldo previo existe para restaurar.
    expect(fs.readdirSync(dir).some((f) => f.includes(".pre-fusion-"))).toBe(true);

    // Una persona corrige la fila en el legado apartado; el siguiente arranque termina la copia.
    db.prepare(`UPDATE _legado_assignments SET priority = 'alta' WHERE id = 10`).run();
    const inf = prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, sembrar: false, ahora: AHORA });
    expect(inf.copiado).toEqual({ assignment_events: 5, checkins: 1, assignments: 3, initiatives: 2 });
    expect(tablas(db).filter((t) => t.startsWith("_legado_"))).toEqual([]);
    expect(huella(db)).toEqual(antes);
  });

  it("(e') un dueño que no está en users también aborta con un mensaje claro", () => {
    const db = baseDesplegada(file);
    db.prepare(`UPDATE assignments SET owner_wallet = 'GFANTASMA' WHERE id = 12`).run();
    expect(() => prepararSqlite(db, { archivo: file, founderWallet: JOHN_REAL, sembrar: false, ahora: AHORA })).toThrow(
      /dueño que no está en users/
    );
    expect(cuenta(db, "assignments")).toBe(0);
  });

  it("(e'') si el respaldo falla, no se migra nada", () => {
    const db = baseDesplegada(file);
    const antes = huella(db);
    // Directorio inexistente: VACUUM INTO no puede escribir el respaldo.
    const imposible = path.join(dir, "no-existe", "zelena.db");
    expect(() => prepararSqlite(db, { archivo: imposible, founderWallet: JOHN_REAL, sembrar: false })).toThrow(
      /No se pudo respaldar/
    );
    expect(columnas(db, "users")).not.toContain("users.role");
    expect(columnas(db, "assignments")).not.toContain("assignments.needs_founder");
    expect(huella(db)).toEqual(antes);
  });
});

describe("(f) CLA: el texto que se sirve es el que firmaron las altas reales", () => {
  const HASH_CLA = "03293c9378146cbd7fcbd49a0df467134a118d7a7e0379664c5d069c0398edb9";
  const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

  it("CLA.md de la raíz y apps/web/CLA.md son el mismo texto, con el hash 03293c93…", () => {
    expect(sha(path.join(process.cwd(), "..", "..", "CLA.md"))).toBe(HASH_CLA);
    expect(sha(path.join(process.cwd(), "CLA.md"))).toBe(HASH_CLA);
  });

  it("claCanonicalHash() sirve ese hash y nunca el texto de reserva", () => {
    expect(readClaText()).not.toContain("No se pudo cargar CLA.md");
    expect(claCanonicalHash()).toBe(HASH_CLA);
  });

  it(".gitattributes protege los dos CLA de conversiones de fin de línea", () => {
    const attrs = fs.readFileSync(path.join(process.cwd(), "..", "..", ".gitattributes"), "utf8");
    expect(attrs).toMatch(/^CLA\.md -text$/m);
    expect(attrs).toMatch(/^apps\/web\/CLA\.md -text$/m);
  });
});
