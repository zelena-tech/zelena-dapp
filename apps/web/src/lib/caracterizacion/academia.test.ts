/**
 * Prueba de caracterización · Academia (contenido, lectura, quiz y puntos).
 * Ficha: docs/features/academia.md · DFD: docs/dfd/academia.json · Commit de referencia: 0e07d8f.
 *
 * Protege el comportamiento ACTUAL, no el deseado. Recorre el flujo principal tal como lo
 * hace el componente Reader en /academia/[slug]:
 *   POST /api/academia/start → POST /api/academia/heartbeat (cada 15 s) →
 *   GET /api/academia/quiz?token=… → POST /api/academia/quiz
 * con las rutas REALES contra una base SQLite temporal sembrada (`seedIfEmpty`), y comprueba
 * lo que queda en `reading_sessions`, `academia_awards`, `points_ledger` y `reputation_events`.
 *
 * Lo único que se sustituye es `getSession()` (lib/session.ts lee la cookie con
 * `next/headers`, que no existe fuera de una petición de Next): se le da la sesión que
 * entregaría el login. El tiempo se mueve con el reloj falso de vitest (solo `Date`).
 *
 * Los casos "HALLAZGO" fijan rarezas actuales que la auditoría reporta; si alguien las
 * corrige, esta prueba debe actualizarse en el mismo cambio. Los casos "ARREGLADO" eran
 * hallazgos que el release wp/32-release corrigió (A2: ed5d167 y 8530cce) y ahora fijan el
 * arreglo. La prueba unitaria previa del motor está en src/lib/academia.test.ts.
 *
 * Desde 8530cce las opciones de cada pregunta se BARAJAN por lectura: la respuesta que se
 * manda es la posición MOSTRADA. `correctasMostradas` hace lo que haría quien sí leyó:
 * busca en las opciones que le sirvieron el texto de la respuesta correcta.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

const sesion = vi.hoisted(() => ({ actual: null as null | Record<string, unknown> }));

// Las rutas importan con el alias "@/lib/…", que vitest.config.ts no declara: cada alias va
// al módulo REAL. Solo la sesión es un doble (ver arriba).
vi.mock("@/lib/db", () => import("../db"));
vi.mock("@/lib/academia", () => import("../academia"));
vi.mock("@/lib/validation", () => import("../validation"));
vi.mock("@/lib/rate-limit", () => import("../rate-limit"));
vi.mock("@/lib/session", () => ({ getSession: async () => sesion.actual }));

import { openDb, type DB } from "../db";
import { seedIfEmpty } from "../seed";
import { currentEpoch, GENOME_DEFAULTS } from "../genome";
import { ACADEMIA_ESPERA_TRAS_FALLO_MS, ACADEMIA_FALLOS_MAX_24H } from "../academia";
import { listAcademia, getAcademiaBySlug, academiaAwardsToday, academiaAlreadyAwarded, pointsByBucket } from "../repo";
import { POST as postStart } from "../../../app/api/academia/start/route";
import { POST as postHeartbeat } from "../../../app/api/academia/heartbeat/route";
import { GET as getQuizRuta, POST as postQuiz } from "../../../app/api/academia/quiz/route";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
const g = globalThis as unknown as { __zelenaDb?: DB };
const dbPrevia = g.__zelenaDb;

/** 10:00 en Bogotá. */
const T0 = new Date("2026-10-21T15:00:00.000Z");

let db: DB;
let n = 0;
let wallet = "";

function nuevaWallet(): string {
  n++;
  return `GCARACTERIZACIONACADEMIA${String(n).padStart(4, "0")}`.padEnd(56, "X");
}

function sesionDe(w: string, claSigned = true): Record<string, unknown> {
  return { wallet: w, name: "Lectora", tier: "Bronze", isFounder: false, claSigned, isDemo: false, role: "contributor" };
}

function post(url: string, cuerpo: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.200" },
    body: JSON.stringify(cuerpo),
  });
}

function get(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { headers: { "x-forwarded-for": "198.51.100.200" } });
}

