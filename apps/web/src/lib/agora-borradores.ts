/**
 * Borradores del Ágora (decisión del founder, 2026-10-21).
 *
 * Los proyectos que siembra `seed()` (los de julio, con nombres de ventures y detalles
 * comerciales) se OCULTAN del público hasta que el founder publique proyectos reales.
 * No se borra nada: la fila, sus hitos y sus aplicaciones quedan tal cual y el proyecto
 * conserva su estado del ciclo. Solo cambia `projects.draft` (0 → 1), y el founder lo
 * vuelve a publicar desde /admin (`publicarProyecto`).
 *
 * La regla de lo que significa estar en borrador vive en `state-machine.ts`
 * (`esBorrador`, `recibeAplicaciones`); aquí están la migración y la publicación.
 */
import type { DB } from "./db"; // solo tipo: sin ciclo en runtime

/** `projects.origin` de un proyecto sembrado. */
export const ORIGEN_SEMBRADO = "seed";
/** `projects.origin` de un proyecto publicado desde el tablero (puente del Ágora). */
export const ORIGEN_AGORA = "agora";

/**
 * Pasa a borrador los proyectos sembrados de una base que ya existía. Devuelve cuántos.
 *
 * Criterio (por su ORIGEN de seed, nunca por el nombre de un venture). Un proyecto es
 * sembrado si cumple las tres condiciones:
 *  1. ninguna entrega del tablero lo enlaza (`assignments.published_as_project_id`):
 *     todo proyecto que crea el puente del Ágora (`agora-publicar.ts`) queda enlazado a
 *     su entrega en la misma transacción;
 *  2. tiene un hito con `ord = 0`: el seed numera los hitos desde 0 (el anticipo) y el
 *     puente desde 1. Es la huella del seed desde su primera versión (4524dff) y la de la
 *     línea que está desplegada (58ee2fd), donde el seed era el único que creaba proyectos;
 *  3. su supervisor es una fila con `is_founder = 1`: el seed pone `FOUNDER_WALLET` como
 *     supervisor de cada proyecto y crea esa fila con `is_founder = 1`.
 *
 * Solo mira filas con `origin IS NULL` (sin clasificar) y les escribe `origin = 'seed'`:
 * por eso es idempotente y un proyecto que el founder ya publicó no vuelve a borrador
 * en el siguiente arranque. SQL portable (subconsultas correlacionadas, sin funciones
 * propias de SQLite). La llama `seedIfEmpty` dentro de su propio `try/catch`, como las
 * migraciones de contenido: el arranque no se cae por ella y se reintenta en el siguiente.
 */
export function marcarSembradosComoBorrador(db: DB): number {
  const r = db
    .prepare(
      `UPDATE projects SET draft = 1, origin = ?
        WHERE origin IS NULL
          AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.published_as_project_id = projects.id)
          AND EXISTS (SELECT 1 FROM milestones m WHERE m.project_id = projects.id AND m.ord = 0)
          AND supervisor_wallet IN (SELECT u.wallet FROM users u WHERE u.is_founder = 1)`
    )
    .run(ORIGEN_SEMBRADO);
  const n = Number(r.changes);
  if (n > 0) console.info(`[seed] Ágora: ${n} proyecto(s) sembrado(s) pasan a borrador (no se borra nada).`);
  return n;
}

export class BorradorError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BorradorError";
    this.status = status;
  }
}

/**
 * Publica un proyecto en borrador: vuelve a verse en el Ágora y a recibir aplicaciones
 * (si su estado es `Open`). Solo el founder: la ruta lo exige con `adminActor` (rol leído
 * de la base). No cambia el estado del ciclo ni ninguna otra columna. Idempotente sobre
 * un proyecto ya publicado (409, sin escribir).
 */
export function publicarProyecto(db: DB, projectId: number): void {
  const p = db.prepare(`SELECT id, draft FROM projects WHERE id = ?`).get(projectId) as
    | { id: number; draft: number }
    | undefined;
  if (!p) throw new BorradorError(404, "Proyecto no encontrado.");
  const r = db.prepare(`UPDATE projects SET draft = 0 WHERE id = ? AND draft = 1`).run(projectId);
  if (Number(r.changes) !== 1) throw new BorradorError(409, "Este proyecto ya está publicado.");
}
