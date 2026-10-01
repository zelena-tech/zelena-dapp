/**
 * Capa de datos ÚNICA. Todo acceso a persistencia pasa por aquí.
 *
 * Driver múltiple, misma superficie SÍNCRONA (prepare().get/all/run, exec, pragma,
 * transaction). Toda la app importa SOLO desde este archivo.
 *  1) Azure SQL Database (paquete `mssql`) — PRODUCCIÓN v1 (WP16). Se ACTIVA con
 *     AZURE_SQL_SERVER (o DATABASE_DRIVER=mssql). `mssql` es asíncrono, así que va
 *     detrás de un puente síncrono (worker_threads + Atomics.wait) y de un
 *     traductor de dialecto T-SQL. Ver `db-mssql.ts` y `sql-dialect.ts`.
 *  2) libSQL/Turso (paquete `libsql`, síncrono, compatible better-sqlite3) — se
 *     ACTIVA cuando hay DATABASE_URL/TURSO_DATABASE_URL. Se conserva para un
 *     archivo libSQL local en dev/CI (WP05 quedó superseded por WP16).
 *  3) better-sqlite3 si está disponible (rendimiento, prod local).
 *  4) node:sqlite (built-in de Node >=22) como fallback sin compilación nativa.
 *
 * DESARROLLO LOCAL SIGUE CON SQLITE: rápido, sin costo, sin red (NO-alcance de WP16).
 *
 * IMPORTANTE: para libSQL se usa `libsql` (síncrono), NO `@libsql/client`
 * (asíncrono): la capa de datos y todos sus consumidores son síncronos. `libsql`
 * habla con archivo local (`file:`), réplica embebida o Turso remoto
 * (`libsql://…` + authToken). Ver docs/deploy.md.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { seedIfEmpty } from "./seed";
import { FOUNDER_WALLET } from "./config";
import { esWalletStellar } from "./crypto";
import { azureSqlConfigFromEnv, describeAzureSql, openAzureSql, type EnvLike } from "./db-mssql";

export interface Stmt {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface DB {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  pragma(directive: string): void;
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
}

const g = globalThis as unknown as { __zelenaDb?: DB };

function dbFilePath(): string {
  const configured = process.env.DATABASE_FILE;
  if (configured) return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  return path.join(process.cwd(), "data", "zelena.db");
}

function schemaSql(): string {
  const p = path.join(process.cwd(), "src", "lib", "schema.sql");
  return fs.readFileSync(p, "utf8");
}

/** Driver 1: better-sqlite3 (ya implementa la interfaz completa). */
function tryBetterSqlite(file: string): DB | null {
  try {
    const req = createRequire(import.meta.url);
    const Database = req("better-sqlite3");
    const db = new Database(file);
    return {
      prepare: (sql: string) => db.prepare(sql) as Stmt,
      exec: (sql: string) => void db.exec(sql),
      pragma: (d: string) => void db.pragma(d),
      transaction: <A extends unknown[], R>(fn: (...args: A) => R) => db.transaction(fn) as (...args: A) => R,
    };
  } catch {
    return null;
  }
}

/** Driver libSQL/Turso: paquete `libsql` (síncrono, API compatible better-sqlite3). */
function tryLibsql(url: string, authToken?: string): DB | null {
  try {
    const req = createRequire(import.meta.url);
    const Database = req("libsql");
    const db = authToken ? new Database(url, { authToken }) : new Database(url);
    return {
      prepare: (sql: string) => db.prepare(sql) as Stmt,
      exec: (sql: string) => void db.exec(sql),
      // Los pragmas locales (WAL, foreign_keys) no aplican en Turso remoto: best-effort.
      pragma: (d: string) => {
        try {
          db.pragma(d);
        } catch {
          /* remoto/no soportado: ignorar */
        }
      },
      transaction: <A extends unknown[], R>(fn: (...args: A) => R) => db.transaction(fn) as (...args: A) => R,
    };
  } catch {
    return null;
  }
}

/** Abre explícitamente un DB libSQL (para tests y para el selector por env var). */
export function openLibsql(url: string, authToken?: string): DB {
  const db = tryLibsql(url, authToken);
  if (!db) throw new Error("No se pudo abrir libSQL: ¿está instalado el paquete `libsql`?");
  return db;
}

