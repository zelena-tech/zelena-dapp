/**
 * Dialecto T-SQL (Azure SQL) — traductor PURO del SQL SQLite que escribe la app.
 *
 * WP16. Reglas de diseño:
 *  - PURO: ni I/O, ni estado global, ni red. Todo es entrada → salida (testeable).
 *  - AGNÓSTICO DEL ESQUEMA: `translateSchema()` traduce el `schema.sql` que exista
 *    en tiempo de ejecución. NO se mantiene un `.sql` paralelo escrito a mano
 *    (se desincronizaría en cuanto alguien añada una tabla).
 *  - FALLA FUERTE: cualquier construcción que no se pueda traducir con fidelidad
 *    lanza `UnsupportedSqlError`. Nunca se emite T-SQL "parecido": una traducción
 *    silenciosamente incorrecta es peor que un error.
 *
 * Nota sobre fechas: el esquema guarda las fechas como TEXTO en el formato de
 * SQLite (`YYYY-MM-DD HH:MM:SS`) y la app las compara con `>`/`<` como cadenas.
 * Por eso `datetime('now')` no se traduce a `SYSUTCDATETIME()` desnudo (daría
 * `datetime2` y el separador ISO `T`, rompiendo las comparaciones de cadena) sino
 * a `CONVERT(NVARCHAR(19), SYSUTCDATETIME(), 120)`, que produce exactamente el
 * mismo formato que SQLite. Mismo reloj (UTC), misma ordenación lexicográfica.
 */

export class UnsupportedSqlError extends Error {
  constructor(message: string) {
    super(`SQL no traducible a T-SQL: ${message}`);
    this.name = "UnsupportedSqlError";
  }
}

/** Longitud por defecto de las columnas de texto que participan en claves/índices. */
export const KEY_TEXT_LENGTH = 200;

/**
 * Columnas 0/1 que se materializan como `BIT`.
 *
 * Detección conservadora a propósito: prefijo `is_`/`has_` (convención inequívoca)
 * o pertenencia a esta lista explícita. Una columna INTEGER que no encaje se queda
 * como `INT`, que SIEMPRE funciona. El riesgo inverso —mandar un contador a `BIT`—
 * sería corrupción silenciosa (SQL Server convierte cualquier valor ≠0 a 1), así
 * que el heurístico nunca adivina.
 */
export const DEFAULT_BOOLEAN_COLUMNS: readonly string[] = [
  "approved",
  "cla_signed",
  "completed",
  "enabled",
  "passed",
  "signed",
];

/** Columnas de texto que contienen JSON (reciben `CHECK (ISJSON(...) = 1)`). */
export const DEFAULT_JSON_COLUMNS: readonly string[] = ["components", "options", "params"];

export interface DialectOptions {
  /** Columnas booleanas extra (además del heurístico `is_`/`has_` y la lista por defecto). */
  booleanColumns?: readonly string[];
  /** Columnas JSON extra. */
  jsonColumns?: readonly string[];
  /** Longitud de `NVARCHAR(n)` para columnas de texto indexadas. */
  keyTextLength?: number;
  /** Tipo destino de `REAL`. */
  realAs?: "FLOAT" | "DECIMAL";
}

export type StatementKind = "select" | "insert" | "update" | "delete" | "other" | "noop";

export interface Translated {
  /** T-SQL con parámetros nombrados (`@p0`, `@p1`, …). Cadena vacía = no-op. */
  sql: string;
  /** Número de parámetros posicionales del SQL original. */
  paramCount: number;
  kind: StatementKind;
}

/* ------------------------------------------------------------------ *
 * Utilidades de parseo (respetan literales de cadena y comentarios)
 * ------------------------------------------------------------------ */

/** Rangos [inicio, fin) ocupados por literales de cadena `'...'`. */
function literalRanges(sql: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const start = i;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      ranges.push([start, Math.min(j + 1, sql.length)]);
      i = j + 1;
      continue;
    }
    i++;
  }
  return ranges;
}

function inRanges(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => pos >= a && pos < b);
}