let reloj = T0.getTime();
function avanzar(segundos: number): void {
  reloj += segundos * 1000;
  vi.setSystemTime(reloj);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  reloj = T0.getTime();
  vi.setSystemTime(reloj);
  db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedIfEmpty(db, { NODE_ENV: "test" } as NodeJS.ProcessEnv);
  g.__zelenaDb = db;
  wallet = nuevaWallet();
  sesion.actual = sesionDe(wallet);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  g.__zelenaDb = dbPrevia;
});

type Pregunta = { id: number; question: string; options: string[] };

/** Lo que hace Reader: iniciar, latir cada 15 s hasta el mínimo y pedir el quiz. */
async function leerHastaElQuiz(contentId: number): Promise<{ token: string; preguntas: Pregunta[] }> {
  const ini = await postStart(post("/api/academia/start", { contentId }));
  expect(ini.status).toBe(200);
  const { token, minSeconds } = (await ini.json()) as { token: string; minSeconds: number };
  let activos = 0;
  while (activos < minSeconds) {
    avanzar(15);
    const beat = await postHeartbeat(post("/api/academia/heartbeat", { token }));
    expect(beat.status).toBe(200);
    activos = ((await beat.json()) as { activeSeconds: number }).activeSeconds;
  }
  const q = await getQuizRuta(get(`/api/academia/quiz?token=${encodeURIComponent(token)}`));
  expect(q.status).toBe(200);
  return { token, preguntas: ((await q.json()) as { questions: Pregunta[] }).questions };
}

/** Posición MOSTRADA de la respuesta correcta de cada pregunta servida (las opciones vienen barajadas). */
function correctasMostradas(preguntas: Pregunta[]): number[] {
  return preguntas.map((p) => {
    const q = db.prepare(`SELECT options, correct FROM academia_quiz WHERE id = ?`).get(p.id) as { options: string; correct: number };
    const i = p.options.indexOf((JSON.parse(q.options) as string[])[q.correct]);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  });
}

/** Una posición mostrada que NO es la correcta, para cada pregunta. */
function incorrectasMostradas(preguntas: Pregunta[]): number[] {
  return correctasMostradas(preguntas).map((x, k) => (x + 1) % preguntas[k].options.length);
}

async function responder(token: string, quizIds: number[], answers: number[]) {
  const res = await postQuiz(post("/api/academia/quiz", { token, quizIds, answers }));
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> };
}

