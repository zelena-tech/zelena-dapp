import { describe, it, expect, beforeEach } from "vitest";
import { openDb, prepararSqlite } from "./db";
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
    // todas correctas (correct=1)
    const r1 = gradeQuiz(db, W, token, ids, [1, 1, 1]);
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
    const ids2 = getQuiz(db, W, otra.token).map((q) => q.id);
    const r2 = gradeQuiz(db, W, otra.token, ids2, [1, 1, 1]);
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
    const r = gradeQuiz(db, W, token, ids, [0, 0, 0]); // todas incorrectas
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
    const ids = getQuiz(db, W, token).map((q) => q.id);
    return gradeQuiz(db, W, token, ids, [1, 1, 1]);
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
      const ids = getQuiz(db, W, token).map((q) => q.id);
      expect(gradeQuiz(db, W, token, ids, [2, 2, 2]).points).toBe(200);
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
      const r = gradeQuiz(db, W, token, quiz.map((q) => q.id), [0, 0, 0]);
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
      const servidas = getQuiz(db, W, token).map((q) => q.id);
      const noServida = idsDe(cid, 5).find((id) => !servidas.includes(id))!;
      expect(() => gradeQuiz(db, W, token, [servidas[0], servidas[1], noServida], [1, 1, 1])).toThrow(/no corresponden/);
      expect(ganado(W)).toEqual(nada);
      // El orden puede cambiar; el conjunto, no.
      expect(gradeQuiz(db, W, token, [servidas[2], servidas[0], servidas[1]], [1, 1, 1]).passed).toBe(true);
    });

    it("una lectura reprobada no se recalifica con el mismo token", () => {
      const token = leida(W, cid);
      const ids = getQuiz(db, W, token).map((q) => q.id);
      expect(gradeQuiz(db, W, token, ids, [0, 0, 0]).passed).toBe(false);
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
      const ids = getQuiz(db, W, token).map((q) => q.id);
      gradeQuiz(db, W, token, ids, [0, 0, 0]);
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
        const ids = getQuiz(db, W, token).map((q) => q.id);
        expect(gradeQuiz(db, W, token, ids, [0, 0, 0]).passed).toBe(false);
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
    const ids1 = getQuiz(db, W, t1).map((q) => q.id);
    expect(gradeQuiz(db, W, t1, ids1, [1, 1, 1]).points).toBe(150);
    const antes = ganado(W);
    const t2 = leida(W, cid);
    const ids2 = getQuiz(db, W, t2).map((q) => q.id);
    expect(gradeQuiz(db, W, t2, ids2, [0, 0, 0]).passed).toBe(false);
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
    const ids = getQuiz(db, OTRA_PROD, token).map((q) => q.id);
    expect(gradeQuiz(db, OTRA_PROD, token, ids, [1, 1, 1]).points).toBe(150);
    expect(() => gradeQuiz(db, OTRA_PROD, token, ids, [1, 1, 1])).toThrow(/ya se calificó/);

    // Segundo arranque: no añade nada más.
    expect(prepararSqlite(db, { archivo: null, founderWallet: null, sembrar: false }).preColumnas).toEqual([]);
  });
});
