/**
 * WP31-E1 · cifras en vivo de la landing (criterio E1-12): solo lo real. Ni las
 * cuentas de prueba ni las firmas sembradas con `SEEDTX_…` cuentan.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { cifrasEnVivo } from "./prueba-en-vivo";

const TX_1 = "1".repeat(64);
const TX_2 = "ab".repeat(32);
const TX_DEMO = "c".repeat(64);

function baseSembrada(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db, {} as NodeJS.ProcessEnv);
  return db;
}

function usuario(db: DB, wallet: string, isDemo: 0 | 1): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, is_demo, cla_signed, role) VALUES (?, ?, ?, 1, 'contributor')`
  ).run(wallet, wallet, isDemo);
}

function firma(db: DB, wallet: string, tx: string | null): void {
  db.prepare(
    `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature, anchor_status, tx_id) VALUES (?, 1, ?, 'sig', ?, ?)`
  ).run(wallet, "h".repeat(64), tx ? "anchored" : "pending", tx);
}

function proyectoConHitoAprobado(db: DB, asignado: string | null): void {
  const supervisor = (db.prepare(`SELECT wallet FROM users ORDER BY wallet LIMIT 1`).get() as { wallet: string }).wallet;
  const r = db
    .prepare(
      `INSERT INTO projects (campaign, title, type, budget_usd, weeks, state, supervisor_wallet, assignee_wallet, summary, description, acceptance)
       VALUES ('Prueba', 'Proyecto de prueba', 'DAO', 100, 2, 'Assigned', ?, ?, 's', 'd', 'a')`
    )
    .run(supervisor, asignado);
  db.prepare(
    `INSERT INTO milestones (project_id, ord, code, name, week, pct, amount_usd, approved) VALUES (?, 1, 'M1', 'Hito', '1', 100, 100, 1)`
  ).run(Number(r.lastInsertRowid));
}

function tarea(db: DB, dueno: string, acciones: string[]): void {
  const r = db
    .prepare(`INSERT INTO assignments (title, owner_wallet, status) VALUES ('Entrega de prueba', ?, 'Hecha')`)
    .run(dueno);
  const id = Number(r.lastInsertRowid);
  for (const a of acciones) {
    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, actor_wallet, day) VALUES (?, ?, 'En revisión', 'Hecha', ?, '2026-10-01')`
    ).run(id, a, dueno);
  }
}

let db: DB;
beforeEach(() => {
  db = baseSembrada();
});

describe("cifrasEnVivo", () => {
  it("la base sembrada (cuentas demo y SEEDTX) no suma ni firmas ni entregas", () => {
    const c = cifrasEnVivo(db);
    expect(c.firmasRegistradas).toBe(0);
    expect(c.entregasAprobadas).toBe(0);
    expect(c.ultimaFirmaAnclada).toBeNull();
    const abiertos = (db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE state = 'Open'`).get() as { n: number }).n;
    expect(c.proyectosAbiertos).toBe(abiertos);
  });

  it("las firmas de cuentas reales con una tx de Stellar cuentan; demo y SEEDTX no", () => {
    usuario(db, "GREAL1", 0);
    usuario(db, "GREAL2", 0);
    usuario(db, "GREAL3", 0);
    usuario(db, "GDEMO1", 1);
    firma(db, "GREAL1", TX_1);
    firma(db, "GDEMO1", TX_DEMO); // cuenta de prueba: no cuenta aunque el hash sea válido
    firma(db, "GREAL2", "SEEDTX_GREAL2_ANCHORED_0009"); // sembrada: no cuenta
    firma(db, "GREAL3", null); // pendiente de anclar: no cuenta
    let c = cifrasEnVivo(db);
    expect(c.firmasRegistradas).toBe(1);
    expect(c.ultimaFirmaAnclada?.tx).toBe(TX_1);
    expect(c.ultimaFirmaAnclada?.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    usuario(db, "GREAL4", 0);
    firma(db, "GREAL4", TX_2);
    c = cifrasEnVivo(db);
    expect(c.firmasRegistradas).toBe(2);
    expect(c.ultimaFirmaAnclada?.tx).toBe(TX_2); // la más reciente
  });

  it("entregas aprobadas: hitos del Ágora y tareas del equipo, solo de cuentas reales", () => {
    usuario(db, "GREAL1", 0);
    usuario(db, "GDEMO1", 1);
    proyectoConHitoAprobado(db, "GREAL1"); // +1
    proyectoConHitoAprobado(db, "GDEMO1"); // demo: no
    proyectoConHitoAprobado(db, null); // sin nadie asignado: no
    tarea(db, "GREAL1", ["enviar_a_revision", "aprobar"]); // +1
    tarea(db, "GDEMO1", ["aprobar"]); // demo: no
    tarea(db, "GREAL1", ["empezar"]); // no aprobada: no
    expect(cifrasEnVivo(db).entregasAprobadas).toBe(2);
  });

  it("un hito de un proyecto sembrado aprobado a una cuenta demo no cuenta", () => {
    const sembrado = db
      .prepare(`SELECT p.id AS id FROM projects p ORDER BY p.id LIMIT 1`)
      .get() as { id: number };
    const demo = (db.prepare(`SELECT wallet FROM users WHERE is_demo = 1 LIMIT 1`).get() as { wallet: string }).wallet;
    db.prepare(`UPDATE projects SET assignee_wallet = ?, state = 'Assigned' WHERE id = ?`).run(demo, sembrado.id);
    db.prepare(`UPDATE milestones SET approved = 1 WHERE project_id = ?`).run(sembrado.id);
    expect(cifrasEnVivo(db).entregasAprobadas).toBe(0);
  });
});