describe("flujo principal · leer, pasar el quiz y recibir puntos de Academia", () => {
  it("la lista pública trae los contenidos habilitados por `ord`, y el detalle se busca por slug", () => {
    const lista = listAcademia();
    expect(lista.map((c) => c.slug)).toEqual([
      "como-se-mide-el-valor",
      "construir-sin-riesgo",
      "el-triangulo-de-activos",
      "video-que-es-zelena-dao",
    ]);
    expect(lista.map((c) => [c.points, c.min_seconds])).toEqual([
      [150, 45],
      [150, 45],
      [150, 45],
      [100, 60],
    ]);
    expect(getAcademiaBySlug("construir-sin-riesgo")?.id).toBe(lista[1].id);
    expect(getAcademiaBySlug("no-existe")).toBeUndefined();
  });

  it("de punta a punta: start → heartbeats → quiz (sin respuestas) → 3/3 → +150 pts, ledger y reputación", async () => {
    const c = listAcademia()[0];

    // 1. Iniciar: una sesión de lectura con token y el mínimo del contenido.
    const ini = await postStart(post("/api/academia/start", { contentId: c.id }));
    expect(ini.status).toBe(200);
    const inicio = (await ini.json()) as { ok: boolean; token: string; minSeconds: number };
    expect(inicio).toMatchObject({ ok: true, minSeconds: 45 });
    expect(inicio.token).toMatch(/^[A-Za-z0-9_-]{32}$/); // randomToken(24): 24 bytes en base64url
    expect(db.prepare(`SELECT wallet, content_id, active_seconds, completed FROM reading_sessions WHERE token = ?`).get(inicio.token)).toEqual({
      wallet,
      content_id: c.id,
      active_seconds: 0,
      completed: 0,
    });

    // 2. Antes del mínimo, el quiz se niega con 403.
    const pronto = await getQuizRuta(get(`/api/academia/quiz?token=${inicio.token}`));
    expect(pronto.status).toBe(403);
    expect(await pronto.json()).toEqual({ error: "Aún no cumples el tiempo mínimo de lectura." });

    // 3. Latidos cada 15 s: el servidor suma el tiempo real entre latidos (tope 20 s por latido).
    const activos: number[] = [];
    for (let i = 0; i < 3; i++) {
      avanzar(15);
      const r = await postHeartbeat(post("/api/academia/heartbeat", { token: inicio.token }));
      activos.push(((await r.json()) as { activeSeconds: number }).activeSeconds);
    }
    expect(activos).toEqual([15, 30, 45]);

    // 4. El quiz: 3 preguntas del contenido, sin la respuesta correcta, con las opciones
    //    barajadas para ESTA lectura (8530cce) y guardadas en la sesión (ed5d167).
    const q = await getQuizRuta(get(`/api/academia/quiz?token=${inicio.token}`));
    expect(q.status).toBe(200);
    const { questions } = (await q.json()) as { questions: Pregunta[] };
    expect(questions).toHaveLength(3);
    for (const p of questions) {
      expect(Object.keys(p).sort()).toEqual(["id", "options", "question"]);
      expect(Array.isArray(p.options)).toBe(true);
    }
    const servido = db.prepare(`SELECT quiz_ids, quiz_orden FROM reading_sessions WHERE token = ?`).get(inicio.token) as {
      quiz_ids: string;
      quiz_orden: string;
    };
    expect(JSON.parse(servido.quiz_ids)).toEqual(questions.map((p) => p.id));
    expect((JSON.parse(servido.quiz_orden) as number[][]).map((o) => [...o].sort())).toEqual(questions.map((p) => p.options.map((_, i) => i)));
    // Pedirlo otra vez devuelve exactamente lo mismo (no recorre el pool ni rebaraja).
    const otraVez = await getQuizRuta(get(`/api/academia/quiz?token=${inicio.token}`));
    expect(((await otraVez.json()) as { questions: Pregunta[] }).questions).toEqual(questions);

    // 5. Responder bien las 3: aprueba y gana los puntos completos (1.º del día = 100 %).
    const ids = questions.map((p) => p.id);
    const r = await responder(inicio.token, ids, correctasMostradas(questions));
    expect(r).toEqual({ status: 200, cuerpo: { ok: true, passed: true, correct: 3, points: 150 } });

    // 6. Lo que queda escrito.
    const periodo = currentEpoch(db);
    expect(db.prepare(`SELECT completed, passed, graded_at FROM reading_sessions WHERE token = ?`).get(inicio.token)).toEqual({
      completed: 1,
      passed: 1,
      graded_at: reloj,
    });
    expect(db.prepare(`SELECT content_id, day, ord_of_day, points FROM academia_awards WHERE wallet = ?`).all(wallet)).toEqual([
      { content_id: c.id, day: "2026-10-21", ord_of_day: 0, points: 150 },
    ]);
    expect(db.prepare(`SELECT points, period_id, bucket, ref FROM points_ledger WHERE wallet = ?`).all(wallet)).toEqual([
      { points: 150, period_id: periodo, bucket: "academia", ref: `Academia #${c.id}` },
    ]);
    expect(db.prepare(`SELECT axis, delta, ref, period_id FROM reputation_events WHERE wallet = ?`).all(wallet)).toEqual([
      { axis: "investigacion", delta: 10, ref: "Academia completada", period_id: periodo }, // max(1, round(150/15))
    ]);

    // 7. Lo que la página vuelve a pintar (router.refresh()).
    expect(academiaAlreadyAwarded(wallet, c.id)).toBe(true);
    expect(academiaAwardsToday(wallet, "2026-10-21")).toBe(1);
    expect(pointsByBucket(wallet)).toEqual({ ejecucion: 0, academia: 150 });
  });

  it("rendimientos decrecientes y tope diario del genoma: 100 %, 75 %, 50 % y el 4.º → 409", async () => {
    expect(GENOME_DEFAULTS.ACADEMIA_DIMINISHING).toEqual([1, 0.75, 0.5]);
    expect(GENOME_DEFAULTS.ACADEMIA_DAILY_CAP).toBe(3);
    const lista = listAcademia();
    const puntos: number[] = [];
    for (const c of lista.slice(0, 3)) {
      const { token, preguntas } = await leerHastaElQuiz(c.id);
      const ids = preguntas.map((p) => p.id);
      const r = await responder(token, ids, correctasMostradas(preguntas));
      expect(r.status).toBe(200);
      puntos.push(r.cuerpo.points as number);
    }
    expect(puntos).toEqual([150, 113, 75]); // Math.round(150 × 0,75) = 113

    const { token, preguntas } = await leerHastaElQuiz(lista[3].id);
    const ids = preguntas.map((p) => p.id);
    const cuarto = await responder(token, ids, correctasMostradas(preguntas));
    expect(cuarto).toEqual({ status: 409, cuerpo: { error: "Alcanzaste el máximo de contenidos con puntos por hoy." } });
    expect(academiaAwardsToday(wallet, "2026-10-21")).toBe(3);
  });

  it("menos de 2 correctas: no aprueba, 0 puntos, nada en el ledger y no dice cuántas acertó", async () => {
    const c = listAcademia()[0];
    const { token, preguntas } = await leerHastaElQuiz(c.id);
    const ids = preguntas.map((p) => p.id);
    const r = await responder(token, ids, incorrectasMostradas(preguntas));
    // ed5d167: un intento fallido no revela los aciertos (`correct: null`) y dice cuánto esperar.
    expect(r).toEqual({ status: 200, cuerpo: { ok: true, passed: false, correct: null, points: 0, reintentarEnMin: 15 } });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ?`).get(wallet)).toEqual({ n: 0 });
    expect(db.prepare(`SELECT completed, passed, graded_at FROM reading_sessions WHERE token = ?`).get(token)).toEqual({
      completed: 1,
      passed: 0,
      graded_at: reloj,
    });
  });

  it("un contenido ya premiado no vuelve a dar puntos (200 con points: 0)", async () => {
    const c = listAcademia()[0];
    for (const esperado of [150, 0]) {
      const { token, preguntas } = await leerHastaElQuiz(c.id);
      const ids = preguntas.map((p) => p.id);
      const r = await responder(token, ids, correctasMostradas(preguntas));
      expect(r.cuerpo).toMatchObject({ passed: true, points: esperado });
    }
    expect(db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ?`).get(wallet)).toEqual({ n: 1 });
  });

  it("iniciar otra lectura descarta la sesión incompleta anterior (una activa por wallet)", async () => {
    const [a, b] = listAcademia();
    const t1 = ((await (await postStart(post("/api/academia/start", { contentId: a.id }))).json()) as { token: string }).token;
    const t2 = ((await (await postStart(post("/api/academia/start", { contentId: b.id }))).json()) as { token: string }).token;
    expect(db.prepare(`SELECT token FROM reading_sessions WHERE wallet = ?`).all(wallet)).toEqual([{ token: t2 }]);
    const viejo = await postHeartbeat(post("/api/academia/heartbeat", { token: t1 }));
    expect(viejo.status).toBe(400);
    expect(await viejo.json()).toEqual({ error: "Sesión de lectura no encontrada." });
  });
});

