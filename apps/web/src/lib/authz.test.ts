/**
 * Autorización por ROL, no por persona (hallazgos D1-02 / D3-01 / D3-02 de la
 * auditoría v1).
 *
 * Las tres invariantes que fija este archivo:
 *  1. El founder que entra por la puerta corporativa (principal `pending:john`, NO
 *     `FOUNDER_WALLET`) conserva la administración. Era el bug latente que detonaba
 *     al encender WP13.
 *  2. La autoridad es la tabla `users`, no la cookie: una cookie que MIENTE
 *     diciéndose founder no administra.
 *  3. `/equipo` es del equipo interno: un `contributor` de la comunidad no entra,
 *     porque `/equipo/proyectos` expone el backlog completo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty, demoInvitesAllowed } from "./seed";
import { adminActor, equipoInternoActor, rolPuedeAdministrar, claimsPuedenAdministrar } from "./authz";
import { esEquipoInterno, pendingPrincipal } from "./roles";
import { FOUNDER_WALLET } from "./config";

function seededDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  return db;
}

/** Sesión mínima; `role` a propósito ausente salvo que el test lo fije. */
function sesion(wallet: string, extra: Record<string, unknown> = {}) {
  return { wallet, name: "quien sea", ...extra } as Parameters<typeof adminActor>[0];
}

describe("regla pura de administración", () => {
  it("solo founder administra; core, supervisora y contributor no", () => {
    expect(rolPuedeAdministrar("founder")).toBe(true);
    expect(rolPuedeAdministrar("core")).toBe(false);
    expect(rolPuedeAdministrar("contributor")).toBe(false);
    // Supervisar no es administrar: ver el trabajo del equipo para destrabarlo no
    // es cerrar épocas ni mutar el genoma.
    expect(claimsPuedenAdministrar({ role: "core", isSupervisor: true })).toBe(false);
  });

  it("equipo interno incluye core y supervisores, nunca a un contributor", () => {
    expect(esEquipoInterno({ role: "founder" })).toBe(true);
    expect(esEquipoInterno({ role: "core" })).toBe(true);
    expect(esEquipoInterno({ role: "core", isSupervisor: true })).toBe(true);
    expect(esEquipoInterno({ role: "contributor" })).toBe(false);
    expect(esEquipoInterno({})).toBe(false); // cookie vieja sin claims
  });
});

describe("adminActor: gate contra la base", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("D3-01 · el founder que entra por Entra (pending:john) SÍ administra", () => {
    const principal = pendingPrincipal("john");
    // Precondición del bug: su principal NO es FOUNDER_WALLET.
    expect(principal).not.toBe(FOUNDER_WALLET);
    const row = db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(principal) as
      | { role: string }
      | undefined;
    expect(row?.role).toBe("founder");

    const actor = adminActor(sesion(principal), db);
    expect(actor).not.toBeNull();
    expect(actor?.role).toBe("founder");
  });

  it("el founder del seed (FOUNDER_WALLET) sigue administrando", () => {
    expect(adminActor(sesion(FOUNDER_WALLET), db)).not.toBeNull();
  });

  it("una cookie que MIENTE diciéndose founder no administra", () => {
    const fausto = pendingPrincipal("fausto");
    const actor = adminActor(sesion(fausto, { role: "founder", isFounder: true, isSupervisor: true }), db);
    expect(actor).toBeNull(); // la fila dice `core`, y la fila manda
  });

  it("un core y una supervisora no administran; sin sesión tampoco", () => {
    expect(adminActor(sesion(pendingPrincipal("fausto")), db)).toBeNull();
    expect(adminActor(sesion(pendingPrincipal("vale")), db)).toBeNull(); // core + supervisora
    expect(adminActor(null, db)).toBeNull();
  });
});

describe("equipoInternoActor: gate de /equipo", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("los 6 del roster entran al módulo equipo", () => {
    for (const slug of ["john", "vale", "juan", "david", "fausto", "angela"]) {
      expect(equipoInternoActor(sesion(pendingPrincipal(slug)), db), slug).not.toBeNull();
    }
  });

  it("D3-02 · un contribuidor de la comunidad NO entra (el backlog no se le muestra)", () => {
    const demo = db
      .prepare(`SELECT wallet FROM users WHERE role = 'contributor' AND is_demo = 1 LIMIT 1`)
      .get() as { wallet: string } | undefined;
    expect(demo?.wallet).toBeTruthy();
    expect(equipoInternoActor(sesion(demo!.wallet), db)).toBeNull();
  });

  it("un usuario que no existe en la base no entra ni con claims inflados", () => {
    expect(equipoInternoActor(sesion("GDESCONOCIDO", { role: "core" }), db)).toBeNull();
  });
});

describe("demoInvitesAllowed: los códigos GENESIS no existen en producción", () => {
  it("en producción NO se siembran; con SEED_DEMO=1 sí; fuera de producción sí", () => {
    expect(demoInvitesAllowed({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(demoInvitesAllowed({ NODE_ENV: "production", SEED_DEMO: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(demoInvitesAllowed({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(demoInvitesAllowed({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it("en desarrollo el seed sí deja las 6 invitaciones GENESIS utilizables", () => {
    const db = seededDb(); // NODE_ENV de vitest no es production
    const n = (
      db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE code LIKE 'GENESIS-%'`).get() as { n: number }
    ).n;
    expect(n).toBe(6);
  });
});
