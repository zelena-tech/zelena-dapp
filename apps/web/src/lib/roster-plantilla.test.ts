/**
 * Hallazgo A8 (auditoría 2026-10-21) · el roster del código es una PLANTILLA de roles.
 *
 * El repo es público: `TEAM_ROSTER` ya no nombra personas (Founder, Operaciones…). Las
 * personas reales viven en la base de producción, sembradas por el código viejo con
 * otros slugs (`pending:<slug>`) y vinculadas con `roster_links`. Este test arranca la
 * app (la MISMA secuencia de `init()`) sobre una base con el esquema de producción y
 * las filas del roster VIEJO —con nombres ficticios: Ana, Beto, Caro…— y comprueba que:
 *  - el cambio de slugs no crea filas nuevas, ni en el primer arranque ni en el segundo;
 *  - ninguna fila pierde su vínculo y el founder se sigue reconociendo (por datos);
 *  - lo que dependía del roster sigue andando: nombres del CSV y del bot, vincular.
 * Y que la variable opcional `ZELENA_TEAM_ROSTER` solo añade lo que falta.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, prepararSqlite, type DB } from "./db";
import { ROSTER_ENV, TEAM_ROSTER, rosterConfigurado, rosterDelEntorno, type TeamActor } from "./roles";
import { hayRosterEnLaBase, seedTeamRoster } from "./team";
import { identidadesDe, principalFounder, slugsFounder } from "./identidades";
import { slugDelEquipo, vincularPrincipal, walletDelEquipoPorNombre } from "./talento";
import { resolverPersona } from "./team-import";
import { hintsFor } from "./bot-agent";

const LIB = path.join(process.cwd(), "src", "lib");
const FIXTURE = fs.readFileSync(path.join(LIB, "__fixtures__", "schema-58ee2fd.sql"), "utf8");

const FOUNDER_DEMO = "GA7ZELENAFOUNDERDEMOWALLET000000000000000000000000000AAA";
const ANA_REAL = "GANAREALFOUNDERWALLETAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // founder
const CARO_REAL = "GCAROREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // core vinculada
const DANI_REAL = "GDANIREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // core por vincular

/** El roster VIEJO tal como lo sembraba el código antes (slugs = nombres, ficticios aquí). */
const ROSTER_VIEJO = [
  { slug: "ana", name: "Ana", role: "founder", sup: 1 },
  { slug: "beto", name: "Beto", role: "core", sup: 1 },
  { slug: "caro", name: "Caro", role: "core", sup: 0 },
  { slug: "dani", name: "Dani", role: "core", sup: 0 },
  { slug: "eli", name: "Eli", role: "core", sup: 0 },
  { slug: "fede", name: "Fede", role: "core", sup: 0 },
] as const;

const cuenta = (db: DB, sql: string, ...p: unknown[]) => Number((db.prepare(sql).get(...p) as { n: number }).n);
const pendientes = (db: DB) =>
  (db.prepare(`SELECT wallet FROM users WHERE wallet LIKE 'pending:%' ORDER BY wallet`).all() as Array<{ wallet: string }>).map(
    (r) => r.wallet
  );
const huella = (db: DB) =>
  JSON.stringify([
    db.prepare(`SELECT wallet, display_name, role, is_supervisor, status FROM users ORDER BY wallet`).all(),
    db.prepare(`SELECT slug, wallet FROM roster_links ORDER BY slug`).all(),
    db.prepare(`SELECT id, owner_wallet FROM assignments ORDER BY id`).all(),
  ]);

/**
 * Base de producción: forma 58ee2fd migrada a v1 (sin sembrar) con las filas del
 * roster viejo, la fila del founder ya vinculada a su cuenta real (su `pending:` se
 * borró al vincular) y otra persona vinculada que conserva su `pending:` como alias.
 */
