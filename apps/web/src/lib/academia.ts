/**
 * Motor anti-bot de la Academia. Reglas:
 *  (a) tiempo mínimo activo por contenido (heartbeats server-side; pestaña oculta no cuenta)
 *  (b) quiz de 3 preguntas rotadas de un pool; aprobar 2/3 desbloquea puntos
 *  (c) cap diario: máx 3 contenidos con puntos por wallet
 *  (d) rendimientos decrecientes: 1º 100%, 2º 75%, 3º 50%
 *  (e) los puntos van al eje Investigación/Contenido (bucket 'academia')
 *  (f) presupuesto de época separado de Academia
 * Una sola sesión de lectura activa por wallet.
 */
import type { DB } from "./db";
import { randomToken } from "./crypto";
import { getActiveGenome, currentEpoch } from "./genome";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function startReading(db: DB, wallet: string, contentId: number): { token: string; minSeconds: number } {
  const content = db.prepare(`SELECT id, min_seconds, enabled FROM academia_content WHERE id = ?`).get(contentId) as
    | { id: number; min_seconds: number; enabled: number }
    | undefined;
  if (!content || !content.enabled) throw new Error("Contenido no disponible.");
  // Una sesión activa por wallet: descarta las incompletas previas.
  db.prepare(`DELETE FROM reading_sessions WHERE wallet = ? AND completed = 0`).run(wallet);
  const token = randomToken(24);
  const now = Date.now();
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
  if (!s) throw new Error("Sesión de lectura no encontrada.");
  if (s.completed) return { activeSeconds: s.active_seconds };
  const now = Date.now();
  const delta = Math.min(20, Math.max(0, Math.round((now - s.last_beat) / 1000)));
  const active = s.active_seconds + delta;
  db.prepare(`UPDATE reading_sessions SET active_seconds = ?, last_beat = ? WHERE token = ?`).run(active, now, token);
  return { activeSeconds: active };
}

function getSessionForQuiz(db: DB, wallet: string, token: string) {
  const s = db.prepare(`SELECT * FROM reading_sessions WHERE token = ? AND wallet = ?`).get(token, wallet) as
    | {
        token: string;
        wallet: string;
        content_id: number;
        started_at: number;
        active_seconds: number;
        completed: number;
        passed: number;
      }
    | undefined;
  if (!s) throw new Error("Sesión de lectura no encontrada.");
  const content = db.prepare(`SELECT min_seconds FROM academia_content WHERE id = ?`).get(s.content_id) as {
    min_seconds: number;
  };
  const elapsedSec = (Date.now() - s.started_at) / 1000;
  // El servidor valida el tiempo transcurrido real Y el tiempo activo por heartbeats.
  if (s.active_seconds < content.min_seconds || elapsedSec < content.min_seconds) {
    const err = new Error("Aún no cumples el tiempo mínimo de lectura.");
    (err as Error & { code?: string }).code = "TOO_SOON";
    throw err;
  }
  return s;
}

export function getQuiz(db: DB, wallet: string, token: string) {
  const s = getSessionForQuiz(db, wallet, token);
  // Selección aleatoria de 3 preguntas del pool (rotación).
  const questions = db
    .prepare(`SELECT id, question, options FROM academia_quiz WHERE content_id = ? ORDER BY RANDOM() LIMIT 3`)
    .all(s.content_id) as Array<{ id: number; question: string; options: string }>;
  return questions.map((q) => ({ id: q.id, question: q.question, options: JSON.parse(q.options) as string[] }));
}

export interface GradeResult {
  passed: boolean;
  correct: number;
  points: number;
}

export function gradeQuiz(
  db: DB,
  wallet: string,
  token: string,
  quizIds: number[],
  answers: number[]
): GradeResult {
  const s = getSessionForQuiz(db, wallet, token);
  const content = db.prepare(`SELECT id, points FROM academia_content WHERE id = ?`).get(s.content_id) as {
    id: number;
    points: number;
  };

  // Valida y califica contra las respuestas correctas del servidor.
  let correct = 0;
  for (let i = 0; i < quizIds.length; i++) {
    const q = db.prepare(`SELECT correct, content_id FROM academia_quiz WHERE id = ?`).get(quizIds[i]) as
      | { correct: number; content_id: number }
      | undefined;
    if (!q || q.content_id !== s.content_id) throw new Error("Pregunta inválida.");
    if (q.correct === answers[i]) correct++;
  }
  const passed = correct >= 2;

  // Marca la sesión como completada pase o no.
  db.prepare(`UPDATE reading_sessions SET completed = 1, passed = ? WHERE token = ?`).run(passed ? 1 : 0, token);

  if (!passed) return { passed: false, correct, points: 0 };

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
    const err = new Error("Alcanzaste el máximo de contenidos con puntos por hoy.");
    (err as Error & { code?: string }).code = "DAILY_CAP";
    throw err;
  }

  const multiplier = genome.ACADEMIA_DIMINISHING[usedToday] ?? 0.5;
  let points = Math.round(content.points * multiplier);

  // Presupuesto de época de Academia (separado).
  const academiaSpent = (
    db.prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger WHERE bucket = 'academia'`).get() as {
      n: number;
    }
  ).n;
  if (academiaSpent + points > genome.ACADEMIA_BUDGET) {
    points = Math.max(0, genome.ACADEMIA_BUDGET - academiaSpent);
  }
  if (points <= 0) {
    const err = new Error("Presupuesto de Academia de la época agotado.");
    (err as Error & { code?: string }).code = "BUDGET";
    throw err;
  }

  const periodId = currentEpoch(db);
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
