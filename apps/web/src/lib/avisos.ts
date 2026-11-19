/**
 * Bandeja de avisos in-app (WP31 §5.C.2). Lo que el motor de recordatorios deja para
 * cada persona sobre SUS entregas (o las que estructura o revisa).
 *
 * Reglas que este archivo hace cumplir:
 *  - Sin horas, sin "última conexión", sin fecha de lectura: `is_leido` lo marca la
 *    persona y no existe "cuándo leyó" (el esquema no tiene esa columna).
 *  - Cada persona ve y marca SOLO lo suyo, sumando todas sus identidades
 *    (`identidadesDe`): el founder ve también los avisos de su fila de equipo antes de
 *    vincularla.
 *  - Idempotente por (wallet, clave): crear dos veces el mismo aviso no lo duplica.
 *  - SQL portable: sin `INSERT OR IGNORE` ni `ON CONFLICT` (SELECT + INSERT).
 *
 * Solo servidor (lee la base).
 */
import type { DB } from "./db";
import { identidadesDe } from "./identidades";
import { instanteDb } from "./zona-horaria";

export interface AvisoRow {
  id: number;
  wallet: string;
  clave: string;
  tipo: string;
  assignment_id: number | null;
  texto: string;
  is_leido: number;
  created_at: string;
}

/** Tope de avisos que devuelve una consulta (la bandeja no pagina en v1). */
export const AVISOS_LIMITE_MAX = 200;
const AVISOS_LIMITE_DEFECTO = 50;
// SQL Server admite hasta 2100 parámetros por consulta: se marca por tandas.
const TANDA = 400;

function marcas(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/**
 * Deja un aviso en la bandeja de `wallet`. Devuelve false si ya existía (misma clave
 * para la misma persona). No abre transacción propia: el motor la llama dentro de la
 * suya, junto a la fila de `reminders_sent`.
 */
export function crearAviso(
  db: DB,
  a: { wallet: string; clave: string; tipo: string; assignmentId: number | null; texto: string },
  now: Date = new Date()
): boolean {
  const existe = db.prepare(`SELECT 1 AS x FROM avisos WHERE wallet = ? AND clave = ?`).get(a.wallet, a.clave);
  if (existe) return false;
  db.prepare(
    `INSERT INTO avisos (wallet, clave, tipo, assignment_id, texto, is_leido, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(a.wallet, a.clave, a.tipo, a.assignmentId ?? null, a.texto, instanteDb(now));
  return true;
}

/** Los avisos de la persona (todas sus identidades): primero los no leídos, luego los más nuevos. */
export function avisosDe(
  db: DB,
  wallet: string,
  opts: { soloNoLeidos?: boolean; limite?: number } = {}
): AvisoRow[] {
  const ids = identidadesDe(db, wallet);
  if (ids.length === 0) return [];
  const limite = Math.max(1, Math.min(AVISOS_LIMITE_MAX, Math.floor(opts.limite ?? AVISOS_LIMITE_DEFECTO)));
  const filtro = opts.soloNoLeidos ? `AND is_leido = 0` : "";
  const rows = db
    .prepare(
      `SELECT id, wallet, clave, tipo, assignment_id, texto, is_leido, created_at
         FROM avisos
        WHERE wallet IN (${marcas(ids.length)}) ${filtro}
        ORDER BY is_leido, id DESC
        LIMIT ?`
    )
    .all(...ids, limite) as AvisoRow[];
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    assignment_id: r.assignment_id == null ? null : Number(r.assignment_id),
    is_leido: Number(r.is_leido) ? 1 : 0,
  }));
}

/** Cuántos avisos sin leer tiene la persona (todas sus identidades). */
export function contarNoLeidos(db: DB, wallet: string): number {
  const ids = identidadesDe(db, wallet);
  if (ids.length === 0) return 0;
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM avisos WHERE wallet IN (${marcas(ids.length)}) AND is_leido = 0`)
    .get(...ids) as { n: number } | undefined;
  return Number(r?.n ?? 0);
}

/**
 * Marca como leídos los avisos de la persona: todos los suyos, o solo los `ids` dados
 * que sean suyos (los ajenos se ignoran en silencio). Devuelve cuántos cambiaron.
 */
export function marcarLeidos(db: DB, wallet: string, ids?: number[]): number {
  const propias = identidadesDe(db, wallet);
  if (propias.length === 0) return 0;
  const dueno = `wallet IN (${marcas(propias.length)})`;
  if (ids === undefined) {
    const info = db.prepare(`UPDATE avisos SET is_leido = 1 WHERE ${dueno} AND is_leido = 0`).run(...propias);
    return Number(info.changes ?? 0);
  }
  const limpios = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  let total = 0;
  for (let i = 0; i < limpios.length; i += TANDA) {
    const tanda = limpios.slice(i, i + TANDA);
    const info = db
      .prepare(`UPDATE avisos SET is_leido = 1 WHERE ${dueno} AND is_leido = 0 AND id IN (${marcas(tanda.length)})`)
      .run(...propias, ...tanda);
    total += Number(info.changes ?? 0);
  }
  return total;
}

/**
 * Dónde se ve la entrega de cada aviso: el tablero de su proyecto o, sin proyecto (o
 * si la pieza ya no existe), el día. Es solo un `href`: la puerta la pone la página.
 */
export function enlacesDeAvisos(db: DB, avisos: Array<Pick<AvisoRow, "id" | "assignment_id">>): Map<number, string> {
  const out = new Map<number, string>();
  const ids = [...new Set(avisos.map((a) => a.assignment_id).filter((n): n is number => Number.isInteger(n)))];
  const slugs = new Map<number, string>();
  for (let i = 0; i < ids.length; i += TANDA) {
    const tanda = ids.slice(i, i + TANDA);
    const rows = db
      .prepare(
        `SELECT a.id AS id, i.slug AS slug FROM assignments a
           LEFT JOIN initiatives i ON i.id = a.initiative_id
          WHERE a.id IN (${marcas(tanda.length)})`
      )
      .all(...tanda) as Array<{ id: number; slug: string | null }>;
    for (const r of rows) if (r.slug && /^[a-z0-9-]+$/.test(r.slug)) slugs.set(Number(r.id), r.slug);
  }
  for (const a of avisos) {
    const slug = a.assignment_id != null ? slugs.get(a.assignment_id) : undefined;
    out.set(a.id, slug ? `/equipo/proyectos/${slug}` : "/equipo/hoy");
  }
  return out;
}