function baseConRosterViejo(file: string): DB {
  const db = openDb(file);
  db.exec(FIXTURE);
  db.exec(`
    INSERT INTO users (wallet, display_name, is_demo, is_founder, cla_signed, created_at) VALUES
      ('${FOUNDER_DEMO}', 'Founder demo', 1, 1, 1, '2026-08-01 10:00:00'),
      ('${ANA_REAL}', 'Ana', 0, 0, 1, '2026-08-02 10:00:00'),
      ('${CARO_REAL}', 'Caro', 0, 0, 1, '2026-08-03 10:00:00'),
      ('${DANI_REAL}', 'Dani R', 0, 0, 1, '2026-08-04 10:00:00');
  `);
  prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL, sembrar: false });

  const ins = db.prepare(
    `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor)
     VALUES (?, ?, 'Bronze', NULL, 'active', 0, 0, 0, ?, ?)`
  );
  for (const m of ROSTER_VIEJO) ins.run(`pending:${m.slug}`, m.name, m.role, m.sup);
  db.prepare(`UPDATE users SET role = 'core' WHERE wallet IN (?, ?)`).run(CARO_REAL, DANI_REAL);
  // La fila del founder se vinculó y su pending se borró; la de Caro se vinculó y quedó como alias.
  db.prepare(`DELETE FROM users WHERE wallet = 'pending:ana'`).run();
  db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('ana', ?, ?)`).run(ANA_REAL, ANA_REAL);
  db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('caro', ?, ?)`).run(CARO_REAL, ANA_REAL);
  // Trabajo a nombre de las filas del roster.
  db.prepare(`INSERT INTO initiatives (id, slug, name, horizon) VALUES (900, 'interno-x', 'Interno X', 'Ahora')`).run();
  const asig = db.prepare(
    `INSERT INTO assignments (id, title, description, initiative_id, owner_wallet, status, priority, created_by)
     VALUES (?, ?, '', 900, ?, 'Asignada', 'Normal', ?)`
  );
  asig.run(9001, "Pieza de Beto", "pending:beto", ANA_REAL);
  asig.run(9002, "Pieza de Caro", CARO_REAL, ANA_REAL);
  asig.run(9003, "Pieza de Dani", "pending:dani", ANA_REAL);
  return db;
}

describe("A8 · arranque sobre producción con el roster viejo (nombres ficticios)", () => {
  let dir: string;
  let file: string;
  const ENV_ANTES = process.env[ROSTER_ENV];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-roster-"));
    file = path.join(dir, "zelena.db");
    delete process.env[ROSTER_ENV];
  });
  afterEach(() => {
    if (ENV_ANTES === undefined) delete process.env[ROSTER_ENV];
    else process.env[ROSTER_ENV] = ENV_ANTES;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows puede retener el archivo */
    }
  });

  it("la base tiene roster: la plantilla no inserta ni una fila, en el primer arranque ni en el segundo", () => {
    const db = baseConRosterViejo(file);
    expect(hayRosterEnLaBase(db)).toBe(true);
    const antes = { pendientes: pendientes(db), usuarios: cuenta(db, `SELECT COUNT(*) AS n FROM users`), h: huella(db) };

    prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL }); // con siembra: lo mismo que init()
    expect(pendientes(db)).toEqual(antes.pendientes);
    expect(cuenta(db, `SELECT COUNT(*) AS n FROM users`)).toBe(antes.usuarios);
    // Ninguna fila de la plantilla (founder, operaciones…) apareció en la base.
    for (const m of TEAM_ROSTER) {
      expect(cuenta(db, `SELECT COUNT(*) AS n FROM users WHERE wallet = ?`, `pending:${m.slug}`), m.slug).toBe(0);
    }
    expect(huella(db)).toBe(antes.h);

    prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL });
    expect(huella(db)).toBe(antes.h);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);
  });

  it("el founder se sigue reconociendo por datos (su slug viejo vinculado) y nadie pierde su vínculo", () => {
    const db = baseConRosterViejo(file);
    prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL });
    expect(slugsFounder(db)).toEqual(["ana"]);
    expect(principalFounder(db)).toBe(ANA_REAL);
    expect(identidadesDe(db, ANA_REAL)).toContain(FOUNDER_DEMO);
    // La fila vinculada sigue unida a su cuenta real (alias) y su trabajo, donde estaba.
    expect(identidadesDe(db, CARO_REAL)).toEqual([CARO_REAL, "pending:caro"].sort());
    expect(db.prepare(`SELECT slug, wallet FROM roster_links ORDER BY slug`).all()).toEqual([
      { slug: "ana", wallet: ANA_REAL },
      { slug: "caro", wallet: CARO_REAL },
    ]);
  });

  it("los nombres del CSV y del bot salen de la base: slug viejo, nombre visible o cuenta vinculada", () => {
    const db = baseConRosterViejo(file);
    prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL });
    expect(slugDelEquipo(db, "beto")).toBe("beto");
    expect(walletDelEquipoPorNombre(db, "Beto")).toBe("pending:beto");
    expect(walletDelEquipoPorNombre(db, "caro")).toBe(CARO_REAL); // el slug va a la cuenta vinculada
    expect(walletDelEquipoPorNombre(db, "Fede")).toBe("pending:fede");
    expect(walletDelEquipoPorNombre(db, "Nadie")).toBeNull();
    expect(resolverPersona(db, "Eli")).toBe("pending:eli");
    // Un nombre de la plantilla no inventa a nadie en esta base.
    expect(walletDelEquipoPorNombre(db, "Operaciones")).toBeNull();
    // El bot recibe las personas desde la base, no desde el código.
    const hints = hintsFor(db, {
      actor: { wallet: ANA_REAL, name: "Ana", role: "founder", isSupervisor: true },
      canWrite: true,
      now: new Date("2026-10-21T15:00:00Z"),
      equipo: null,
    });
    for (const n of ["Ana", "Beto", "Caro", "Dani", "Eli", "Fede"]) expect(hints).toContain(n);
    expect(hints).not.toMatch(/Operaciones|Plataforma|Finanzas/);
  });

  it("una fila del roster viejo se sigue vinculando con su cuenta real", () => {
    const db = baseConRosterViejo(file);
    prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL });
    const founder: TeamActor = { wallet: ANA_REAL, name: "Ana", role: "founder", isSupervisor: true };
    vincularPrincipal(db, founder, { slug: "dani", wallet: DANI_REAL });
    expect(db.prepare(`SELECT owner_wallet FROM assignments WHERE id = 9003`).get()).toEqual({ owner_wallet: DANI_REAL });
    expect(walletDelEquipoPorNombre(db, "dani")).toBe(DANI_REAL);
    // Y el arranque siguiente no la recrea.
    prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL });
    expect(pendientes(db)).not.toContain("pending:dani");
  });

  it("con ZELENA_TEAM_ROSTER (los slugs viejos) solo se añade lo que falta y se respeta roster_links", () => {
    const db = baseConRosterViejo(file);
    db.prepare(`DELETE FROM users WHERE wallet = 'pending:fede'`).run(); // una fila que falta
    process.env[ROSTER_ENV] = JSON.stringify([
      ...ROSTER_VIEJO.map((m) => ({ slug: m.slug, name: m.name, role: m.role, isSupervisor: m.sup === 1 })),
      { slug: "gabi", name: "Gabi", role: "core" },
    ]);
    const antes = pendientes(db);
    prepararSqlite(db, { archivo: file, founderWallet: ANA_REAL });
    // Vuelve la que faltaba y entra la nueva; 'ana' (vinculada) no se recrea; nada se duplica.
    expect(pendientes(db)).toEqual([...antes, "pending:fede", "pending:gabi"].sort());
    expect(pendientes(db)).not.toContain("pending:ana");
    expect(cuenta(db, `SELECT COUNT(*) AS n FROM users WHERE wallet = 'pending:beto'`)).toBe(1);
  });
});

