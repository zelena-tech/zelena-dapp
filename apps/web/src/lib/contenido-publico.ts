/**
 * Contenido público sembrado en la base (WP31-E2 · spec WP31 §5.E y §13).
 *
 * `seedIfEmpty` solo siembra una base VACÍA: editar `seed()` no cambia producción.
 * Esta migración de contenido lleva una base que ya tiene el contenido viejo a la
 * misma forma final que siembra hoy una base nueva (en una base nueva no hace nada):
 *
 *  - S1 · Academia: el módulo que explicaba la estructura legal pasa a "Construir sin
 *    cargar con el riesgo" (slug nuevo, título, resumen y cuerpo), con su quiz
 *    actualizado EN SU SITIO (mismos ids: la Academia califica por id de pregunta y
 *    un quiz a medio responder no se rompe) y el orden nuevo: primero "Cómo se mide
 *    el valor", después este módulo. No toca `academia_awards`, `reading_sessions`
 *    ni `points_ledger`: lo ganado no se toca.
 *  - S2 · Decisiones: se AÑADE una decisión nueva y transparente. La vieja se conserva
 *    tal cual: su hash es público y verificable, así que no se reescribe.
 *  - S3 · "score compuesto por contribuidor" → "por entrega" en los cuerpos de la
 *    Academia: se califica la entrega, nunca a la persona.
 *
 * Idempotente y en una sola transacción. La llama `seedIfEmpty` dentro de su propio
 * `try/catch` (spec §3.5): el arranque no se cae por contenido y la migración se
 * reintenta en el siguiente.
 */
import type { DB } from "./db"; // solo tipo: sin ciclo en runtime
import { sha256Hex } from "./crypto";

/** Slug del módulo S1 antes de la migración (lo redirige `next.config.mjs`). */
export const SLUG_S1_ANTERIOR = "por-que-sas-dao";
/** Slug del módulo S1 después de la migración. */
export const SLUG_S1 = "construir-sin-riesgo";
/** El módulo que pasa a ser el primero de la Academia. */
const SLUG_PRIMERO = "como-se-mide-el-valor";

type PreguntaQuiz = readonly [pregunta: string, opciones: readonly string[], correcta: number];

/** S1 · textos del anexo §13. `seed()` los usa tal cual en una base nueva. */
export const ACADEMIA_S1: {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly quiz: readonly PreguntaQuiz[];
} = {
  slug: SLUG_S1,
  title: "Construir sin cargar con el riesgo",
  summary:
    "Quién responde ante los clientes, qué es tuyo para siempre y por qué firmar no te convierte en empleado.",
  body: `## Construir sin cargar con el riesgo

1. Zelena firma con los clientes y responde por lo que se entrega.
2. La comunidad coordina el trabajo, evalúa entregas y guarda la reputación.
3. Tu autoría es tuya; tu historial es verificable y lo ganado no se quita.
4. Firmar el acuerdo de contribución no crea relación laboral ni te convierte en socio, y nada de lo que recibes es salario.
5. La autonomía de la comunidad se gana por etapas.`,
  // En este orden: la migración reescribe las 5 filas viejas por orden de id.
  quiz: [
    ["¿Quién responde ante el cliente por lo que se entrega?", ["La comunidad", "Zelena", "Cada contribuidor", "El cliente"], 1],
    ["¿Firmar el acuerdo de contribución crea una relación laboral?", ["Sí", "No", "Solo si cobras", "Solo para el equipo"], 1],
    ["¿Qué se evalúa?", ["La persona", "La entrega", "Las horas", "La antigüedad"], 1],
    ["¿Se puede perder lo que ya ganaste?", ["Sí, si faltas a un rito", "Sí, al irte", "No", "Solo al cambiar de época"], 2],
    ["La autonomía de la comunidad es…", ["Inmediata", "La recompensa de la madurez", "Decisión de un cliente", "Un token"], 1],
  ],
};

/** S2 · la decisión nueva (spec §5.E). Mismo texto que `REEMPLAZO_DECISION` de `agora-labels.ts`. */
export const DECISION_S2: { readonly title: string; readonly reason: string } = {
  title: "Las etiquetas de proyecto pasan a Cliente y Comunidad",
  reason:
    "Desde hoy los proyectos se etiquetan como de un cliente o de la comunidad. El valor interno no cambia y la decisión anterior se conserva tal cual, con su huella.",
};

/** Marca de la decisión histórica del 2026-07-01 que S2 complementa (no se modifica). */
const MARCA_DECISION_ANTERIOR = "etiquetadas SAS";

/** S3 · primero la variante con negrita: así la segunda no vuelve a contar el mismo texto. */
const REEMPLAZOS_S3: ReadonlyArray<readonly [string, string]> = [
  ["score compuesto** por contribuidor", "score compuesto** por entrega"],
  ["score compuesto por contribuidor", "score compuesto por entrega"],
];

/**
 * Zona del "hoy" de la decisión S2. Es el `BUSINESS_TZ` por defecto del genoma
 * (WP31-B). Nunca la hora local del servidor: Azure corre en UTC.
 */
const ZONA_DECISION = "America/Bogota";

/** AAAA-MM-DD de `instante` en la zona `tz` (Intl, sin constantes de desfase). */
function diaEnZona(instante: Date, tz: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instante);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

