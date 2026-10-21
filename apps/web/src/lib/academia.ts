/**
 * Motor anti-bot de la Academia. Reglas:
 *  (a) tiempo mínimo activo por contenido (heartbeats server-side; pestaña oculta no cuenta)
 *  (b) quiz de 3 preguntas rotadas de un pool; aprobar 2/3 desbloquea puntos
 *  (c) cap diario: máx 3 contenidos con puntos por wallet
 *  (d) rendimientos decrecientes: 1º 100%, 2º 75%, 3º 50%
 *  (e) los puntos van al eje Investigación/Contenido (bucket 'academia')
 *  (f) presupuesto de época separado de Academia
 * Una sola sesión de lectura activa por wallet.
 *
 * Hallazgo A2 (auditoría 2026-10-21): el quiz se aprobaba sin leer. Se podía mandar la
 * misma pregunta tres veces o preguntas que no se sirvieron, recalificar una lectura
 * reprobada con el mismo token (fuerza bruta sin límite) y pedir el quiz sin límite
 * para recorrer el pool. Ahora:
 *  - Puntos y reputación SOLO desde una sesión de lectura de ESA cuenta (token + wallet),
 *    de ESE contenido, con el tiempo mínimo cumplido (activo por heartbeats y real).
 *  - Las preguntas servidas quedan guardadas en la sesión (`quiz_ids`): pedir el quiz
 *    otra vez devuelve las MISMAS, y la calificación exige exactamente esas, distintas.
 *  - Una sesión se califica UNA vez (`graded_at`, reclamada con un UPDATE condicional).
 *  - Las respuestas correctas nunca salen del servidor: el quiz no las trae y, si no
 *    apruebas, ni siquiera se dice cuántas acertaste (sería una pista para adivinar).
 *  - Tras un intento fallido hay que esperar `ACADEMIA_ESPERA_TRAS_FALLO_MS` y volver a
 *    leer (sesión nueva con su tiempo mínimo), con un máximo de
 *    `ACADEMIA_FALLOS_MAX_24H` intentos fallidos por contenido en 24 horas.
 * Nada de esto quita lo ya otorgado: `academia_awards`, `points_ledger` y
 * `reputation_events` solo reciben inserciones.
 */
import type { DB } from "./db";
import { randomToken } from "./crypto";
import { getActiveGenome, currentEpoch } from "./genome";
import { puntosDeEpoca } from "./gamificacion";

/**
 * Límites anti-abuso del quiz (como los límites de intentos de las rutas, no son
 * parámetros de incentivos: no cambian cuántos puntos da nada). Tras un intento
 * fallido, 15 minutos de espera y una lectura nueva; como mucho 3 intentos fallidos
 * por contenido en 24 horas.
 */
export const ACADEMIA_ESPERA_TRAS_FALLO_MS = 15 * 60_000;
export const ACADEMIA_FALLOS_MAX_24H = 3;
const VENTANA_FALLOS_MS = 24 * 60 * 60_000;

/** Preguntas por quiz y mínimo para aprobar. */
const PREGUNTAS_POR_QUIZ = 3;
const ACIERTOS_PARA_APROBAR = 2;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Error con código para que la ruta elija el status sin leer el texto. */
export class AcademiaError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AcademiaError";
    this.code = code;
  }
}

