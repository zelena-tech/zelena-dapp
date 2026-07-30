/**
 * Importador de los CSV de tareas de John → iniciativas + asignaciones (WP14).
 *
 * Columnas esperadas:
 *   Task Name, Description, Status, Priority, Assignee, Iniciativa, Horizonte,
 *   Criterio de aceptación
 *
 * Detalles REALES de los archivos de John que este parser tiene que aguantar:
 *  - `Zelena_Tareas_Import.csv` empieza con BOM UTF-8 (EF BB BF);
 *  - hay comas dentro de campos entrecomillados;
 *  - los saltos de línea son CRLF.
 * Por eso el parser es propio (sin dependencias nuevas): comillas, comillas
 * escapadas (""), comas dentro de campos y CRLF.
 *
 * IDEMPOTENTE: cada fila produce un `import_key` determinista
 * (`csv:<iniciativa>:<titulo>`); reimportar actualiza en vez de duplicar.
 */
import type { DB } from "./db";
import { findRosterMember, pendingPrincipal } from "./roles.ts";
import { isTeamStatus, type TeamStatus } from "./team-state-machine.ts";
import {
  createAssignment,
  getAssignment,
  isHorizon,
  isPriority,
  seedTeamRoster,
  slugify,
  upsertInitiative,
  type Horizon,
  type Priority,
} from "./team.ts";

// ---------------------------------------------------------------------------
// Parser CSV (propio; sin dependencias)
// ---------------------------------------------------------------------------

/**
 * Parte un texto CSV en filas de celdas. Soporta BOM UTF-8, campos entrecomillados
 * con comas y saltos de línea dentro, comillas escapadas ("") y CRLF.
 * Descarta filas completamente vacías (última línea del archivo).
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const endRow = () => {
    row.push(field);
    field = "";
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else if (c !== "\r") {
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Mapeos del vocabulario del CSV al del modelo
// ---------------------------------------------------------------------------

/** Status del CSV → estado de la máquina. `Hecho` (CSV) = `Hecha` (modelo). */
export const STATUS_MAP: Record<string, TeamStatus> = {
  backlog: "Backlog",
  asignada: "Asignada",
  "en curso": "En curso",
  "en revision": "En revisión",
  "en revisión": "En revisión",
  hecho: "Hecha",
  hecha: "Hecha",
  bloqueada: "Bloqueada",
};

/** Horizonte del CSV → horizonte del modelo. `Después` (CSV) = `Parqueado`. */
export const HORIZON_MAP: Record<string, Horizon> = {
  ahora: "Ahora",
  siguiente: "Siguiente",
  despues: "Parqueado",
  "después": "Parqueado",
  parqueado: "Parqueado",
};

const HEADERS = [
  "Task Name",
  "Description",
  "Status",
  "Priority",
  "Assignee",
  "Iniciativa",
  "Horizonte",
  "Criterio de aceptación",
] as const;