describe("A8 · plantilla y variable de entorno", () => {
  it("una base sin roster recibe la plantilla de roles, una sola vez", () => {
    const db = openDb(":memory:");
    db.exec(fs.readFileSync(path.join(LIB, "schema.sql"), "utf8"));
    expect(hayRosterEnLaBase(db)).toBe(false);
    seedTeamRoster(db, {});
    seedTeamRoster(db, {});
    expect(pendientes(db)).toEqual(TEAM_ROSTER.map((m) => `pending:${m.slug}`).sort());
    expect(slugsFounder(db)).toEqual(["founder"]);
  });

  it("la plantilla son roles: ningún nombre de persona, ni correos", () => {
    expect(TEAM_ROSTER.map((m) => m.name)).toEqual(["Founder", "Operaciones", "Finanzas", "Producto", "Plataforma", "Contenido"]);
    expect(JSON.stringify(TEAM_ROSTER)).not.toMatch(/@/);
  });

  it("ZELENA_TEAM_ROSTER válido manda; inválido o vacío cae a la plantilla sin copiar el valor al log", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const bueno = { [ROSTER_ENV]: JSON.stringify([{ slug: "x-1", name: "Equis", role: "core", aliases: ["Equis", "X"] }]) };
    expect(rosterConfigurado(bueno)).toEqual({
      deEntorno: true,
      miembros: [{ slug: "x-1", name: "Equis", role: "core", isSupervisor: false, domain: "", aliases: ["Equis", "X"] }],
    });
    for (const malo of ["no es json", "[]", '[{"slug":"Con Espacio","name":"A","role":"core"}]', '[{"slug":"a","name":"A","role":"jefe"}]', '[{"slug":"a","name":"A","role":"core"},{"slug":"a","name":"B","role":"core"}]']) {
      expect(rosterDelEntorno({ [ROSTER_ENV]: malo }), malo).toBeNull();
    }
    expect(rosterConfigurado({})).toEqual({ deEntorno: false, miembros: TEAM_ROSTER });
    for (const llamada of aviso.mock.calls) expect(String(llamada[0])).not.toContain("Con Espacio");
    aviso.mockRestore();
  });

  it(".env.example documenta la variable sin valor", () => {
    const ejemplo = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    expect(ejemplo).toMatch(new RegExp(`^# ${ROSTER_ENV}=$`, "m"));
  });
});
