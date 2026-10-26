import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { openDb, prepararSqlite, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import { REORDEN_OPCIONES_S4, reordenarOpcionesAcademia } from "./contenido-publico";
import fs from "node:fs";
import path from "node:path";
import {
  ACADEMIA_ESPERA_TRAS_FALLO_MS,
  ACADEMIA_FALLOS_MAX_24H,
  AcademiaError,
  startReading,
  getQuiz,
  gradeQuiz,
  heartbeat,
  statusDeErrorAcademia,
} from "./academia";

function freshDb() {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  db.prepare(
    `INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'T', 100000, 5000, 'Open')`
  ).run();
  const info = db
    .prepare(
      `INSERT INTO academia_content (slug, kind, title, summary, points, min_seconds, ord)
       VALUES ('t', 'article', 'T', 's', 150, 60, 1)`
    )
    .run();
  const cid = info.lastInsertRowid as number;
  const q = db.prepare(`INSERT INTO academia_quiz (content_id, question, options, correct) VALUES (?, ?, ?, ?)`);
  for (let i = 0; i < 5; i++) q.run(cid, `Q${i}`, JSON.stringify(["a", "b", "c", "d"]), 1);
  return { db, cid };
}

const W = "GTESTWALLET000000000000000000000000000000000000000000000";

/**
 * Respuestas que eligen, en cada pregunta, la opción con ese texto en el orden MOSTRADO
 * (las opciones se barajan por lectura: la posición guardada no sirve para responder).
 * En `freshDb` la correcta es "b" y "a" es incorrecta.
 */
function elegir(quiz: Array<{ options: string[] }>, texto: string): number[] {
  return quiz.map((q) => {
    const i = q.options.indexOf(texto);
    if (i < 0) throw new Error(`la opción ${texto} no está en la pregunta`);
    return i;
  });
}

describe("Academia anti-bot", () => {
  let db: ReturnType<typeof freshDb>["db"];
  let cid: number;
  beforeEach(() => {
    const f = freshDb();
    db = f.db;
    cid = f.cid;
  });

  it("rechaza el quiz antes del tiempo mínimo", () => {
    const { token } = startReading(db, W, cid);
    expect(() => getQuiz(db, W, token)).toThrow(/tiempo mínimo/i);
  });

  it("permite el quiz tras cumplir tiempo activo y transcurrido", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      token
    );
    const questions = getQuiz(db, W, token);
    expect(questions).toHaveLength(3);
  });

  it("otorga puntos al aprobar 2/3 y no vuelve a otorgar", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      token
    );
    const questions = getQuiz(db, W, token);
    const ids = questions.map((q) => q.id);
    // todas correctas (la opción "b")
    const r1 = gradeQuiz(db, W, token, ids, elegir(questions, "b"));
    expect(r1.passed).toBe(true);
    expect(r1.points).toBe(150);
    // la misma lectura no se califica dos veces (hallazgo A2)
    expect(() => gradeQuiz(db, W, token, ids, [1, 1, 1])).toThrow(/ya se calificó/);
    // otra lectura completa del mismo contenido: ya premiado → 0 puntos
    const otra = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      otra.token
    );
    const quiz2 = getQuiz(db, W, otra.token);
    const r2 = gradeQuiz(db, W, otra.token, quiz2.map((q) => q.id), elegir(quiz2, "b"));
    expect(r2.points).toBe(0);
  });

  it("no aprueba con menos de 2 correctas", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      token
    );
    const questions = getQuiz(db, W, token);
    const ids = questions.map((q) => q.id);
    const r = gradeQuiz(db, W, token, ids, elegir(questions, "a")); // todas incorrectas
    expect(r.passed).toBe(false);
    expect(r.points).toBe(0);
  });

  it("el heartbeat acumula tiempo activo", () => {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET last_beat = ? WHERE token = ?`).run(Date.now() - 15_000, token);
    const r = heartbeat(db, W, token);
    expect(r.activeSeconds).toBeGreaterThanOrEqual(15);
  });
});

describe("tope de Academia por época y bucket (WP31, criterio B5)", () => {
  let db: ReturnType<typeof freshDb>["db"];
  let cid: number;

  function aprobarQuiz(): { passed: boolean; points: number } {
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(Date.now() - 70_000, token);
    const quiz = getQuiz(db, W, token);
    return gradeQuiz(db, W, token, quiz.map((q) => q.id), elegir(quiz, "b"));
  }

  function sumar(points: number, periodId: number, bucket: string): void {
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES ('GOTRA', ?, ?, ?, 'Previo')`).run(
      points,
      periodId,
      bucket
    );
  }

  beforeEach(() => {
    const f = freshDb();
    db = f.db;
    cid = f.cid;
    db.prepare(`UPDATE periods SET state = 'Closed' WHERE id = 1`).run();
    db.prepare(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (2, 'E2', 100000, 5000, 'Open')`).run();
  });

  it("la Academia de otra época y los puntos de ejecución no cuentan; la fila va a la época actual", () => {
    sumar(5_000, 1, "academia"); // la época anterior agotó su Academia
    sumar(100_000, 2, "ejecucion");
    const r = aprobarQuiz();
    expect(r.points).toBe(150);
    const fila = db.prepare(`SELECT period_id, bucket FROM points_ledger WHERE wallet = ?`).get(W);
    expect(fila).toEqual({ period_id: 2, bucket: "academia" });
  });

  it("la Academia de la época actual sí cuenta: recorta al remanente", () => {
    sumar(4_950, 2, "academia");
    expect(aprobarQuiz().points).toBe(50);
  });

  it("agotada en la época actual, no otorga", () => {
    sumar(5_000, 2, "academia");
    expect(() => aprobarQuiz()).toThrow(/agotado/);
    expect(db.prepare(`SELECT 1 AS x FROM points_ledger WHERE wallet = ?`).get(W)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Hallazgo A2 (auditoría 2026-10-21): los atajos del quiz, cerrados.
 * ------------------------------------------------------------------ */
describe("A2 · el quiz solo da puntos con una lectura válida de ESE contenido por ESA cuenta", () => {
  let db: ReturnType<typeof freshDb>["db"];
  let cid: number;
  let otro: number;
  const OTRA = "GOTRAWALLET0000000000000000000000000000000000000000000000";

  /** Sesión con el tiempo mínimo cumplido (activo por heartbeats y real). */
  function leida(wallet: string, contentId: number): string {
    const { token } = startReading(db, wallet, contentId);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(
      Date.now() - 70_000,
      token
    );
    return token;
  }

  const idsDe = (contentId: number, n = 3) =>
    (db.prepare(`SELECT id FROM academia_quiz WHERE content_id = ? ORDER BY id LIMIT ?`).all(contentId, n) as Array<{ id: number }>).map(
      (r) => r.id
    );

  const ganado = (w: string) => ({
    puntos: (db.prepare(`SELECT COALESCE(SUM(points), 0) AS n FROM points_ledger WHERE wallet = ?`).get(w) as { n: number }).n,
    rep: (db.prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM reputation_events WHERE wallet = ?`).get(w) as { n: number }).n,
    premios: (db.prepare(`SELECT COUNT(*) AS n FROM academia_awards WHERE wallet = ?`).get(w) as { n: number }).n,
  });
  const nada = { puntos: 0, rep: 0, premios: 0 };

  beforeEach(() => {
    const f = freshDb();
    db = f.db;
    cid = f.cid;
    // Un segundo contenido con sus propias preguntas (respuesta correcta = 2).
    otro = Number(
      db
        .prepare(
          `INSERT INTO academia_content (slug, kind, title, summary, points, min_seconds, ord)
           VALUES ('otro', 'article', 'Otro', 's', 200, 60, 2)`
        )
        .run().lastInsertRowid
    );
    const q = db.prepare(`INSERT INTO academia_quiz (content_id, question, options, correct) VALUES (?, ?, ?, ?)`);
    for (let i = 0; i < 5; i++) q.run(otro, `O${i}`, JSON.stringify(["a", "b", "c", "d"]), 2);
  });

  describe("quiz sin leer", () => {
    it("sin el tiempo mínimo no hay preguntas ni calificación, aunque se adivinen los ids", () => {
      const { token } = startReading(db, W, cid);
      expect(() => getQuiz(db, W, token)).toThrow(/tiempo mínimo/);
      expect(() => gradeQuiz(db, W, token, idsDe(cid), [1, 1, 1])).toThrow(/tiempo mínimo/);
      expect(ganado(W)).toEqual(nada);
    });

    it("el tiempo real sin heartbeats (pestaña cerrada) no cuenta como lectura", () => {
      const { token } = startReading(db, W, cid);
      db.prepare(`UPDATE reading_sessions SET started_at = ? WHERE token = ?`).run(Date.now() - 3_600_000, token);
      expect(() => getQuiz(db, W, token)).toThrow(/tiempo mínimo/);
    });

    it("los heartbeats no adelantan el reloj real: sin el tiempo transcurrido, no", () => {
      const { token } = startReading(db, W, cid);
      db.prepare(`UPDATE reading_sessions SET active_seconds = 999 WHERE token = ?`).run(token);
      expect(() => getQuiz(db, W, token)).toThrow(/tiempo mínimo/);
    });

    it("calificar sin haber pedido las preguntas de la lectura no vale", () => {
      const token = leida(W, cid);
      expect(() => gradeQuiz(db, W, token, idsDe(cid), [1, 1, 1])).toThrow(/Primero pide las preguntas/);
      expect(ganado(W)).toEqual(nada);
    });

    it("sin sesión de lectura (token inventado) no hay nada", () => {
      expect(() => getQuiz(db, W, "token-inventado-123")).toThrow(/no encontrada/);
      expect(() => gradeQuiz(db, W, "token-inventado-123", idsDe(cid), [1, 1, 1])).toThrow(/no encontrada/);
      expect(ganado(W)).toEqual(nada);
    });
  });

  describe("lectura de otro contenido o de otra cuenta", () => {
    it("con la lectura de un contenido no se califican las preguntas de otro", () => {
      const token = leida(W, cid);
      getQuiz(db, W, token);
      expect(() => gradeQuiz(db, W, token, idsDe(otro), [2, 2, 2])).toThrow(/no corresponden/);
      expect(ganado(W)).toEqual(nada);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM academia_awards WHERE content_id = ?`).get(otro)).toEqual({ n: 0 });
    });

    it("los puntos son siempre del contenido leído, nunca de otro", () => {
      const token = leida(W, otro);
      const quiz = getQuiz(db, W, token);
      expect(gradeQuiz(db, W, token, quiz.map((q) => q.id), elegir(quiz, "c")).points).toBe(200);
      expect(db.prepare(`SELECT content_id FROM academia_awards WHERE wallet = ?`).all(W)).toEqual([{ content_id: otro }]);
    });

    it("la lectura de otra cuenta no sirve: ni sus preguntas ni su calificación", () => {
      const token = leida(OTRA, cid);
      const ids = getQuiz(db, OTRA, token).map((q) => q.id);
      expect(() => getQuiz(db, W, token)).toThrow(/no encontrada/);
      expect(() => gradeQuiz(db, W, token, ids, [1, 1, 1])).toThrow(/no encontrada/);
      expect(ganado(W)).toEqual(nada);
    });

    it("un contenido despublicado a mitad de la lectura ya no da puntos", () => {
      const token = leida(W, cid);
      const ids = getQuiz(db, W, token).map((q) => q.id);
      db.prepare(`UPDATE academia_content SET enabled = 0 WHERE id = ?`).run(cid);
      expect(() => gradeQuiz(db, W, token, ids, [1, 1, 1])).toThrow(/no disponible/);
      expect(ganado(W)).toEqual(nada);
    });
  });

  describe("respuestas adivinadas por fuerza bruta", () => {
    it("las respuestas correctas nunca viajan: ni en el quiz ni en un intento fallido", () => {
      const token = leida(W, cid);
      const quiz = getQuiz(db, W, token);
      for (const q of quiz) expect(Object.keys(q).sort()).toEqual(["id", "options", "question"]);
      const r = gradeQuiz(db, W, token, quiz.map((q) => q.id), elegir(quiz, "a"));
      expect(r).toEqual({ passed: false, correct: null, points: 0, reintentarEnMin: 15 });
    });

    it("pedir el quiz muchas veces devuelve SIEMPRE las mismas preguntas (no recorre el pool)", () => {
      const token = leida(W, cid);
      const primera = getQuiz(db, W, token).map((q) => q.id);
      for (let i = 0; i < 20; i++) expect(getQuiz(db, W, token).map((q) => q.id)).toEqual(primera);
      expect(new Set(primera).size).toBe(3);
    });

    it("la misma pregunta repetida tres veces no se acepta", () => {
      const token = leida(W, cid);
      const [a] = getQuiz(db, W, token).map((q) => q.id);
      expect(() => gradeQuiz(db, W, token, [a, a, a], [1, 1, 1])).toThrow(/no corresponden/);
      expect(ganado(W)).toEqual(nada);
    });

    it("preguntas del pool que no se sirvieron en esta lectura no se aceptan", () => {
      const token = leida(W, cid);
      const quiz = getQuiz(db, W, token);
      const servidas = quiz.map((q) => q.id);
      const noServida = idsDe(cid, 5).find((id) => !servidas.includes(id))!;
      expect(() => gradeQuiz(db, W, token, [servidas[0], servidas[1], noServida], [1, 1, 1])).toThrow(/no corresponden/);
      expect(ganado(W)).toEqual(nada);
      // El orden de las preguntas puede cambiar; el conjunto, no.
      const enOtroOrden = [quiz[2], quiz[0], quiz[1]];
      expect(gradeQuiz(db, W, token, enOtroOrden.map((q) => q.id), elegir(enOtroOrden, "b")).passed).toBe(true);
    });

    it("una lectura reprobada no se recalifica con el mismo token", () => {
      const token = leida(W, cid);
      const quiz = getQuiz(db, W, token);
      const ids = quiz.map((q) => q.id);
      expect(gradeQuiz(db, W, token, ids, elegir(quiz, "a")).passed).toBe(false);
      for (const intento of [
        [1, 1, 1],
        [0, 1, 1],
        [2, 2, 2],
      ]) {
        expect(() => gradeQuiz(db, W, token, ids, intento)).toThrow(/ya se calificó/);
      }
      expect(() => getQuiz(db, W, token)).toThrow(/ya se calificó/);
      expect(ganado(W)).toEqual(nada);
    });

    it("tras un intento fallido hay que esperar 15 min y volver a leer", () => {
      const token = leida(W, cid);
      const quiz = getQuiz(db, W, token);
      gradeQuiz(db, W, token, quiz.map((q) => q.id), elegir(quiz, "a"));
      expect(() => startReading(db, W, cid)).toThrow(/podrás intentarlo de nuevo en 15 min/);
      // Otro contenido sí se puede leer: la espera es por contenido.
      expect(() => startReading(db, W, otro)).not.toThrow();
      // Pasada la espera, se puede leer otra vez (y la lectura nueva exige su tiempo mínimo).
      db.prepare(`UPDATE reading_sessions SET graded_at = graded_at - ? WHERE token = ?`).run(
        ACADEMIA_ESPERA_TRAS_FALLO_MS,
        token
      );
      const nueva = startReading(db, W, cid);
      expect(() => getQuiz(db, W, nueva.token)).toThrow(/tiempo mínimo/);
    });

    it(`como mucho ${ACADEMIA_FALLOS_MAX_24H} intentos fallidos por contenido en 24 horas`, () => {
      const ahora = Date.now();
      for (let i = 0; i < ACADEMIA_FALLOS_MAX_24H; i++) {
        const token = leida(W, cid);
        const quiz = getQuiz(db, W, token);
        expect(gradeQuiz(db, W, token, quiz.map((q) => q.id), elegir(quiz, "a")).passed).toBe(false);
        // Simula que la espera de 15 min ya pasó (los fallos siguen dentro de las 24 h).
        db.prepare(`UPDATE reading_sessions SET graded_at = ? WHERE token = ?`).run(ahora - (i + 1) * 3_600_000, token);
      }
      expect(() => startReading(db, W, cid)).toThrow(/máximo de 3 intentos de este contenido en 24 horas/);
      // Cuando el más viejo sale de la ventana de 24 h, se libera un intento.
      expect(() => startReading(db, W, cid, ahora + 22 * 3_600_000 + 60_000)).not.toThrow();
    });

    it("la ruta responde 429 a la espera y 409 a la recalificación (sin leer el texto del error)", () => {
      expect(statusDeErrorAcademia(new AcademiaError("RETRY_WAIT", "x"))).toBe(429);
      expect(statusDeErrorAcademia(new AcademiaError("ALREADY_GRADED", "x"))).toBe(409);
      expect(statusDeErrorAcademia(new AcademiaError("NO_QUIZ", "x"))).toBe(409);
      expect(statusDeErrorAcademia(new AcademiaError("TOO_SOON", "x"))).toBe(403);
      expect(statusDeErrorAcademia(new AcademiaError("BAD_QUIZ", "x"))).toBe(400);
      expect(statusDeErrorAcademia(new Error("otro"))).toBe(400);
    });

    it("el GET del quiz tiene límite de solicitudes", () => {
      const ruta = fs.readFileSync(path.join(process.cwd(), "app", "api", "academia", "quiz", "route.ts"), "utf8");
      const get = ruta.slice(ruta.indexOf("export async function GET"), ruta.indexOf("export async function POST"));
      expect(get).toMatch(/rateLimit\(`aca-quiz-get:/);
    });
  });

  it("lo ya otorgado no se quita: una lectura aprobada antes sigue sumando aunque después se repruebe", () => {
    const t1 = leida(W, cid);
    const quiz1 = getQuiz(db, W, t1);
    expect(gradeQuiz(db, W, t1, quiz1.map((q) => q.id), elegir(quiz1, "b")).points).toBe(150);
    const antes = ganado(W);
    const t2 = leida(W, cid);
    const quiz2 = getQuiz(db, W, t2);
    expect(gradeQuiz(db, W, t2, quiz2.map((q) => q.id), elegir(quiz2, "a")).passed).toBe(false);
    expect(ganado(W)).toEqual(antes);
  });
});