function norm(v: string): string {
  return v.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Fila mapeada
// ---------------------------------------------------------------------------

export interface MappedRow {
  title: string;
  description: string;
  status: TeamStatus;
  priority: Priority;
  ownerWallet: string | null;
  initiativeName: string;
  horizon: Horizon;
  acceptanceCriteria: string;
  importKey: string;
  warnings: string[];
}

export interface RowError {
  line: number;
  title: string;
  reason: string;
}

export interface ImportSummary {
  created: number;
  updated: number;
  initiatives: number;
  errors: RowError[];
  warnings: Array<{ line: number; title: string; warning: string }>;
}

/**
 * Mapea una fila. Devuelve `{ error }` si un valor del vocabulario es desconocido:
 * el importador NO adivina silenciosamente (mejor una fila reportada que un dato
 * inventado en el tablero del equipo).
 */
export function mapRow(cells: Record<string, string>): { row?: MappedRow; error?: string } {
  const title = (cells["Task Name"] ?? "").trim();
  if (!title) return { error: "Fila sin 'Task Name'." };

  const initiativeName = (cells["Iniciativa"] ?? "").trim();
  if (!initiativeName) return { error: "Fila sin 'Iniciativa'." };

  const warnings: string[] = [];

  const rawStatus = (cells["Status"] ?? "").trim();
  let status: TeamStatus = "Backlog";
  if (rawStatus) {
    const mapped = STATUS_MAP[norm(rawStatus)];
    if (!mapped) return { error: `Status desconocido: '${rawStatus}'.` };
    status = mapped;
  }

  const rawPriority = (cells["Priority"] ?? "").trim();
  let priority: Priority = "Normal";
  if (rawPriority) {
    const candidate = rawPriority[0].toUpperCase() + rawPriority.slice(1).toLowerCase();
    if (!isPriority(candidate)) return { error: `Priority desconocida: '${rawPriority}'.` };
    priority = candidate;
  }

  const rawHorizon = (cells["Horizonte"] ?? "").trim();
  let horizon: Horizon = "Ahora";
  if (rawHorizon) {
    const mapped = HORIZON_MAP[norm(rawHorizon)] ?? (isHorizon(rawHorizon) ? rawHorizon : undefined);
    if (!mapped) return { error: `Horizonte desconocido: '${rawHorizon}'.` };
    horizon = mapped;
  }

  const rawAssignee = (cells["Assignee"] ?? "").trim();
  let ownerWallet: string | null = null;
  if (rawAssignee) {
    const member = findRosterMember(rawAssignee);
    if (!member) return { error: `Assignee fuera del roster: '${rawAssignee}'.` };
    ownerWallet = pendingPrincipal(member.slug);
  }

  // Coherencia de la máquina de estados: sin responsable, el trabajo no puede estar
  // más allá de Backlog. Se corrige y se avisa en vez de crear un estado imposible.
  if (!ownerWallet && status !== "Backlog") {
    warnings.push(`sin Assignee: '${status}' se importa como 'Backlog'`);
    status = "Backlog";
  }
  if (!isTeamStatus(status)) return { error: `Estado inválido tras el mapeo: '${status}'.` };

  return {
    row: {
      title,
      description: (cells["Description"] ?? "").trim(),
      status,
      priority,
      ownerWallet,
      initiativeName,
      horizon,
      acceptanceCriteria: (cells["Criterio de aceptación"] ?? "").trim(),
      importKey: `csv:${slugify(initiativeName)}:${slugify(title)}`,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

/**
 * Importa un CSV. Idempotente por `import_key`: la segunda pasada actualiza los
 * campos descriptivos y NO duplica nada.
 *
 * Al reimportar NO se pisa el `status` de una asignación que el equipo ya movió en
 * la app: el tablero es la fuente de verdad una vez el trabajo empezó. El CSV solo
 * fija el estado inicial de las filas nuevas.
 */
export function importTasks(db: DB, csvText: string, createdBy: string | null = null): ImportSummary {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error("El CSV está vacío.");

  const header = rows[0].map((h) => h.trim());
  for (const h of HEADERS) {
    if (!header.includes(h)) throw new Error(`Falta la columna '${h}' en el CSV.`);
  }

  const summary: ImportSummary = { created: 0, updated: 0, initiatives: 0, errors: [], warnings: [] };
  const seenInitiatives = new Set<string>();

  // El importador necesita el roster para resolver los Assignee (FK owner_wallet).
  seedTeamRoster(db);

  const tx = db.transaction(() => {
    for (let r = 1; r < rows.length; r++) {
      const cells: Record<string, string> = {};
      header.forEach((h, i) => (cells[h] = rows[r][i] ?? ""));
      const line = r + 1; // 1-indexado con cabecera, como lo ve un editor

      const { row, error } = mapRow(cells);
      if (!row) {
        summary.errors.push({ line, title: (cells["Task Name"] ?? "").trim(), reason: error ?? "fila inválida" });
        continue;
      }
      for (const w of row.warnings) summary.warnings.push({ line, title: row.title, warning: w });

      const initiativeId = upsertInitiative(db, row.initiativeName, row.horizon);
      if (!seenInitiatives.has(row.initiativeName)) {
        seenInitiatives.add(row.initiativeName);
        summary.initiatives++;
      }

      const existing = db.prepare(`SELECT id FROM assignments WHERE import_key = ?`).get(row.importKey) as
        | { id: number }
        | undefined;

      if (existing) {
        db.prepare(
          `UPDATE assignments
              SET title = ?, description = ?, initiative_id = ?, owner_wallet = ?, priority = ?,
                  horizon = ?, acceptance_criteria = ?, updated_at = datetime('now')
            WHERE id = ?`
        ).run(
          row.title,
          row.description,
          initiativeId,
          row.ownerWallet,
          row.priority,
          row.horizon,
          row.acceptanceCriteria,
          existing.id
        );
        summary.updated++;
      } else {
        createAssignment(db, {
          title: row.title,
          description: row.description,
          initiativeId,
          ownerWallet: row.ownerWallet,
          status: row.status,
          priority: row.priority,
          horizon: row.horizon,
          acceptanceCriteria: row.acceptanceCriteria,
          createdBy,
          importKey: row.importKey,
        });
        summary.created++;
      }
    }
  });
  tx();
  return summary;
}

/** Utilidad para el CLI: comprueba que una asignación importada existe. */
export function findByImportKey(db: DB, importKey: string) {
  const row = db.prepare(`SELECT id FROM assignments WHERE import_key = ?`).get(importKey) as
    | { id: number }
    | undefined;
  return row ? getAssignment(db, row.id) : undefined;
}
