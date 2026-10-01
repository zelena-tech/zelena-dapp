/**
 * Importador de los CSV de tareas de John → iniciativas + asignaciones (WP14).
 *
 * Columnas (el nombre de la cabecera se reconoce sin mayúsculas ni acentos, en
 * español o en inglés):
 *   obligatorias: Task Name (o Title), Iniciativa (o Initiative)
 *   opcionales:   Description, Status, Priority, Assignee, Horizonte,
 *                 Criterio de aceptación, Size (S|M|L), Due (AAAA-MM-DD)
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
 *
 * WP31-A2 (spec §5.A.6):
 *  - El Assignee se resuelve POR DATOS (`resolverPersona`): alias del roster →
 *    `walletDeRoster` (la cuenta vinculada o su `pending:<slug>`); si no, una
 *    coincidencia única de `display_name` entre activos no demo. Si no, error de fila.
 *    `mapRow` sigue siendo puro: devuelve el nombre crudo y la resolución pasa a
 *    `importTasks`.
 *  - Importar NO emite puntos ni reputación: no crea eventos `aprobar` ni toca los
 *    ledgers. Una fila `Hecho` del CSV entra como historia, sin premio.
 *  - Reimportar no reasigna ni replanifica una entrega En revisión ni edita una Hecha
 *    (misma regla que `editarAsignacion`).
 *
 * Cadena del CLI (`packages/scripts/import-tareas.mjs`, type-stripping de Node):
 * imports de valor con sufijo `.ts` y sintaxis borrable.
 */
import type { DB } from "./db";
import { findRosterMember, isPendingPrincipal, normalizeName, pendingPrincipal } from "./roles.ts";
import { isTeamStatus, type TeamStatus } from "./team-state-machine.ts";
import {
  createAssignment,
  getAssignment,
  isHorizon,
  seedTeamRoster,
  slugify,
  upsertInitiative,
  type Horizon,
  type Priority,
  type Size,
} from "./team.ts";
import { walletDeRoster } from "./talento.ts";

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

/** Priority del CSV → prioridad del modelo (inglés, español o P1–P4). */
export const PRIORITY_MAP: Record<string, Priority> = {
  urgent: "Urgent",
  urgente: "Urgent",
  p1: "Urgent",
  high: "High",
  alta: "High",
  p2: "High",
  normal: "Normal",
  media: "Normal",
  p3: "Normal",
  low: "Low",
  baja: "Low",
  p4: "Low",
};

/** Size del CSV → tamaño del modelo. */
export const SIZE_MAP: Record<string, Size> = { s: "S", m: "M", l: "L" };

/**
 * Columnas reconocidas: nombre canónico (el de los CSV de John) y sus alias. La
 * cabecera se compara con `normalizeName` (sin acentos, sin mayúsculas).
 */
const COLUMNAS: ReadonlyArray<{ canon: string; alias: readonly string[]; obligatoria: boolean }> = [
  { canon: "Task Name", alias: ["title", "titulo", "tarea"], obligatoria: true },
  { canon: "Iniciativa", alias: ["initiative", "proyecto", "project"], obligatoria: true },
  { canon: "Description", alias: ["descripcion"], obligatoria: false },
  { canon: "Status", alias: ["estado"], obligatoria: false },
  { canon: "Priority", alias: ["prioridad"], obligatoria: false },
  { canon: "Assignee", alias: ["responsable"], obligatoria: false },
  { canon: "Horizonte", alias: ["horizon"], obligatoria: false },
  { canon: "Criterio de aceptación", alias: ["criterio", "acceptance", "acceptance criteria"], obligatoria: false },
  { canon: "Size", alias: ["tamano"], obligatoria: false },
  { canon: "Due", alias: ["due date", "vence", "fecha"], obligatoria: false },
];

/** Nombre canónico de una cabecera, o null si no es una columna reconocida. */
function columnaCanonica(cabecera: string): string | null {
  const n = normalizeName(cabecera);
  if (!n) return null;
  const c = COLUMNAS.find((col) => normalizeName(col.canon) === n || col.alias.includes(n));
  return c ? c.canon : null;
}

/** Celdas con sus claves llevadas al nombre canónico (la primera aparición gana). */
function celdasCanonicas(cells: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cells)) {
    const canon = columnaCanonica(k) ?? k;
    if (!(canon in out)) out[canon] = v ?? "";
  }
  return out;
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

