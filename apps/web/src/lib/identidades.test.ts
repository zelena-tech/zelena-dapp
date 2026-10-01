import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedTeam } from "./team";
import { identidadesDe, mismaPersona, principalFounder, reglaB8 } from "./identidades";

const SESION = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // wallet con la que entra el founder
const DEMO = "GA7ZELENAFOUNDERDEMOWALLET000000000000000000000000000AAA"; // fila demo con rol founder
const ALUMNI = "GFOUNDERALUMNIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ANA = "GANACONTRIBUIDORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const VALE_REAL = "GVALEREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const JOHN_REAL = "GJOHNREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

function usuario(db: DB, wallet: string, o: { role?: string; status?: string; isDemo?: number } = {}): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, ?, ?, ?, ?, 1)`
  ).run(wallet, wallet.slice(0, 8), o.role ?? "contributor", o.status ?? "active", o.isDemo ?? 0);
}

/** Vincula una fila del roster como lo hará `vincularPrincipal` (A2): la pending desaparece. */
function vincular(db: DB, slug: string, wallet: string, role: string): void {
  usuario(db, wallet, { role });
  db.prepare(`DELETE FROM users WHERE wallet = ?`).run(`pending:${slug}`);
  db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES (?, ?, ?)`).run(slug, wallet, SESION);
}

