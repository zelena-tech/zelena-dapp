/**
 * Cargadores del SLA desde la base (WP31 §5.B.2). La lógica vive en `sla.ts` (puro);
 * aquí solo se leen asignaciones y eventos y se arma la configuración del genoma.
 *
 * Solo lee: ningún INSERT, UPDATE ni DELETE. Sin `node:`, sin `crypto.ts` y sin
 * valores de `db.ts` (solo su tipo): queda en la cadena de `team.ts` (gancho de
 * emisión, WP31-I1), que llega al CLI de Node con type-stripping (imports de valor
 * con sufijo `.ts`) y a un componente de cliente.
 */
import type { DB } from "./db";
import { getActiveGenome } from "./genome.ts";
import {
  evaluarSla,
  isSlaPrioridad,
  slaConfigDesdeGenoma,
  type EventoSla,
  type PiezaSla,
  type SlaConfig,
  type SlaResultado,
} from "./sla.ts";
import type { TeamStatus } from "./team-state-machine";

/** Configuración de SLA del genoma de la época (por defecto, la actual). */
export function slaConfig(db: DB, epoch?: number): SlaConfig {
  return slaConfigDesdeGenoma(getActiveGenome(db, epoch));
}

interface FilaPieza {
  id: number;
  priority: string;
  status: string;
  due_date: string | null;
  created_at: string;
  blocked_at: string | null;
}

interface FilaEvento extends EventoSla {
  assignment_id: number;
}

const COLUMNAS = `id, priority, status, due_date, created_at, blocked_at`;
const COLUMNAS_EVENTO = `assignment_id, action, from_status, to_status, created_at`;
// SQL Server admite hasta 2100 parámetros por consulta: se consulta por tandas.
const TANDA = 400;

function aPieza(f: FilaPieza, eventos: EventoSla[]): PiezaSla {
  return {
    id: Number(f.id),
    priority: isSlaPrioridad(f.priority) ? f.priority : "Normal",
    status: f.status as TeamStatus,
    due_date: f.due_date ?? null,
    created_at: String(f.created_at),
    blocked_at: f.blocked_at ?? null,
    eventos,
  };
}

function aEvento(e: FilaEvento): EventoSla {
  return {
    action: String(e.action),
    from_status: String(e.from_status),
    to_status: String(e.to_status),
    created_at: String(e.created_at),
  };
}

function agrupar(filas: FilaPieza[], eventos: FilaEvento[]): PiezaSla[] {
  const porPieza = new Map<number, EventoSla[]>();
  for (const e of eventos) {
    const id = Number(e.assignment_id);
    let lista = porPieza.get(id);
    if (!lista) {
      lista = [];
      porPieza.set(id, lista);
    }
    lista.push(aEvento(e));
  }
  return filas.map((f) => aPieza(f, porPieza.get(Number(f.id)) ?? []));
}

/** Una asignación con sus eventos (en orden de id), o undefined si no existe. */
export function cargarPiezaSla(db: DB, assignmentId: number): PiezaSla | undefined {
  const f = db.prepare(`SELECT ${COLUMNAS} FROM assignments WHERE id = ?`).get(assignmentId) as FilaPieza | undefined;
  if (!f) return undefined;
  const eventos = db
    .prepare(`SELECT ${COLUMNAS_EVENTO} FROM assignment_events WHERE assignment_id = ? ORDER BY id`)
    .all(assignmentId) as FilaEvento[];
  return aPieza(f, eventos.map(aEvento));
}

/** Todas las piezas que no están `Hecha` (abiertas y bloqueadas), con sus eventos. */
export function cargarPiezasAbiertas(db: DB): PiezaSla[] {
  const filas = db
    .prepare(`SELECT ${COLUMNAS} FROM assignments WHERE status <> 'Hecha' ORDER BY id`)
    .all() as FilaPieza[];
  if (filas.length === 0) return [];
  const eventos = db
    .prepare(
      `SELECT e.assignment_id, e.action, e.from_status, e.to_status, e.created_at
         FROM assignment_events e
         JOIN assignments a ON a.id = e.assignment_id
        WHERE a.status <> 'Hecha'
        ORDER BY e.id`
    )
    .all() as FilaEvento[];
  return agrupar(filas, eventos);
}

/** Semáforo de varias asignaciones a la vez (las que no existen no aparecen en el mapa). */
export function slaDeAsignaciones(
  db: DB,
  ids: number[],
  ahora: Date = new Date(),
  c?: SlaConfig
): Map<number, SlaResultado> {
  const out = new Map<number, SlaResultado>();
  const unicos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (unicos.length === 0) return out;
  const cfg = c ?? slaConfig(db);
  for (let i = 0; i < unicos.length; i += TANDA) {
    const tanda = unicos.slice(i, i + TANDA);
    const marcas = tanda.map(() => "?").join(",");
    const filas = db
      .prepare(`SELECT ${COLUMNAS} FROM assignments WHERE id IN (${marcas}) ORDER BY id`)
      .all(...tanda) as FilaPieza[];
    const eventos = db
      .prepare(`SELECT ${COLUMNAS_EVENTO} FROM assignment_events WHERE assignment_id IN (${marcas}) ORDER BY id`)
      .all(...tanda) as FilaEvento[];
    for (const p of agrupar(filas, eventos)) out.set(p.id, evaluarSla(p, cfg, ahora));
  }
  return out;
}
