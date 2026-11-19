/**
 * Épocas (WP31 §5.B.5): cerrar la época actual y abrir la siguiente en UNA operación
 * atómica, y abrir una época cuando no hay ninguna abierta.
 *
 * El cierre calcula la raíz Merkle de lo emitido en la época (cada fila de
 * `points_ledger` y `reputation_events` con ese `period_id`), la encola para la red
 * de pruebas (`anchor_queue`, kind `merkle_root`) y la deja escrita en el decision
 * log. Como todo INSERT de los ledgers usa `period_id = currentEpoch` (la época más
 * reciente) y la vinculación de cuentas no toca historia sellada, después de cerrar
 * la época N ninguna fila nueva cae en N: su raíz sigue siendo reproducible (B10b).
 *
 * Reglas: solo el founder (`rolPuedeAdministrar`); nunca se toca un ledger (ni
 * UPDATE ni DELETE: test estático B12); el presupuesto de la época nueva sale del
 * genoma que rige en ella. Módulo de servidor (usa `crypto.ts`).
 */
import type { DB } from "./db";
import type { TeamActor } from "./roles";
import { rolPuedeAdministrar } from "./authz";
import { merkleRoot, sha256Hex } from "./crypto";
import { getActiveGenome } from "./genome";
import { mutationDecidedFor } from "./mutation";
import { diaLocal } from "./zona-horaria";

export interface EstadoCierreEpoca {
  periodo: { id: number; name: string; state: string; created_at: string } | null;
  fitnessFirmado: boolean;
  mutacionDecidida: boolean;
  puedeCerrar: boolean;
  faltantes: string[];
  puedeAbrir: boolean; // true si no hay ninguna época Open (la última está Closed/Anchored o no hay filas)
}

export interface ResultadoCierre {
  cerrada: number;
  abierta: number;
  merkleRoot: string;
  anchorQueueId: number;
  decisionLogId: number;
}

/** Error de una operación de épocas, con su estado HTTP y lo que falta (copy de §8.5). */
export class EpocaError extends Error {
  status: number;
  faltantes: string[];
  constructor(status: number, faltantes: string[]) {
    super(faltantes.join(" "));
    this.name = "EpocaError";
    this.status = status;
    this.faltantes = faltantes;
  }
}

export const FALTA_FITNESS = "Falta firmar el fitness de esta época.";
export const FALTA_MUTACION = "Falta decidir la mutación de la siguiente (aunque sea «sin cambios»).";
export const SIN_EPOCA_ABIERTA = "No hay ninguna época abierta.";
export const SOLO_FOUNDER = "Solo el founder cierra o abre una época.";
export const FALTA_JUSTIFICACION = "La justificación es obligatoria (mínimo 10 caracteres).";
export const YA_HAY_ABIERTA = "Ya hay una época abierta: ciérrala antes de abrir otra.";

const MIN_JUSTIFICACION = 10;
const MAX_NOMBRE = 80;

interface FilaPeriodo {
  id: number;
  name: string;
  state: string;
  created_at: string;
}

function ultimoPeriodo(db: DB): FilaPeriodo | null {
  const r = db.prepare(`SELECT id, name, state, created_at FROM periods ORDER BY id DESC LIMIT 1`).get() as
    | FilaPeriodo
    | undefined;
  return r ? { id: Number(r.id), name: String(r.name), state: String(r.state), created_at: String(r.created_at) } : null;
}

function hayEpocaAbierta(db: DB): boolean {
  return !!db.prepare(`SELECT 1 AS x FROM periods WHERE state = 'Open'`).get();
}

function fitnessFirmadoDe(db: DB, epoch: number): boolean {
  return !!db.prepare(`SELECT 1 AS x FROM epoch_fitness WHERE epoch = ? AND signed = 1`).get(epoch);
}