/** URL de libSQL configurada por entorno (Turso o archivo libSQL local), o null. */
export function libsqlUrl(): string | null {
  return process.env.TURSO_DATABASE_URL ?? process.env.DATABASE_URL ?? null;
}

/** Ruta de archivo local si la URL es local (`file:` o path plano); null si es remota. */
export function localFileFromUrl(url: string): string | null {
  if (url.startsWith("file:")) {
    const p = url.slice("file:".length).replace(/^\/\//, "");
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return null; // remota (libsql://, https://, wss://)
  return path.isAbsolute(url) ? url : path.join(process.cwd(), url); // path plano
}

/** Driver 2: node:sqlite (DatabaseSync, sin dependencias nativas externas). */
function nodeSqlite(file: string): DB {
  const req = createRequire(import.meta.url);
  const { DatabaseSync } = req("node:sqlite");
  const db = new DatabaseSync(file);
  let inTx = false;
  return {
    prepare: (sql: string) => {
      // Statement perezoso: tolera DDL posterior y evita statements colgados.
      return {
        run: (...p: unknown[]) => db.prepare(sql).run(...p),
        get: (...p: unknown[]) => db.prepare(sql).get(...p),
        all: (...p: unknown[]) => db.prepare(sql).all(...p),
      } as Stmt;
    },
    exec: (sql: string) => void db.exec(sql),
    pragma: (d: string) => void db.exec(`PRAGMA ${d};`),
    transaction:
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      (...args: A): R => {
        if (inTx) return fn(...args); // transacción anidada: únete a la externa
        db.exec("BEGIN IMMEDIATE");
        inTx = true;
        try {
          const r = fn(...args);
          db.exec("COMMIT");
          return r;
        } catch (e) {
          try { db.exec("ROLLBACK"); } catch { /* ya revertida */ }
          throw e;
        } finally {
          inTx = false;
        }
      },
  };
}

/** Abre una conexión con el mejor driver disponible, sin schema ni seed (útil en tests). */
export function openDb(file: string): DB {
  return tryBetterSqlite(file) ?? nodeSqlite(file);
}

export type DbDriver = "mssql" | "libsql" | "sqlite";

/**
 * Qué driver toca, según el entorno. PURA respecto del `env` que recibe.
 *
 * 1. `DATABASE_DRIVER` explícito manda (mssql | libsql | sqlite).
 * 2. Configuración de Azure SQL presente → `mssql` (producción v1).
 * 3. URL de libSQL/Turso → `libsql`.
 * 4. Si no → SQLite local (desarrollo).
 */
export function resolveDriver(env: EnvLike = process.env): DbDriver {
  const explicit = env.DATABASE_DRIVER?.trim().toLowerCase();
  if (explicit) {
    if (explicit === "mssql" || explicit === "libsql" || explicit === "sqlite") return explicit;
    throw new Error(`DATABASE_DRIVER='${explicit}' no es válido (mssql | libsql | sqlite).`);
  }
  if (env.AZURE_SQL_SERVER || env.AZURE_SQL_CONNECTION_STRING) return "mssql";
  if (env.TURSO_DATABASE_URL || env.DATABASE_URL) return "libsql";
  return "sqlite";
}

function init(): DB {
  const driver = resolveDriver();
  if (driver === "mssql") {
    // Azure SQL (producción v1). Si la configuración está pero el driver no carga,
    // se LANZA: degradar a SQLite local en producción es el fallo exacto que esto
    // existe para evitar (mismo criterio que la URL remota de Turso, más abajo).
    const config = azureSqlConfigFromEnv();
    if (!config) {
      throw new Error(
        "DATABASE_DRIVER=mssql pero falta la configuración de Azure SQL " +
          "(AZURE_SQL_SERVER + AZURE_SQL_DATABASE, o AZURE_SQL_CONNECTION_STRING). Ver docs/deploy.md."
      );
    }
    const remote = openAzureSql(config);
    remote.exec(schemaSql());
    seedIfEmpty(remote);
    // Misma regla que la ruta SQLite: FOUNDER_WALLET se aplica en cada arranque.
    const promovidos = backfillFounder(remote, FOUNDER_WALLET);
    if (promovidos > 0) console.info(`[db] founder: ${promovidos} fila(s) promovidas por FOUNDER_WALLET.`);
    console.info(`[db] Azure SQL activo: ${describeAzureSql(config)}`);
    return remote;
  }

  const url = driver === "libsql" ? libsqlUrl() : null;
  let db: DB;
  // Archivo local de la base, para el respaldo previo a una migración (null = remota).
  let archivo: string | null = null;
  if (url) {
    // Driver libSQL/Turso seleccionado por env var (deploy serverless o archivo local).
    const authToken = process.env.TURSO_AUTH_TOKEN ?? process.env.DATABASE_AUTH_TOKEN ?? undefined;
    const localFile = localFileFromUrl(url);
    // Para un archivo local, crea el directorio antes de abrir (primer arranque).
    if (localFile) fs.mkdirSync(path.dirname(localFile), { recursive: true });
    archivo = localFile;
    const libsql = tryLibsql(url, authToken);
    if (libsql) {
      db = libsql;
    } else if (!localFile) {
      // URL REMOTA (Turso) pero el paquete `libsql` no cargó: FALLAR fuerte. Degradar
      // a SQLite local sería el archivo efímero de Vercel (fork F2) sin aviso — el
      // fallo exacto que WP03 existe para evitar.
      throw new Error(
        `DATABASE/TURSO URL remota configurada pero el paquete 'libsql' no está disponible. ` +
          `Instala 'libsql' o corrige la URL; no se degrada silenciosamente a SQLite local.`
      );
    } else {
      // URL de archivo local: degradar al driver estándar sobre ese mismo archivo es aceptable.
      fs.mkdirSync(path.dirname(localFile), { recursive: true });
      db = openDb(localFile);
    }
  } else {
    const file = dbFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    archivo = file;
    db = openDb(file);
  }
  // busy_timeout (antes que nada: con la base en almacenamiento de red los bloqueos
  // tardan más), WAL, foreign_keys, respaldo + migraciones, schema y seed.
  const informe = prepararSqlite(db, { archivo, founderWallet: FOUNDER_WALLET });
  if (informe.migro) {
    console.info(
      `[db] migración aplicada · respaldo=${informe.respaldo ?? "(sin archivo)"} · ` +
        `columnas=${[...informe.preColumnas, ...informe.postColumnas].join(",") || "-"} · ` +
        `equipo apartado=${informe.apartado} copiado=${informe.copiado ? JSON.stringify(informe.copiado) : "-"} · ` +
        `correos=${informe.correosCopiados}`
    );
  }
  registrarEstadoFounder(informe, FOUNDER_WALLET);
  return db;
}

export function getDb(): DB {
  if (!g.__zelenaDb) g.__zelenaDb = init();
  return g.__zelenaDb;
}

// ===========================================================================
// Migraciones de la ruta SQLite (fusión v1 ← línea desplegada, 2026-09-30)
// ===========================================================================
//
// `schema.sql` es solo `CREATE ... IF NOT EXISTS`: no toca una tabla que ya
// existe. La base de PRODUCCIÓN (`/home/data/zelena.db`) nació con el esquema de
// la línea desplegada (58ee2fd): `users` sin role/entra_oid/auth_provider y las
// cuatro tablas del módulo equipo con OTRA forma (prioridad alta|media|baja,
// horizonte en minúscula, eventos sin `day`…). Esta sección la lleva a la forma
// v1 SIN tocar los datos reales (cla_signatures, anchor_queue, reputation_events,
// points_ledger, projects, milestones, invites, genoma, votos, periods…).
//
// Secuencia (`prepararSqlite`, la misma que corre `init()` y los tests):
//   1. respaldo `VACUUM INTO` si hay algo que migrar (si falla, NO se migra);
//   2. `applyMigrations` (columnas que faltan);
//   3. `apartarEquipoLegado` (renombra las 4 tablas legado a `_legado_*`);
//   4. `schema.sql`;
//   5. `applyMigrations` otra vez (tablas recién creadas);
//   6. `copiarEquipoLegado` (mapeo de valores, conserva ids, todo o nada);
//   7. seed (que en producción también vence los GENESIS-000x demo sin usar) +
//      `backfillFounder` (el gate de antes, `wallet === FOUNDER_WALLET`, queda como
//      DATO de la base, no como regla de código). Este paso corre en CADA arranque:
//      una wallet registrada tarde o una variable corregida se arreglan reiniciando.
// Es idempotente: el segundo arranque no cambia nada.

/**
 * Columnas nuevas sobre tablas preexistentes. `CREATE TABLE IF NOT EXISTS` no
 * toca una tabla que ya existe, y `ALTER TABLE ADD COLUMN` falla si la columna ya
 * está. Añadir una entrada aquí es el procedimiento para toda columna nueva sobre
 * una tabla preexistente.
 *
 * `users.email` y `users.recovery_email` (línea desplegada) salieron de la lista:
 * los correos viven en `user_emails` (WP13). En producción quedan como columnas
 * legado toleradas; si alguna tuviera valor, `copiarCorreosLegado` lo pasa a
 * `user_emails`.
 */
export const COLUMNAS_NUEVAS: ReadonlyArray<{ tabla: string; columna: string; ddl: string }> = [
  { tabla: "users", columna: "role", ddl: "TEXT NOT NULL DEFAULT 'contributor'" },
  { tabla: "users", columna: "is_supervisor", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { tabla: "users", columna: "entra_oid", ddl: "TEXT" },
  { tabla: "users", columna: "auth_provider", ddl: "TEXT NOT NULL DEFAULT 'invite'" },
  // Codigo de cohorte multiuso: NULL en max_uses = un solo uso (semantica original).
  { tabla: "invites", columna: "max_uses", ddl: "INTEGER" },
  { tabla: "invites", columna: "uses", ddl: "INTEGER NOT NULL DEFAULT 0" },
];

/** Columnas de una tabla (vacío si no existe). */
function columnasDe(db: DB, tabla: string): string[] {
  try {
    return (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((c) => c.name);
  } catch {
    return [];
  }
}

/** Columnas de `COLUMNAS_NUEVAS` que faltan en tablas que YA existen. */
export function columnasFaltantes(db: DB): string[] {
  const faltan: string[] = [];
  for (const { tabla, columna } of COLUMNAS_NUEVAS) {
    const cols = columnasDe(db, tabla);
    if (cols.length > 0 && !cols.includes(columna)) faltan.push(`${tabla}.${columna}`);
  }
  return faltan;
}

export function applyMigrations(db: DB): string[] {
  const aplicadas: string[] = [];
  for (const { tabla, columna, ddl } of COLUMNAS_NUEVAS) {
    const cols = columnasDe(db, tabla);
    if (cols.length === 0) continue; // la tabla no existe todavia: la crea schema.sql
    if (cols.includes(columna)) continue;
    db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${ddl}`);
    aplicadas.push(`${tabla}.${columna}`);
  }
  return aplicadas;
}

/** Tablas del módulo equipo, hijos primero (orden de renombrado y de borrado). */
const EQUIPO = ["assignment_events", "checkins", "assignments", "initiatives"] as const;
/**
 * Índices de la forma legado. Hay que soltarlos ANTES de renombrar: un índice
 * viaja con su tabla, y v1 reusa `idx_assign_owner` con OTRAS columnas, así que un
 * `CREATE INDEX IF NOT EXISTS` lo saltaría y dejaría el índice viejo colgado de
 * `_legado_assignments`.
 */
const IDX_LEGADO = ["idx_assign_owner", "idx_assign_client", "idx_assign_initiative", "idx_aevents_assignment"];

/** ¿El módulo equipo tiene la forma de la línea desplegada (sin `needs_founder`)? */
export function esEquipoLegado(db: DB): boolean {
  const cols = columnasDe(db, "assignments");
  return cols.length > 0 && !cols.includes("needs_founder");
}

/** ¿Quedó un apartado a medias (tablas `_legado_*` sin copiar)? */
function hayLegadoApartado(db: DB): boolean {
  return columnasDe(db, "_legado_assignments").length > 0;
}

/**
 * Fila con `is_founder=1` cuyo `role` no es founder: el estado exacto que deja un
 * `ALTER TABLE ADD COLUMN role DEFAULT 'contributor'` si el arranque murió antes
 * del backfill. Solo mira datos de la base.
 */
function founderInconsistente(db: DB): boolean {
  if (!columnasDe(db, "users").includes("role")) return false;
  const r = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_founder = 1 AND role <> 'founder'`).get() as {
    n: number;
  };
  return r.n > 0;
}

export interface DiagnosticoMigracion {
  columnasFaltantes: string[];
  equipoLegado: boolean;
  legadoApartado: boolean;
  founderInconsistente: boolean;
}

/** Qué hay que migrar en esta base. Todo falso = no se toca nada. */
export function diagnosticarMigracion(db: DB): DiagnosticoMigracion {
  return {
    columnasFaltantes: columnasFaltantes(db),
    equipoLegado: esEquipoLegado(db),
    legadoApartado: hayLegadoApartado(db),
    founderInconsistente: founderInconsistente(db),
  };
}

export function hayQueMigrar(d: DiagnosticoMigracion): boolean {
  return d.columnasFaltantes.length > 0 || d.equipoLegado || d.legadoApartado || d.founderInconsistente;
}

/**
 * Respaldo consistente con `VACUUM INTO` (sirve aunque la base esté en WAL y con
 * lectores). Nombre: `<archivo>.pre-fusion-<fechaISO>.db` junto a la base. Si el
 * respaldo falla se LANZA: sin respaldo no se migra.
 */
export function respaldarAntesDeMigrar(db: DB, archivo: string, ahora: Date = new Date()): string {
  const sello = ahora.toISOString().replace(/[:.]/g, "-");
  let destino = `${archivo}.pre-fusion-${sello}.db`;
  for (let i = 1; fs.existsSync(destino); i++) destino = `${archivo}.pre-fusion-${sello}-${i}.db`;
  try {
    db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  } catch (e) {
    throw new Error(
      `[db] No se pudo respaldar la base antes de migrar (${destino}): ${(e as Error).message}. ` +
        `No se migra nada. Revisa espacio y permisos del directorio de la base.`
    );
  }
  if (!fs.existsSync(destino)) {
    throw new Error(`[db] VACUUM INTO no dejó el respaldo en ${destino}. No se migra nada.`);
  }
  return destino;
}

/**
 * PRE-schema: renombra las 4 tablas legado a `_legado_*` y suelta sus índices,
 * en UNA transacción. Solo si detecta la forma legado; si no, no hace nada.
 */
export function apartarEquipoLegado(db: DB): boolean {
  if (!esEquipoLegado(db)) return false;
  db.transaction(() => {
    for (const i of IDX_LEGADO) db.exec(`DROP INDEX IF EXISTS ${i}`);
    for (const t of EQUIPO) {
      if (columnasDe(db, t).length > 0) db.exec(`ALTER TABLE ${t} RENAME TO _legado_${t}`);
    }
  })();
  return true;
}

const PRIO = (c: string) =>
  `CASE lower(${c}) WHEN 'alta' THEN 'High' WHEN 'media' THEN 'Normal' WHEN 'baja' THEN 'Low' END`;
const HOR = (c: string) =>
  `CASE lower(${c}) WHEN 'ahora' THEN 'Ahora' WHEN 'siguiente' THEN 'Siguiente' WHEN 'parqueado' THEN 'Parqueado' END`;
const ACC = `CASE action WHEN 'a_revision' THEN 'enviar_a_revision' ELSE action END`;
const ESTADOS_V1 = `('Backlog','Asignada','En curso','En revisión','Hecha','Bloqueada')`;
const ACCIONES_V1 = `('crear','asignar','empezar','enviar_a_revision','aprobar','devolver','bloquear','desbloquear')`;

export class MigracionEquipoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigracionEquipoError";
  }
}

/**
 * POST-schema: copia las filas de `_legado_*` a las tablas v1 con el mapeo de
 * valores, conservando los ids, compara conteos y borra las `_legado_*`. TODO O
 * NADA: un valor desconocido (prioridad, horizonte, estado, tamaño o acción que no
 * sabemos traducir) aborta con ROLLBACK. No se adivina.
 *
 * Devuelve el conteo por tabla, o `null` si no había nada apartado.
 */
export function copiarEquipoLegado(db: DB): Record<string, number> | null {
  if (!hayLegadoApartado(db)) return null;
  const cuenta = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const origen: Record<string, number> = {};
  for (const t of EQUIPO) origen[t] = columnasDe(db, `_legado_${t}`).length > 0 ? cuenta(`_legado_${t}`) : 0;
  const existe = (t: string) => columnasDe(db, `_legado_${t}`).length > 0;

  db.transaction(() => {
    const malos: string[] = [];
    const contar = (sql: string, que: string) => {
      const n = (db.prepare(sql).get() as { n: number }).n;
      if (n > 0) malos.push(`${n} ${que}`);
    };
    if (existe("initiatives")) {
      contar(`SELECT COUNT(*) AS n FROM _legado_initiatives WHERE ${HOR("horizon")} IS NULL`, "iniciativas con horizonte desconocido");
    }
    contar(`SELECT COUNT(*) AS n FROM _legado_assignments WHERE ${PRIO("priority")} IS NULL`, "asignaciones con prioridad desconocida");
    contar(`SELECT COUNT(*) AS n FROM _legado_assignments WHERE status NOT IN ${ESTADOS_V1}`, "asignaciones con estado desconocido");
    contar(
      `SELECT COUNT(*) AS n FROM _legado_assignments WHERE size IS NOT NULL AND size NOT IN ('S','M','L')`,
      "asignaciones con tamaño desconocido"
    );
    // La forma legado no tenía FK de owner_wallet → users; la de v1 sí. Un dueño que
    // no está en users haría fallar el INSERT con un error opaco: se nombra aquí.
    contar(
      `SELECT COUNT(*) AS n FROM _legado_assignments
       WHERE owner_wallet IS NOT NULL AND owner_wallet NOT IN (SELECT wallet FROM users)`,
      "asignaciones con un dueño que no está en users"
    );
    if (existe("assignment_events")) {
      contar(
        `SELECT COUNT(*) AS n FROM _legado_assignment_events
         WHERE ${ACC} NOT IN ${ACCIONES_V1} OR to_status NOT IN ${ESTADOS_V1}
            OR (from_status IS NOT NULL AND from_status NOT IN ${ESTADOS_V1})`,
        "eventos con acción o estado desconocidos"
      );
    }
    if (malos.length > 0) {
      throw new MigracionEquipoError(
        `[db] Migración del módulo equipo abortada (${malos.join("; ")}). No se adivina: ` +
          `corrige esas filas en las tablas _legado_* o restaura el respaldo pre-fusion.`
      );
    }

    if (existe("initiatives")) {
      db.exec(`INSERT INTO initiatives (id, slug, name, horizon, client_id, notes, created_at)
        SELECT id, slug, name, ${HOR("horizon")}, client_id, notes, created_at FROM _legado_initiatives`);
    }
    const joinIni = existe("initiatives") ? `LEFT JOIN _legado_initiatives i ON i.id = a.initiative_id` : "";
    const horIni = existe("initiatives") ? `COALESCE(${HOR("i.horizon")}, 'Ahora')` : `'Ahora'`;
    const previoBloqueo = existe("assignment_events")
      ? `CASE WHEN a.status = 'Bloqueada' THEN (SELECT e.from_status FROM _legado_assignment_events e
           WHERE e.assignment_id = a.id AND e.to_status = 'Bloqueada' ORDER BY e.id DESC LIMIT 1) END`
      : `NULL`;
    db.exec(`INSERT INTO assignments (id, title, description, initiative_id, client_id, owner_wallet, status,
        status_before_block, priority, size, horizon, due_date, acceptance_criteria, spec_url, graph_node_id,
        blocked_reason, blocked_at, needs_founder, published_as_project_id, created_by, import_key,
        created_at, updated_at, closed_at)
      SELECT a.id, a.title, COALESCE(a.description, ''), a.initiative_id, a.client_id, a.owner_wallet, a.status,
        ${previoBloqueo},
        ${PRIO("a.priority")}, a.size, ${horIni}, a.due_date,
        COALESCE(a.acceptance_criteria, ''), a.spec_url, a.graph_node_id, a.blocked_reason,
        CASE WHEN a.status = 'Bloqueada' THEN a.updated_at END, 0, a.published_as_project_id, a.created_by, NULL,
        a.created_at, a.updated_at, CASE WHEN a.status = 'Hecha' THEN a.updated_at END
      FROM _legado_assignments a ${joinIni}`);
    if (existe("assignment_events")) {
      db.exec(`INSERT INTO assignment_events (id, assignment_id, action, from_status, to_status, reason, actor_wallet, day, created_at)
        SELECT id, assignment_id, ${ACC}, COALESCE(from_status, 'Backlog'), to_status, reason, actor_wallet,
               substr(created_at, 1, 10), created_at FROM _legado_assignment_events`);
    }
    if (existe("checkins")) {
      db.exec(`INSERT INTO checkins (id, wallet, day, done, doing, blocked, created_at, updated_at)
        SELECT id, wallet, day, done, doing, COALESCE(blocked, ''), updated_at, updated_at FROM _legado_checkins`);
    }
    for (const t of EQUIPO) {
      const n = cuenta(t);
      if (n !== origen[t]) {
        throw new MigracionEquipoError(`[db] Migración del módulo equipo: ${t} tiene ${n} filas y el origen ${origen[t]}.`);
      }
    }
    for (const t of EQUIPO) if (existe(t)) db.exec(`DROP TABLE _legado_${t}`);
  })();
  return origen;
}

/**
 * Guarda de las columnas legado `users.email` / `users.recovery_email` (línea
 * desplegada). En producción están todas a NULL; si alguna tuviera valor, se copia
 * a `user_emails` (sin verificar, no corporativo) antes de olvidarlas. Idempotente.
 */
export function copiarCorreosLegado(db: DB): number {
  const cols = columnasDe(db, "users");
  let copiados = 0;
  for (const [col, kind] of [
    ["email", "primary"],
    ["recovery_email", "recovery"],
  ] as const) {
    if (!cols.includes(col)) continue;
    const r = db
      .prepare(
        `INSERT OR IGNORE INTO user_emails (wallet, email, kind, is_corporate, is_verified)
         SELECT wallet, lower(trim(${col})), ?, 0, 0 FROM users
         WHERE ${col} IS NOT NULL AND trim(${col}) <> ''
           AND lower(trim(${col})) NOT IN (SELECT email FROM user_emails)`
      )
      .run(kind);
    copiados += Number(r.changes);
  }
  return copiados;
}

/**
 * Promoción del founder: la fila con `wallet = FOUNDER_WALLET` (y la `is_founder = 1`
 * del seed) queda `founder` + supervisor. Reproduce el gate de antes
 * (`wallet === FOUNDER_WALLET`) como DATO de la base; los gates siguen leyendo
 * `users.role` (`lib/authz.ts`), nunca la variable.
 *
 * Corre en CADA arranque, no solo en el que migra (hallazgo de verificación,
 * 2026-09-30). Con una sola pasada, si en ese arranque la wallet todavía no tenía
 * fila (John se registra después con la cohorte o con una invitación) o
 * FOUNDER_WALLET era la wallet demo, nadie quedaba founder y cambiar la variable ya
 * no lo arreglaba. Ahora basta con fijar la variable y reiniciar, igual que antes de
 * la fusión (y lo mismo que hace `seedBootstrapInvite`).
 *
 * Solo PROMUEVE: nunca degrada. Cambiar FOUNDER_WALLET no le quita el rol a la wallet
 * anterior; retirar un founder es una decisión explícita (UPDATE documentado en
 * docs/DESPLIEGUE-V1.md) hasta que WP32 lo lleve a /admin. Idempotente.
 */
export function backfillFounder(db: DB, founderWallet: string | null | undefined): number {
  const r = db
    .prepare(
      `UPDATE users SET role = 'founder', is_supervisor = 1
       WHERE (is_founder = 1 OR wallet = ?) AND (role <> 'founder' OR is_supervisor <> 1)`
    )
    .run(founderWallet ?? "");
  return Number(r.changes);
}

export interface EstadoFounder {
  /** ¿La wallet de FOUNDER_WALLET tiene fila en `users`? */
  registrada: boolean;
  /**
   * Filas `founder` por las que alguien puede entrar HOY firmando con su wallet
   * (`/api/login`): llave Stellar válida y CLA firmado. La wallet demo del seed no
   * cuenta (no es una llave real) ni `pending:john` (solo entra por Entra).
   */
  conFirma: number;
}

/** Diagnóstico de acceso del founder, para el log de arranque y el ensayo previo al deploy. */
export function estadoFounder(db: DB, founderWallet: string | null | undefined): EstadoFounder {
  const registrada =
    !!founderWallet && !!db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(founderWallet);
  const founders = db
    .prepare(`SELECT wallet FROM users WHERE role = 'founder' AND cla_signed = 1`)
    .all() as Array<{ wallet: string }>;
  return { registrada, conFirma: founders.filter((f) => esWalletStellar(f.wallet)).length };
}

export interface OpcionesArranque {
  /** Archivo de la base (para el respaldo). `null` = memoria/remota: sin respaldo. */
  archivo: string | null;
  /** Wallet que hoy pasa el gate de /admin (`FOUNDER_WALLET`). */
  founderWallet?: string | null;
  /** Texto de `schema.sql` (por defecto, el del repo). */
  schema?: string;
  /** Sembrar (seedIfEmpty). Los tests de migración lo apagan para aislar. */
  sembrar?: boolean;
  ahora?: Date;
}

export interface InformeArranque {
  migro: boolean;
  respaldo: string | null;
  preColumnas: string[];
  apartado: boolean;
  postColumnas: string[];
  copiado: Record<string, number> | null;
  correosCopiados: number;
  /** Filas promovidas a founder en ESTE arranque (0 si ya lo eran). */
  founderPromovidos: number;
  founder: EstadoFounder;
}

/**
 * Secuencia completa de arranque de la ruta SQLite (ver cabecera de la sección).
 * `init()` la llama con el archivo real y `FOUNDER_WALLET`; los tests, con copias.
 */
export function prepararSqlite(db: DB, opts: OpcionesArranque): InformeArranque {
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const diag = diagnosticarMigracion(db);
  const migro = hayQueMigrar(diag);
  let respaldo: string | null = null;
  if (migro && opts.archivo) respaldo = respaldarAntesDeMigrar(db, opts.archivo, opts.ahora);

  // ANTES del schema: sobre una base preexistente, schema.sql declara indices que
  // usan columnas nuevas (p. ej. idx_users_entra_oid sobre users.entra_oid). Como
  // CREATE TABLE IF NOT EXISTS no toca la tabla vieja, el indice reventaria antes
  // de llegar a la migracion. En una base nueva no hace nada (la tabla no existe).
  const preColumnas = applyMigrations(db);
  const apartado = apartarEquipoLegado(db);
  db.exec(opts.schema ?? schemaSql());
  // DESPUES del schema: columnas nuevas sobre tablas que acaba de crear schema.sql.
  const postColumnas = applyMigrations(db);
  const correosCopiados = copiarCorreosLegado(db);
  const copiado = copiarEquipoLegado(db);

  if (opts.sembrar !== false) seedIfEmpty(db);
  // En CADA arranque (ver backfillFounder): una wallet registrada después del
  // arranque que migró, o una FOUNDER_WALLET corregida, se promueve al reiniciar.
  const founderPromovidos = backfillFounder(db, opts.founderWallet);
  const founder = estadoFounder(db, opts.founderWallet);

  return {
    migro,
    respaldo,
    preColumnas,
    apartado,
    postColumnas,
    copiado,
    correosCopiados,
    founderPromovidos,
    founder,
  };
}

/** `GABCD…WXYZ`: suficiente para reconocer la wallet en el log sin copiarla entera. */
function abreviarWallet(w: string): string {
  return w.length > 12 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

/**
 * Deja en el log de arranque si el founder puede entrar. En producción avisa en
 * voz alta cuando NADIE puede entrar a /admin por firma: es exactamente el estado
 * de la copia de prod (único founder = wallet demo inválida) y no da ningún error.
 */
function registrarEstadoFounder(informe: InformeArranque, founderWallet: string): void {
  const w = abreviarWallet(founderWallet);
  if (informe.founderPromovidos > 0) {
    console.info(`[db] founder: ${informe.founderPromovidos} fila(s) promovidas (FOUNDER_WALLET=${w}).`);
  }
  if (process.env.NODE_ENV !== "production") return;
  if (!informe.founder.registrada) {
    console.warn(
      `[db] founder: FOUNDER_WALLET=${w} no tiene fila en users. Entra con FOUNDER_BOOTSTRAP_CODE y esa ` +
        `wallet, o regístrala y reinicia la app (ver docs/DESPLIEGUE-V1.md, "Acceso del founder").`
    );
  }
  if (informe.founder.conFirma === 0) {
    console.warn(
      `[db] founder: ninguna fila founder tiene una llave Stellar válida con el CLA firmado: ` +
        `nadie puede entrar a /admin por /api/login (ver docs/DESPLIEGUE-V1.md, "Acceso del founder").`
    );
  }
}