/** Separa un script en statements por `;`, ignorando `;` en cadenas y comentarios. */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === ";") {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Índice del `)` que cierra el `(` en `open`; -1 si no cierra. */
function matchParen(sql: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Divide por comas de primer nivel (respeta paréntesis y cadenas). */
export function splitTopLevel(text: string, sep = ","): string[] {
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      buf += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === sep && depth === 0) {
      out.push(buf.trim());
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

/** Reemplaza llamadas `name(...)` (paréntesis balanceados, fuera de cadenas). */
function replaceCalls(sql: string, name: string, fn: (args: string[]) => string): string {
  const ranges = literalRanges(sql);
  const re = new RegExp(`\\b${name}\\s*\\(`, "gi");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (inRanges(m.index, ranges)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) break;
    const args = splitTopLevel(sql.slice(open + 1, close));
    out += sql.slice(last, m.index) + fn(args);
    last = close + 1;
    re.lastIndex = last;
  }
  return out + sql.slice(last);
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/* ------------------------------------------------------------------ *
 * Parámetros: `?` posicional → `@p0` nombrado
 * ------------------------------------------------------------------ */

/**
 * `?` → `@p0`, `@p1`, … El paso a parámetros NOMBRADOS va PRIMERO porque las
 * traducciones estructurales (ON CONFLICT → IF NOT EXISTS / MERGE) referencian el
 * mismo valor más de una vez; con `?` posicional eso desalinearía el binding.
 */
export function bindPlaceholders(sql: string): { sql: string; paramCount: number } {
  let out = "";
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "?") {
      out += `@p${n}`;
      n++;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return { sql: out, paramCount: n };
}

/* ------------------------------------------------------------------ *
 * Fechas y horas
 * ------------------------------------------------------------------ */

/** Expresión T-SQL que produce el "ahora" UTC con el formato TEXTO de SQLite. */
export function nowExpression(modifiers: string[] = []): string {
  return `CONVERT(NVARCHAR(19), ${applyModifiers("SYSUTCDATETIME()", modifiers)}, 120)`;
}

const MODIFIER_UNITS: Record<string, string> = {
  day: "day",
  days: "day",
  hour: "hour",
  hours: "hour",
  minute: "minute",
  minutes: "minute",
  second: "second",
  seconds: "second",
  month: "month",
  months: "month",
  year: "year",
  years: "year",
};

/** Modificadores tipo `'+30 days'` → `DATEADD(day, 30, expr)`. */
function applyModifiers(expr: string, modifiers: string[]): string {
  let out = expr;
  for (const raw of modifiers) {
    const mod = stripQuotes(raw);
    const m = /^([+-])\s*(\d+)\s+([a-z]+)$/i.exec(mod.trim());
    if (!m) throw new UnsupportedSqlError(`modificador de fecha '${mod}' (solo se soporta ±N unidad)`);
    const unit = MODIFIER_UNITS[m[3].toLowerCase()];
    if (!unit) throw new UnsupportedSqlError(`unidad de fecha '${m[3]}'`);
    const sign = m[1] === "-" ? "-" : "";
    out = `DATEADD(${unit}, ${sign}${m[2]}, ${out})`;
  }
  return out;
}

function datetimeSource(arg: string): { expr: string; isNow: boolean } {
  const v = stripQuotes(arg);
  if (v.toLowerCase() === "now") return { expr: "SYSUTCDATETIME()", isNow: true };
  return { expr: `CONVERT(datetime2, ${arg.trim()})`, isNow: false };
}

/** `datetime('now', …)`, `date('now')`, `CURRENT_TIMESTAMP` → equivalentes T-SQL. */
export function translateDates(sql: string): string {
  let out = replaceCalls(sql, "datetime", (args) => {
    if (args.length === 0) throw new UnsupportedSqlError("datetime() sin argumentos");
    const src = datetimeSource(args[0]);
    return `CONVERT(NVARCHAR(19), ${applyModifiers(src.expr, args.slice(1))}, 120)`;
  });
  out = replaceCalls(out, "date", (args) => {
    if (args.length === 0) throw new UnsupportedSqlError("date() sin argumentos");
    const src = datetimeSource(args[0]);
    return `CONVERT(NVARCHAR(10), ${applyModifiers(src.expr, args.slice(1))}, 23)`;
  });
  out = replaceCalls(out, "strftime", (args) => {
    if (args.length < 2) throw new UnsupportedSqlError("strftime() necesita formato y valor");
    const fmt = stripQuotes(args[0]);
    const src = datetimeSource(args[1]);
    const expr = applyModifiers(src.expr, args.slice(2));
    if (fmt === "%Y-%m-%d") return `CONVERT(NVARCHAR(10), ${expr}, 23)`;
    if (fmt === "%Y-%m-%d %H:%M:%S") return `CONVERT(NVARCHAR(19), ${expr}, 120)`;
    return `FORMAT(${expr}, '${strftimeToNetFormat(fmt)}')`;
  });
  const ranges = literalRanges(out);
  out = out.replace(/\bCURRENT_TIMESTAMP\b/gi, (match, offset: number) =>
    inRanges(offset, ranges) ? match : nowExpression()
  );
  return out;
}

/** Tokens de `strftime` → tokens de formato de `FORMAT()` (.NET). */
export function strftimeToNetFormat(fmt: string): string {
  const map: Record<string, string> = {
    "%Y": "yyyy",
    "%m": "MM",
    "%d": "dd",
    "%H": "HH",
    "%M": "mm",
    "%S": "ss",
  };
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    if (fmt[i] === "%") {
      const token = fmt.slice(i, i + 2);
      const rep = map[token];
      if (!rep) throw new UnsupportedSqlError(`token de strftime '${token}'`);
      out += rep;
      i += 2;
      continue;
    }
    out += fmt[i];
    i++;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Paginación, aleatoriedad, JSON
 * ------------------------------------------------------------------ */

/** `LIMIT n` → `TOP (n)`; `LIMIT n OFFSET m` → `OFFSET … FETCH NEXT …`. */
export function translateLimit(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  const m = /\bLIMIT\s+(@p\d+|\d+)(?:\s+OFFSET\s+(@p\d+|\d+))?\s*$/i.exec(trimmed);
  if (!m) {
    const commaForm = /\bLIMIT\s+(@p\d+|\d+)\s*,\s*(@p\d+|\d+)\s*$/i.exec(trimmed);
    if (!commaForm) return trimmed;
    // SQLite: LIMIT <offset>, <count>
    return offsetFetch(trimmed.slice(0, commaForm.index).trim(), commaForm[1], commaForm[2]);
  }
  const head = trimmed.slice(0, m.index).trim();
  const count = m[1];
  const offset = m[2];
  if (offset) return offsetFetch(head, offset, count);
  if (!/^SELECT\b/i.test(head)) throw new UnsupportedSqlError("LIMIT fuera de un SELECT");
  return head.replace(/^SELECT(\s+DISTINCT)?/i, (mm, distinct: string | undefined) =>
    `SELECT${distinct ?? ""} TOP (${count})`
  );
}

function offsetFetch(head: string, offset: string, count: string): string {
  // T-SQL exige ORDER BY para OFFSET/FETCH; si no hay, se añade uno neutro.
  const hasOrderBy = /\bORDER\s+BY\b/i.test(head);
  const base = hasOrderBy ? head : `${head} ORDER BY (SELECT NULL)`;
  return `${base} OFFSET ${offset} ROWS FETCH NEXT ${count} ROWS ONLY`;
}

const CLAUSE_AFTER_DERIVED =
  /^\s*(WHERE|GROUP|ORDER|HAVING|UNION|EXCEPT|INTERSECT|ON|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|FOR|OPTION|OFFSET|FETCH)\b/i;

/**
 * `FROM (SELECT …)` → `FROM (SELECT …) AS __dN`.
 *
 * SQLite acepta una tabla derivada sin alias; T-SQL la RECHAZA (error de sintaxis).
 * Caso real: `lib/epochs.ts` cuenta wallets activas sobre un `UNION ALL`.
 */
export function aliasDerivedTables(sql: string): string {
  const ranges = literalRanges(sql);
  const re = /\b(FROM|JOIN)\s*\(/gi;
  let out = "";
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    if (inRanges(m.index, ranges)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) break;
    const after = sql.slice(close + 1);
    const hasAlias = /^\s*(AS\s+)?[A-Za-z_][\w]*/i.test(after) && !CLAUSE_AFTER_DERIVED.test(after);
    n++;
    out += sql.slice(last, close + 1) + (hasAlias ? "" : ` AS __d${n}`);
    last = close + 1;
    re.lastIndex = last;
  }
  return out + sql.slice(last);
}

/** ¿La expresión tiene un operador de comparación de primer nivel? */
function hasTopLevelComparison(expr: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === "'") {
      let j = i + 1;
      while (j < expr.length) {
        if (expr[j] === "'") {
          if (expr[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0) {
      if (c === "<" || c === ">" || c === "=" || c === "!") return true;
      if (/\bIS\s+(NOT\s+)?NULL\b/i.test(expr.slice(i))) return true;
    }
    i++;
  }
  return false;
}

/**
 * `SELECT (a <= b) AS x` → `SELECT CASE WHEN a <= b THEN 1 ELSE 0 END AS x`.
 *
 * SQLite trata las comparaciones como escalares 0/1; T-SQL NO admite una expresión
 * booleana en la lista de selección (es error de sintaxis). Caso real:
 * `lib/invites.ts` → `SELECT (expires_at <= datetime('now')) AS e`.
 *
 * Conservador a propósito: solo transforma elementos COMPLETAMENTE parentizados con
 * una comparación de primer nivel. Ni subconsultas escalares (`(SELECT …)`) ni
 * llamadas a función (`COUNT(*)`, `COALESCE(SUM(x), 0)`) se tocan.
 */
export function translateBooleanSelectItems(sql: string): string {
  const head = /^\s*SELECT(\s+DISTINCT)?\s/i.exec(sql);
  if (!head) return sql;
  const listStart = head[0].length;
  // Fin de la lista de selección: el primer FROM de primer nivel.
  let depth = 0;
  let listEnd = sql.length;
  const ranges = literalRanges(sql);
  for (let i = listStart; i < sql.length; i++) {
    if (inRanges(i, ranges)) continue;
    const c = sql[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /\bFROM\b/i.test(sql.slice(i, i + 4)) && /\s/.test(sql[i - 1] ?? " ")) {
      listEnd = i;
      break;
    }
  }
  const items = splitTopLevel(sql.slice(listStart, listEnd));
  const transformed = items.map((item) => {
    const t = item.trim();
    if (!t.startsWith("(")) return item;
    const close = matchParen(t, 0);
    if (close < 0) return item;
    const rest = t.slice(close + 1).trim();
    if (rest !== "" && !/^(AS\s+)?[A-Za-z_][\w]*$/i.test(rest)) return item;
    const inner = t.slice(1, close).trim();
    if (/^SELECT\b/i.test(inner)) return item; // subconsulta escalar
    if (!hasTopLevelComparison(inner)) return item;
    return `CASE WHEN ${inner} THEN 1 ELSE 0 END${rest ? ` ${rest}` : ""}`;
  });
  if (transformed.every((t, i) => t === items[i])) return sql;
  const tail = listEnd < sql.length ? ` ${sql.slice(listEnd)}` : "";
  return `${sql.slice(0, listStart)}${transformed.join(", ")}${tail}`;
}

/** `RANDOM()` → `NEWID()` (orden aleatorio en T-SQL). */
export function translateRandom(sql: string): string {
  const ranges = literalRanges(sql);
  return sql.replace(/\bRANDOM\s*\(\s*\)/gi, (match, offset: number) =>
    inRanges(offset, ranges) ? match : "NEWID()"
  );
}

/** `json_extract(col, '$.a')` → `JSON_VALUE(col, '$.a')`. */
export function translateJson(sql: string): string {
  return replaceCalls(sql, "json_extract", (args) => {
    if (args.length !== 2) throw new UnsupportedSqlError("json_extract() con más de un path");
    return `JSON_VALUE(${args[0]}, ${args[1]})`;
  });
}

/* ------------------------------------------------------------------ *
 * RETURNING → OUTPUT
 * ------------------------------------------------------------------ */

export function translateReturning(sql: string): string {
  const ranges = literalRanges(sql);
  const m = /\bRETURNING\s+([\s\S]+)$/i.exec(sql);
  if (!m || inRanges(m.index, ranges)) return sql;
  const head = sql.slice(0, m.index).trim();
  const cols = splitTopLevel(m[1].trim().replace(/;\s*$/, ""));
  const kind = statementKind(head);
  const prefix = kind === "delete" ? "DELETED" : "INSERTED";
  const output = `OUTPUT ${cols.map((c) => (c === "*" ? `${prefix}.*` : `${prefix}.${c}`)).join(", ")}`;
  if (kind === "insert") {
    const at = /\b(VALUES|SELECT)\b/i.exec(head);
    if (!at) throw new UnsupportedSqlError("INSERT ... RETURNING sin VALUES ni SELECT");
    return `${head.slice(0, at.index).trim()} ${output} ${head.slice(at.index).trim()}`;
  }
  if (kind === "update" || kind === "delete") {
    const at = /\bWHERE\b/i.exec(head);
    if (!at) return `${head} ${output}`;
    return `${head.slice(0, at.index).trim()} ${output} ${head.slice(at.index).trim()}`;
  }
  throw new UnsupportedSqlError("RETURNING solo se soporta en INSERT/UPDATE/DELETE");
}

/* ------------------------------------------------------------------ *
 * Upsert: ON CONFLICT / INSERT OR IGNORE
 * ------------------------------------------------------------------ */

interface ParsedInsert {
  table: string;
  columns: string[];
  values: string[];
  head: string;
}

function parseSingleRowInsert(sql: string): ParsedInsert | null {
  const m = /^INSERT(?:\s+OR\s+\w+)?\s+INTO\s+([A-Za-z_][\w]*)\s*\(([\s\S]*?)\)\s*VALUES\s*\(/i.exec(sql.trim());
  if (!m) return null;
  const openIdx = sql.indexOf("(", sql.toUpperCase().indexOf("VALUES", m.index));
  const close = matchParen(sql, openIdx);
  if (close < 0) return null;
  const rest = sql.slice(close + 1).trim();
  if (rest.length > 0 && !/^ON\s+CONFLICT/i.test(rest)) return null; // múltiples tuplas u otra cola
  return {
    table: m[1],
    columns: splitTopLevel(m[2]).map((c) => c.trim()),
    values: splitTopLevel(sql.slice(openIdx + 1, close)),
    head: `INSERT INTO ${m[1]} (${splitTopLevel(m[2])
      .map((c) => c.trim())
      .join(", ")}) VALUES (${splitTopLevel(sql.slice(openIdx + 1, close)).join(", ")})`,
  };
}

/**
 * `ON CONFLICT (…) DO NOTHING` → `IF NOT EXISTS (…) INSERT …`
 * `ON CONFLICT (…) DO UPDATE SET …` → `MERGE … WITH (HOLDLOCK)`
 * `INSERT OR IGNORE` → INSERT con captura del error de clave duplicada (2601/2627).
 */
export function translateUpsert(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  const conflict = /\bON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+([\s\S]+)$/i.exec(trimmed);
  if (conflict) {
    const parsed = parseSingleRowInsert(trimmed);
    if (!parsed) throw new UnsupportedSqlError("ON CONFLICT solo se soporta en INSERT de una tupla con columnas explícitas");
    const keys = splitTopLevel(conflict[1]).map((c) => c.trim());
    const action = conflict[2].trim();
    const valueOf = (col: string): string => {
      const i = parsed.columns.findIndex((c) => c.toLowerCase() === col.toLowerCase());
      if (i < 0 || i >= parsed.values.length) throw new UnsupportedSqlError(`columna de conflicto '${col}' ausente en el INSERT`);
      return parsed.values[i];
    };
    const match = keys.map((k) => `${k} = ${valueOf(k)}`).join(" AND ");
    if (/^NOTHING$/i.test(action)) {
      return `IF NOT EXISTS (SELECT 1 FROM ${parsed.table} WITH (UPDLOCK, HOLDLOCK) WHERE ${match}) ${parsed.head}`;
    }
    const upd = /^UPDATE\s+SET\s+([\s\S]+)$/i.exec(action);
    if (!upd) throw new UnsupportedSqlError(`acción ON CONFLICT DO ${action}`);
    const sets = splitTopLevel(upd[1]).map((s) => s.replace(/\bexcluded\./gi, "src."));
    const srcCols = parsed.columns.map((c, i) => `${parsed.values[i]} AS ${c}`).join(", ");
    const on = keys.map((k) => `tgt.${k} = src.${k}`).join(" AND ");
    return (
      `MERGE ${parsed.table} WITH (HOLDLOCK) AS tgt ` +
      `USING (SELECT ${srcCols}) AS src ON ${on} ` +
      `WHEN MATCHED THEN UPDATE SET ${sets.join(", ")} ` +
      `WHEN NOT MATCHED THEN INSERT (${parsed.columns.join(", ")}) ` +
      `VALUES (${parsed.columns.map((c) => `src.${c}`).join(", ")})`
    );
  }
  const orClause = /^INSERT\s+OR\s+(\w+)\s+INTO\b/i.exec(trimmed);
  if (orClause) {
    const mode = orClause[1].toUpperCase();
    if (mode !== "IGNORE") throw new UnsupportedSqlError(`INSERT OR ${mode}`);
    const body = trimmed.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO");
    // Equivalente fiel de OR IGNORE: se tragan SOLO los errores de clave duplicada.
    return (
      `BEGIN TRY ${body}; END TRY ` +
      `BEGIN CATCH IF ERROR_NUMBER() NOT IN (2601, 2627) THROW; END CATCH`
    );
  }
  return trimmed;
}

/* ------------------------------------------------------------------ *
 * Bloqueo explícito en UPDATE (garantía de consumo atómico)
 * ------------------------------------------------------------------ */

/**
 * `UPDATE t SET …` → `UPDATE t WITH (UPDLOCK, ROWLOCK) SET …`.
 *
 * Superficie crítica V5: el consumo de invitaciones es un UPDATE condicional
 * (`WHERE code = @p1 AND used_by IS NULL`) dentro de transacción. Con los hints,
 * el lector-escritor toma el lock de actualización a nivel de fila desde el
 * primer momento: exactamente una transacción ve `used_by IS NULL` y gana.
 */
export function addUpdateLockHints(sql: string): string {
  return sql.replace(
    /^(\s*UPDATE\s+)([A-Za-z_][\w]*)(\s+)(SET\b)/i,
    (_m, kw: string, table: string, gap: string, set: string) => `${kw}${table} WITH (UPDLOCK, ROWLOCK)${gap}${set}`
  );
}

/* ------------------------------------------------------------------ *
 * Statement completo
 * ------------------------------------------------------------------ */

export function statementKind(sql: string): StatementKind {
  const s = sql.trim();
  if (/^PRAGMA\b/i.test(s)) return "noop";
  if (/^SELECT\b/i.test(s) || /^WITH\b/i.test(s)) return "select";
  if (/^INSERT\b/i.test(s)) return "insert";
  if (/^UPDATE\b/i.test(s)) return "update";
  if (/^DELETE\b/i.test(s)) return "delete";
  return "other";
}

/**
 * Columnas IDENTITY por tabla, leídas del T-SQL que produjo `translateSchema()`.
 *
 * Sirve para el caso `INSERT INTO periods (id, …) VALUES (1, …)` del seed: SQLite
 * acepta un id explícito en una PK autoincremental, T-SQL lo RECHAZA salvo con
 * `SET IDENTITY_INSERT … ON`. Se deriva del esquema real en tiempo de ejecución
 * (agnóstico del esquema), no de una lista escrita a mano.
 */
export function collectIdentityColumns(tsqlStatements: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const stmt of tsqlStatements) {
    const table = /CREATE\s+TABLE\s+([A-Za-z_][\w]*)\s*\(/i.exec(stmt);
    if (!table) continue;
    const col = /\[([A-Za-z_][\w]*)\]\s+INT\s+IDENTITY\(/i.exec(stmt);
    if (col) out.set(table[1].toLowerCase(), col[1].toLowerCase());
  }
  return out;
}

/**
 * Si el INSERT trae valor explícito para la columna IDENTITY, lo envuelve en
 * `SET IDENTITY_INSERT … ON/OFF`. Si no, devuelve el SQL tal cual.
 */
export function withIdentityInsert(tsql: string, identityColumns: ReadonlyMap<string, string>): string {
  if (identityColumns.size === 0) return tsql;
  const m = /INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/i.exec(tsql);
  if (!m) return tsql;
  const identity = identityColumns.get(m[1].toLowerCase());
  if (!identity) return tsql;
  const columns = splitTopLevel(m[2]).map((c) => c.trim().replace(/^\[|\]$/g, "").toLowerCase());
  if (!columns.includes(identity)) return tsql;
  const body = tsql.replace(/;\s*$/, "");
  return `SET IDENTITY_INSERT ${m[1]} ON;\n${body};\nSET IDENTITY_INSERT ${m[1]} OFF;`;
}

export interface TranslateOptions {
  /** Columnas IDENTITY por tabla (ver `collectIdentityColumns`). */
  identityColumns?: ReadonlyMap<string, string>;
}

/**
 * Traduce un statement DML/consulta completo. Devuelve también `paramCount` para
 * que el driver sepa cuántos `@pN` bindear.
 *
 * `PRAGMA …` → no-op (`sql: ""`): en Azure SQL no existe y no hay equivalente
 * (WAL y foreign_keys son propiedades del motor, no configurables por sesión).
 */
export function translate(sqliteSql: string, options: TranslateOptions = {}): Translated {
  const kindRaw = statementKind(sqliteSql);
  if (kindRaw === "noop") return { sql: "", paramCount: 0, kind: "noop" };

  const bound = bindPlaceholders(sqliteSql.trim().replace(/;\s*$/, ""));
  let sql = bound.sql;
  const kind = statementKind(sql);

  sql = translateUpsert(sql);
  sql = translateReturning(sql);
  sql = aliasDerivedTables(sql);
  sql = translateBooleanSelectItems(sql);
  sql = translateLimit(sql);
  sql = translateRandom(sql);
  sql = translateJson(sql);
  sql = translateDates(sql);
  sql = addUpdateLockHints(sql);

  if (/\bLIMIT\s+(@p\d+|\d+)/i.test(sql)) {
    throw new UnsupportedSqlError("queda un LIMIT sin traducir (¿LIMIT en subconsulta?)");
  }
  sql = sql.trim();
  // T-SQL exige terminar MERGE con `;`.
  if (/^MERGE\b/i.test(sql) && !sql.endsWith(";")) sql += ";";
  if (kind === "insert" && options.identityColumns) {
    sql = withIdentityInsert(sql, options.identityColumns);
  }
  return { sql, paramCount: bound.paramCount, kind };
}

/**
 * Añade el eco de la identidad al final de un INSERT para poder devolver
 * `lastInsertRowid`. Tiene que ir en el MISMO lote: `SCOPE_IDENTITY()` es por
 * ámbito, un lote aparte devolvería NULL.
 */
export function withIdentityEcho(tsql: string): string {
  return `${tsql.replace(/;\s*$/, "")};\nSELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS lastInsertRowid;`;
}

/* ------------------------------------------------------------------ *
 * DDL: schema.sql → T-SQL
 * ------------------------------------------------------------------ */

interface TableParts {
  name: string;
  ifNotExists: boolean;
  body: string;
}

function parseCreateTable(stmt: string): TableParts | null {
  const m = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s*\(/i.exec(stmt.trim());
  if (!m) return null;
  const s = stmt.trim();
  const open = s.indexOf("(", m.index + m[0].length - 1);
  const close = matchParen(s, open);
  if (close < 0) return null;
  return { name: m[2], ifNotExists: Boolean(m[1]), body: s.slice(open + 1, close) };
}

const CONSTRAINT_START = /^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)\b/i;

function isBooleanColumn(name: string, def: string, extra: readonly string[]): boolean {
  if (!/\bINTEGER\b/i.test(def)) return false;
  if (!/\bDEFAULT\s+[01]\b/i.test(def)) return false;
  if (/^(is|has)_/i.test(name)) return true;
  return DEFAULT_BOOLEAN_COLUMNS.includes(name.toLowerCase()) || extra.includes(name.toLowerCase());
}

/** Columnas que participan en claves/índices → NVARCHAR(n), no NVARCHAR(MAX). */
function keyedColumns(body: string, indexed: readonly string[]): Set<string> {
  const keys = new Set<string>(indexed.map((c) => c.toLowerCase()));
  for (const part of splitTopLevel(body)) {
    const t = part.trim();
    if (CONSTRAINT_START.test(t)) {
      const cols = /\(([^)]*)\)/.exec(t);
      if (cols && !/^FOREIGN\s+KEY/i.test(t)) {
        for (const c of splitTopLevel(cols[1])) keys.add(c.trim().toLowerCase());
      }
      if (/^FOREIGN\s+KEY/i.test(t) && cols) {
        for (const c of splitTopLevel(cols[1])) keys.add(c.trim().toLowerCase());
      }
      continue;
    }
    const nm = /^([A-Za-z_][\w]*)\b([\s\S]*)$/.exec(t);
    if (!nm) continue;
    if (/\b(PRIMARY\s+KEY|UNIQUE)\b/i.test(nm[2])) keys.add(nm[1].toLowerCase());
  }
  return keys;
}

function translateColumnDef(
  raw: string,
  keys: Set<string>,
  opts: Required<Pick<DialectOptions, "keyTextLength" | "realAs">> & {
    booleanColumns: readonly string[];
    jsonColumns: readonly string[];
  }
): string {
  const nm = /^([A-Za-z_][\w]*)\b([\s\S]*)$/.exec(raw.trim());
  if (!nm) throw new UnsupportedSqlError(`definición de columna no reconocida: ${raw.trim()}`);
  const name = nm[1];
  let def = nm[2].trim();
  const lower = name.toLowerCase();
  const isKey = keys.has(lower);

  let checks = "";
  if (/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/i.test(def)) {
    def = def.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/i, "INT IDENTITY(1,1) PRIMARY KEY");
  } else if (/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(def)) {
    def = def.replace(/\bINTEGER\s+PRIMARY\s+KEY\b/i, "INT NOT NULL PRIMARY KEY");
  } else if (isBooleanColumn(name, def, opts.booleanColumns)) {
    def = def.replace(/\bINTEGER\b/i, "BIT");
  } else {
    def = def.replace(/\bINTEGER\b/i, "INT");
  }
  def = def.replace(/\bREAL\b/i, opts.realAs === "DECIMAL" ? "DECIMAL(18,6)" : "FLOAT");
  def = def.replace(/\bNUMERIC\b/i, "DECIMAL(18,6)");
  def = def.replace(/\bBLOB\b/i, "VARBINARY(MAX)");
  if (/\bTEXT\b/i.test(def)) {
    const isJson =
      DEFAULT_JSON_COLUMNS.includes(lower) || opts.jsonColumns.includes(lower) || /_json$/.test(lower);
    def = def.replace(/\bTEXT\b/i, isKey ? `NVARCHAR(${opts.keyTextLength})` : "NVARCHAR(MAX)");
    if (isJson) checks = ` CHECK (ISJSON([${name}]) = 1)`;
  }
  // T-SQL: una PRIMARY KEY no admite NULL; SQLite sí lo tolera en columnas TEXT.
  if (/\bPRIMARY\s+KEY\b/i.test(def) && !/\bNOT\s+NULL\b/i.test(def)) {
    def = def.replace(/\bPRIMARY\s+KEY\b/i, "NOT NULL PRIMARY KEY");
  }
  def = translateDates(def);
  return `[${name}] ${def}${checks}`.replace(/\s+/g, " ").trim();
}

/**
 * Traduce un `schema.sql` de SQLite completo a una lista de statements T-SQL
 * idempotentes (`IF OBJECT_ID(...) IS NULL` / `IF NOT EXISTS (sys.indexes)`).
 *
 * Es AGNÓSTICO del esquema: se le pasa el `schema.sql` real en tiempo de ejecución.
 */
export function translateSchema(sqliteSchema: string, options: DialectOptions = {}): string[] {
  const opts = {
    keyTextLength: options.keyTextLength ?? KEY_TEXT_LENGTH,
    realAs: options.realAs ?? ("FLOAT" as const),
    booleanColumns: (options.booleanColumns ?? []).map((c) => c.toLowerCase()),
    jsonColumns: (options.jsonColumns ?? []).map((c) => c.toLowerCase()),
  };
  const statements = splitStatements(sqliteSchema);

  // Primera pasada: columnas indexadas por CREATE INDEX (afectan el tipo de texto).
  const indexedByTable = new Map<string, string[]>();
  for (const stmt of statements) {
    const m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s+ON\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/i.exec(
      stmt.trim()
    );
    if (!m) continue;
    const cols = splitTopLevel(m[3]).map((c) => c.trim().replace(/\s+(ASC|DESC)$/i, ""));
    const prev = indexedByTable.get(m[2].toLowerCase()) ?? [];
    indexedByTable.set(m[2].toLowerCase(), [...prev, ...cols.map((c) => c.toLowerCase())]);
  }

  const out: string[] = [];
  for (const stmt of statements) {
    const s = stmt.trim();
    if (/^PRAGMA\b/i.test(s)) continue; // no-op en Azure SQL

    const table = parseCreateTable(s);
    if (table) {
      const keys = keyedColumns(table.body, indexedByTable.get(table.name.toLowerCase()) ?? []);
      const parts = splitTopLevel(table.body).map((part) => {
        const t = part.trim();
        if (CONSTRAINT_START.test(t)) return translateTableConstraint(t);
        return translateColumnDef(t, keys, opts);
      });
      const create = `CREATE TABLE ${table.name} (\n  ${parts.join(",\n  ")}\n)`;
      out.push(
        table.ifNotExists
          ? `IF OBJECT_ID(N'[${table.name}]', N'U') IS NULL\nBEGIN\n${create}\nEND`
          : create
      );
      continue;
    }

    const idx = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)\s+ON\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/i.exec(
      s
    );
    if (idx) {
      const create = `CREATE ${idx[1] ? "UNIQUE " : ""}INDEX ${idx[3]} ON ${idx[4]} (${idx[5].trim()})`;
      out.push(
        idx[2]
          ? `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'${idx[3]}' AND object_id = OBJECT_ID(N'[${idx[4]}]'))\n${create}`
          : create
      );
      continue;
    }

    // Cualquier otro DDL pasa por el traductor de expresiones (no se inventa nada).
    out.push(translateDates(s));
  }
  return out;
}

function translateTableConstraint(t: string): string {
  // FOREIGN KEY / UNIQUE / PRIMARY KEY / CHECK: la sintaxis coincide en T-SQL.
  // Solo se traducen las expresiones de fecha que puedan aparecer en un CHECK.
  return translateDates(t).replace(/\s+/g, " ").trim();
}