/** Qué falta para cerrar la época actual y si se puede abrir una (para `/admin`). */
export function estadoCierreEpoca(db: DB): EstadoCierreEpoca {
  const periodo = ultimoPeriodo(db);
  const abierta = periodo?.state === "Open";
  const fitnessFirmado = periodo ? fitnessFirmadoDe(db, periodo.id) : false;
  const mutacionDecidida = periodo ? mutationDecidedFor(db, periodo.id + 1) : false;
  const faltantes: string[] = [];
  if (!abierta) faltantes.push(SIN_EPOCA_ABIERTA);
  else {
    if (!fitnessFirmado) faltantes.push(FALTA_FITNESS);
    if (!mutacionDecidida) faltantes.push(FALTA_MUTACION);
  }
  return {
    periodo,
    fitnessFirmado,
    mutacionDecidida,
    puedeCerrar: abierta && fitnessFirmado && mutacionDecidida,
    faltantes,
    puedeAbrir: !hayEpocaAbierta(db),
  };
}

/** JSON canónico: claves ordenadas, sin espacios. */
function jsonCanonico(o: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])));
}

function texto(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/**
 * Hojas de la raíz Merkle de una época: una por fila de `points_ledger` y de
 * `reputation_events` con ese `period_id`, en JSON canónico y en orden (tabla, id).
 */
export function hojasDeEpoca(db: DB, periodId: number): string[] {
  const puntos = db
    .prepare(
      `SELECT id, wallet, points, period_id, bucket, ref, created_at FROM points_ledger WHERE period_id = ? ORDER BY id`
    )
    .all(periodId) as Array<Record<string, unknown>>;
  const reputacion = db
    .prepare(
      `SELECT id, wallet, axis, delta, ref, period_id, created_at FROM reputation_events WHERE period_id = ? ORDER BY id`
    )
    .all(periodId) as Array<Record<string, unknown>>;
  return [
    ...puntos.map((r) =>
      jsonCanonico({
        tabla: "points_ledger",
        id: Number(r.id),
        wallet: texto(r.wallet),
        points: Number(r.points),
        period_id: Number(r.period_id),
        bucket: texto(r.bucket),
        ref: texto(r.ref),
        created_at: texto(r.created_at),
      })
    ),
    ...reputacion.map((r) =>
      jsonCanonico({
        tabla: "reputation_events",
        id: Number(r.id),
        wallet: texto(r.wallet),
        axis: texto(r.axis),
        delta: Number(r.delta),
        ref: texto(r.ref),
        period_id: Number(r.period_id),
        created_at: texto(r.created_at),
      })
    ),
  ];
}

function exigirFounder(actor: TeamActor): void {
  if (!actor || !rolPuedeAdministrar(actor.role)) throw new EpocaError(403, [SOLO_FOUNDER]);
}

function justificacionValida(j: unknown): string | null {
  const t = typeof j === "string" ? j.trim() : "";
  return t.length >= MIN_JUSTIFICACION ? t : null;
}

function nombreValido(n: unknown, porDefecto: string): string {
  const t = typeof n === "string" ? n.trim() : "";
  if (!t) return porDefecto;
  if (t.length > MAX_NOMBRE) throw new EpocaError(400, [`El nombre de la época tiene como máximo ${MAX_NOMBRE} caracteres.`]);
  return t;
}

function fechaDecision(db: DB, ahora: Date): string {
  const tz = getActiveGenome(db).BUSINESS_TZ;
  try {
    return diaLocal(ahora, tz);
  } catch {
    return ahora.toISOString().slice(0, 10);
  }
}

function insertarDecision(db: DB, fecha: string, title: string, reason: string): number {
  const info = db
    .prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (?, ?, ?, ?)`)
    .run(fecha, title, reason, sha256Hex(`${title}|${reason}`)); // misma convención que mutation.ts
  return Number(info.lastInsertRowid);
}

function insertarPeriodo(db: DB, epoch: number, nombre: string): number {
  const g = getActiveGenome(db, epoch);
  const info = db
    .prepare(`INSERT INTO periods (name, epoch_budget, academia_budget, state) VALUES (?, ?, ?, 'Open')`)
    .run(nombre, g.EPOCH_BUDGET, g.ACADEMIA_BUDGET);
  return Number(info.lastInsertRowid);
}

/**
 * Cierra la época actual y abre la siguiente, todo o nada. Precondiciones: founder;
 * época actual `Open`; fitness de la época firmado; mutación de la siguiente
 * decidida (aunque sea "sin cambios"); justificación ≥ 10. Nunca toca los ledgers.
 */
export function cerrarYAbrirEpoca(
  db: DB,
  actor: TeamActor,
  input: { justificacion: string; nombreSiguiente?: string },
  ahora: Date = new Date()
): ResultadoCierre {
  exigirFounder(actor);
  const estado = estadoCierreEpoca(db);
  const faltantes = [...estado.faltantes];
  const justificacion = justificacionValida(input?.justificacion);
  if (!justificacion) faltantes.push(FALTA_JUSTIFICACION);
  if (faltantes.length > 0 || !estado.periodo) {
    throw new EpocaError(estado.puedeCerrar && !justificacion ? 400 : 409, faltantes);
  }
  const n = estado.periodo.id;
  const siguiente = n + 1;
  const nombre = nombreValido(input.nombreSiguiente, `Época ${siguiente}`);
  const fecha = fechaDecision(db, ahora);

  return db.transaction((): ResultadoCierre => {
    // Se relee dentro de la transacción: dos cierres a la vez no cierran dos veces.
    const actual = ultimoPeriodo(db);
    if (!actual || actual.id !== n || actual.state !== "Open") throw new EpocaError(409, [SIN_EPOCA_ABIERTA]);

    const hojas = hojasDeEpoca(db, n);
    const root = merkleRoot(hojas);
    db.prepare(`UPDATE periods SET state = 'Closed', merkle_root = ? WHERE id = ? AND state = 'Open'`).run(root, n);
    const cola = db
      .prepare(`INSERT INTO anchor_queue (kind, ref, data_key, payload_hash) VALUES ('merkle_root', ?, ?, ?)`)
      .run(String(n), `epoch:${n}`, root);
    const decisionLogId = insertarDecision(
      db,
      fecha,
      `Cierre de la época ${n} y apertura de la ${siguiente}`,
      `Raíz Merkle de la época ${n}: ${root} (${hojas.length} registros de puntos y reputación). ` +
        `Se encola para la red de pruebas. Justificación: ${justificacion}`
    );
    const abierta = insertarPeriodo(db, siguiente, nombre);
    return { cerrada: n, abierta, merkleRoot: root, anchorQueueId: Number(cola.lastInsertRowid), decisionLogId };
  })();
}

/**
 * Abre la época siguiente cuando no hay ninguna abierta (la última está cerrada o
 * anclada, o no hay filas). Solo el founder; presupuestos del genoma de esa época y
 * una entrada en el decision log.
 */
export function abrirEpoca(
  db: DB,
  actor: TeamActor,
  input: { justificacion: string; nombre?: string },
  ahora: Date = new Date()
): { abierta: number; decisionLogId: number } {
  exigirFounder(actor);
  const justificacion = justificacionValida(input?.justificacion);
  if (hayEpocaAbierta(db)) throw new EpocaError(409, [YA_HAY_ABIERTA]);
  if (!justificacion) throw new EpocaError(400, [FALTA_JUSTIFICACION]);
  const ultimo = ultimoPeriodo(db);
  const siguiente = ultimo ? ultimo.id + 1 : 1;
  const nombre = nombreValido(input.nombre, `Época ${siguiente}`);
  const fecha = fechaDecision(db, ahora);

  return db.transaction(() => {
    if (hayEpocaAbierta(db)) throw new EpocaError(409, [YA_HAY_ABIERTA]);
    const abierta = insertarPeriodo(db, siguiente, nombre);
    const decisionLogId = insertarDecision(
      db,
      fecha,
      `Apertura de la época ${abierta}`,
      `Se abre la época ${abierta} («${nombre}») con los presupuestos de su genoma. Justificación: ${justificacion}`
    );
    return { abierta, decisionLogId };
  })();
}
