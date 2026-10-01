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
 *    ledgers. Una fila `Hecho` del CSV entra como historia, sin premio y sin evento.
 *  - Solo nacen piezas Backlog (sin responsable), Asignada (con responsable) o Hecha
 *    (historia). Con responsable, Backlog, En curso, En revisión y Bloqueada entran
 *    como Asignada con aviso: el importador no fabrica estados que la máquina no puede
 *    explicar. Cada pieza nueva (salvo la historia) abre su historial con un evento
 *    `crear` de quien importa.
 *  - Reimportar no reasigna ni replanifica una entrega En revisión (ni una bloqueada
 *    desde revisión) ni edita una Hecha (misma regla que `editarAsignacion`). Fuera de
 *    Backlog tampoco cambia el responsable: eso se hace en el tablero, con su evento.
 *    Nunca mueve de proyecto lo que el tablero movió. Todo cambio deja su evento.
 *
 * Cadena del CLI (`packages/scripts/import-tareas.mjs`, type-stripping de Node):
 * imports de valor con sufijo `.ts` y sintaxis borrable.
 */
import type { DB } from "./db";
import { findRosterMember, isPendingPrincipal, normalizeName, pendingPrincipal } from "./roles.ts";
import { isTeamStatus, teamTransition, type TeamStatus } from "./team-state-machine.ts";
import { getActiveGenome } from "./genome.ts";
import { diaLocal, instanteDb } from "./zona-horaria.ts";
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
  // Con responsable, el importador solo crea lo que la máquina puede explicar: Asignada
  // (o Hecha, como historia). Una pieza En curso, En revisión o Bloqueada no se fabrica:
  // sin el evento de quien la empezó, la envió o la bloqueó, nadie sabría quién no
  // puede aprobarla, y quien importa podría aprobar lo que nadie entregó. Backlog con
  // responsable tampoco: con dueño la pieza está asignada, como cuando se crea en la web.
  if (assignee && status === "Backlog") {
    warnings.push(`con Assignee, 'Backlog' se importa como 'Asignada'`);
    status = "Asignada";
  } else if (assignee && status !== "Asignada" && status !== "Hecha") {
    warnings.push(`'${status}' se importa como 'Asignada': quien la tiene la mueve desde el tablero`);
    status = "Asignada";
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
function faltaMembresiaEn(db: DB, wallet: string, initiativeId: number | null): boolean {
  const u = db.prepare(`SELECT role, is_supervisor FROM users WHERE wallet = ?`).get(wallet) as
    | { role: string; is_supervisor: number }
    | undefined;
  if (!u || u.role !== "contributor" || u.is_supervisor) return false;
  if (initiativeId === null) return true;
  return !db
    .prepare(`SELECT 1 AS x FROM project_members WHERE initiative_id = ? AND wallet = ?`)
    .get(initiativeId, wallet);
}

function faltaMembresia(db: DB, wallet: string, initiativeName: string): boolean {
  const ini = db.prepare(`SELECT id FROM initiatives WHERE slug = ?`).get(slugify(initiativeName)) as
    | { id: number }
    | undefined;
  return faltaMembresiaEn(db, wallet, ini ? ini.id : null);
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

/** Lo que el CSV puede cambiar de una pieza que ya existe, con su columna. */
interface PiezaExistente {
  id: number;
  status: string;
  status_before_block: string | null;
  owner_wallet: string | null;
  initiative_id: number | null;
  title: string;
  description: string;
  priority: string;
  horizon: string;
  acceptance_criteria: string;
  size: string | null;
  due_date: string | null;
}

/**
 * Pieza que el CSV ya no toca: una aprobada no se edita, y una entrega en revisión
 * (o bloqueada desde revisión, que vuelve a revisión al desbloquearse) no se
 * reasigna ni se replanifica. Misma regla que `editarAsignacion`.
 */
function esFija(p: Pick<PiezaExistente, "status" | "status_before_block">): boolean {
  return (
    p.status === "Hecha" ||
    p.status === "En revisión" ||
    (p.status === "Bloqueada" && p.status_before_block === "En revisión")
  );
}

/**
 * Importa un CSV. Idempotente por `import_key`: la segunda pasada actualiza los
 * campos descriptivos y NO duplica nada.
 *
 * Filas nuevas: nacen Backlog (sin responsable), Asignada (con responsable) o Hecha
 * (historia, sin evento ni premio; ver `mapRow`). Las demás abren su historial con un
 * evento `crear` a nombre de quien importa (`cli` desde la consola), con el `now`
 * inyectado. Así ninguna pieza aparece "en revisión" sin que nadie la haya enviado.
 *
 * Al reimportar el tablero es la fuente de verdad una vez la pieza existe:
 *  - El `status` nunca se pisa.
 *  - Una pieza Hecha, En revisión o bloqueada desde revisión no se toca.
 *  - El responsable solo sigue al CSV mientras la pieza está en Backlog: recibirlo es
 *    la transición `asignar` de la máquina (Backlog → Asignada), y quitárselo solo
 *    cabe en Backlog. Fuera de Backlog se conserva y se avisa: reasignar trabajo
 *    empezado se hace en el tablero, con su evento y sus reglas.
 *  - Una pieza que el tablero movió de proyecto no vuelve al del CSV.
 *  - Si cambia algo, un evento (`asignar`, `reasignar` o `editar`) con los nombres de
 *    los campos (nunca valores). Si no cambia nada, ningún evento.
 *
 * No emite puntos ni reputación. Deja una fila `importar` en `talent_events` con los
 * conteos (quién importó y cuánto, nunca el contenido).
 */
export function importTasks(
  db: DB,
  csvText: string,
  createdBy: string | null = null,
  now: Date = new Date()
): ImportSummary {
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

  // Cada cambio deja su evento, a nombre de quien importa y con el `now` inyectado
  // (spec §3.1): `created_at` explícito y el día en la zona del genoma.
  const quienImporta = createdBy ?? "cli";
  const dia = diaLocal(now, getActiveGenome(db).BUSINESS_TZ);
  const instante = instanteDb(now);
  const insEvento = db.prepare(
    `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, reason, actor_wallet, day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const evento = (id: number, accion: string, de: string, a: string, motivo: string) =>
    insEvento.run(id, accion, de, a, motivo, quienImporta, dia, instante);

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

      const existing = db
        .prepare(
          `SELECT id, status, status_before_block, owner_wallet, initiative_id, title, description, priority,
                  horizon, acceptance_criteria, size, due_date
             FROM assignments WHERE import_key = ?`
        )
        .get(row.importKey) as PiezaExistente | undefined;

      let ownerWallet: string | null = null;
      if (row.assignee) {
        const res = resolver(db, row.assignee);
        if ("motivo" in res) {
          summary.errors.push({ line, title: row.title, reason: res.motivo });
          continue;
        }
        ownerWallet = res.wallet;
      }
      // La membresía importa cuando la persona de verdad recibe la pieza: al crearla o
      // al asignarle una que sigue en Backlog (en el proyecto donde está HOY la pieza).
      if (ownerWallet !== null && (!existing || (existing.status === "Backlog" && existing.owner_wallet !== ownerWallet))) {
        const falta = existing
          ? faltaMembresiaEn(db, ownerWallet, existing.initiative_id)
          : faltaMembresia(db, ownerWallet, row.initiativeName);
        if (falta) {
          summary.errors.push({
            line,
            title: row.title,
            reason: existing
              ? `«${row.assignee}» no está en el proyecto de esta pieza: primero súmale`
              : `«${row.assignee}» no está en el proyecto «${row.initiativeName}»: primero súmale`,
          });
          continue;
        }
      }

      const initiativeId = upsertInitiative(db, row.initiativeName, row.horizon);
      if (!seenInitiatives.has(row.initiativeName)) {
        seenInitiatives.add(row.initiativeName);
        summary.initiatives++;
      }

      if (!existing) {
        for (const w of row.warnings) summary.warnings.push({ line, title: row.title, warning: w });
        const id = createAssignment(db, {
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
        // La historia (Hecha) entra sin evento: no es una entrega aprobada hoy, y un
        // evento hacia Hecha la contaría como tal en el resumen del día.
        if (row.status !== "Hecha") evento(id, "crear", "Backlog", row.status, "importada desde CSV");
        summary.created++;
        continue;
      }

      summary.updated++;
      const avisar = (warning: string) => summary.warnings.push({ line, title: row.title, warning });
      const noSeReasigna = `está '${existing.status}' con su responsable: no se reasigna desde el CSV (se cambia en el tablero)`;
      if (esFija(existing)) {
        if (ownerWallet !== existing.owner_wallet) avisar(noSeReasigna);
        continue;
      }

      const sets: string[] = [];
      const valores: Array<string | null> = [];
      const campos: string[] = [];
      const cambia = (campo: string, columna: string, nuevo: string | null, actual: string | null) => {
        if (nuevo === actual) return;
        sets.push(`${columna} = ?`);
        valores.push(nuevo);
        campos.push(campo);
      };
      cambia("title", "title", row.title, existing.title);
      cambia("description", "description", row.description, existing.description ?? "");
      cambia("priority", "priority", row.priority, existing.priority);
      cambia("horizon", "horizon", row.horizon, existing.horizon);
      cambia("acceptanceCriteria", "acceptance_criteria", row.acceptanceCriteria, existing.acceptance_criteria ?? "");
      // Una celda vacía no borra lo que ya se planificó.
      if (row.size !== null) cambia("size", "size", row.size, existing.size);
      if (row.dueDate !== null) cambia("dueDate", "due_date", row.dueDate, existing.due_date);

      if (existing.initiative_id !== initiativeId) {
        avisar("en el tablero está en otro proyecto: el CSV no la mueve");
      }

      let status = existing.status;
      let accion = "editar";
      if (ownerWallet !== existing.owner_wallet) {
        if (existing.status !== "Backlog") {
          avisar(noSeReasigna);
        } else if (ownerWallet === null) {
          // Dato viejo (Backlog con responsable): en Backlog sí puede quedar sin él.
          cambia("ownerWallet", "owner_wallet", null, existing.owner_wallet);
          accion = "reasignar";
        } else {
          // Recibir responsable en Backlog es la transición `asignar` de la máquina.
          status = teamTransition({ status: "Backlog", statusBeforeBlock: null, blockedReason: null }, "asignar").status;
          cambia("ownerWallet", "owner_wallet", ownerWallet, existing.owner_wallet);
          accion = "asignar";
        }
      }

      if (campos.length === 0) continue;
      db.prepare(`UPDATE assignments SET ${sets.join(", ")}, status = ?, updated_at = ? WHERE id = ?`).run(
        ...valores,
        status,
        now.toISOString(),
        existing.id
      );
      evento(existing.id, accion, existing.status, status, `campos: ${campos.join(", ")}`);
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