const OTRA_PROD = "GLECTORAPRODUCCION00000000000000000000000000000000000000";

describe("A2 · sobre una base con el esquema de producción", () => {
  const FIXTURE = fs.readFileSync(path.join(process.cwd(), "src", "lib", "__fixtures__", "schema-58ee2fd.sql"), "utf8");

  it("el arranque añade quiz_ids y graded_at sin tocar lecturas ni premios, y el quiz nuevo funciona", () => {
    const db = openDb(":memory:");
    db.exec(FIXTURE);
    db.exec(`
      INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'Génesis', 100000, 5000, 'Open');
      INSERT INTO academia_content (id, slug, kind, title, summary, points, min_seconds, ord)
        VALUES (1, 'c', 'article', 'C', 's', 150, 60, 1);
      INSERT INTO academia_quiz (content_id, question, options, correct) VALUES
        (1, 'Q1', '["a","b"]', 1), (1, 'Q2', '["a","b"]', 1), (1, 'Q3', '["a","b"]', 1);
      INSERT INTO reading_sessions (token, wallet, content_id, started_at, active_seconds, last_beat, completed, passed)
        VALUES ('vieja-aprobada', '${W}', 1, 1000, 90, 1000, 1, 1),
               ('vieja-a-medias', '${W}', 1, 2000, 10, 2000, 0, 0);
      INSERT INTO academia_awards (wallet, content_id, day, ord_of_day, points) VALUES ('${W}', 1, '2026-09-01', 0, 150);
      INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES ('${W}', 150, 1, 'academia', 'Academia #1');
    `);
    const premios = () =>
      JSON.stringify([
        db.prepare(`SELECT * FROM academia_awards ORDER BY id`).all(),
        db.prepare(`SELECT * FROM points_ledger ORDER BY id`).all(),
      ]);
    const premiosAntes = premios();

    const inf = prepararSqlite(db, { archivo: null, founderWallet: null, sembrar: false });
    expect(inf.preColumnas).toEqual(expect.arrayContaining(["reading_sessions.quiz_ids", "reading_sessions.graded_at"]));
    expect(
      db.prepare(`SELECT token, completed, passed, quiz_ids, graded_at FROM reading_sessions ORDER BY token`).all()
    ).toEqual([
      { token: "vieja-a-medias", completed: 0, passed: 0, quiz_ids: null, graded_at: null },
      { token: "vieja-aprobada", completed: 1, passed: 1, quiz_ids: null, graded_at: null },
    ]);
    expect(premios()).toBe(premiosAntes);

    // Una lectura nueva sobre la base migrada: preguntas guardadas y una sola calificación.
    const { token } = startReading(db, OTRA_PROD, 1);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(Date.now() - 70_000, token);
    const quiz = getQuiz(db, OTRA_PROD, token);
    const ids = quiz.map((q) => q.id);
    expect(gradeQuiz(db, OTRA_PROD, token, ids, elegir(quiz, "b")).points).toBe(150);
    expect(() => gradeQuiz(db, OTRA_PROD, token, ids, elegir(quiz, "b"))).toThrow(/ya se calificó/);

    // Segundo arranque: no añade nada más.
    expect(prepararSqlite(db, { archivo: null, founderWallet: null, sembrar: false }).preColumnas).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Hallazgo A2, revisión: con las opciones siempre en el orden guardado y casi todas
 * las correctas en la misma posición, responder siempre la segunda opción aprobaba
 * sin leer. Las opciones se barajan por lectura y ninguna posición fija acierta.
 * ------------------------------------------------------------------ */
describe("A2 · adivinar por posición no aprueba: opciones barajadas por lectura", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ningún vector constante aprueba por encima del azar en los contenidos sembrados (con latidos reales)", () => {
    // La prueba del revisor: base nueva con la siembra real, latidos cada 15 s hasta el
    // tiempo mínimo y la misma posición en las 3 respuestas, con una cuenta por intento.
    vi.useFakeTimers({ toFake: ["Date"] });
    let t = Date.parse("2026-10-24T15:00:00.000Z");
    vi.setSystemTime(t);
    const db = openDb(":memory:");
    prepararSqlite(db, { archivo: null, founderWallet: null });
    const contenidos = db
      .prepare(`SELECT id, slug FROM academia_content WHERE enabled = 1 ORDER BY id`)
      .all() as Array<{ id: number; slug: string }>;
    expect(contenidos.length).toBeGreaterThanOrEqual(4);

    const INTENTOS = 40;
    let n = 0;
    const aprobados: Array<{ slug: string; posicion: number; aprobados: number }> = [];
    for (const c of contenidos) {
      for (let posicion = 0; posicion < 4; posicion++) {
        let ok = 0;
        for (let i = 0; i < INTENTOS; i++) {
          const w = `GADIVINA${String(n++).padStart(48, "0")}`;
          const { token, minSeconds } = startReading(db, w, c.id, t);
          for (let s = 0; s < minSeconds; s += 15) {
            t += 15_000;
            vi.setSystemTime(t);
            heartbeat(db, w, token);
          }
          const quiz = getQuiz(db, w, token, t);
          try {
            gradeQuiz(db, w, token, quiz.map((q) => q.id), quiz.map(() => posicion), t);
          } catch (e) {
            // Aprobada, pero sin presupuesto de Academia: la lectura ya quedó como aprobada.
            if (!(e instanceof AcademiaError) || !["BUDGET", "DAILY_CAP"].includes(e.code)) throw e;
          }
          ok += (db.prepare(`SELECT passed FROM reading_sessions WHERE token = ?`).get(token) as { passed: number }).passed;
        }
        aprobados.push({ slug: c.slug, posicion, aprobados: ok });
      }
    }
    // Al azar (4 opciones, 2 de 3) se aprueba el 15,6 % de las veces: ~6 de 40, con una
    // desviación de ~2,3. La mitad (20) queda a más de 6 desviaciones: sin falsos rojos.
    const porEncima = aprobados.filter((a) => a.aprobados > INTENTOS / 2);
    expect(porEncima).toEqual([]);
  });

  it("las respuestas correctas guardadas están repartidas entre las posiciones", () => {
    const db = openDb(":memory:");
    prepararSqlite(db, { archivo: null, founderWallet: null });
    const filas = db
      .prepare(
        `SELECT c.slug, q.options, q.correct FROM academia_quiz q JOIN academia_content c ON c.id = q.content_id ORDER BY c.id, q.id`
      )
      .all() as Array<{ slug: string; options: string; correct: number }>;
    const porContenido = new Map<string, number[]>();
    for (const f of filas) {
      expect(JSON.parse(f.options)).toHaveLength(4);
      porContenido.set(f.slug, [...(porContenido.get(f.slug) ?? []), f.correct]);
    }
    expect(porContenido.size).toBeGreaterThanOrEqual(4);
    for (const [slug, correctas] of porContenido) {
      const cuenta = [0, 1, 2, 3].map((p) => correctas.filter((c) => c === p).length);
      // 5 preguntas en 4 posiciones: ninguna posición con más de 2 y al menos 3 distintas.
      expect({ slug, maxima: Math.max(...cuenta) <= 2, distintas: cuenta.filter((x) => x > 0).length >= 3 }).toEqual({
        slug,
        maxima: true,
        distintas: true,
      });
    }
  });

  it("cada lectura recibe sus opciones barajadas, iguales en cada pedido, y se califica la opción mostrada", () => {
    const { db, cid } = freshDb(); // las 5 preguntas: opciones a, b, c, d; correcta "b"
    const ordenes = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const w = `GBARAJA${String(i).padStart(49, "0")}`;
      const { token } = startReading(db, w, cid);
      db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(Date.now() - 70_000, token);
      const quiz = getQuiz(db, w, token);
      for (const q of quiz) {
        expect([...q.options].sort()).toEqual(["a", "b", "c", "d"]);
        ordenes.add(q.options.join(""));
      }
      // Pedirlo otra vez no cambia el orden (no se puede barajar hasta dar con uno cómodo).
      expect(getQuiz(db, w, token)).toEqual(quiz);
      // Se califica la opción que la persona vio, no la posición guardada.
      const r = gradeQuiz(db, w, token, quiz.map((q) => q.id), elegir(quiz, "b"));
      expect(r.passed).toBe(true);
    }
    // 90 preguntas servidas: si no se barajaran, todas tendrían el orden guardado "abcd".
    expect(ordenes.size).toBeGreaterThan(1);
  });

  it("la permutación de cada pregunta queda guardada en la lectura junto a sus ids", () => {
    const { db, cid } = freshDb();
    const { token } = startReading(db, W, cid);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(Date.now() - 70_000, token);
    const quiz = getQuiz(db, W, token);
    const fila = db.prepare(`SELECT quiz_ids, quiz_orden FROM reading_sessions WHERE token = ?`).get(token) as {
      quiz_ids: string;
      quiz_orden: string | null;
    };
    expect(JSON.parse(fila.quiz_ids)).toEqual(quiz.map((q) => q.id));
    const orden = JSON.parse(fila.quiz_orden ?? "null") as number[][];
    expect(orden).toHaveLength(3);
    quiz.forEach((q, k) => {
      expect([...orden[k]].sort()).toEqual([0, 1, 2, 3]);
      // La opción mostrada en la posición i es la guardada en orden[k][i].
      expect(q.options).toEqual(orden[k].map((i) => ["a", "b", "c", "d"][i]));
    });
  });
});