describe("puertas y fallas", () => {
  it("sin sesión, o con sesión sin el acuerdo firmado: 401 en las cuatro llamadas", async () => {
    const c = listAcademia()[0];
    for (const s of [null, sesionDe(wallet, false)]) {
      sesion.actual = s;
      expect((await postStart(post("/api/academia/start", { contentId: c.id }))).status).toBe(401);
      expect((await postHeartbeat(post("/api/academia/heartbeat", { token: "x".repeat(48) }))).status).toBe(401);
      expect((await getQuizRuta(get(`/api/academia/quiz?token=${"x".repeat(48)}`))).status).toBe(401);
      expect((await postQuiz(post("/api/academia/quiz", { token: "x".repeat(48), quizIds: [1, 2, 3], answers: [0, 0, 0] }))).status).toBe(401);
    }
    sesion.actual = null;
    const r = await postStart(post("/api/academia/start", { contentId: c.id }));
    expect(await r.json()).toEqual({ error: "Debes entrar y firmar el CLA." });
  });

  it("contenido deshabilitado por el admin: start → 400; su página por slug sigue respondiendo", async () => {
    const c = listAcademia()[0];
    db.prepare(`UPDATE academia_content SET enabled = 0 WHERE id = ?`).run(c.id);
    const r = await postStart(post("/api/academia/start", { contentId: c.id }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Contenido no disponible." });
    expect(listAcademia().some((x) => x.id === c.id)).toBe(false);
    expect(getAcademiaBySlug(c.slug)?.id).toBe(c.id); // HALLAZGO: el detalle no filtra `enabled`
  });

  it("entrada inválida → 400 'Entrada inválida.'; token de otra wallet → 400", async () => {
    expect((await postStart(post("/api/academia/start", { contentId: "uno" }))).status).toBe(400);
    expect((await postQuiz(post("/api/academia/quiz", { token: "x".repeat(48), quizIds: [1, 2], answers: [0, 0] }))).status).toBe(400);
    const { token } = await leerHastaElQuiz(listAcademia()[0].id);
    sesion.actual = sesionDe(nuevaWallet());
    const ajeno = await getQuizRuta(get(`/api/academia/quiz?token=${token}`));
    expect(ajeno.status).toBe(400);
    expect(await ajeno.json()).toEqual({ error: "Sesión de lectura no encontrada." });
  });

  it("presupuesto de Academia de la época agotado → 409 y no escribe", async () => {
    const periodo = currentEpoch(db);
    const gastado = pointsByBucketDeEpoca(periodo);
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES ('GOTRA', ?, ?, 'academia', 'Previo')`).run(
      GENOME_DEFAULTS.ACADEMIA_BUDGET - gastado,
      periodo
    );
    const { token, preguntas } = await leerHastaElQuiz(listAcademia()[0].id);
    const ids = preguntas.map((p) => p.id);
    const r = await responder(token, ids, correctasMostradas(preguntas));
    expect(r).toEqual({ status: 409, cuerpo: { error: "Presupuesto de Academia de la época agotado." } });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM academia_awards WHERE wallet = ?`).get(wallet)).toEqual({ n: 0 });
  });
});

