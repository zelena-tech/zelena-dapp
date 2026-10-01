import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import {
  getActiveGenome,
  currentEpoch,
  dailyFocusHour,
  seedGenomeV1,
  seedGenomeV2,
  clearGenomeCache,
  sha256HexPuro,
  GENOME_V1,
  GENOME_V2_NUEVAS,
  GENOME_DEFAULTS,
} from "./genome";
import { seedIfEmpty } from "./seed";
import { sha256Hex } from "./crypto";

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  return db;
}

function seedPeriod(db: DB, id: number): void {
  db.prepare(
    `INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (?, ?, 0, 0, 'Open')`
  ).run(id, `Época ${id}`);
}

describe("genoma versionado (WP02)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    seedPeriod(db, 1);
  });

  it("los valores v1 equivalen exactamente a las constantes previas (regresión)", () => {
    seedGenomeV1(db);
    const g = getActiveGenome(db, 1);
    expect(g.EPOCH_BUDGET).toBe(100_000);
    expect(g.ACADEMIA_BUDGET).toBe(5_000);
    expect(g.ACADEMIA_DAILY_CAP).toBe(3);
    expect(g.ACADEMIA_DIMINISHING).toEqual([1, 0.75, 0.5]);
    expect(g.ACADEMIA_VOTE_WEIGHT).toBe(0.5);
    expect(g.TIER_INVITE_CAPS).toEqual({ Bronze: 2, Silver: 5, Gold: 10 });
    // WP19: la hora de los 3 focos del día es un gen, no un literal del bot.
    expect(g.DAILY_FOCUS_HOUR).toBe(7);
  });

  it("la hora de los 3 focos sale del genoma y una versión nueva la cambia (WP19)", () => {
    seedGenomeV1(db);
    expect(dailyFocusHour(db, 1)).toBe(7);

    // Publica un genoma v2 con otra hora, efectivo desde la época 2.
    const v2 = { ...GENOME_V1, DAILY_FOCUS_HOUR: 6 };
    db.prepare(
      `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (2, ?, 2, NULL)`
    ).run(JSON.stringify(v2));
    clearGenomeCache(db);

    expect(dailyFocusHour(db, 1)).toBe(7); // época en curso intacta
    expect(dailyFocusHour(db, 2)).toBe(6);
  });

  it("sin ninguna versión en DB cae a los defaults: v1 + claves nuevas (bootstrap, B1)", () => {
    const g = getActiveGenome(db, 1);
    expect(g).toEqual(GENOME_DEFAULTS);
    // Las claves v1 conservan sus valores canónicos.
    for (const k of Object.keys(GENOME_V1) as Array<keyof typeof GENOME_V1>) expect(g[k]).toEqual(GENOME_V1[k]);
  });

  it("la época actual es el id del período más reciente", () => {
    expect(currentEpoch(db)).toBe(1);
    seedPeriod(db, 2);
    expect(currentEpoch(db)).toBe(2);
  });

  it("una versión con effective_from_epoch futuro NO cambia la época actual", () => {
    seedGenomeV1(db); // v1 efectivo desde época 1

    // Publica un genoma v2 (presupuesto distinto) efectivo desde la época 2.
    const v2 = { ...GENOME_V1, EPOCH_BUDGET: 250_000, ACADEMIA_DAILY_CAP: 5 };
    db.prepare(
      `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (2, ?, 2, NULL)`
    ).run(JSON.stringify(v2));
    clearGenomeCache(db);

    // La época en curso (1) sigue viendo v1 — nada retroactivo.
    expect(getActiveGenome(db, 1).EPOCH_BUDGET).toBe(100_000);
    expect(getActiveGenome(db, 1).ACADEMIA_DAILY_CAP).toBe(3);

    // La época futura (2) ya ve v2.
    expect(getActiveGenome(db, 2).EPOCH_BUDGET).toBe(250_000);
    expect(getActiveGenome(db, 2).ACADEMIA_DAILY_CAP).toBe(5);
  });

  it("el seed publica el genoma v1 en el decision log y en genome_versions", () => {
    const fresh = freshDb(); // seedIfEmpty crea su propio período 1
    seedIfEmpty(fresh);
    const dec = fresh.prepare(`SELECT id FROM decision_log WHERE title = 'Genoma v1 publicado'`).get() as
      | { id: number }
      | undefined;
    expect(dec).toBeTruthy();
    const gv = fresh.prepare(`SELECT version, decision_log_id FROM genome_versions WHERE version = 1`).get() as
      | { version: number; decision_log_id: number }
      | undefined;
    expect(gv?.version).toBe(1);
    expect(gv?.decision_log_id).toBe(dec!.id);
    // Tras el seed, getActiveGenome lee v1 desde la DB, mezclada con los defaults (WP31):
    // la época en curso ve los valores v1 y las claves nuevas con su valor por defecto.
    expect(getActiveGenome(fresh, 1)).toEqual(GENOME_DEFAULTS);
    // Y el mismo arranque publica la v2 para la época siguiente (WP31, §3.5 paso 2).
    const v2 = fresh.prepare(`SELECT effective_from_epoch AS e FROM genome_versions WHERE version = 2`).get() as
      | { e: number }
      | undefined;
    expect(v2?.e).toBe(2);
  });

  it("seedGenomeV1 es idempotente y liga a una entrada del decision log", () => {
    db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-07-01','Genoma v1 publicado','r','h')`).run();
    const decId = (db.prepare(`SELECT id FROM decision_log ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
    seedGenomeV1(db, decId);
    seedGenomeV1(db, decId); // segunda llamada no duplica
    const rows = db.prepare(`SELECT version, decision_log_id FROM genome_versions`).all() as Array<{
      version: number;
      decision_log_id: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(1);
    expect(rows[0].decision_log_id).toBe(decId);
  });
});

// ---------------------------------------------------------------------------
// WP31 · genoma v2 (criterios B1, B2 y B13)
// ---------------------------------------------------------------------------

/** Claves y valores de spec §6, copiados de la tabla (si cambian, cambia el spec). */
const ESPERADO_V2 = {
  TASK_POINTS: { S: 10, M: 30, L: 80 },
  TASK_REP: { S: 1, M: 3, L: 8 },
  ON_TIME_BONUS_PCT: 25,
  BUSINESS_TZ: "America/Bogota",
  BUSINESS_DAYS: [1, 2, 3, 4, 5],
  BUSINESS_HOUR_START: 8,
  BUSINESS_HOUR_END: 18,
  SLA_P1_RESPONSE_H: 2,
  SLA_P1_RESTORE_H: 8,
  SLA_P1_REVIEW_H: 4,
  SLA_P2_RESPONSE_H: 10,
  SLA_P2_RESOLVE_D: 3,
  SLA_P3_RESPONSE_D: 2,
  SLA_P3_RESOLVE_D: 10,
  SLA_P4_TRIAGE_D: 5,
  SLA_REVIEW_D: 1,
  SLA_BLOCK_ESCALATE_D: 2,
  SLA_BLOCK_FOUNDER_D: 5,
  SLA_WARN_PCT: 25,
  SLA_WARN_MAX_H: 10,
  REMINDER_DIGEST_HOUR: 8,
  REMINDER_MAX_INMEDIATOS: 3,
  REMINDER_P1_NO_RESPONSE_H: 1,
  REMINDER_BEFORE_D: { High: 1, Normal: 2 },
  ESCALATE_SUPERVISOR_D: { High: 1, Normal: 2 },
  ESCALATE_FOUNDER_D: { High: 3, Normal: 5 },
  ESCALATE_P1_FOUNDER_FACTOR: 2,
  RITES_CADENCE: {
    sync: { frecuencia: "semanal", dia_semana: 1, hora: "09:00", duracion_min: 30 },
    demo: { frecuencia: "quincenal", dia_semana: 5, hora: "16:00", duracion_min: 60, ancla: "2026-10-09" },
    retro: { frecuencia: "mensual", semana_del_mes: 1, dia_semana: 1, hora: "10:00", duracion_min: 60 },
  },
  RITE_ATTEND_REP: 2,
  RITE_HOST_REP: 5,
  RITE_RECORDER_REP: 5,
  RITE_CODE_ROTATION_S: 90,
  RITE_WINDOW_MIN: 30,
  AGORA_HITOS_DEFAULT: [
    { nombre: "Anticipo", semana: "1", pct: 20 },
    { nombre: "Primera entrega", semana: "2", pct: 25 },
    { nombre: "Segunda entrega", semana: "4", pct: 25 },
    { nombre: "Entrega final", semana: "6", pct: 20 },
    { nombre: "Retención de calidad", semana: "8", pct: 10 },
  ],
  BADGE_GOALS: {
    "primera-entrega": 1,
    "diez-entregas": 10,
    "a-tiempo": 5,
    "pieza-grande": 1,
    "ojo-de-revisor": 5,
    presente: 3,
    anfitrion: 1,
  },
};

const CLAVES_V1 = [
  "EPOCH_BUDGET",
  "ACADEMIA_BUDGET",
  "ACADEMIA_DAILY_CAP",
  "ACADEMIA_DIMINISHING",
  "ACADEMIA_VOTE_WEIGHT",
  "TIER_INVITE_CAPS",
  "FITNESS_WEIGHTS",
  "DAILY_FOCUS_HOUR",
];

function insertarVersion(db: DB, version: number, params: unknown, eff: number): void {
  db.prepare(
    `INSERT INTO genome_versions (version, params, effective_from_epoch, decision_log_id) VALUES (?, ?, ?, NULL)`
  ).run(version, typeof params === "string" ? params : JSON.stringify(params), eff);
}

const filasDe = (db: DB, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

describe("genoma v2 · claves nuevas y mezcla con defaults (WP31, B1)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    seedPeriod(db, 1);
  });

  it("GENOME_V2_NUEVAS trae TODAS las claves de spec §6 con sus valores, y ninguna clave v1", () => {
    expect(GENOME_V2_NUEVAS).toEqual(ESPERADO_V2);
    expect(Object.keys(GENOME_V2_NUEVAS)).toHaveLength(35);
    for (const k of CLAVES_V1) expect(Object.keys(GENOME_V2_NUEVAS)).not.toContain(k);
  });

  it("GENOME_V1 sigue intacto: sus 8 claves, sin claves nuevas; GENOME_DEFAULTS = v1 + nuevas", () => {
    expect(Object.keys(GENOME_V1).sort()).toEqual([...CLAVES_V1].sort());
    expect(GENOME_V1).not.toHaveProperty("TASK_POINTS");
    expect(GENOME_DEFAULTS).toEqual({ ...GENOME_V1, ...ESPERADO_V2 });
  });

  it("con la fila v1 guardada, getActiveGenome trae las claves nuevas (mezcla con defaults)", () => {
    seedGenomeV1(db);
    const g = getActiveGenome(db, 1);
    expect(g.TASK_POINTS).toEqual({ S: 10, M: 30, L: 80 });
    expect(g.BUSINESS_TZ).toBe("America/Bogota");
    expect(g.RITES_CADENCE.demo).toMatchObject({ frecuencia: "quincenal", ancla: "2026-10-09" });
    expect(g).toEqual(GENOME_DEFAULTS);
  });

  it("lo guardado manda sobre los defaults, clave por clave", () => {
    insertarVersion(db, 1, { ...GENOME_V1, EPOCH_BUDGET: 90_000, TASK_POINTS: { S: 1, M: 2, L: 3 } }, 1);
    const g = getActiveGenome(db, 1);
    expect(g.EPOCH_BUDGET).toBe(90_000);
    expect(g.TASK_POINTS).toEqual({ S: 1, M: 2, L: 3 });
    expect(g.TASK_REP).toEqual(GENOME_DEFAULTS.TASK_REP);
  });

  it("una versión con params vacíos o parciales (como la de producción) se lee completa", () => {
    insertarVersion(db, 1, "{}", 1);
    expect(getActiveGenome(db, 1)).toEqual(GENOME_DEFAULTS);
  });

  it("params ilegibles no tumban la lectura: rigen los defaults", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      insertarVersion(db, 1, "{no es json", 1);
      expect(getActiveGenome(db, 1)).toEqual(GENOME_DEFAULTS);
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  it("la caché guarda el objeto YA mezclado", () => {
    insertarVersion(db, 1, { EPOCH_BUDGET: 90_000 }, 1);
    const primera = getActiveGenome(db, 1);
    expect(primera.EPOCH_BUDGET).toBe(90_000);
    expect(primera.TASK_POINTS).toEqual(GENOME_DEFAULTS.TASK_POINTS);

    // Sin invalidar la caché, la segunda lectura es el mismo objeto mezclado (no relee la fila).
    db.prepare(`UPDATE genome_versions SET params = '{}' WHERE version = 1`).run();
    const segunda = getActiveGenome(db, 1);
    expect(segunda).toBe(primera);
    expect(segunda.TASK_POINTS).toEqual(GENOME_DEFAULTS.TASK_POINTS);
    expect(segunda.EPOCH_BUDGET).toBe(90_000);

    // Al invalidarla, se vuelve a leer y a mezclar.
    clearGenomeCache(db);
    expect(getActiveGenome(db, 1).EPOCH_BUDGET).toBe(GENOME_V1.EPOCH_BUDGET);
  });
});

describe("seedGenomeV2 (WP31, B2)", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
    seedPeriod(db, 1);
    seedGenomeV1(db);
  });

  it("inserta UNA versión con v1 + claves nuevas, efectiva desde la época siguiente, con su decisión", () => {
    const antesMutaciones = filasDe(db, "mutation_decisions");
    expect(seedGenomeV2(db)).toEqual({ insertada: true, version: 2 });

    const v2 = db
      .prepare(`SELECT params, effective_from_epoch AS eff, decision_log_id AS dec FROM genome_versions WHERE version = 2`)
      .get() as { params: string; eff: number; dec: number };
    expect(v2.eff).toBe(2);
    expect(JSON.parse(v2.params)).toEqual({ ...GENOME_V1, ...ESPERADO_V2 });

    const d = db.prepare(`SELECT date, title, reason, hash FROM decision_log WHERE id = ?`).get(v2.dec) as {
      date: string;
      title: string;
      reason: string;
      hash: string;
    };
    expect(d.title).toBe("Genoma v2: claves nuevas de entregas, plazos y ritos");
    expect(d.reason).toBe(
      "Se añaden claves sin cambiar ningún valor existente. Rigen con sus valores por defecto desde su publicación y quedan versionadas desde la época 2."
    );
    // Misma convención de huella que mutation.ts: sha256(`${title}|${reason}`).
    expect(d.hash).toBe(sha256Hex(`${d.title}|${d.reason}`));
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // No es la decisión de mutación de ninguna época.
    expect(filasDe(db, "mutation_decisions")).toBe(antesMutaciones);
    // La época en curso no cambia (nada retroactivo): ya veía los defaults por la mezcla.
    expect(getActiveGenome(db, 1)).toEqual(GENOME_DEFAULTS);
    expect(getActiveGenome(db, 2)).toEqual(GENOME_DEFAULTS);
  });

  it("es idempotente: la segunda vez no hace nada", () => {
    seedGenomeV2(db);
    const antes = { gv: filasDe(db, "genome_versions"), dl: filasDe(db, "decision_log") };
    expect(seedGenomeV2(db)).toEqual({ insertada: false, version: null });
    expect(seedGenomeV2(db)).toEqual({ insertada: false, version: null });
    expect({ gv: filasDe(db, "genome_versions"), dl: filasDe(db, "decision_log") }).toEqual(antes);
  });

  it("no hace nada si alguna versión, aunque no sea la más alta, ya trae TASK_POINTS", () => {
    insertarVersion(db, 2, { ...GENOME_V1, TASK_POINTS: { S: 1, M: 1, L: 1 } }, 2);
    insertarVersion(db, 3, { ...GENOME_V1 }, 3);
    expect(seedGenomeV2(db)).toEqual({ insertada: false, version: null });
    expect(filasDe(db, "genome_versions")).toBe(3);
  });

  it("efectiva desde max(época actual + 1, la de la versión más alta), sin cambiar valores guardados", () => {
    seedPeriod(db, 2);
    seedPeriod(db, 3);
    expect(seedGenomeV2(db).version).toBe(2);
    expect(
      (db.prepare(`SELECT effective_from_epoch AS e FROM genome_versions WHERE version = 2`).get() as { e: number }).e
    ).toBe(4);

    const otra = freshDb();
    seedPeriod(otra, 1);
    insertarVersion(otra, 1, GENOME_V1, 1);
    insertarVersion(otra, 2, { ...GENOME_V1, EPOCH_BUDGET: 110_000 }, 5);
    expect(seedGenomeV2(otra).version).toBe(3);
    const v3 = otra.prepare(`SELECT params, effective_from_epoch AS e FROM genome_versions WHERE version = 3`).get() as {
      params: string;
      e: number;
    };
    expect(v3.e).toBe(5);
    // Parte de la versión más alta sin cambiar ningún valor: conserva el 110.000.
    expect(JSON.parse(v3.params).EPOCH_BUDGET).toBe(110_000);
  });

  it("parte de los params de la versión más alta tal cual y solo añade lo que falta", () => {
    const otra = freshDb();
    seedPeriod(otra, 1);
    insertarVersion(otra, 1, { EPOCH_BUDGET: 100_000, BUSINESS_TZ: "America/Lima" }, 1);
    seedGenomeV2(otra);
    const p = JSON.parse(
      (otra.prepare(`SELECT params FROM genome_versions WHERE version = 2`).get() as { params: string }).params
    );
    expect(p.BUSINESS_TZ).toBe("America/Lima"); // nunca se pisa un valor guardado
    expect(p.TASK_POINTS).toEqual(ESPERADO_V2.TASK_POINTS);
    expect(p).not.toHaveProperty("ACADEMIA_BUDGET"); // lo no guardado sigue saliendo de los defaults
  });

  it("sin ninguna versión previa parte de GENOME_V1", () => {
    const vacia = freshDb();
    seedPeriod(vacia, 1);
    expect(seedGenomeV2(vacia)).toEqual({ insertada: true, version: 1 });
    const p = JSON.parse(
      (vacia.prepare(`SELECT params FROM genome_versions WHERE version = 1`).get() as { params: string }).params
    );
    expect(p).toEqual({ ...GENOME_V1, ...ESPERADO_V2 });
  });

  it("seedIfEmpty la corre una sola vez: un segundo arranque no añade versiones ni decisiones", () => {
    const fresh = freshDb();
    seedIfEmpty(fresh);
    const tras1 = { gv: filasDe(fresh, "genome_versions"), dl: filasDe(fresh, "decision_log") };
    expect(fresh.prepare(`SELECT COUNT(*) AS n FROM decision_log WHERE title LIKE 'Genoma v2:%'`).get()).toEqual({ n: 1 });
    seedIfEmpty(fresh);
    expect({ gv: filasDe(fresh, "genome_versions"), dl: filasDe(fresh, "decision_log") }).toEqual(tras1);
  });
});

describe("sha256 en JS puro (decision log de seedGenomeV2)", () => {
  it("da el mismo hex que sha256Hex de crypto.ts, también con acentos y varios bloques", () => {
    const casos = [
      "",
      "abc",
      "Genoma v2: claves nuevas de entregas, plazos y ritos|Se añaden claves…",
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(63),
      "x".repeat(64),
      "ñandú 🌱 época".repeat(40),
    ];
    for (const c of casos) expect(sha256HexPuro(c)).toBe(sha256Hex(c));
    expect(sha256HexPuro("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("genome.ts no arrastra node: ni crypto.ts (CLI y cadena de cliente) y sus imports de valor llevan .ts", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "genome.ts"), "utf8");
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/node:|from "\.\/crypto|from "\.\/session|require\(/);
    for (const m of codigo.matchAll(/^import (?!type)[^;]* from "(\.[^"]+)";/gm)) expect(m[1]).toMatch(/\.ts$/);
    // Sintaxis borrable: sin enum, namespace ni propiedades de parámetro.
    expect(codigo).not.toMatch(/\benum\s|\bnamespace\s|constructor\s*\(\s*(public|private|protected|readonly)\s/);
  });
});

describe("arranque resistente (WP31, B13)", () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
  });

  it("con seedGenomeV2 forzado a fallar, seedIfEmpty no lanza y getActiveGenome devuelve los defaults", () => {
    const fresh = freshDb();
    // Falla a mitad de seedGenomeV2: la decisión ya se insertó y la versión no entra.
    fresh.exec(
      `CREATE TRIGGER falla_genoma_v2 BEFORE INSERT ON genome_versions WHEN NEW.version > 1
       BEGIN SELECT RAISE(ABORT, 'fallo forzado'); END;`
    );
    expect(() => seedIfEmpty(fresh)).not.toThrow();
    expect(error).toHaveBeenCalledWith("[seed] genoma v2", expect.anything());

    clearGenomeCache(fresh);
    expect(getActiveGenome(fresh)).toEqual(GENOME_DEFAULTS);
    expect(getActiveGenome(fresh, 2)).toEqual(GENOME_DEFAULTS);
    // Atómica: ni versión ni decisión a medias.
    expect(filasDe(fresh, "genome_versions")).toBe(1);
    expect(fresh.prepare(`SELECT COUNT(*) AS n FROM decision_log WHERE title LIKE 'Genoma v2:%'`).get()).toEqual({ n: 0 });
    // El resto del arranque siguió: el roster del equipo existe.
    expect(fresh.prepare(`SELECT COUNT(*) AS n FROM users WHERE wallet = 'pending:john'`).get()).toEqual({ n: 1 });

    // Se reintenta en el siguiente arranque.
    fresh.exec(`DROP TRIGGER falla_genoma_v2`);
    seedIfEmpty(fresh);
    expect(filasDe(fresh, "genome_versions")).toBe(2);
  });
});
