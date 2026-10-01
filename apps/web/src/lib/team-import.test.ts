/**
 * WP14 criterio 1: "Importar el CSV crea iniciativas y asignaciones con responsable
 * y criterio de aceptación." Más el parser propio (BOM, comillas, comas dentro de
 * campos, CRLF) y la idempotencia del importador.
 *
 * La fixture `__fixtures__/tareas-demo.csv` es INVENTADA (un huerto) y tiene la
 * misma forma que los CSV reales de John, que viven fuera del repo y no se copian.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { importTasks, mapRow, parseCsv, resolverPersona, HORIZON_MAP, STATUS_MAP } from "./team-import";
import { pendingPrincipal, type TeamActor } from "./roles";
import { listInitiatives, seedTeam, type AssignmentRow } from "./team";
import { vincularPrincipal } from "./talento";

const FIXTURE = path.join(process.cwd(), "src", "lib", "__fixtures__", "tareas-demo.csv");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

function csv(): string {
  return fs.readFileSync(FIXTURE, "utf8");
}

function byTitle(db: DB, title: string): AssignmentRow | undefined {
  return db.prepare(`SELECT * FROM assignments WHERE title = ?`).get(title) as AssignmentRow | undefined;
}

describe("parser CSV propio (sin dependencias nuevas)", () => {
  it("respeta comas y saltos de línea dentro de campos entrecomillados", () => {
    const rows = parseCsv('a,b,c\n1,"dos, con coma",3\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "dos, con coma", "3"],
    ]);
    const multi = parseCsv('a,b\n1,"linea1\nlinea2"\n');
    expect(multi[1][1]).toBe("linea1\nlinea2");
  });

  it("desescapa comillas dobles ('\"\"' → '\"')", () => {
    const rows = parseCsv('a\n"dice ""hola"" fuerte"\n');
    expect(rows[1][0]).toBe('dice "hola" fuerte');
  });

  it("tolera CRLF y descarta la línea vacía final", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("descarta el BOM UTF-8 (el primer CSV de John lo trae)", () => {
    const rows = parseCsv("﻿Task Name,Status\nAlgo,Backlog\n");
    expect(rows[0][0]).toBe("Task Name");
  });

  it("preserva celdas vacías intermedias", () => {
    expect(parseCsv("a,b,c\n1,,3\n")[1]).toEqual(["1", "", "3"]);
  });

  it("la fixture del repo trae BOM, CRLF y comas dentro de comillas", () => {
    const raw = fs.readFileSync(FIXTURE);
    expect([raw[0], raw[1], raw[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = parseCsv(csv());
    expect(rows[0][0]).toBe("Task Name");
    expect(rows[0]).toHaveLength(8);
    expect(rows[1][1]).toContain("tomates, lechuga"); // coma dentro del campo
    expect(rows[3][1]).toContain('"Huerto Demo"'); // comillas escapadas
  });
});

describe("mapeos del vocabulario del CSV (WP14)", () => {
  it("Status: Backlog→Backlog, En curso→En curso, Hecho→Hecha", () => {
    expect(STATUS_MAP["backlog"]).toBe("Backlog");
    expect(STATUS_MAP["en curso"]).toBe("En curso");
    expect(STATUS_MAP["hecho"]).toBe("Hecha");
  });

  it("Horizonte: Después→Parqueado", () => {
    expect(HORIZON_MAP["ahora"]).toBe("Ahora");
    expect(HORIZON_MAP["siguiente"]).toBe("Siguiente");
    expect(HORIZON_MAP["después"]).toBe("Parqueado");
    expect(HORIZON_MAP["despues"]).toBe("Parqueado");
  });

  it("mapRow resuelve el Assignee al principal `pending:<slug>` del roster", () => {
    const { row } = mapRow({
      "Task Name": "Algo",
      Description: "d",
      Status: "En curso",
      Priority: "Urgent",
      Assignee: "Fausto",
      Iniciativa: "WMS",
      Horizonte: "Ahora",
      "Criterio de aceptación": "QA aprobado",
    });
    expect(row!.ownerWallet).toBe("pending:fausto");
    expect(row!.status).toBe("En curso");
    expect(row!.priority).toBe("Urgent");
    expect(row!.acceptanceCriteria).toBe("QA aprobado");
  });

  it("rechaza (no adivina) valores desconocidos de Status, Priority, Horizonte y Assignee", () => {
    const base = {
      "Task Name": "Algo",
      Description: "",
      Status: "Backlog",
      Priority: "Normal",
      Assignee: "Fausto",
      Iniciativa: "WMS",
      Horizonte: "Ahora",
      "Criterio de aceptación": "",
    };
    expect(mapRow({ ...base, Status: "Zombi" }).error).toMatch(/Status desconocido/);
    expect(mapRow({ ...base, Priority: "Critiquísima" }).error).toMatch(/Priority desconocida/);
    expect(mapRow({ ...base, Horizonte: "Nunca" }).error).toMatch(/Horizonte desconocido/);
    // WP31-A2: mapRow es puro y ya no decide quién está en el equipo; devuelve el
    // nombre crudo y `importTasks` lo resuelve por datos (o reporta la fila).
    const marciano = mapRow({ ...base, Assignee: "Marciano" });
    expect(marciano.error).toBeUndefined();
    expect(marciano.row!.assignee).toBe("Marciano");
    expect(marciano.row!.ownerWallet).toBeNull();
    expect(mapRow({ ...base, "Task Name": "" }).error).toMatch(/Task Name/);
    expect(mapRow({ ...base, Iniciativa: "" }).error).toMatch(/Iniciativa/);
  });

  it("sin Assignee, un estado en vuelo se corrige a Backlog con aviso (no estado imposible)", () => {
    const { row } = mapRow({
      "Task Name": "Algo",
      Description: "",
      Status: "En curso",
      Priority: "Normal",
      Assignee: "",
      Iniciativa: "WMS",
      Horizonte: "Ahora",
      "Criterio de aceptación": "",
    });
    expect(row!.ownerWallet).toBeNull();
    expect(row!.status).toBe("Backlog");
    expect(row!.warnings.join(" ")).toMatch(/sin Assignee/);
  });
});

describe("importTasks — criterio 1 de WP14", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("crea iniciativas y asignaciones CON responsable y criterio de aceptación", () => {
    const s = importTasks(db, csv());

    // 6 filas válidas de 7: 'Marciano' no está en el equipo y se reporta.
    expect(s.created).toBe(6);
    expect(s.updated).toBe(0);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0].title).toBe("Diseñar el logo del huerto");
    expect(s.errors[0].reason).toBe("no encuentro a «Marciano» en el equipo");

    // Iniciativas creadas desde el CSV (más las sembradas por el roster).
    const names = listInitiatives(db).map((i) => i.name);
    expect(names).toContain("Huerto Demo");
    expect(names).toContain("Cocina Demo");

    // Responsable resuelto al principal del roster.
    const plantar = byTitle(db, "Plantar el huerto de pruebas")!;
    expect(plantar.owner_wallet).toBe(pendingPrincipal("fausto"));
    expect(plantar.priority).toBe("High");
    expect(plantar.status).toBe("Backlog");
    // Criterio de aceptación importado íntegro, con su coma interna.
    expect(plantar.acceptance_criteria).toBe("Tres bancales sembrados, con riego programado.");
    // Descripción con coma dentro de comillas.
    expect(plantar.description).toContain("tomates, lechuga y albahaca");

    // El responsable existe como usuario (FK owner_wallet → users.wallet).
    const owner = db.prepare(`SELECT display_name, role FROM users WHERE wallet = ?`).get(plantar.owner_wallet) as {
      display_name: string;
      role: string;
    };
    expect(owner.display_name).toBe("Fausto");
    expect(owner.role).toBe("core");
  });

  it("mapea los estados y horizontes del CSV al modelo", () => {
    importTasks(db, csv());
    expect(byTitle(db, "Regar el huerto")!.status).toBe("En curso");
    // 'Hecho' del CSV → 'Hecha' del modelo, y queda con fecha de cierre.
    const cartel = byTitle(db, "Pintar el cartel del huerto")!;
    expect(cartel.status).toBe("Hecha");
    expect(cartel.closed_at).not.toBeNull();
    // 'Después' → 'Parqueado' en la fila…
    expect(cartel.horizon).toBe("Parqueado");
    // …pero la iniciativa toma el horizonte MÁS urgente de sus filas.
    const huerto = listInitiatives(db).find((i) => i.name === "Huerto Demo")!;
    expect(huerto.horizon).toBe("Ahora");
    const cocina = listInitiatives(db).find((i) => i.name === "Cocina Demo")!;
    expect(cocina.horizon).toBe("Siguiente");
  });

  it("'Ángela' con acento resuelve al roster", () => {
    importTasks(db, csv());
    expect(byTitle(db, "Pintar el cartel del huerto")!.owner_wallet).toBe(pendingPrincipal("angela"));
  });

  it("fila sin Assignee: se importa sin responsable y vuelve a Backlog (con aviso)", () => {
    const s = importTasks(db, csv());
    const barrer = byTitle(db, "Barrer el invernadero")!;
    expect(barrer.owner_wallet).toBeNull();
    expect(barrer.status).toBe("Backlog");
    expect(s.warnings.some((w) => w.title === "Barrer el invernadero")).toBe(true);
  });

  it("es IDEMPOTENTE: reimportar no duplica nada", () => {
    importTasks(db, csv());
    const countAfterFirst = (db.prepare(`SELECT COUNT(*) AS n FROM assignments`).get() as { n: number }).n;
    const initiativesAfterFirst = listInitiatives(db).length;

    const second = importTasks(db, csv());

    expect(second.created).toBe(0);
    expect(second.updated).toBe(6);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM assignments`).get() as { n: number }).n).toBe(countAfterFirst);
    expect(listInitiatives(db)).toHaveLength(initiativesAfterFirst);
  });

  it("reimportar NO pisa el estado que el equipo ya movió en la app", () => {
    importTasks(db, csv());
    const id = byTitle(db, "Plantar el huerto de pruebas")!.id;
    db.prepare(`UPDATE assignments SET status = 'En curso' WHERE id = ?`).run(id);

    importTasks(db, csv()); // el CSV dice 'Backlog'

    expect(byTitle(db, "Plantar el huerto de pruebas")!.status).toBe("En curso");
  });

  it("falla fuerte si falta una columna obligatoria o el CSV está vacío", () => {
    expect(() => importTasks(db, "Task Name,Status\nAlgo,Backlog\n")).toThrow(/Falta la columna/);
    expect(() => importTasks(db, "")).toThrow(/vacío/);
  });
});

// ---------------------------------------------------------------------------
// WP31-A2 · resolución por datos y sin puntos (criterio A2-3, spec §5.A.6)
// ---------------------------------------------------------------------------

const FUNDADOR = "GFOUNDERSESIONAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const FAUSTO_REAL = "GFAUSTOREALAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const MARCIANO = "GMARCIANOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTRO_MARCIANO = "GOTROMARCIANOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const EXTERNA = "GEXTERNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function persona(db: DB, wallet: string, nombre: string, o: { role?: string; isDemo?: number; status?: string } = {}) {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, is_demo, status, cla_signed) VALUES (?, ?, ?, ?, ?, 1)`
  ).run(wallet, nombre, o.role ?? "core", o.isDemo ?? 0, o.status ?? "active");
}

function cuenta(db: DB, sql: string, ...p: unknown[]): number {
  return Number((db.prepare(sql).get(...p) as { n: number }).n);
}

describe("importTasks — Assignee por datos (WP31-A2, A2-3)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    seedTeam(db);
    persona(db, FUNDADOR, "John", { role: "founder" });
  });

  it("resuelve por el roster VINCULADO: la tarea va a la cuenta real y el pending no se recrea", () => {
    persona(db, FAUSTO_REAL, "Fausto R");
    const founder: TeamActor = { wallet: FUNDADOR, name: "John", role: "founder", isSupervisor: true };
    vincularPrincipal(db, founder, { slug: "fausto", wallet: FAUSTO_REAL });

    const s = importTasks(db, csv(), FUNDADOR);

    expect(byTitle(db, "Plantar el huerto de pruebas")!.owner_wallet).toBe(FAUSTO_REAL);
    expect(s.errors.map((e) => e.title)).toEqual(["Diseñar el logo del huerto"]);
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(pendingPrincipal("fausto"))).toBeUndefined();
  });

  it("resuelve por display_name único entre activos no demo", () => {
    persona(db, MARCIANO, "Marciano");
    const s = importTasks(db, csv());
    expect(s.errors).toEqual([]);
    expect(s.created).toBe(7);
    expect(byTitle(db, "Diseñar el logo del huerto")!.owner_wallet).toBe(MARCIANO);
    expect(resolverPersona(db, "  marciano ")).toBe(MARCIANO);
    expect(resolverPersona(db, "Ángela")).toBe(pendingPrincipal("angela"));
    expect(resolverPersona(db, "Nadie")).toBeNull();
  });

  it("no adivina: nombre repetido, cuenta demo o inactiva → error de fila", () => {
    persona(db, MARCIANO, "Marciano");
    persona(db, OTRO_MARCIANO, "marciano");
    const repetido = importTasks(db, csv());
    expect(repetido.errors[0].reason).toBe("hay más de una persona llamada «Marciano» en el equipo");
    expect(resolverPersona(db, "Marciano")).toBeNull();

    const db2 = freshDb();
    persona(db2, MARCIANO, "Marciano", { isDemo: 1 });
    persona(db2, OTRO_MARCIANO, "Marciano", { status: "alumni" });
    expect(importTasks(db2, csv()).errors[0].reason).toBe("no encuentro a «Marciano» en el equipo");
  });

  it("un contributor solo recibe trabajo de un proyecto donde es miembro", () => {
    persona(db, EXTERNA, "Externa", { role: "contributor" });
    const fila = "Task Name,Iniciativa,Assignee,Status\nPodar,Huerto Demo,Externa,Asignada\n";
    const sin = importTasks(db, fila);
    expect(sin.created).toBe(0);
    expect(sin.errors[0].reason).toBe("«Externa» no está en el proyecto «Huerto Demo»: primero súmale");

    const huerto = (db.prepare(`SELECT id FROM initiatives WHERE slug = 'huerto-demo'`).get() as { id: number } | undefined)?.id;
    const id = huerto ?? Number(db.prepare(`INSERT INTO initiatives (slug, name) VALUES ('huerto-demo', 'Huerto Demo')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO project_members (initiative_id, wallet, rol_proyecto, vinculo) VALUES (?, ?, 'ejecuta', 'externo')`).run(id, EXTERNA);
    const con = importTasks(db, fila);
    expect(con.created).toBe(1);
    expect(byTitle(db, "Podar")!.owner_wallet).toBe(EXTERNA);
  });

  it("importar filas Hecha NO crea puntos, reputación ni eventos de aprobación", () => {
    const pts = cuenta(db, `SELECT COUNT(*) AS n FROM points_ledger`);
    const rep = cuenta(db, `SELECT COUNT(*) AS n FROM reputation_events`);
    importTasks(db, csv(), FUNDADOR);
    importTasks(db, csv(), FUNDADOR);
    expect(byTitle(db, "Pintar el cartel del huerto")!.status).toBe("Hecha");
    expect(cuenta(db, `SELECT COUNT(*) AS n FROM points_ledger`)).toBe(pts);
    expect(cuenta(db, `SELECT COUNT(*) AS n FROM reputation_events`)).toBe(rep);
    expect(cuenta(db, `SELECT COUNT(*) AS n FROM assignment_events WHERE action = 'aprobar'`)).toBe(0);
  });

  it("acepta las columnas del copy (Initiative, Title, Assignee, Status, Priority, Size, Due)", () => {
    const texto =
      "Initiative,Title,Assignee,Status,Priority,Size,Due\n" +
      "Cocina Demo,Hornear pan,Juan,Asignada,P2,m,2026-10-09\n" +
      "Cocina Demo,Medir harina,,Backlog,Baja,XL,\n" +
      "Cocina Demo,Lavar platos,,Backlog,Normal,,2026-02-30\n";
    const s = importTasks(db, texto);
    expect(s.created).toBe(1);
    const pan = byTitle(db, "Hornear pan")!;
    expect(pan).toMatchObject({
      owner_wallet: pendingPrincipal("juan"),
      status: "Asignada",
      priority: "High",
      size: "M",
      due_date: "2026-10-09",
    });
    expect(s.errors.map((e) => [e.line, e.reason])).toEqual([
      [3, "Size desconocido: 'XL' (usa S, M o L)."],
      [4, "Due no es una fecha AAAA-MM-DD: '2026-02-30'."],
    ]);
  });

  it("reimportar no reasigna ni replanifica una entrega En revisión, ni edita una Hecha", () => {
    importTasks(db, csv());
    const regar = byTitle(db, "Regar el huerto")!;
    db.prepare(`UPDATE assignments SET status = 'En revisión' WHERE id = ?`).run(regar.id);
    const cambiado = csv().replace("En curso,Normal,David,Huerto Demo", "En curso,Urgent,Fausto,Huerto Demo");
    expect(cambiado).not.toBe(csv());

    const s = importTasks(db, cambiado);

    expect(s.updated).toBe(6);
    expect(byTitle(db, "Regar el huerto")).toMatchObject({
      owner_wallet: pendingPrincipal("david"),
      priority: "Normal",
      status: "En revisión",
    });
  });

  it("deja una fila 'importar' en talent_events con los conteos", () => {
    importTasks(db, csv(), FUNDADOR);
    const ev = db.prepare(`SELECT actor_wallet, action, detail FROM talent_events`).all() as Array<{
      actor_wallet: string;
      action: string;
      detail: string;
    }>;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ actor_wallet: FUNDADOR, action: "importar" });
    expect(JSON.parse(ev[0].detail)).toEqual({ creadas: 6, yaEstaban: 0, conError: 1, proyectos: 2 });
  });
});