/* ------------------------------------------------------------------ *
 * Hallazgo A2, revisión: la Academia que ya está en producción (sembrada con las
 * correctas casi todas en la segunda opción) pasa al orden nuevo en el arranque.
 * ------------------------------------------------------------------ */
describe("A2 · revisión: las opciones de la Academia de producción se reordenan sin tocar lo ganado", () => {
  const FIXTURE = fs.readFileSync(path.join(process.cwd(), "src", "lib", "__fixtures__", "schema-58ee2fd.sql"), "utf8");
  const LECTORA = "GLECTORAACADEMIA000000000000000000000000000000000000000000";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  interface FilaQuiz {
    id: number;
    content_id: number;
    question: string;
    options: string;
    correct: number;
  }
  const quizDe = (db: DB) =>
    db.prepare(`SELECT id, content_id, question, options, correct FROM academia_quiz ORDER BY id`).all() as FilaQuiz[];

  /** La pregunta en su forma ANTERIOR si S4 la reordena; si no, tal cual. */
  function formaAnterior(q: FilaQuiz): FilaQuiz {
    const r = REORDEN_OPCIONES_S4.find((x) => x.pregunta === q.question);
    return r ? { ...q, options: JSON.stringify(r.antes), correct: r.de } : q;
  }

  /**
   * Base con el esquema de producción (58ee2fd) y la Academia tal como se sembró: los
   * mismos contenidos e ids que una siembra de hoy (S1 ya aplicado), con el quiz en el
   * orden anterior. Más lo ganado y lo leído, que no se puede tocar.
   */
  function baseProduccionAcademia(): { db: DB; nuevo: FilaQuiz[] } {
    const hoy = openDb(":memory:");
    prepararSqlite(hoy, { archivo: null, founderWallet: null });
    const contenidos = hoy
      .prepare(
        `SELECT id, slug, kind, title, summary, axis, points, min_seconds, body, video_id, enabled, ord FROM academia_content ORDER BY id`
      )
      .all() as Array<Record<string, unknown>>;
    const nuevo = quizDe(hoy);

    const db = openDb(":memory:");
    db.exec(FIXTURE);
    db.exec(`
      INSERT INTO users (wallet, display_name, cla_signed) VALUES ('${LECTORA}', 'Lectora', 1);
      INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'Época Génesis', 100000, 5000, 'Open');
      INSERT INTO genome_versions (version, params, effective_from_epoch) VALUES (1, '{}', 1);
      INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-07-01', 'Génesis', 'arranque', 'h');
    `);
    const insC = db.prepare(
      `INSERT INTO academia_content (id, slug, kind, title, summary, axis, points, min_seconds, body, video_id, enabled, ord)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of contenidos) {
      insC.run(c.id, c.slug, c.kind, c.title, c.summary, c.axis, c.points, c.min_seconds, c.body, c.video_id, c.enabled, c.ord);
    }
    const insQ = db.prepare(`INSERT INTO academia_quiz (id, content_id, question, options, correct) VALUES (?, ?, ?, ?, ?)`);
    for (const q of nuevo.map(formaAnterior)) insQ.run(q.id, q.content_id, q.question, q.options, q.correct);
    db.exec(`
      INSERT INTO academia_awards (wallet, content_id, day, ord_of_day, points) VALUES ('${LECTORA}', 2, '2026-09-01', 0, 150);
      INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES ('${LECTORA}', 150, 1, 'academia', 'Academia #2');
      INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES ('${LECTORA}', 'investigacion', 10, 'Academia completada', 1);
      INSERT INTO reading_sessions (token, wallet, content_id, started_at, active_seconds, last_beat, completed, passed)
        VALUES ('aprobada', '${LECTORA}', 2, 1000, 90, 1000, 1, 1),
               ('a-medias', '${LECTORA}', 3, 2000, 10, 2000, 0, 0);
    `);
    return { db, nuevo };
  }

  const loGanado = (db: DB) =>
    JSON.stringify([
      db.prepare(`SELECT * FROM academia_awards ORDER BY id`).all(),
      db.prepare(`SELECT * FROM points_ledger ORDER BY id`).all(),
      db.prepare(`SELECT * FROM reputation_events ORDER BY id`).all(),
      db
        .prepare(
          `SELECT token, wallet, content_id, started_at, active_seconds, last_beat, completed, passed FROM reading_sessions ORDER BY token`
        )
        .all(),
    ]);
  const decisiones = (db: DB) => db.prepare(`SELECT * FROM decision_log ORDER BY id`).all();

  const correctasPorContenido = (db: DB) => {
    const por = new Map<number, number[]>();
    for (const q of quizDe(db)) por.set(q.content_id, [...(por.get(q.content_id) ?? []), q.correct]);
    return [...por.values()];
  };

  it("la forma anterior es la que midió el revisor: la segunda opción en 15 de 20", () => {
    const { db, nuevo } = baseProduccionAcademia();
    expect(correctasPorContenido(db)).toEqual([
      [1, 1, 1, 2, 1],
      [2, 1, 1, 1, 1],
      [1, 1, 1, 2, 1],
      [1, 2, 1, 1, 1],
    ]);
    // Solo cambia el orden: mismas preguntas, mismas opciones y la misma respuesta correcta.
    const esencia = (q: FilaQuiz) => {
      const o = JSON.parse(q.options) as string[];
      return { id: q.id, question: q.question, opciones: [...o].sort(), correcta: o[q.correct] };
    };
    expect(quizDe(db).map(esencia)).toEqual(nuevo.map(esencia));
  });

  it("el arranque deja el quiz igual al de una siembra nueva, sin tocar lo ganado, y la segunda vez no hace nada", () => {
    const { db, nuevo } = baseProduccionAcademia();
    const antes = loGanado(db);
    const decisionesAntes = decisiones(db);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    prepararSqlite(db, { archivo: null, founderWallet: null });

    expect(quizDe(db)).toEqual(nuevo);
    expect(correctasPorContenido(db).every((c) => [0, 1, 2, 3].every((p) => c.filter((x) => x === p).length <= 2))).toBe(true);
    expect(loGanado(db)).toBe(antes);
    // El decision log solo crece (el genoma v2 añade su decisión): lo anterior, intacto.
    expect(decisiones(db).slice(0, decisionesAntes.length)).toEqual(decisionesAntes);
    expect(info.mock.calls.some((c) => /14 pregunta\(s\) con las opciones reordenadas/.test(String(c[0])))).toBe(true);

    // Segundo arranque: nada que reordenar y nada cambia.
    prepararSqlite(db, { archivo: null, founderWallet: null });
    expect(reordenarOpcionesAcademia(db)).toBe(0);
    expect(quizDe(db)).toEqual(nuevo);
    expect(loGanado(db)).toBe(antes);

    // Y la Academia migrada funciona: quien leyó y sabe la respuesta aprueba.
    const otra = "GLECTORANUEVA0000000000000000000000000000000000000000000000";
    const { token } = startReading(db, otra, 3);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(Date.now() - 70_000, token);
    const quiz = getQuiz(db, otra, token);
    const correctas = quiz.map((q) => {
      const f = nuevo.find((x) => x.id === q.id)!;
      return q.options.indexOf((JSON.parse(f.options) as string[])[f.correct]);
    });
    expect(gradeQuiz(db, otra, token, quiz.map((q) => q.id), correctas).passed).toBe(true);
  });

  it("una pregunta que ya no tiene la forma anterior exacta no se toca", () => {
    const { db } = baseProduccionAcademia();
    prepararSqlite(db, { archivo: null, founderWallet: null, sembrar: false }); // columnas nuevas, sin migrar el quiz
    const [editada, otraCorrecta] = REORDEN_OPCIONES_S4.slice(5, 7);
    db.prepare(`UPDATE academia_quiz SET options = ? WHERE question = ?`).run(
      JSON.stringify([...editada.antes.slice(0, 3), "Opción editada a mano"]),
      editada.pregunta
    );
    db.prepare(`UPDATE academia_quiz SET correct = 2 WHERE question = ?`).run(otraCorrecta.pregunta);
    const fila = (pregunta: string) =>
      db.prepare(`SELECT options, correct FROM academia_quiz WHERE question = ?`).get(pregunta) as { options: string; correct: number };
    const antes = [fila(editada.pregunta), fila(otraCorrecta.pregunta)];
    vi.spyOn(console, "info").mockImplementation(() => {});

    expect(reordenarOpcionesAcademia(db)).toBe(REORDEN_OPCIONES_S4.length - 2);
    expect([fila(editada.pregunta), fila(otraCorrecta.pregunta)]).toEqual(antes);
  });

  it("una lectura con el quiz ya servido sigue viendo lo mismo y se califica igual", () => {
    // Esquema de hoy (con quiz_orden) y el triángulo de activos en su forma anterior.
    const { db } = freshDb();
    const tri = Number(
      db
        .prepare(
          `INSERT INTO academia_content (slug, kind, title, summary, points, min_seconds, ord) VALUES ('tri', 'article', 'Tri', 's', 150, 60, 2)`
        )
        .run().lastInsertRowid
    );
    const preguntas: Array<[string, string[], number]> = [
      ["¿Qué activo paga el trabajo?", ["ZWORK", "Reputación", "USDC", "Ninguno"], 2],
      ...REORDEN_OPCIONES_S4.slice(5, 8).map((r): [string, string[], number] => [r.pregunta, [...r.antes], r.de]),
      ["La emisión de ZWORK sigue...", ["Sin límite", "Un presupuesto por época con techo duro", "El precio de mercado", "La inflación"], 1],
    ];
    const ins = db.prepare(`INSERT INTO academia_quiz (content_id, question, options, correct) VALUES (?, ?, ?, ?)`);
    for (const [q, o, c] of preguntas) ins.run(tri, q, JSON.stringify(o), c);

    const { token } = startReading(db, W, tri);
    db.prepare(`UPDATE reading_sessions SET active_seconds = 65, started_at = ? WHERE token = ?`).run(Date.now() - 70_000, token);
    const visto = getQuiz(db, W, token);
    vi.spyOn(console, "info").mockImplementation(() => {});

    expect(reordenarOpcionesAcademia(db)).toBe(3);
    // Las 3 servidas incluyen al menos una reordenada (2 de las 5 no cambian).
    expect(getQuiz(db, W, token)).toEqual(visto);
    const correctaDe = (texto: string) => preguntas.find(([q]) => q === texto)!;
    const respuestas = visto.map((q) => {
      const [, o, c] = correctaDe(q.question);
      return q.options.indexOf(o[c]);
    });
    expect(gradeQuiz(db, W, token, visto.map((q) => q.id), respuestas).passed).toBe(true);
  });

  it("si la migración falla, el arranque sigue y no queda nada a medias", () => {
    const { db } = baseProduccionAcademia();
    prepararSqlite(db, { archivo: null, founderWallet: null, sembrar: false }); // columnas nuevas, sin migrar el quiz
    db.exec(
      `INSERT INTO reading_sessions (token, wallet, content_id, started_at, active_seconds, last_beat, quiz_ids, quiz_orden)
       VALUES ('en-curso', '${LECTORA}', 2, 3000, 70, 3000, '[6,7,8]', '[[0,1,2,3],[0,1,2,3],[0,1,2,3]]')`
    );
    const antes = quizDe(db);
    const rota: DB = {
      ...db,
      prepare: (sql: string) => {
        // Falla DESPUÉS de reordenar: la transacción tiene que deshacer lo reordenado.
        if (sql.includes("FROM reading_sessions WHERE completed = 0")) throw new Error("fallo simulado");
        return db.prepare(sql);
      },
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => seedIfEmpty(rota, {} as NodeJS.ProcessEnv)).not.toThrow();
    expect(error.mock.calls.some((c) => /orden de opciones de la Academia/.test(String(c[0])))).toBe(true);
    expect(quizDe(db)).toEqual(antes);
    // En el arranque siguiente se reintenta y sale bien.
    expect(reordenarOpcionesAcademia(db)).toBe(REORDEN_OPCIONES_S4.length);
  });
});
