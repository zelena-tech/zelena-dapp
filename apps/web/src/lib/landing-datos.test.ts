/**
 * WP33 · datos en vivo de la landing en inglés (lib/landing-datos.ts): solo lo real,
 * con todo en cero se muestra el cero, sin campañas ni nombres, y una base que falla
 * no tumba la página.
 *
 * Base en memoria con `schema.sql` + `seedIfEmpty` (las cuentas sembradas son demo y
 * los proyectos sembrados nacen en borrador). Wallets de mentira; ningún dato real.
 * Calendario de ritos (America/Bogota): demo vie 9 oct 2026 16:00 = 21:00 UTC.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { prepararRito } from "./ritos";
import type { TeamActor } from "./roles";
import type { Encuentro } from "./encuentros";
import {
  CIFRAS_EN_CERO,
  LLAMADA_AVISO,
  RUTA_VOTAR,
  cuantasDecisiones,
  cuantasVotacionesAbiertas,
  datosComunidad,
  llamadaParticiparEn,
  proximasCitas,
  proyectosAbiertos,
  votacionesAbiertas,
} from "./landing-datos";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
const PREP = new Date("2026-10-01T12:00:00.000Z");
const DEMO = "2026-10-09T21:00:00.000Z";
const ANTES_DE_LA_DEMO = new Date("2026-10-08T12:00:00.000Z");

function baseSembrada(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedIfEmpty(db, {} as NodeJS.ProcessEnv);
  return db;
}

function usuario(db: DB, wallet: string, isDemo: 0 | 1, role = "contributor"): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, is_demo, cla_signed, role, is_founder, status) VALUES (?, ?, ?, 1, ?, ?, 'active')`
  ).run(wallet, wallet, isDemo, role, role === "founder" ? 1 : 0);
}

function fundadora(db: DB): TeamActor {
  usuario(db, "G_FUNDADORA_PRUEBA", 0, "founder");
  return { wallet: "G_FUNDADORA_PRUEBA", name: "Fundadora", role: "founder", isSupervisor: true };
}

function encuentro(fecha: string): Encuentro {
  return {
    slug: `prueba-${fecha}`,
    titulo: "Jornada de prueba",
    ciudad: "Ciudad de prueba",
    fecha,
    lugar: "Lugar de prueba",
    precio: "Gratis",
    descripcion: "Un encuentro inventado para el test.",
    registro: "https://example.org/registro",
  };
}

let db: DB;
beforeEach(() => {
  db = baseSembrada();
});

describe("votacionesAbiertas", () => {
  it("la votación sembrada sale con 0 votos: los suyos son de cuentas de prueba", () => {
    const v = votacionesAbiertas(db);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ favor: 0, contra: 0, abstencion: 0, total: 0, pctFavor: 0, umbral: 66, href: RUTA_VOTAR });
    const sembrados = (db.prepare(`SELECT COUNT(*) AS n FROM votes`).get() as { n: number }).n;
    expect(sembrados).toBeGreaterThan(0);
    expect(cuantasVotacionesAbiertas(db)).toBe(1);
  });

  it("cuenta solo votos de cuentas reales, con la fórmula de /gobernanza, y enlaza a votar", () => {
    const id = (db.prepare(`SELECT id FROM proposals WHERE status = 'open' ORDER BY id LIMIT 1`).get() as { id: number }).id;
    for (const [w, demo] of [
      ["GR1", 0],
      ["GR2", 0],
      ["GR3", 0],
      ["GD1", 1],
    ] as const)
      usuario(db, w, demo);
    const votar = db.prepare(`INSERT INTO votes (proposal_id, wallet, choice) VALUES (?, ?, ?)`);
    votar.run(id, "GR1", "favor");
    votar.run(id, "GR2", "favor");
    votar.run(id, "GR3", "contra");
    votar.run(id, "GD1", "contra"); // demo: no cuenta
    const [v] = votacionesAbiertas(db);
    expect(v).toMatchObject({ id, favor: 2, contra: 1, abstencion: 0, total: 3, pctFavor: 67 });
  });

  it("solo las abiertas, la más antigua primero (la misma que /gobernanza), con límite", () => {
    const nueva = db.prepare(`INSERT INTO proposals (title, description, status, threshold) VALUES (?, 'd', ?, 50)`);
    nueva.run("Abierta 2", "open");
    nueva.run("Cerrada", "closed");
    nueva.run("Abierta 3", "open");
    const v = votacionesAbiertas(db);
    expect(v.map((x) => x.titulo).slice(1)).toEqual(["Abierta 2", "Abierta 3"]);
    expect(v[0].id).toBeLessThan(v[1].id);
    expect(votacionesAbiertas(db, 1)).toHaveLength(1);
    expect(votacionesAbiertas(db, 0)).toEqual([]);
    expect(cuantasVotacionesAbiertas(db)).toBe(3);
  });

  it("sin votaciones abiertas: lista vacía y 0", () => {
    db.prepare(`UPDATE proposals SET status = 'closed'`).run();
    expect(votacionesAbiertas(db)).toEqual([]);
    expect(cuantasVotacionesAbiertas(db)).toBe(0);
  });
});

describe("cuantasDecisiones", () => {
  it("cuenta las vigentes sin las actas de ritos", () => {
    const antes = cuantasDecisiones(db);
    db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-10-20', 'Rito demo del 9 de octubre', 'acta', ?)`).run(
      "a".repeat(64)
    );
    expect(cuantasDecisiones(db)).toBe(antes);
    db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-10-21', 'Una decisión nueva', 'porque sí', ?)`).run(
      "b".repeat(64)
    );
    expect(cuantasDecisiones(db)).toBe(antes + 1);
  });
});

describe("proyectosAbiertos", () => {
  it("los sembrados son borradores: no sale ninguno", () => {
    expect(proyectosAbiertos(db)).toEqual([]);
  });

  it("publicados y abiertos, con etiqueta en inglés y sin la campaña", () => {
    db.prepare(`UPDATE projects SET draft = 0 WHERE id IN (1, 2)`).run();
    db.prepare(`UPDATE projects SET state = 'Assigned' WHERE id = 2`).run(); // ya no está abierto
    const p = proyectosAbiertos(db);
    expect(p).toHaveLength(1);
    expect(p[0].id).toBe(1);
    expect(p[0].href).toBe("/agora/1");
    expect(["Client", "Community"]).toContain(p[0].etiquetaTipo);
    expect(["client", "community"]).toContain(p[0].tipo);
    expect(Object.keys(p[0]).sort()).toEqual(["etiquetaTipo", "href", "id", "presupuestoUsd", "semanas", "tipo", "titulo"]);
    const campana = (db.prepare(`SELECT campaign FROM projects WHERE id = 1`).get() as { campaign: string }).campaign;
    expect(JSON.stringify(p)).not.toContain(campana);
  });

  it("respeta el límite y lo más nuevo va primero", () => {
    db.prepare(`UPDATE projects SET draft = 0, state = 'Open'`).run();
    const todos = proyectosAbiertos(db, 50);
    expect(todos.length).toBeGreaterThan(2);
    expect(todos[0].id).toBeGreaterThan(todos[1].id);
    expect(proyectosAbiertos(db, 2)).toHaveLength(2);
  });
});

describe("proximasCitas y la llamada a participar", () => {
  it("sin encuentros ni ritos preparados: vacío, y la llamada lleva al aviso", () => {
    expect(proximasCitas(db, ANTES_DE_LA_DEMO, { encuentros: [] })).toEqual([]);
    expect(llamadaParticiparEn(db, ANTES_DE_LA_DEMO, [])).toEqual(LLAMADA_AVISO);
    expect(LLAMADA_AVISO.href).toBe("/encuentros#aviso");
  });

  it("un rito de comunidad preparado sale con fecha en inglés, su lugar y su página", () => {
    const r = prepararRito(db, fundadora(db), { kind: "demo", scheduledFor: DEMO, lugar: "Sala de prueba" }, PREP);
    const citas = proximasCitas(db, ANTES_DE_LA_DEMO, { encuentros: [] });
    expect(citas).toEqual([
      {
        clave: `rito-${r.id}`,
        tipo: "rito",
        fecha: "2026-10-09",
        diaCorto: "OCT 9",
        hora: "4:00 PM GMT-5",
        titulo: "Community demo",
        idiomaTitulo: "en",
        lugar: "Sala de prueba",
        href: `/comunidad/ritos/${r.id}`,
      },
    ]);
    expect(llamadaParticiparEn(db, ANTES_DE_LA_DEMO, [])).toEqual({
      href: `/comunidad/ritos/${r.id}`,
      destino: "rito",
      texto: "Come to the demo on Oct 9",
      comando: "join_the_next_demo",
    });
  });

  it("un encuentro publicado entra por fecha; si llega antes, la llamada lleva a /encuentros", () => {
    prepararRito(db, fundadora(db), { kind: "demo", scheduledFor: DEMO }, PREP);
    const e = encuentro("2026-10-08");
    const citas = proximasCitas(db, ANTES_DE_LA_DEMO, { encuentros: [e] });
    expect(citas.map((c) => c.tipo)).toEqual(["encuentro", "rito"]);
    expect(citas[0]).toMatchObject({ diaCorto: "OCT 8", hora: null, idiomaTitulo: "es", lugar: "Ciudad de prueba", href: "/encuentros#proximos" });
    expect(proximasCitas(db, ANTES_DE_LA_DEMO, { encuentros: [e], limite: 1 })).toHaveLength(1);
    expect(llamadaParticiparEn(db, ANTES_DE_LA_DEMO, [e])).toMatchObject({ href: "/encuentros#proximos", destino: "encuentro" });
  });

  it("nunca muestra una fecha de la cadencia sin preparar", () => {
    // La cadencia tiene demos cada quince días, pero ninguna preparada: no sale nada.
    expect(proximasCitas(db, new Date("2026-10-02T12:00:00.000Z"), { encuentros: [] })).toEqual([]);
  });
});

describe("datosComunidad", () => {
  it("con la base sembrada: todo en cero (lo sembrado es de prueba) y objetos planos", () => {
    const d = datosComunidad(db, ANTES_DE_LA_DEMO);
    expect(d.cifras).toMatchObject({ firmas: 0, proyectosAbiertos: 0, puntos: 0, entregasAprobadas: 0, ultimaFirma: null });
    expect(d.cifras.votacionesAbiertas).toBe(1);
    expect(d.proyectos).toEqual([]);
    expect(d.votaciones).toHaveLength(1);
    expect(d.llamada.href).toBeTruthy();
    // Se puede pasar tal cual a un componente de cliente.
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it("si la base falla, cada bloque sale vacío y la página no se cae", () => {
    const rota = {
      prepare: () => {
        throw new Error("base caída");
      },
      exec: () => undefined,
      pragma: () => undefined,
      transaction: <A extends unknown[], R>(fn: (...a: A) => R) => fn,
    } as unknown as DB;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = datosComunidad(rota, ANTES_DE_LA_DEMO);
    error.mockRestore();
    expect(d).toEqual({ cifras: CIFRAS_EN_CERO, proyectos: [], votaciones: [], citas: [], llamada: LLAMADA_AVISO });
  });

  it("la última firma real lleva su enlace al explorador de la red de pruebas", () => {
    usuario(db, "GREAL1", 0);
    const tx = "1".repeat(64);
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature, anchor_status, tx_id) VALUES ('GREAL1', 1, ?, 'sig', 'anchored', ?)`
    ).run("h".repeat(64), tx);
    const d = datosComunidad(db, ANTES_DE_LA_DEMO);
    expect(d.cifras.firmas).toBe(1);
    expect(d.cifras.ultimaFirma?.url).toBe(`https://stellar.expert/explorer/testnet/tx/${tx}`);
  });
});