function pointsByBucketDeEpoca(periodo: number): number {
  return (
    db.prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger WHERE period_id = ? AND bucket = 'academia'`).get(periodo) as {
      n: number;
    }
  ).n;
}

describe("rarezas actuales (HALLAZGOS de la auditoría) y arreglos de A2", () => {
  it("ARREGLADO: el quiz exige exactamente las preguntas servidas, distintas (ni repetidas ni del resto del pool)", async () => {
    // ed5d167: antes la MISMA pregunta repetida tres veces aprobaba (+150).
    const c = listAcademia()[0];
    const { token, preguntas } = await leerHastaElQuiz(c.id);
    const una = preguntas[0].id;
    const buena = correctasMostradas([preguntas[0]])[0];
    const NO_CORRESPONDEN = { error: "Las respuestas no corresponden a las preguntas de esta lectura." };
    expect(await responder(token, [una, una, una], [buena, buena, buena])).toEqual({ status: 400, cuerpo: NO_CORRESPONDEN });
    // Una pregunta del mismo contenido que NO se sirvió en esta lectura tampoco vale.
    const ids = preguntas.map((p) => p.id);
    const fuera = (
      db.prepare(`SELECT id FROM academia_quiz WHERE content_id = ? AND id NOT IN (${ids.join(",")}) LIMIT 1`).get(c.id) as { id: number }
    ).id;
    expect(await responder(token, [fuera, ids[1], ids[2]], [0, 0, 0])).toEqual({ status: 400, cuerpo: NO_CORRESPONDEN });
    // Esos envíos no gastan la lectura: con las servidas, aprueba.
    expect((await responder(token, ids, correctasMostradas(preguntas))).cuerpo).toMatchObject({ passed: true, correct: 3, points: 150 });
  });

  it("ARREGLADO: una lectura se califica UNA vez; tras fallar hay que esperar 15 min y volver a leer (máx. 3 fallos en 24 h)", async () => {
    // ed5d167: antes una sesión reprobada se volvía a calificar con el mismo token.
    const c = listAcademia()[0];
    const { token, preguntas } = await leerHastaElQuiz(c.id);
    const ids = preguntas.map((p) => p.id);
    expect((await responder(token, ids, incorrectasMostradas(preguntas))).cuerpo).toMatchObject({ passed: false });
    // El mismo token, otra vez, ahora con las correctas: 409 y sin puntos.
    expect(await responder(token, ids, correctasMostradas(preguntas))).toEqual({
      status: 409,
      cuerpo: { error: "Esta lectura ya se calificó. Para intentarlo de nuevo, vuelve a leer el contenido." },
    });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ?`).get(wallet)).toEqual({ n: 0 });

    // Volver a leer enseguida: 429 hasta que pasen los 15 minutos.
    expect(ACADEMIA_ESPERA_TRAS_FALLO_MS).toBe(15 * 60_000);
    const pronto = await postStart(post("/api/academia/start", { contentId: c.id }));
    expect(pronto.status).toBe(429);
    expect(((await pronto.json()) as { error: string }).error).toMatch(/^No aprobaste el intento anterior\..*15 min\.$/);

    // Dos fallos más (con su espera) agotan los 3 del día para ese contenido.
    expect(ACADEMIA_FALLOS_MAX_24H).toBe(3);
    for (let k = 0; k < 2; k++) {
      avanzar(15 * 60);
      const otra = await leerHastaElQuiz(c.id);
      expect((await responder(otra.token, otra.preguntas.map((p) => p.id), incorrectasMostradas(otra.preguntas))).cuerpo).toMatchObject({
        passed: false,
      });
    }
    avanzar(15 * 60);
    const agotado = await postStart(post("/api/academia/start", { contentId: c.id }));
    expect(agotado.status).toBe(429);
    expect(((await agotado.json()) as { error: string }).error).toMatch(/^Llegaste al máximo de 3 intentos de este contenido en 24 horas\./);
    // Otro contenido sí se puede leer.
    expect((await postStart(post("/api/academia/start", { contentId: listAcademia()[1].id }))).status).toBe(200);
  });

  it("ARREGLADO: pedir el quiz tiene límite (20 por minuto) y siempre trae lo mismo para la misma lectura", async () => {
    const { token, preguntas } = await leerHastaElQuiz(listAcademia()[0].id); // ya hizo 1 pedido
    for (let i = 0; i < 19; i++) {
      const r = await getQuizRuta(get(`/api/academia/quiz?token=${token}`));
      expect(r.status).toBe(200);
      expect(((await r.json()) as { questions: Pregunta[] }).questions).toEqual(preguntas);
    }
    const vigesimoPrimero = await getQuizRuta(get(`/api/academia/quiz?token=${token}`));
    expect(vigesimoPrimero.status).toBe(429);
    expect(await vigesimoPrimero.json()).toEqual({ error: "Demasiadas solicitudes." });
  });

  it("ARREGLADO: en la siembra ninguna posición concentra las respuestas correctas (máx. 2 por contenido)", () => {
    // 8530cce: antes la correcta era la segunda opción en 15 de las 20 preguntas sembradas.
    const porPosicion = db
      .prepare(`SELECT content_id, correct, COUNT(*) AS n FROM academia_quiz GROUP BY content_id, correct`)
      .all() as Array<{ content_id: number; correct: number; n: number }>;
    expect(porPosicion.length).toBeGreaterThan(0);
    expect(Math.max(...porPosicion.map((f) => f.n))).toBeLessThanOrEqual(2);
  });

  it("HALLAZGO: el día del tope diario es el día UTC, no el de Bogotá (BUSINESS_TZ del genoma)", async () => {
    // 23:30 del 21 en Bogotá = 04:30 UTC del 22.
    reloj = new Date("2026-10-22T04:30:00.000Z").getTime();
    vi.setSystemTime(reloj);
    const { token, preguntas } = await leerHastaElQuiz(listAcademia()[0].id);
    const ids = preguntas.map((p) => p.id);
    await responder(token, ids, correctasMostradas(preguntas));
    expect(db.prepare(`SELECT day FROM academia_awards WHERE wallet = ?`).get(wallet)).toEqual({ day: "2026-10-22" });
  });
});
