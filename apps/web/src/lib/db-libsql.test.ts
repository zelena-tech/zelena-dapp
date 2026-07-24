/**
 * WP03: el driver libSQL (paquete `libsql`, síncrono) debe satisfacer EXACTAMENTE
 * la misma interfaz que el driver por defecto. Corre contra un archivo libSQL local.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openLibsql, type DB } from "./db";
import { generateInvite, consumeInvite, countActiveInvites, InviteConsumeError } from "./invites";
import { seedGenomeV1, getActiveGenome } from "./genome";
import { seedIfEmpty } from "./seed";

const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
const ISSUER = "GISSUERLIBSQLDEMO000000000000000000000000000000000000000A";
const NEWUSER = "GNEWUSERLIBSQLDEMO00000000000000000000000000000000000000A";

function cleanup(file: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      fs.unlinkSync(file + suffix);
    } catch {
      /* no existe */
    }
  }
}

describe("driver libSQL (archivo local) — paridad síncrona (WP03)", () => {
  let db: DB;
  let file: string;

  beforeAll(() => {
    file = path.join(os.tmpdir(), `zelena-libsql-test-${process.pid}.db`);
    cleanup(file);
    db = openLibsql(file);
    db.pragma("foreign_keys = ON");
    db.exec(schema);
  });

  afterAll(() => cleanup(file));

  it("prepare().run/get/all y exec funcionan síncronamente", () => {
    const info = db
      .prepare(`INSERT INTO users (wallet, display_name, tier, is_demo, cla_signed) VALUES (?, 'Ada', 'Bronze', 1, 1)`)
      .run("GLIBSQLADADEMO00000000000000000000000000000000000000000AA");
    expect(Number(info.changes)).toBe(1);
    const row = db
      .prepare(`SELECT display_name FROM users WHERE wallet = ?`)
      .get("GLIBSQLADADEMO00000000000000000000000000000000000000000AA") as { display_name: string };
    expect(row.display_name).toBe("Ada");
    expect(db.prepare(`SELECT wallet FROM users`).all().length).toBeGreaterThanOrEqual(1);
  });

  it("transaction() y consumo atómico de invitación se comportan igual que en SQLite", () => {
    const code = generateInvite(db, ISSUER, "Bronze");
    expect(countActiveInvites(db, ISSUER)).toBe(1);
    const issuer = consumeInvite(db, code, NEWUSER);
    expect(issuer).toBe(ISSUER);
    expect(countActiveInvites(db, ISSUER)).toBe(0);
    expect(() => consumeInvite(db, code, "GLATE000000000000000000000000000000000000000000000000000A")).toThrow(
      InviteConsumeError
    );
  });

  it("el genoma versionado se lee correctamente sobre libSQL", () => {
    db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1,'E',0,0,'Open')`).run();
    seedGenomeV1(db);
    const g = getActiveGenome(db, 1);
    expect(g.EPOCH_BUDGET).toBe(100_000);
    expect(g.TIER_INVITE_CAPS.Gold).toBe(10);
  });

  it("el flujo de seed completo (init) corre sobre libSQL local — reproducible", () => {
    const seedFile = path.join(os.tmpdir(), `zelena-libsql-seed-${process.pid}.db`);
    cleanup(seedFile);
    const sdb = openLibsql(seedFile);
    sdb.pragma("foreign_keys = ON");
    sdb.exec(schema);
    seedIfEmpty(sdb);

    const users = (sdb.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    const projects = (sdb.prepare(`SELECT COUNT(*) AS n FROM projects`).get() as { n: number }).n;
    const genome = (sdb.prepare(`SELECT COUNT(*) AS n FROM genome_versions WHERE version = 1`).get() as { n: number }).n;
    expect(users).toBeGreaterThanOrEqual(4);
    expect(projects).toBeGreaterThanOrEqual(5);
    expect(genome).toBe(1);
    // Idempotente: correr de nuevo no duplica.
    seedIfEmpty(sdb);
    expect((sdb.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(users);
    cleanup(seedFile);
  });
});