describe("identidades (WP31 §5.0, criterio B1c)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    seedTeam(db); // roster: pending:john (founder), pending:vale (core + supervisión), …
    usuario(db, SESION, { role: "founder" });
    usuario(db, DEMO, { role: "founder", isDemo: 1 });
    usuario(db, ALUMNI, { role: "founder", status: "alumni" });
    usuario(db, ANA);
  });

  it("principalFounder: la fila pending del slug founder del roster mientras no se vincule", () => {
    expect(principalFounder(db)).toBe("pending:john");
  });

  it("principalFounder: la wallet vinculada por roster_links, y null si no hay ninguna", () => {
    vincular(db, "john", JOHN_REAL, "founder");
    expect(principalFounder(db)).toBe(JOHN_REAL);
    expect(principalFounder(freshDb())).toBeNull();
  });

  it("founder con fila de sesión + pending:<slug>: son la misma persona en las dos direcciones", () => {
    const esperado = [DEMO, SESION, "pending:john"].sort();
    expect(identidadesDe(db, SESION)).toEqual(esperado);
    expect(identidadesDe(db, "pending:john")).toEqual(esperado);
    expect(mismaPersona(db, SESION, "pending:john")).toBe(true);
    expect(mismaPersona(db, "pending:john", SESION)).toBe(true);
    // Una fila founder que ya no está activa no entra en la lista…
    expect(identidadesDe(db, SESION)).not.toContain(ALUMNI);
    // …pero sigue siendo la misma persona (mismaPersona es simétrica).
    expect(mismaPersona(db, ALUMNI, SESION)).toBe(true);
    expect(mismaPersona(db, SESION, ALUMNI)).toBe(true);
  });

  it("founder vinculado: su wallet real, su pending y su sesión son la misma persona", () => {
    vincular(db, "john", JOHN_REAL, "founder");
    expect(identidadesDe(db, JOHN_REAL)).toEqual([DEMO, JOHN_REAL, SESION, "pending:john"].sort());
    expect(identidadesDe(db, SESION)).toEqual([DEMO, JOHN_REAL, SESION].sort());
    expect(mismaPersona(db, SESION, JOHN_REAL)).toBe(true);
    expect(mismaPersona(db, "pending:john", SESION)).toBe(true);
  });

  it("slug vinculado por roster_links: la pending y la wallet real son la misma persona", () => {
    expect(identidadesDe(db, "pending:vale")).toEqual(["pending:vale"]);
    vincular(db, "vale", VALE_REAL, "core");
    expect(identidadesDe(db, VALE_REAL)).toEqual([VALE_REAL, "pending:vale"]);
    expect(identidadesDe(db, "pending:vale")).toEqual([VALE_REAL, "pending:vale"]);
    expect(mismaPersona(db, VALE_REAL, "pending:vale")).toBe(true);
    // Vale no es el founder: ninguna identidad del founder es suya.
    expect(mismaPersona(db, VALE_REAL, SESION)).toBe(false);
    expect(mismaPersona(db, "pending:vale", "pending:john")).toBe(false);
  });

  it("persona normal = solo ella", () => {
    expect(identidadesDe(db, ANA)).toEqual([ANA]);
    expect(identidadesDe(db, "pending:david")).toEqual(["pending:david"]);
    expect(mismaPersona(db, ANA, SESION)).toBe(false);
    expect(mismaPersona(db, ANA, "pending:john")).toBe(false);
    expect(mismaPersona(db, ANA, "pending:david")).toBe(false);
    expect(mismaPersona(db, ANA, ANA)).toBe(true);
    // Una wallet que no está en la base sigue siendo ella misma, y nada más.
    expect(identidadesDe(db, "GDESCONOCIDA")).toEqual(["GDESCONOCIDA"]);
    expect(mismaPersona(db, "", "")).toBe(false);
  });

  it("reglaB8: simétrica, sobre todas las identidades, con el founder exento como quien revisa y como dueño", () => {
    const INVITA = "GINVITAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    usuario(db, INVITA);
    const invito = (por: string, a: string) => db.prepare(`UPDATE users SET invited_by = ? WHERE wallet = ?`).run(por, a);
    const nada = { founderExento: false, vinculoInvitacion: false };
    const vinculo = { founderExento: false, vinculoInvitacion: true };
    const exento = { founderExento: true, vinculoInvitacion: false };

    // Las dos direcciones.
    invito(INVITA, ANA);
    expect(reglaB8(db, INVITA, ANA)).toEqual(vinculo);
    expect(reglaB8(db, ANA, INVITA)).toEqual(vinculo);
    expect(reglaB8(db, ANA, "pending:david")).toEqual(nada);

    // Todas las identidades: la fila de equipo de Vale entró invitada por INVITA y Vale ya
    // entra con su cuenta real (vinculada sin borrar la fila de equipo).
    invito(INVITA, "pending:vale");
    usuario(db, VALE_REAL, { role: "core" });
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('vale', ?, ?)`).run(VALE_REAL, SESION);
    expect(reglaB8(db, INVITA, VALE_REAL)).toEqual(vinculo);
    expect(reglaB8(db, VALE_REAL, INVITA)).toEqual(vinculo);

    // El founder, con cualquiera de sus identidades, exento en las dos direcciones: como
    // quien invitó (sesión o fila de equipo) y revisa, y como dueño revisado por su invitado.
    invito(SESION, "pending:david");
    invito("pending:john", "pending:fausto");
    for (const founder of [SESION, "pending:john", DEMO]) {
      for (const invitado of ["pending:david", "pending:fausto"]) {
        expect(reglaB8(db, founder, invitado)).toEqual(exento);
        expect(reglaB8(db, invitado, founder)).toEqual(exento);
      }
    }
    // Vinculado a su cuenta real, igual (lo reconoce el roster aunque esa fila no diga founder).
    usuario(db, JOHN_REAL, { role: "core" });
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES ('john', ?, ?)`).run(JOHN_REAL, SESION);
    invito(JOHN_REAL, ANA);
    expect(reglaB8(db, ANA, JOHN_REAL)).toEqual(exento);

    expect(reglaB8(db, "", ANA)).toEqual(nada);
    expect(reglaB8(db, ANA, "")).toEqual(nada);
  });

  it("sin duplicados y ordenadas", () => {
    const ids = identidadesDe(db, SESION);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("estático: reconoce al founder por rol y roster (nunca FOUNDER_WALLET), solo lee y no arrastra node:", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "identidades.ts"), "utf8");
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/FOUNDER_WALLET/);
    expect(codigo).not.toMatch(/\b(UPDATE|DELETE|INSERT)\b/);
    expect(codigo).not.toMatch(/node:|from "\.\/crypto|from "\.\/session/);
    // De db.ts solo el tipo (la cadena de team.ts llega a un componente de cliente).
    expect(codigo).toMatch(/import type \{ DB \} from "\.\/db"/);
    expect(codigo).not.toMatch(/^import \{[^}]*\} from "\.\/db"/m);
    // Imports de valor con sufijo .ts (CLI con type-stripping).
    for (const m of codigo.matchAll(/^import (?!type)[^;]* from "(\.[^"]+)";/gm)) expect(m[1]).toMatch(/\.ts$/);
  });
});