/** Orden nuevo: "Cómo se mide el valor", luego S1 y después los demás en su orden relativo. */
function reordenarAcademia(db: DB, idS1: number): void {
  const filas = db.prepare(`SELECT id, slug, ord FROM academia_content ORDER BY ord, id`).all() as Array<{
    id: number;
    slug: string;
    ord: number;
  }>;
  const primero = filas.find((f) => f.slug === SLUG_PRIMERO);
  const orden = [
    ...(primero ? [primero] : []),
    ...filas.filter((f) => f.id === idS1),
    ...filas.filter((f) => f.id !== idS1 && f !== primero),
  ];
  const upd = db.prepare(`UPDATE academia_content SET ord = ? WHERE id = ?`);
  orden.forEach((f, i) => {
    if (f.ord !== i + 1) upd.run(i + 1, f.id);
  });
}

/** S1. Devuelve true si migró el módulo. */
function aplicarS1(db: DB): boolean {
  // Guarda contra el UNIQUE de slug: si el destino ya existe (base nueva o segunda
  // corrida), no se toca nada.
  if (db.prepare(`SELECT id FROM academia_content WHERE slug = ?`).get(SLUG_S1)) return false;
  const anterior = db.prepare(`SELECT id FROM academia_content WHERE slug = ?`).get(SLUG_S1_ANTERIOR) as
    | { id: number }
    | undefined;
  if (!anterior) return false;

  db.prepare(`UPDATE academia_content SET slug = ?, title = ?, summary = ?, body = ? WHERE id = ?`).run(
    ACADEMIA_S1.slug,
    ACADEMIA_S1.title,
    ACADEMIA_S1.summary,
    ACADEMIA_S1.body,
    anterior.id
  );

  const preguntas = db
    .prepare(`SELECT id FROM academia_quiz WHERE content_id = ? ORDER BY id`)
    .all(anterior.id) as Array<{ id: number }>;
  if (preguntas.length === ACADEMIA_S1.quiz.length) {
    const upd = db.prepare(`UPDATE academia_quiz SET question = ?, options = ?, correct = ? WHERE id = ?`);
    preguntas.forEach((p, i) => {
      const [pregunta, opciones, correcta] = ACADEMIA_S1.quiz[i];
      upd.run(pregunta, JSON.stringify(opciones), correcta, p.id);
    });
  } else {
    // No se adivina qué fila es qué pregunta. El ensayo previo al despliegue
    // comprueba que en producción son 5; si no, lo resuelve una persona.
    console.warn(
      `[seed] contenido público: el quiz del módulo ${anterior.id} tiene ${preguntas.length} preguntas ` +
        `(se esperaban ${ACADEMIA_S1.quiz.length}); no se toca y sigue el quiz anterior.`
    );
  }

  reordenarAcademia(db, anterior.id);
  return true;
}

/** S2. Devuelve true si insertó la decisión nueva. */
function aplicarS2(db: DB, ahora: Date): boolean {
  const anterior = db.prepare(`SELECT id FROM decision_log WHERE reason LIKE ?`).get(`%${MARCA_DECISION_ANTERIOR}%`);
  if (!anterior) return false;
  if (db.prepare(`SELECT id FROM decision_log WHERE title = ?`).get(DECISION_S2.title)) return false;
  const date = diaEnZona(ahora, ZONA_DECISION);
  // Misma convención de hash que las decisiones sembradas: sha256(fecha|título|razón).
  const hash = sha256Hex([date, DECISION_S2.title, DECISION_S2.reason].join("|"));
  db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (?, ?, ?, ?)`).run(
    date,
    DECISION_S2.title,
    DECISION_S2.reason,
    hash
  );
  return true;
}

/** S3. Devuelve cuántas apariciones reemplazó. */
function aplicarS3(db: DB): number {
  const filas = db
    .prepare(`SELECT id, body FROM academia_content WHERE body LIKE ? ORDER BY id`)
    .all("%por contribuidor%") as Array<{ id: number; body: string | null }>;
  const upd = db.prepare(`UPDATE academia_content SET body = ? WHERE id = ?`);
  let total = 0;
  for (const fila of filas) {
    let body = fila.body ?? "";
    let cambios = 0;
    for (const [anterior, nuevo] of REEMPLAZOS_S3) {
      const partes = body.split(anterior);
      cambios += partes.length - 1;
      body = partes.join(nuevo);
    }
    if (cambios > 0) {
      upd.run(body, fila.id);
      total += cambios;
    }
  }
  return total;
}

/**
 * Aplica S1, S2 y S3 en una transacción. Idempotente: la segunda corrida devuelve
 * `{ academia: false, decision: false, reemplazos: 0 }` y no escribe nada.
 * `ahora` (opcional) fija el "hoy" de la decisión S2; por defecto, el reloj.
 */
export function aplicarContenidoPublico(
  db: DB,
  ahora: Date = new Date()
): { academia: boolean; decision: boolean; reemplazos: number } {
  const tx = db.transaction(() => {
    const academia = aplicarS1(db);
    const decision = aplicarS2(db, ahora);
    const reemplazos = aplicarS3(db);
    return { academia, decision, reemplazos };
  });
  const r = tx();
  if (r.academia || r.decision || r.reemplazos > 0) {
    console.info(
      `[seed] contenido público: academia=${r.academia} decisión=${r.decision} reemplazos=${r.reemplazos}`
    );
  }
  return r;
}
