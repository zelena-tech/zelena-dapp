/**
 * Las votaciones abiertas y su recuento: UNA sola fuente para /gobernanza y para la
 * landing (/comunidad), para que las dos digan lo mismo de la misma propuesta.
 *
 * Solo cuentan los votos de cuentas reales. Los de las cuentas de demostración
 * (`users.is_demo = 1`: las sembradas y las que entran con un código de demostración)
 * no suman, igual que en el resto de cifras públicas (lib/prueba-en-vivo.ts): pueden
 * votar para probar el flujo, pero su voto no mueve el recuento.
 */
import type { DB } from "./db";

export interface RecuentoVotos {
  favor: number;
  contra: number;
  abstencion: number;
}

export interface PropuestaAbierta {
  id: number;
  title: string;
  description: string;
  threshold: number;
}

/** Ancla de cada votación en /gobernanza; la landing enlaza a la suya. */
export function anclaPropuesta(id: number): string {
  return `propuesta-${id}`;
}

function entero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Las votaciones abiertas, la más antigua primero. /gobernanza las muestra todas, cada
 * una con su formulario y su ancla; la landing lista las primeras.
 */
export function propuestasAbiertas(db: DB, limite = 20): PropuestaAbierta[] {
  const cuantas = Math.min(Math.max(0, Math.floor(limite) || 0), 50);
  if (cuantas === 0) return [];
  const filas = db
    .prepare(
      `SELECT id, title, description, threshold FROM proposals WHERE status = 'open' ORDER BY id LIMIT ${cuantas}`
    )
    .all() as Array<{ id: number; title: string; description: string | null; threshold: number }>;
  return filas.map((p) => ({
    id: entero(p.id),
    title: String(p.title),
    description: String(p.description ?? ""),
    threshold: entero(p.threshold),
  }));
}

/** Recuento de una votación: solo los votos de cuentas reales. */
export function recuentoVotos(db: DB, proposalId: number): RecuentoVotos {
  const filas = db
    .prepare(
      `SELECT v.choice AS choice, COUNT(*) AS n
         FROM votes v
         JOIN users u ON u.wallet = v.wallet
        WHERE v.proposal_id = ? AND u.is_demo = 0
        GROUP BY v.choice`
    )
    .all(proposalId) as Array<{ choice: string; n: number }>;
  const out: RecuentoVotos = { favor: 0, contra: 0, abstencion: 0 };
  for (const r of filas) {
    if (r.choice === "favor" || r.choice === "contra" || r.choice === "abstencion") out[r.choice] = entero(r.n);
  }
  return out;
}
