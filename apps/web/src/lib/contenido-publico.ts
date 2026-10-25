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
 *
 * S4 (`reordenarOpcionesAcademia`, revisión del hallazgo A2) va aparte, con su propia
 * transacción y su propio `try/catch`: reparte entre las posiciones las respuestas
 * correctas del quiz sembrado, que estaban casi todas en la segunda opción.
 *
 * S5 (`aclararPreguntaDeRed`, WP33) también va aparte: la pregunta del quiz que decía que
 * "todo" corre en la red de pruebas pasa a hablar de la plataforma de la comunidad, porque
 * los bonos de Harmony ya se pagan en la red principal de Stellar.
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
    ["¿Quién responde ante el cliente por lo que se entrega?", ["La comunidad", "Cada contribuidor", "Zelena", "El cliente"], 2],
    ["¿Firmar el acuerdo de contribución crea una relación laboral?", ["No", "Sí", "Solo si cobras", "Solo para el equipo"], 0],
    ["¿Qué se evalúa?", ["La persona", "La antigüedad", "Las horas", "La entrega"], 3],
    ["¿Se puede perder lo que ya ganaste?", ["Sí, si faltas a un rito", "No", "Sí, al irte", "Solo al cambiar de época"], 1],
    ["La autonomía de la comunidad es…", ["La recompensa de la madurez", "Inmediata", "Decisión de un cliente", "Un token"], 0],
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

/* ------------------------------------------------------------------ *
 * S4 · Orden de las opciones del quiz de la Academia (revisión del hallazgo A2)
 * ------------------------------------------------------------------ */

/**
 * Una pregunta sembrada cuyo orden de opciones cambia: en su forma anterior (`antes`, con
 * la correcta en `de`) se intercambian las opciones `de` y `a`, y la correcta pasa a `a`.
 * Mismos textos y mismos ids: solo cambia el orden.
 */
interface ReordenOpciones {
  readonly pregunta: string;
  readonly antes: readonly string[];
  readonly de: number;
  readonly a: number;
}

/**
 * Las preguntas de la Academia sembrada con su orden ANTERIOR, en el que la correcta era
 * la segunda opción en 15 de 20 preguntas (por contenido: 1,1,1,2,1 · 2,1,1,1,1 ·
 * 1,1,1,2,1 · 1,2,1,1,1). El orden nuevo es el de `seed()` y `ACADEMIA_S1`: ninguna
 * posición con más de 2 correctas por contenido. Las preguntas que ya estaban bien
 * repartidas no aparecen.
 */
export const REORDEN_OPCIONES_S4: readonly ReordenOpciones[] = [
  // S1 · Construir sin cargar con el riesgo (una base que ya aplicó S1 con el orden anterior).
  { pregunta: "¿Quién responde ante el cliente por lo que se entrega?", antes: ["La comunidad", "Zelena", "Cada contribuidor", "El cliente"], de: 1, a: 2 },
  { pregunta: "¿Firmar el acuerdo de contribución crea una relación laboral?", antes: ["Sí", "No", "Solo si cobras", "Solo para el equipo"], de: 1, a: 0 },
  { pregunta: "¿Qué se evalúa?", antes: ["La persona", "La entrega", "Las horas", "La antigüedad"], de: 1, a: 3 },
  { pregunta: "¿Se puede perder lo que ya ganaste?", antes: ["Sí, si faltas a un rito", "Sí, al irte", "No", "Solo al cambiar de época"], de: 2, a: 1 },
  { pregunta: "La autonomía de la comunidad es…", antes: ["Inmediata", "La recompensa de la madurez", "Decisión de un cliente", "Un token"], de: 1, a: 0 },
  // El triángulo de activos.
  { pregunta: "¿ZWORK es transferible en la fase actual?", antes: ["Sí, libremente", "No, son puntos no transferibles", "Solo en mainnet", "Solo los fines de semana"], de: 1, a: 3 },
  { pregunta: "¿Qué activo otorga voto?", antes: ["USDC", "La reputación", "ZWORK", "El CLA"], de: 1, a: 0 },
  { pregunta: "Un token que es 'ownership de nada'...", antes: ["Es lo ideal", "Es el error que el diseño evita", "Da más voto", "Es obligatorio"], de: 1, a: 3 },
  // Cómo se mide el valor.
  { pregunta: "¿Cuál es el orden correcto de la máquina de estados?", antes: ["Open→Delivered→Assigned", "Open→Assigned→Delivered→Scored→Distributed", "Assigned→Open→Scored", "Scored→Open→Delivered"], de: 1, a: 3 },
  { pregunta: "¿Puede un supervisor evaluar a su invitado directo?", antes: ["Sí", "No (regla B8)", "Solo con permiso", "Siempre"], de: 1, a: 0 },
  { pregunta: "El score compuesto es...", antes: ["Subjetivo", "Calculado, transparente y verificable", "Secreto", "Aleatorio"], de: 1, a: 2 },
  // Qué es Zelena DAO (video).
  { pregunta: "La tesis central de Zelena es...", antes: ["La antigüedad manda", "El valor que entregas determina lo que recibes", "El título importa más", "Las horas registradas"], de: 1, a: 3 },
  { pregunta: "El onboarding es...", antes: ["Abierto a todos", "Por invitación con CLA", "Solo por pago", "Automático"], de: 1, a: 0 },
  { pregunta: "El tagline de Zelena es...", antes: ["Move fast", "Real work, Real rewards", "Code is law", "To the moon"], de: 1, a: 3 },
];

