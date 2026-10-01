/**
 * Bandeja de avisos (WP31 §5.C.2): criterio C1-10. Cada persona ve y marca solo lo
 * suyo, sumando todas sus identidades; el esquema no guarda "cuándo leyó".
 * Personas ficticias; base en memoria con el esquema real.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal } from "./roles";
import { seedTeam } from "./team";
import { avisosDe, contarNoLeidos, crearAviso, enlacesDeAvisos, marcarLeidos } from "./avisos";

const ANA = "GANAEJECUTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const RITA = "GRITAREVISAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SESION_FOUNDER = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const JOHN = pendingPrincipal("john");

const AHORA = new Date("2026-10-05T15:00:00.000Z");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

function usuario(db: DB, wallet: string, role = "contributor"): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, ?, ?, 'active', 0, 1)`
  ).run(wallet, wallet.slice(1, 6), role);
}

function aviso(db: DB, wallet: string, clave: string, assignmentId: number | null = null): boolean {
  return crearAviso(db, { wallet, clave, tipo: "vencida", assignmentId, texto: `«Pieza ${clave}» (P3) vence hoy.` }, AHORA);
}

let db: DB;
beforeEach(() => {
  db = freshDb();
  usuario(db, ANA);
  usuario(db, RITA);
  usuario(db, SESION_FOUNDER, "founder");
});

describe("crearAviso", () => {
  it("es idempotente por (wallet, clave) y escribe created_at con el instante inyectado", () => {
    expect(aviso(db, ANA, "vencida:1:2026-10-05")).toBe(true);
    expect(aviso(db, ANA, "vencida:1:2026-10-05")).toBe(false);
    expect(aviso(db, RITA, "vencida:1:2026-10-05")).toBe(true); // otra persona, otra fila
    const filas = db.prepare(`SELECT wallet, created_at FROM avisos ORDER BY id`).all() as Array<{ created_at: string }>;
    expect(filas).toHaveLength(2);
    expect(filas[0].created_at).toBe("2026-10-05 15:00:00");
  });
});

describe("C1-10 · cada persona ve y marca solo lo suyo", () => {
  it("avisosDe y contarNoLeidos devuelven solo los propios", () => {
    aviso(db, ANA, "a");
    aviso(db, ANA, "b");
    aviso(db, RITA, "c");
    expect(avisosDe(db, ANA).map((a) => a.clave).sort()).toEqual(["a", "b"]);
    expect(avisosDe(db, RITA).map((a) => a.clave)).toEqual(["c"]);
    expect(contarNoLeidos(db, ANA)).toBe(2);
    expect(avisosDe(db, "GNOEXISTE")).toEqual([]);
  });

  it("marcarLeidos con ids ajenos no toca los de otra persona", () => {
    aviso(db, ANA, "a");
    aviso(db, RITA, "c");
    const deRita = avisosDe(db, RITA)[0].id;
    expect(marcarLeidos(db, ANA, [deRita])).toBe(0);
    expect(contarNoLeidos(db, RITA)).toBe(1);
    const deAna = avisosDe(db, ANA)[0].id;
    expect(marcarLeidos(db, ANA, [deAna, deRita, -3, 0])).toBe(1);
    expect(contarNoLeidos(db, ANA)).toBe(0);
    expect(contarNoLeidos(db, RITA)).toBe(1);
  });

  it("marcarLeidos sin ids marca todos los propios y nada más", () => {
    aviso(db, ANA, "a");
    aviso(db, ANA, "b");
    aviso(db, RITA, "c");
    expect(marcarLeidos(db, ANA)).toBe(2);
    expect(marcarLeidos(db, ANA)).toBe(0);
    expect(contarNoLeidos(db, RITA)).toBe(1);
  });

  it("suma todas las identidades: el founder ve y marca los de su fila de equipo", () => {
    aviso(db, JOHN, "equipo"); // avisos del principal de equipo (pending:john)
    aviso(db, SESION_FOUNDER, "sesion");
    expect(avisosDe(db, SESION_FOUNDER).map((a) => a.clave).sort()).toEqual(["equipo", "sesion"]);
    expect(contarNoLeidos(db, SESION_FOUNDER)).toBe(2);
    expect(marcarLeidos(db, SESION_FOUNDER)).toBe(2);
    expect(contarNoLeidos(db, JOHN)).toBe(0);
  });

  it("los no leídos van primero y se respeta el límite", () => {
    for (const c of ["a", "b", "c"]) aviso(db, ANA, c);
    const primero = avisosDe(db, ANA).find((a) => a.clave === "c");
    marcarLeidos(db, ANA, [primero!.id]);
    const lista = avisosDe(db, ANA);
    expect(lista.map((a) => a.is_leido)).toEqual([0, 0, 1]);
    expect(avisosDe(db, ANA, { limite: 1 })).toHaveLength(1);
    expect(avisosDe(db, ANA, { soloNoLeidos: true }).every((a) => a.is_leido === 0)).toBe(true);
  });

  it("el esquema de avisos no tiene columnas de fecha de lectura ni de presencia", () => {
    const cols = (db.prepare(`PRAGMA table_info(avisos)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "wallet", "clave", "tipo", "assignment_id", "texto", "is_leido", "created_at"]);
    expect(cols.some((c) => /leido_|read_at|visto|seen|conexion|last/i.test(c))).toBe(false);
  });
});

describe("enlacesDeAvisos", () => {
  it("enlaza al tablero del proyecto o, sin proyecto, al día", () => {
    const ini = Number(
      db.prepare(`INSERT INTO initiatives (slug, name) VALUES ('proyecto-piloto', 'Proyecto Piloto')`).run().lastInsertRowid
    );
    const con = Number(
      db.prepare(`INSERT INTO assignments (title, initiative_id, owner_wallet, status) VALUES ('A', ?, ?, 'Asignada')`).run(ini, ANA)
        .lastInsertRowid
    );
    const sin = Number(
      db.prepare(`INSERT INTO assignments (title, owner_wallet, status) VALUES ('B', ?, 'Asignada')`).run(ANA).lastInsertRowid
    );
    aviso(db, ANA, "con", con);
    aviso(db, ANA, "sin", sin);
    aviso(db, ANA, "nada", null);
    const lista = avisosDe(db, ANA);
    const enlaces = enlacesDeAvisos(db, lista);
    const por = (clave: string) => enlaces.get(lista.find((a) => a.clave === clave)!.id);
    expect(por("con")).toBe("/equipo/proyectos/proyecto-piloto");
    expect(por("sin")).toBe("/equipo/hoy");
    expect(por("nada")).toBe("/equipo/hoy");
  });
});
