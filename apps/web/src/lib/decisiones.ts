/**
 * Decisiones reemplazadas (decisión del founder, 2026-10-21).
 *
 * El decision log es de solo inserción: una decisión publicada nunca se reescribe ni se
 * borra, porque su huella (`hash`) es pública y verificable. Cuando una decisión nueva
 * reemplaza a otra, el vínculo se registra APARTE, en `decision_replacements` (también
 * de solo inserción), y:
 *  - en lo público (/gobernanza, /comunidad) se muestra SOLO la versión vigente, la que
 *    reemplazó, sin el texto original;
 *  - el original queda intacto en `decision_log`, con su huella, y solo lo ve el founder
 *    en /admin (`decisionesReemplazadas`).
 *
 * Solo servidor (lee la base). Las etiquetas y la marca de la decisión histórica de las
 * etiquetas viejas viven en `agora-labels.ts`.
 */
import type { DB } from "./db"; // solo tipo: sin ciclo en runtime
import { REEMPLAZO_DECISION, esDecisionReemplazada } from "./agora-labels";

export interface Decision {
  id: number;
  date: string;
  title: string;
  reason: string;
  hash: string;
}

/** Decisión vigente, con las fechas de las que reemplaza (nunca su texto). */
export interface DecisionVigente extends Decision {
  reemplazaA: Array<{ id: number; date: string }>;
}

/** Decisión reemplazada, tal cual está en el registro, para /admin (solo founder). */
export interface DecisionReemplazada extends Decision {
  reemplazadaPor: { id: number; date: string; title: string } | null;
}

function todas(db: DB): Decision[] {
  return db.prepare(`SELECT id, date, title, reason, hash FROM decision_log ORDER BY id`).all() as Decision[];
}

/** decision_id → replaced_by_id, de la tabla de reemplazos. */
function reemplazos(db: DB): Map<number, number> {
  const filas = db
    .prepare(`SELECT decision_id, replaced_by_id FROM decision_replacements ORDER BY id`)
    .all() as Array<{ decision_id: number; replaced_by_id: number }>;
  return new Map(filas.map((f) => [Number(f.decision_id), Number(f.replaced_by_id)]));
}

/**
 * Registra que `decisionId` quedó reemplazada por `reemplazadaPorId`. Solo inserta (nada
 * se reescribe). Devuelve `false` si ese mismo vínculo ya estaba (idempotente) y lanza si
 * alguna de las dos no existe, si son la misma o si la decisión ya tiene OTRO reemplazo.
 */
export function registrarReemplazo(db: DB, decisionId: number, reemplazadaPorId: number): boolean {
  if (decisionId === reemplazadaPorId) throw new Error("Una decisión no se reemplaza a sí misma.");
  const existe = db.prepare(`SELECT id FROM decision_log WHERE id = ?`);
  if (!existe.get(decisionId) || !existe.get(reemplazadaPorId)) throw new Error("Esa decisión no existe.");
  const previo = db
    .prepare(`SELECT replaced_by_id FROM decision_replacements WHERE decision_id = ?`)
    .get(decisionId) as { replaced_by_id: number } | undefined;
  if (previo) {
    if (Number(previo.replaced_by_id) === reemplazadaPorId) return false;
    throw new Error("Esa decisión ya tiene otro reemplazo registrado.");
  }
  db.prepare(`INSERT INTO decision_replacements (decision_id, replaced_by_id) VALUES (?, ?)`).run(
    decisionId,
    reemplazadaPorId
  );
  return true;
}

/**
 * Migración idempotente: registra los reemplazos que ya existen en el registro. Hoy, uno:
 * la decisión histórica que nombraba las etiquetas viejas (`esDecisionReemplazada`) la
 * reemplaza "Las etiquetas de proyecto pasan a Cliente y Comunidad" (la que añade
 * `aplicarContenidoPublico`, S2). Sin la decisión nueva no registra nada. Devuelve
 * cuántos vínculos insertó. La llama `seedIfEmpty` en su propio `try/catch`.
 */
export function vincularReemplazosConocidos(db: DB): number {
  const filas = todas(db);
  const vigente = filas.find((d) => d.title === REEMPLAZO_DECISION);
  if (!vigente) return 0;
  let n = 0;
  for (const d of filas) {
    if (d.id === vigente.id || !esDecisionReemplazada(d.reason)) continue;
    if (registrarReemplazo(db, d.id, vigente.id)) n++;
  }
  if (n > 0) console.info(`[seed] decisiones: ${n} reemplazo(s) registrado(s); el original sigue intacto.`);
  return n;
}

/**
 * Ids de las decisiones que NO se muestran en público: las de la tabla de reemplazos y,
 * por si la migración todavía no corrió, la histórica de las etiquetas viejas.
 */
function idsReemplazadas(db: DB, filas: Decision[]): Set<number> {
  const ids = new Set(reemplazos(db).keys());
  for (const d of filas) if (esDecisionReemplazada(d.reason) && d.title !== REEMPLAZO_DECISION) ids.add(d.id);
  return ids;
}

/** Decisiones vigentes, de la más antigua a la más reciente. Lo único que ve el público. */
export function decisionesVigentes(db: DB): DecisionVigente[] {
  const filas = todas(db);
  const fuera = idsReemplazadas(db, filas);
  const porId = new Map(filas.map((d) => [d.id, d]));
  const reemplazaA = new Map<number, Array<{ id: number; date: string }>>();
  for (const [vieja, nueva] of reemplazos(db)) {
    const d = porId.get(vieja);
    if (!d) continue;
    reemplazaA.set(nueva, [...(reemplazaA.get(nueva) ?? []), { id: d.id, date: d.date }]);
  }
  return filas.filter((d) => !fuera.has(d.id)).map((d) => ({ ...d, reemplazaA: reemplazaA.get(d.id) ?? [] }));
}

/**
 * Decisión vigente que corresponde a `id`: la misma si está vigente, o la que la
 * reemplazó (siguiendo la cadena). `null` si no hay ninguna vigente a la que llevar.
 * Sirve para los enlaces públicos que apuntaban al original (`#dec-<id>`).
 */
export function vigenteDe(db: DB, id: number): Decision | null {
  const filas = todas(db);
  const fuera = idsReemplazadas(db, filas);
  const mapa = reemplazos(db);
  const porId = new Map(filas.map((d) => [d.id, d]));
  let actual = id;
  for (let saltos = 0; saltos < filas.length + 1; saltos++) {
    if (!fuera.has(actual)) return porId.get(actual) ?? null;
    const siguiente = mapa.get(actual);
    if (siguiente === undefined) return null;
    actual = siguiente;
  }
  return null;
}

/** Las reemplazadas, completas y con su huella, para /admin (solo founder). */
export function decisionesReemplazadas(db: DB): DecisionReemplazada[] {
  const filas = todas(db);
  const fuera = idsReemplazadas(db, filas);
  const mapa = reemplazos(db);
  const porId = new Map(filas.map((d) => [d.id, d]));
  return filas
    .filter((d) => fuera.has(d.id))
    .map((d) => {
      const nueva = porId.get(mapa.get(d.id) ?? -1);
      return { ...d, reemplazadaPor: nueva ? { id: nueva.id, date: nueva.date, title: nueva.title } : null };
    });
}