/** Opciones guardadas (JSON) de una fila; null si la fila está rota. */
function opcionesDeFila(texto: string): string[] | null {
  try {
    const o = JSON.parse(texto) as unknown;
    return Array.isArray(o) && o.every((x) => typeof x === "string") ? (o as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * Lecturas en curso con el quiz ya servido: su orden mostrado apunta a índices guardados,
 * así que se corrige con el mismo intercambio para que la persona siga viendo lo mismo y
 * se califique igual. Solo `quiz_orden` de lecturas SIN calificar: lo leído y lo ganado
 * no se toca.
 */
function corregirLecturasEnCurso(db: DB, cambios: ReadonlyMap<number, ReordenOpciones>): void {
  const lecturas = db
    .prepare(`SELECT token, quiz_ids, quiz_orden FROM reading_sessions WHERE completed = 0 AND quiz_orden IS NOT NULL`)
    .all() as Array<{ token: string; quiz_ids: string | null; quiz_orden: string }>;
  const upd = db.prepare(`UPDATE reading_sessions SET quiz_orden = ? WHERE token = ? AND quiz_orden = ?`);
  for (const l of lecturas) {
    let ids: unknown;
    let orden: unknown;
    try {
      ids = JSON.parse(l.quiz_ids ?? "null");
      orden = JSON.parse(l.quiz_orden);
    } catch {
      continue; // fila rota: el quiz la vuelve a barajar al pedirlo
    }
    if (!Array.isArray(ids) || !Array.isArray(orden)) continue;
    let tocada = false;
    const nuevo = orden.map((p: unknown, k) => {
      const c = cambios.get(ids[k] as number);
      if (!c || !Array.isArray(p)) return p;
      tocada = true;
      return p.map((i) => (i === c.de ? c.a : i === c.a ? c.de : i));
    });
    if (tocada) upd.run(JSON.stringify(nuevo), l.token, l.quiz_orden);
  }
}

/**
 * S4. Lleva cada pregunta de `REORDEN_OPCIONES_S4` de su orden anterior al nuevo. Solo
 * toca una fila con EXACTAMENTE la forma anterior (mismo texto, mismas opciones en el
 * mismo orden y la misma correcta): una pregunta editada después no se toca y la segunda
 * corrida no encuentra nada. No toca `academia_awards`, `points_ledger` ni
 * `reputation_events`, ni las lecturas calificadas. En una transacción; la llama
 * `seedIfEmpty` en su propio `try/catch`. Devuelve cuántas preguntas reordenó.
 */
export function reordenarOpcionesAcademia(db: DB): number {
  const tx = db.transaction(() => {
    const cambios = new Map<number, ReordenOpciones>();
    const sel = db.prepare(`SELECT id, options FROM academia_quiz WHERE question = ? AND correct = ? ORDER BY id`);
    const upd = db.prepare(`UPDATE academia_quiz SET options = ?, correct = ? WHERE id = ? AND correct = ?`);
    for (const r of REORDEN_OPCIONES_S4) {
      for (const f of sel.all(r.pregunta, r.de) as Array<{ id: number; options: string }>) {
        const opciones = opcionesDeFila(f.options);
        if (!opciones || opciones.length !== r.antes.length || opciones.some((o, i) => o !== r.antes[i])) continue;
        const nuevas = [...opciones];
        [nuevas[r.de], nuevas[r.a]] = [nuevas[r.a], nuevas[r.de]];
        if (Number(upd.run(JSON.stringify(nuevas), r.a, f.id, r.de).changes) === 1) cambios.set(f.id, r);
      }
    }
    if (cambios.size > 0) corregirLecturasEnCurso(db, cambios);
    return cambios.size;
  });
  const n = tx();
  if (n > 0) console.info(`[seed] Academia: ${n} pregunta(s) con las opciones reordenadas (revisión de A2).`);
  return n;
}

/* ------------------------------------------------------------------ *
 * S5 · La pregunta de la red en el quiz de la Academia (WP33)
 * ------------------------------------------------------------------ */

/**
 * "¿Dónde corre todo hoy?" → "Testnet" dejó de ser cierto: Harmony paga bonos reales en
 * USDC en la red principal de Stellar desde septiembre de 2026. Lo que corre en la red de
 * pruebas es la plataforma de la comunidad, así que la pregunta se acota a ella y la
 * respuesta (y su posición) no cambia. `seed()` siembra ya la pregunta nueva.
 */
export const PREGUNTA_RED_S5 = {
  antes: "¿Dónde corre todo hoy?",
  ahora: "¿Dónde corre hoy la plataforma de la comunidad?",
} as const;

/**
 * S5. Cambia solo el texto de la pregunta, en su sitio (mismo id, mismas opciones y misma
 * correcta): un quiz a medio responder se sigue calificando igual. Idempotente: la segunda
 * corrida no encuentra la pregunta vieja. La llama `seedIfEmpty` en su propio `try/catch`.
 * Devuelve cuántas filas cambió.
 */
export function aclararPreguntaDeRed(db: DB): number {
  const r = db
    .prepare(`UPDATE academia_quiz SET question = ? WHERE question = ?`)
    .run(PREGUNTA_RED_S5.ahora, PREGUNTA_RED_S5.antes);
  const n = Number(r.changes);
  if (n > 0) console.info(`[seed] Academia: ${n} pregunta(s) sobre la red, acotadas a la plataforma de la comunidad.`);
  return n;
}