function minutosHasta(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/**
 * ¿Puede esta cuenta empezar otra lectura de este contenido? Lanza `RETRY_WAIT` si su
 * último intento fallido fue hace menos de la espera o si ya agotó los fallidos de 24 h.
 * Solo cuenta lecturas calificadas con `graded_at` (las de antes del arreglo no lo tienen).
 */
function exigirEsperaTrasFallo(db: DB, wallet: string, contentId: number, now: number): void {
  const fallos = db
    .prepare(
      `SELECT graded_at FROM reading_sessions
        WHERE wallet = ? AND content_id = ? AND completed = 1 AND passed = 0
          AND graded_at IS NOT NULL AND graded_at > ?
        ORDER BY graded_at DESC`
    )
    .all(wallet, contentId, now - VENTANA_FALLOS_MS) as Array<{ graded_at: number }>;
  if (fallos.length >= ACADEMIA_FALLOS_MAX_24H) {
    const libera = fallos[ACADEMIA_FALLOS_MAX_24H - 1].graded_at + VENTANA_FALLOS_MS;
    throw new AcademiaError(
      "RETRY_WAIT",
      `Llegaste al máximo de ${ACADEMIA_FALLOS_MAX_24H} intentos de este contenido en 24 horas. ` +
        `Podrás intentarlo de nuevo en ${Math.ceil((libera - now) / 3_600_000)} h.`
    );
  }
  const ultimo = fallos[0]?.graded_at;
  if (ultimo !== undefined && now - ultimo < ACADEMIA_ESPERA_TRAS_FALLO_MS) {
    const faltan = ACADEMIA_ESPERA_TRAS_FALLO_MS - (now - ultimo);
    throw new AcademiaError(
      "RETRY_WAIT",
      `No aprobaste el intento anterior. Vuelve a leer con calma: podrás intentarlo de nuevo en ${minutosHasta(faltan)} min.`
    );
  }
}

export function startReading(
  db: DB,
  wallet: string,
  contentId: number,
  now: number = Date.now()
): { token: string; minSeconds: number } {
  const content = db.prepare(`SELECT id, min_seconds, enabled FROM academia_content WHERE id = ?`).get(contentId) as
    | { id: number; min_seconds: number; enabled: number }
    | undefined;
  if (!content || !content.enabled) throw new AcademiaError("NOT_AVAILABLE", "Contenido no disponible.");
  exigirEsperaTrasFallo(db, wallet, content.id, now);
  // Una sesión activa por wallet: descarta las incompletas previas.
  db.prepare(`DELETE FROM reading_sessions WHERE wallet = ? AND completed = 0`).run(wallet);
  const token = randomToken(24);
  db.prepare(
    `INSERT INTO reading_sessions (token, wallet, content_id, started_at, active_seconds, last_beat)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(token, wallet, contentId, now, now);
  return { token, minSeconds: content.min_seconds };
}

export function heartbeat(db: DB, wallet: string, token: string): { activeSeconds: number } {
  const s = db.prepare(`SELECT * FROM reading_sessions WHERE token = ? AND wallet = ?`).get(token, wallet) as
    | { token: string; active_seconds: number; last_beat: number; completed: number }
    | undefined;
  if (!s) throw new AcademiaError("NO_SESSION", "Sesión de lectura no encontrada.");
  if (s.completed) return { activeSeconds: s.active_seconds };
  const now = Date.now();
  const delta = Math.min(20, Math.max(0, Math.round((now - s.last_beat) / 1000)));
  const active = s.active_seconds + delta;
  db.prepare(`UPDATE reading_sessions SET active_seconds = ?, last_beat = ? WHERE token = ?`).run(active, now, token);
  return { activeSeconds: active };
}

interface SesionLectura {
  token: string;
  wallet: string;
  content_id: number;
  started_at: number;
  active_seconds: number;
  completed: number;
  passed: number;
  quiz_ids: string | null;
}

/**
 * La sesión de lectura de ESTA cuenta, sin calificar y con el tiempo mínimo cumplido
 * (activo por heartbeats Y real transcurrido). Si no, lanza.
 */
function getSessionForQuiz(db: DB, wallet: string, token: string, now: number): SesionLectura {
  const s = db.prepare(`SELECT * FROM reading_sessions WHERE token = ? AND wallet = ?`).get(token, wallet) as
    | SesionLectura
    | undefined;
  if (!s) throw new AcademiaError("NO_SESSION", "Sesión de lectura no encontrada.");
  if (s.completed) {
    throw new AcademiaError(
      "ALREADY_GRADED",
      "Esta lectura ya se calificó. Para intentarlo de nuevo, vuelve a leer el contenido."
    );
  }
  const content = db.prepare(`SELECT min_seconds, enabled FROM academia_content WHERE id = ?`).get(s.content_id) as
    | { min_seconds: number; enabled: number }
    | undefined;
  if (!content || !content.enabled) throw new AcademiaError("NOT_AVAILABLE", "Contenido no disponible.");
  const elapsedSec = (now - s.started_at) / 1000;
  // El servidor valida el tiempo transcurrido real Y el tiempo activo por heartbeats.
  if (s.active_seconds < content.min_seconds || elapsedSec < content.min_seconds) {
    throw new AcademiaError("TOO_SOON", "Aún no cumples el tiempo mínimo de lectura.");
  }
  return s;
}

/** Ids servidos guardados en la sesión, o null si todavía no se pidió el quiz. */
function idsServidos(s: SesionLectura): number[] | null {
  if (!s.quiz_ids) return null;
  try {
    const ids = JSON.parse(s.quiz_ids) as unknown;
    if (Array.isArray(ids) && ids.every((n) => Number.isInteger(n))) return ids as number[];
  } catch {
    /* fila rota: se trata como no servida */
  }
  return null;
}

export interface PreguntaQuiz {
  id: number;
  question: string;
  options: string[];
}

/**
 * Las preguntas del quiz de esta lectura (sin respuestas). La primera vez elige 3 al
 * azar del pool del contenido y las guarda en la sesión; después devuelve SIEMPRE las
 * mismas, así que pedirlo muchas veces no recorre el pool.
 */
export function getQuiz(db: DB, wallet: string, token: string, now: number = Date.now()): PreguntaQuiz[] {
  const s = getSessionForQuiz(db, wallet, token, now);
  let ids = idsServidos(s);
  if (!ids) {
    // Selección aleatoria de 3 preguntas del pool (rotación).
    const elegidas = (
      db
        .prepare(`SELECT id FROM academia_quiz WHERE content_id = ? ORDER BY RANDOM() LIMIT ${PREGUNTAS_POR_QUIZ}`)
        .all(s.content_id) as Array<{ id: number }>
    ).map((q) => q.id);
    // Condicional: si dos pedidos llegan a la vez, gana el primero y ambos ven lo mismo.
    db.prepare(`UPDATE reading_sessions SET quiz_ids = ? WHERE token = ? AND quiz_ids IS NULL`).run(
      JSON.stringify(elegidas),
      token
    );
    const guardada = db.prepare(`SELECT quiz_ids FROM reading_sessions WHERE token = ?`).get(token) as {
      quiz_ids: string | null;
    };
    ids = idsServidos({ ...s, quiz_ids: guardada.quiz_ids }) ?? elegidas;
  }
  const pregunta = db.prepare(`SELECT id, question, options FROM academia_quiz WHERE id = ? AND content_id = ?`);
  return ids
    .map((id) => pregunta.get(id, s.content_id) as { id: number; question: string; options: string } | undefined)
    .filter((q): q is { id: number; question: string; options: string } => !!q)
    .map((q) => ({ id: q.id, question: q.question, options: JSON.parse(q.options) as string[] }));
}

export interface GradeResult {
  passed: boolean;
  /** Aciertos, solo si aprobaste: si no, no se dice (sería una pista para adivinar). */
  correct: number | null;
  points: number;
  /** Si no aprobaste: minutos de espera antes de volver a leer. */
  reintentarEnMin?: number;
}

export function gradeQuiz(
  db: DB,
  wallet: string,
  token: string,
  quizIds: number[],
  answers: number[],
  now: number = Date.now()
): GradeResult {
  const s = getSessionForQuiz(db, wallet, token, now);
  const servidos = idsServidos(s);
  if (!servidos) {
    throw new AcademiaError("NO_QUIZ", "Primero pide las preguntas de esta lectura.");
  }
  // Exactamente las preguntas servidas en esta lectura, cada una una vez.
  const mismas =
    Array.isArray(quizIds) &&
    Array.isArray(answers) &&
    quizIds.length === servidos.length &&
    answers.length === quizIds.length &&
    new Set(quizIds).size === quizIds.length &&
    quizIds.every((id) => servidos.includes(id));
  if (!mismas) {
    throw new AcademiaError("BAD_QUIZ", "Las respuestas no corresponden a las preguntas de esta lectura.");
  }
  const content = db.prepare(`SELECT id, points FROM academia_content WHERE id = ?`).get(s.content_id) as {
    id: number;
    points: number;
  };

  // Califica contra las respuestas correctas del servidor (nunca salen de aquí).
  let correct = 0;
  const pregunta = db.prepare(`SELECT correct, content_id FROM academia_quiz WHERE id = ?`);
  for (let i = 0; i < quizIds.length; i++) {
    const q = pregunta.get(quizIds[i]) as { correct: number; content_id: number } | undefined;
    if (!q || q.content_id !== s.content_id) {
      throw new AcademiaError("BAD_QUIZ", "Las respuestas no corresponden a las preguntas de esta lectura.");
    }
    if (q.correct === answers[i]) correct++;
  }
  const passed = correct >= ACIERTOS_PARA_APROBAR;

  // Marca la sesión como calificada pase o no, UNA sola vez: el UPDATE condicional es
  // el que reclama la lectura (un segundo envío con el mismo token no pasa de aquí).
  const reclamada = db
    .prepare(
      `UPDATE reading_sessions SET completed = 1, passed = ?, graded_at = ?
        WHERE token = ? AND wallet = ? AND completed = 0`
    )
    .run(passed ? 1 : 0, now, token, wallet);
  if (Number(reclamada.changes) !== 1) {
    throw new AcademiaError(
      "ALREADY_GRADED",
      "Esta lectura ya se calificó. Para intentarlo de nuevo, vuelve a leer el contenido."
    );
  }

  if (!passed) {
    return { passed: false, correct: null, points: 0, reintentarEnMin: minutosHasta(ACADEMIA_ESPERA_TRAS_FALLO_MS) };
  }

  // Ya premiado por este contenido → no re-otorga.
  const already = db.prepare(`SELECT 1 AS x FROM academia_awards WHERE wallet = ? AND content_id = ?`).get(wallet, content.id);
  if (already) return { passed: true, correct, points: 0 };

  // Parámetros evolutivos desde el genoma activo (nunca hardcodeados — WP02).
  const genome = getActiveGenome(db);

  const day = today();
  const usedToday = (
    db.prepare(`SELECT COUNT(*) AS n FROM academia_awards WHERE wallet = ? AND day = ?`).get(wallet, day) as {
      n: number;
    }
  ).n;
  if (usedToday >= genome.ACADEMIA_DAILY_CAP) {
    throw new AcademiaError("DAILY_CAP", "Alcanzaste el máximo de contenidos con puntos por hoy.");
  }

  const multiplier = genome.ACADEMIA_DIMINISHING[usedToday] ?? 0.5;
  let points = Math.round(content.points * multiplier);

  // Presupuesto de Academia de la época ACTUAL (separado del de ejecución). WP31: antes
  // se sumaba la Academia de todas las épocas contra el presupuesto de una sola.
  const periodId = currentEpoch(db);
  const academiaSpent = puntosDeEpoca(db, periodId, "academia");
  if (academiaSpent + points > genome.ACADEMIA_BUDGET) {
    points = Math.max(0, genome.ACADEMIA_BUDGET - academiaSpent);
  }
  if (points <= 0) {
    throw new AcademiaError("BUDGET", "Presupuesto de Academia de la época agotado.");
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO academia_awards (wallet, content_id, day, ord_of_day, points) VALUES (?, ?, ?, ?, ?)`
    ).run(wallet, content.id, day, usedToday, points);
    db.prepare(
      `INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, ?, 'academia', ?)`
    ).run(wallet, points, periodId, `Academia #${content.id}`);
    db.prepare(
      `INSERT INTO reputation_events (wallet, axis, delta, ref, period_id) VALUES (?, 'investigacion', ?, 'Academia completada', ?)`
    ).run(wallet, Math.max(1, Math.round(points / 15)), periodId);
  });
  tx();

  return { passed: true, correct, points };
}

/** Status HTTP de un error de la Academia (las rutas no leen el texto del mensaje). */
export function statusDeErrorAcademia(e: unknown): number {
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case "TOO_SOON":
      return 403;
    case "RETRY_WAIT":
      return 429;
    case "ALREADY_GRADED":
    case "NO_QUIZ":
    case "DAILY_CAP":
    case "BUDGET":
      return 409;
    default:
      return 400;
  }
}