/** `AAAA-MM-DD` que existe en el calendario. */
function esFechaValida(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
// Fila mapeada
// ---------------------------------------------------------------------------

export interface MappedRow {
  title: string;
  description: string;
  status: TeamStatus;
  priority: Priority;
  /**
   * Resolución PURA por el roster en código (alias → `pending:<slug>`), o null. Es
   * una pista para el dry-run del CLI: `importTasks` la sustituye por la resolución
   * por datos (`resolverPersona`).
   */
  ownerWallet: string | null;
  /** El Assignee tal como viene en el CSV (vacío = sin responsable). */
  assignee: string;
  initiativeName: string;
  horizon: Horizon;
  acceptanceCriteria: string;
  size: Size | null;
  dueDate: string | null;
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
 * inventado en el tablero del equipo). Puro: no lee la base; el Assignee se
 * devuelve crudo y lo resuelve `importTasks`.
 */
export function mapRow(rawCells: Record<string, string>): { row?: MappedRow; error?: string } {
  const cells = celdasCanonicas(rawCells);
  const title = (cells["Task Name"] ?? "").trim();
  if (!title) return { error: "Fila sin 'Task Name'." };
  // Sin letras ni números no hay `import_key` estable (chocaría con otras filas).
  if (!slugify(title)) return { error: "El 'Task Name' necesita letras o números." };

  const initiativeName = (cells["Iniciativa"] ?? "").trim();
  if (!initiativeName) return { error: "Fila sin 'Iniciativa'." };
  // Ídem para la iniciativa: `upsertInitiative` la rechazaría y abortaría toda la importación.
  if (!slugify(initiativeName)) return { error: "La 'Iniciativa' necesita letras o números." };

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
    const mapped = PRIORITY_MAP[normalizeName(rawPriority)];
    if (!mapped) return { error: `Priority desconocida: '${rawPriority}'.` };
    priority = mapped;
  }

  const rawHorizon = (cells["Horizonte"] ?? "").trim();
  let horizon: Horizon = "Ahora";
  if (rawHorizon) {
    const mapped = HORIZON_MAP[norm(rawHorizon)] ?? (isHorizon(rawHorizon) ? rawHorizon : undefined);
    if (!mapped) return { error: `Horizonte desconocido: '${rawHorizon}'.` };
    horizon = mapped;
  }

  const rawSize = (cells["Size"] ?? "").trim();
  let size: Size | null = null;
  if (rawSize) {
    const mapped = SIZE_MAP[norm(rawSize)];
    if (!mapped) return { error: `Size desconocido: '${rawSize}' (usa S, M o L).` };
    size = mapped;
  }

  const rawDue = (cells["Due"] ?? "").trim();
  let dueDate: string | null = null;
  if (rawDue) {
    if (!esFechaValida(rawDue)) return { error: `Due no es una fecha AAAA-MM-DD: '${rawDue}'.` };
    dueDate = rawDue;
  }

  const assignee = (cells["Assignee"] ?? "").trim();
  const member = assignee ? findRosterMember(assignee) : undefined;
  const ownerWallet = member ? pendingPrincipal(member.slug) : null;

  // Coherencia de la máquina de estados: sin responsable, el trabajo no puede estar
  // más allá de Backlog. Se corrige y se avisa en vez de crear un estado imposible.
  if (!assignee && status !== "Backlog") {
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
      assignee,
      initiativeName,
      horizon,
      acceptanceCriteria: (cells["Criterio de aceptación"] ?? "").trim(),
      size,
      dueDate,
      importKey: `csv:${slugify(initiativeName)}:${slugify(title)}`,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolución del Assignee por datos
// ---------------------------------------------------------------------------

type Resolucion = { wallet: string } | { motivo: string };

function resolver(db: DB, nombre: string): Resolucion {
  const crudo = (nombre ?? "").trim();
  const n = normalizeName(crudo);
  if (!n) return { motivo: "falta el Assignee" };

  // 1. Alias del roster → su cuenta vinculada o su fila `pending:<slug>`.
  const member = findRosterMember(crudo);
  if (member) {
    const w = walletDeRoster(db, member.slug);
    if (w) return { wallet: w };
  }

  // 2. Coincidencia ÚNICA de display_name entre activos no demo.
  const filas = db
    .prepare(`SELECT wallet, display_name FROM users WHERE status = 'active' AND is_demo = 0`)
    .all() as Array<{ wallet: string; display_name: string }>;
  const coinciden = filas.filter((f) => normalizeName(f.display_name ?? "") === n);
  if (coinciden.length === 1) return { wallet: coinciden[0].wallet };
  if (coinciden.length > 1) return { motivo: `hay más de una persona llamada «${crudo}» en el equipo` };

  // 3. La cuenta exacta (para quien pega una wallet en lugar de un nombre).
  const exacta = filas.find((f) => f.wallet === crudo && !isPendingPrincipal(f.wallet));
  if (exacta) return { wallet: exacta.wallet };

  return { motivo: `no encuentro a «${crudo}» en el equipo` };
}

/**
 * Persona del equipo a partir del nombre del CSV: alias del roster →
 * `walletDeRoster`; si no, coincidencia única de `display_name` normalizado entre
 * activos no demo; si no, null.
 */
export function resolverPersona(db: DB, nombre: string): string | null {
  const r = resolver(db, nombre);
  return "wallet" in r ? r.wallet : null;
}

/**
 * Un contributor (sin supervisión) solo ve sus proyectos: no se le importa trabajo
 * en uno donde no es miembro, o quedaría a su nombre algo que no puede ver.
 */
function faltaMembresia(db: DB, wallet: string, initiativeName: string): boolean {
  const u = db.prepare(`SELECT role, is_supervisor FROM users WHERE wallet = ?`).get(wallet) as
    | { role: string; is_supervisor: number }
    | undefined;
  if (!u || u.role !== "contributor" || u.is_supervisor) return false;
  const ini = db.prepare(`SELECT id FROM initiatives WHERE slug = ?`).get(slugify(initiativeName)) as
    | { id: number }
    | undefined;
  if (!ini) return true;
  return !db
    .prepare(`SELECT 1 AS x FROM project_members WHERE initiative_id = ? AND wallet = ?`)
    .get(ini.id, wallet);
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

/** Estados que el CSV ya no toca: una entrega en revisión no se replanifica y una aprobada no se edita. */
const FIJOS: readonly string[] = ["En revisión", "Hecha"];

/**
 * Importa un CSV. Idempotente por `import_key`: la segunda pasada actualiza los
 * campos descriptivos y NO duplica nada.
 *
 * Al reimportar NO se pisa el `status` de una asignación que el equipo ya movió en
 * la app: el tablero es la fuente de verdad una vez el trabajo empezó. El CSV solo
 * fija el estado inicial de las filas nuevas. Una entrega En revisión o Hecha no se
 * toca (cuenta como "ya estaba").
 *
 * No emite puntos ni reputación. Deja una fila `importar` en `talent_events` con los
 * conteos (quién importó y cuánto, nunca el contenido).
 */
export function importTasks(db: DB, csvText: string, createdBy: string | null = null): ImportSummary {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error("El CSV está vacío.");

  const header = rows[0].map((h) => columnaCanonica(h) ?? h.trim());
  for (const col of COLUMNAS) {
    if (col.obligatoria && !header.includes(col.canon)) {
      throw new Error(`Falta la columna '${col.canon}' en el CSV.`);
    }
  }

  const summary: ImportSummary = { created: 0, updated: 0, initiatives: 0, errors: [], warnings: [] };
  const seenInitiatives = new Set<string>();

  // El importador necesita el roster para resolver los Assignee (FK owner_wallet).
  // Solo inserta lo que falta: no pisa roles ni recrea filas ya vinculadas.
  seedTeamRoster(db);

  const tx = db.transaction(() => {
    for (let r = 1; r < rows.length; r++) {
      const cells: Record<string, string> = {};
      header.forEach((h, i) => {
        if (!(h in cells)) cells[h] = rows[r][i] ?? "";
      });
      const line = r + 1; // 1-indexado con cabecera, como lo ve un editor
      const titulo = (cells["Task Name"] ?? "").trim();

      const { row, error } = mapRow(cells);
      if (!row) {
        summary.errors.push({ line, title: titulo, reason: error ?? "fila inválida" });
        continue;
      }

      let ownerWallet: string | null = null;
      if (row.assignee) {
        const res = resolver(db, row.assignee);
        if ("motivo" in res) {
          summary.errors.push({ line, title: row.title, reason: res.motivo });
          continue;
        }
        if (faltaMembresia(db, res.wallet, row.initiativeName)) {
          summary.errors.push({
            line,
            title: row.title,
            reason: `«${row.assignee}» no está en el proyecto «${row.initiativeName}»: primero súmale`,
          });
          continue;
        }
        ownerWallet = res.wallet;
      }
      for (const w of row.warnings) summary.warnings.push({ line, title: row.title, warning: w });

      const initiativeId = upsertInitiative(db, row.initiativeName, row.horizon);
      if (!seenInitiatives.has(row.initiativeName)) {
        seenInitiatives.add(row.initiativeName);
        summary.initiatives++;
      }

      const existing = db.prepare(`SELECT id, status FROM assignments WHERE import_key = ?`).get(row.importKey) as
        | { id: number; status: string }
        | undefined;

      if (existing) {
        if (!FIJOS.includes(existing.status)) {
          db.prepare(
            `UPDATE assignments
                SET title = ?, description = ?, initiative_id = ?, owner_wallet = ?, priority = ?,
                    horizon = ?, acceptance_criteria = ?, size = COALESCE(?, size),
                    due_date = COALESCE(?, due_date), updated_at = datetime('now')
              WHERE id = ?`
          ).run(
            row.title,
            row.description,
            initiativeId,
            ownerWallet,
            row.priority,
            row.horizon,
            row.acceptanceCriteria,
            row.size,
            row.dueDate,
            existing.id
          );
        }
        summary.updated++;
      } else {
        createAssignment(db, {
          title: row.title,
          description: row.description,
          initiativeId,
          ownerWallet,
          status: row.status,
          priority: row.priority,
          size: row.size,
          horizon: row.horizon,
          dueDate: row.dueDate,
          acceptanceCriteria: row.acceptanceCriteria,
          createdBy,
          importKey: row.importKey,
        });
        summary.created++;
      }
    }

    db.prepare(
      `INSERT INTO talent_events (actor_wallet, target_wallet, initiative_id, action, detail) VALUES (?, NULL, NULL, 'importar', ?)`
    ).run(
      createdBy ?? "cli",
      JSON.stringify({
        creadas: summary.created,
        yaEstaban: summary.updated,
        conError: summary.errors.length,
        proyectos: summary.initiatives,
      })
    );
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
