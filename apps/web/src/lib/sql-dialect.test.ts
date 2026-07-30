/**
 * WP16 — dialecto T-SQL. Un test por punto del spec.
 *
 * El traductor es PURO, así que se puede probar por completo sin Azure. Lo que NO
 * se puede probar aquí es que Azure SQL acepte el T-SQL resultante: eso exige la
 * instancia real (paso 6 del despliegue, John).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  translate,
  translateSchema,
  translateLimit,
  translateDates,
  translateRandom,
  translateJson,
  translateReturning,
  translateBooleanSelectItems,
  aliasDerivedTables,
  translateUpsert,
  addUpdateLockHints,
  bindPlaceholders,
  withIdentityEcho,
  collectIdentityColumns,
  withIdentityInsert,
  strftimeToNetFormat,
  splitStatements,
  UnsupportedSqlError,
} from "./sql-dialect";

const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");

describe("dialecto T-SQL — DDL (WP16)", () => {
  const ddl = translateSchema(schema);
  const joined = ddl.join("\n\n");

  it("INTEGER PRIMARY KEY AUTOINCREMENT → INT IDENTITY(1,1) PRIMARY KEY", () => {
    expect(joined).toContain("IDENTITY(1,1)");
    expect(joined).not.toMatch(/AUTOINCREMENT/i);
    const t = translateSchema("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT);")[0];
    expect(t).toMatch(/\[id\] INT IDENTITY\(1,1\) NOT NULL PRIMARY KEY/);
  });

  it("TEXT → NVARCHAR(MAX), y NVARCHAR(n) cuando la columna es clave o va indexada", () => {
    const users = ddl.find((s) => /CREATE TABLE users/i.test(s)) as string;
    // wallet es PRIMARY KEY → longitud acotada (NVARCHAR(MAX) no puede indexarse).
    expect(users).toMatch(/\[wallet\] NVARCHAR\(200\) NOT NULL PRIMARY KEY/);
    // display_name no participa en ninguna clave → MAX.
    expect(users).toMatch(/\[display_name\] NVARCHAR\(MAX\) NOT NULL/);
    expect(joined).not.toMatch(/\bTEXT\b/);
  });

  it("una columna TEXT referenciada por CREATE INDEX también recibe NVARCHAR(n)", () => {
    const out = translateSchema(
      `CREATE TABLE t (wallet TEXT NOT NULL, nota TEXT);
       CREATE INDEX IF NOT EXISTS idx_t ON t(wallet);`
    );
    expect(out[0]).toMatch(/\[wallet\] NVARCHAR\(200\) NOT NULL/);
    expect(out[0]).toMatch(/\[nota\] NVARCHAR\(MAX\)/);
  });

  // Hallazgo de WP13: la cola de un CREATE INDEX se descartaba en silencio, así que
  // un índice PARCIAL de SQLite salía como índice SIN filtro. Importa porque un
  // UNIQUE sobre columna nullable pasa en SQLite (admite varios NULL) y rompe en
  // SQL Server (los NULL son iguales entre sí: solo admite uno).
  it("un índice PARCIAL conserva su WHERE (índice filtrado en T-SQL)", () => {
    const out = translateSchema(
      `CREATE TABLE users (wallet TEXT PRIMARY KEY, entra_oid TEXT);
       CREATE UNIQUE INDEX IF NOT EXISTS idx_oid ON users(entra_oid) WHERE entra_oid IS NOT NULL;`
    );
    const idx = out.find((s) => s.includes("idx_oid"))!;
    expect(idx).toMatch(/CREATE UNIQUE INDEX idx_oid ON users \(entra_oid\)/);
    expect(idx).toMatch(/WHERE entra_oid IS NOT NULL/);
  });

  it("un índice sin filtro no gana un WHERE de la nada", () => {
    const out = translateSchema(
      `CREATE TABLE t (wallet TEXT NOT NULL);
       CREATE INDEX idx_t ON t(wallet);`
    );
    expect(out.find((s) => s.includes("idx_t"))!).not.toMatch(/WHERE/i);
  });

  it("una cola no reconocida en CREATE INDEX LANZA en vez de emitir T-SQL 'parecido'", () => {
    expect(() =>
      translateSchema(
        `CREATE TABLE t (wallet TEXT NOT NULL);
         CREATE INDEX idx_t ON t(wallet) COLLATE NOCASE;`
      )
    ).toThrow(UnsupportedSqlError);
  });

  it("REAL → FLOAT (o DECIMAL si se pide)", () => {
    expect(translateSchema("CREATE TABLE t (score REAL NOT NULL);")[0]).toMatch(/\[score\] FLOAT NOT NULL/);
    expect(translateSchema("CREATE TABLE t (score REAL NOT NULL);", { realAs: "DECIMAL" })[0]).toMatch(
      /\[score\] DECIMAL\(18,6\) NOT NULL/
    );
    expect(joined).not.toMatch(/\bREAL\b/);
  });

  it("booleanos 0/1 → BIT; los enteros que NO son banderas siguen siendo INT", () => {
    const users = ddl.find((s) => /CREATE TABLE users/i.test(s)) as string;
    expect(users).toMatch(/\[is_demo\] BIT NOT NULL DEFAULT 0/);
    expect(users).toMatch(/\[is_founder\] BIT NOT NULL DEFAULT 0/);
    expect(users).toMatch(/\[cla_signed\] BIT NOT NULL DEFAULT 0/);
    // anchor_queue.attempts es un CONTADOR con DEFAULT 0: jamás debe volverse BIT
    // (SQL Server convertiría cualquier valor ≠0 a 1 → corrupción silenciosa).
    const queue = ddl.find((s) => /CREATE TABLE anchor_queue/i.test(s)) as string;
    expect(queue).toMatch(/\[attempts\] INT NOT NULL DEFAULT 0/);
    // academia_quiz.correct es un ÍNDICE de opción, no un booleano.
    const quiz = ddl.find((s) => /CREATE TABLE academia_quiz/i.test(s)) as string;
    expect(quiz).toMatch(/\[correct\] INT NOT NULL/);
  });

  it("DEFAULT (datetime('now')) → SYSUTCDATETIME() con el formato de texto de SQLite", () => {
    const users = ddl.find((s) => /CREATE TABLE users/i.test(s)) as string;
    expect(users).toContain("DEFAULT (CONVERT(NVARCHAR(19), SYSUTCDATETIME(), 120))");
    expect(joined).not.toMatch(/datetime\('now'\)/i);
  });

  it("las columnas JSON (params del genoma) llevan CHECK (ISJSON(...) = 1)", () => {
    const genome = ddl.find((s) => /CREATE TABLE genome_versions/i.test(s)) as string;
    expect(genome).toContain("CHECK (ISJSON([params]) = 1)");
    const fitness = ddl.find((s) => /CREATE TABLE epoch_fitness/i.test(s)) as string;
    expect(fitness).toContain("CHECK (ISJSON([components]) = 1)");
  });

  it("PRAGMA es no-op y CREATE ... IF NOT EXISTS se vuelve idempotente en T-SQL", () => {
    expect(joined).not.toMatch(/PRAGMA/i);
    expect(joined).not.toMatch(/IF NOT EXISTS\s+users/i);
    expect(joined).toContain("IF OBJECT_ID(N'[users]', N'U') IS NULL");
    const idx = ddl.find((s) => /idx_rep_wallet/i.test(s)) as string;
    expect(idx).toContain("SELECT 1 FROM sys.indexes WHERE name = N'idx_rep_wallet'");
  });

  it("procesa el schema.sql ACTUAL completo sin lanzar y traduce todas las tablas", () => {
    expect(() => translateSchema(schema)).not.toThrow();
    const tablesInSqlite = splitStatements(schema).filter((s) => /^CREATE\s+TABLE/i.test(s.trim())).length;
    const tablesInTsql = ddl.filter((s) => /CREATE TABLE/i.test(s)).length;
    expect(tablesInTsql).toBe(tablesInSqlite);
    expect(tablesInTsql).toBeGreaterThanOrEqual(20);
    // Constraints de tabla intactos.
    expect(joined).toMatch(/UNIQUE \(wallet, cla_version\)/);
    expect(joined).toMatch(/FOREIGN KEY \(project_id\) REFERENCES projects\(id\)/);
  });
});

describe("dialecto T-SQL — fechas y formatos (WP16)", () => {
  it("CURRENT_TIMESTAMP y datetime('now') → SYSUTCDATETIME()", () => {
    expect(translateDates("SELECT CURRENT_TIMESTAMP")).toBe(
      "SELECT CONVERT(NVARCHAR(19), SYSUTCDATETIME(), 120)"
    );
    expect(translateDates("SELECT datetime('now')")).toContain("SYSUTCDATETIME()");
  });

  it("modificadores relativos → DATEADD", () => {
    expect(translateDates("SELECT datetime('now','+30 days')")).toBe(
      "SELECT CONVERT(NVARCHAR(19), DATEADD(day, 30, SYSUTCDATETIME()), 120)"
    );
    expect(translateDates("SELECT datetime('now','-14 days')")).toContain("DATEADD(day, -14, SYSUTCDATETIME())");
    expect(translateDates("SELECT date('now')")).toBe("SELECT CONVERT(NVARCHAR(10), SYSUTCDATETIME(), 23)");
  });

  it("strftime → CONVERT/FORMAT", () => {
    expect(translateDates("SELECT strftime('%Y-%m-%d', created_at) FROM t")).toBe(
      "SELECT CONVERT(NVARCHAR(10), CONVERT(datetime2, created_at), 23) FROM t"
    );
    expect(translateDates("SELECT strftime('%Y-%m', created_at) FROM t")).toBe(
      "SELECT FORMAT(CONVERT(datetime2, created_at), 'yyyy-MM') FROM t"
    );
    expect(strftimeToNetFormat("%Y-%m-%dT%H:%M:%S")).toBe("yyyy-MM-ddTHH:mm:ss");
  });

  it("un modificador o token no soportado LANZA en vez de traducir mal", () => {
    expect(() => translateDates("SELECT datetime('now','start of month')")).toThrow(UnsupportedSqlError);
    expect(() => translateDates("SELECT strftime('%j', created_at)")).toThrow(UnsupportedSqlError);
  });

  it("no toca lo que está dentro de un literal de cadena", () => {
    expect(translateDates("SELECT 'CURRENT_TIMESTAMP' AS x")).toBe("SELECT 'CURRENT_TIMESTAMP' AS x");
  });
});

describe("dialecto T-SQL — paginación, aleatoriedad y JSON (WP16)", () => {
  it("LIMIT n → TOP (n)", () => {
    expect(translateLimit("SELECT id FROM periods ORDER BY id DESC LIMIT 1")).toBe(
      "SELECT TOP (1) id FROM periods ORDER BY id DESC"
    );
    expect(translateLimit("SELECT DISTINCT wallet FROM users LIMIT 5")).toBe(
      "SELECT DISTINCT TOP (5) wallet FROM users"
    );
  });

  it("LIMIT n OFFSET m → OFFSET … FETCH NEXT …, con ORDER BY neutro si falta", () => {
    expect(translateLimit("SELECT id FROM users ORDER BY id LIMIT 10 OFFSET 20")).toBe(
      "SELECT id FROM users ORDER BY id OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY"
    );
    expect(translateLimit("SELECT id FROM users LIMIT 10 OFFSET 20")).toContain("ORDER BY (SELECT NULL) OFFSET 20 ROWS");
    // Forma SQLite `LIMIT offset, count`.
    expect(translateLimit("SELECT id FROM users ORDER BY id LIMIT 5, 10")).toBe(
      "SELECT id FROM users ORDER BY id OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY"
    );
  });

  it("ORDER BY RANDOM() → ORDER BY NEWID() (consulta real de academia)", () => {
    const t = translate(
      "SELECT id, question, options FROM academia_quiz WHERE content_id = ? ORDER BY RANDOM() LIMIT 3"
    );
    expect(t.sql).toBe("SELECT TOP (3) id, question, options FROM academia_quiz WHERE content_id = @p0 ORDER BY NEWID()");
    expect(t.paramCount).toBe(1);
    expect(translateRandom("SELECT 'RANDOM()' AS x")).toBe("SELECT 'RANDOM()' AS x");
  });

  it("una tabla derivada sin alias recibe uno (T-SQL lo exige)", () => {
    // SQL literal de lib/epochs.ts (wallets activas de los últimos 14 días).
    const t = translate(
      `SELECT COUNT(DISTINCT wallet) AS n FROM (
         SELECT wallet, created_at FROM reputation_events
         UNION ALL SELECT wallet, created_at FROM points_ledger
       ) WHERE created_at > datetime('now','-14 days')`
    );
    expect(t.sql).toMatch(/\)\s+AS __d1 WHERE created_at >/);
    expect(aliasDerivedTables("SELECT n FROM (SELECT 1 AS n) AS ya")).toBe("SELECT n FROM (SELECT 1 AS n) AS ya");
    expect(aliasDerivedTables("SELECT n FROM (SELECT 1 AS n) sin_as")).toBe("SELECT n FROM (SELECT 1 AS n) sin_as");
    // `IN (SELECT …)` no es una tabla derivada: no se le pone alias.
    expect(aliasDerivedTables("SELECT id FROM users WHERE wallet IN (SELECT wallet FROM votes)")).toBe(
      "SELECT id FROM users WHERE wallet IN (SELECT wallet FROM votes)"
    );
  });

  it("json_extract → JSON_VALUE", () => {
    expect(translateJson("SELECT json_extract(params, '$.EPOCH_BUDGET') FROM genome_versions")).toBe(
      "SELECT JSON_VALUE(params, '$.EPOCH_BUDGET') FROM genome_versions"
    );
  });

  it("un LIMIT que no se pueda mover (subconsulta) LANZA", () => {
    expect(() => translate("SELECT * FROM (SELECT id FROM users LIMIT 1) x WHERE x.id > 0")).toThrow(
      UnsupportedSqlError
    );
  });
});

describe("dialecto T-SQL — parámetros, RETURNING e identidad (WP16)", () => {
  it("`?` posicional → `@pN` nombrado, ignorando literales", () => {
    const b = bindPlaceholders("SELECT ? FROM t WHERE a = ? AND b = '¿qué?'");
    expect(b.sql).toBe("SELECT @p0 FROM t WHERE a = @p1 AND b = '¿qué?'");
    expect(b.paramCount).toBe(2);
  });

  it("RETURNING → cláusula OUTPUT (INSERTED/DELETED)", () => {
    expect(translateReturning("INSERT INTO t (a) VALUES (@p0) RETURNING id")).toBe(
      "INSERT INTO t (a) OUTPUT INSERTED.id VALUES (@p0)"
    );
    expect(translateReturning("UPDATE t SET a = @p0 WHERE id = @p1 RETURNING id, a")).toBe(
      "UPDATE t SET a = @p0 OUTPUT INSERTED.id, INSERTED.a WHERE id = @p1"
    );
    expect(translateReturning("DELETE FROM t WHERE id = @p0 RETURNING *")).toBe(
      "DELETE FROM t OUTPUT DELETED.* WHERE id = @p0"
    );
  });

  it("lastInsertRowid se obtiene con SCOPE_IDENTITY() en el MISMO lote", () => {
    const echo = withIdentityEcho("INSERT INTO t (a) VALUES (@p0)");
    expect(echo).toContain("INSERT INTO t (a) VALUES (@p0);");
    expect(echo).toContain("SELECT CAST(SCOPE_IDENTITY() AS BIGINT) AS lastInsertRowid;");
  });

  it("un id explícito sobre una columna IDENTITY se envuelve en SET IDENTITY_INSERT", () => {
    // SQLite acepta `INSERT INTO periods (id, …) VALUES (1, …)` (lo hace el seed);
    // T-SQL lo RECHAZA sobre una columna IDENTITY salvo con este interruptor.
    const identity = collectIdentityColumns(translateSchema(schema));
    expect(identity.get("periods")).toBe("id");
    expect(identity.get("users")).toBeUndefined(); // PK es `wallet`, no un entero

    const t = translate(
      `INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'Época Génesis', ?, ?, 'Open')`,
      { identityColumns: identity }
    );
    expect(t.sql.startsWith("SET IDENTITY_INSERT periods ON;")).toBe(true);
    expect(t.sql.trimEnd().endsWith("SET IDENTITY_INSERT periods OFF;")).toBe(true);
    expect(t.paramCount).toBe(2);

    // Sin id explícito NO se envuelve (el caso normal).
    const plain = translate(`INSERT INTO periods (name, epoch_budget, academia_budget, state) VALUES (?, ?, ?, 'Open')`, {
      identityColumns: identity,
    });
    expect(plain.sql).not.toMatch(/IDENTITY_INSERT/);
    expect(withIdentityInsert("INSERT INTO users (wallet) VALUES (@p0)", identity)).toBe(
      "INSERT INTO users (wallet) VALUES (@p0)"
    );
  });

  it("PRAGMA se traduce a no-op", () => {
    expect(translate("PRAGMA foreign_keys = ON").sql).toBe("");
    expect(translate("PRAGMA journal_mode = WAL").kind).toBe("noop");
  });
});

describe("dialecto T-SQL — upsert (WP16)", () => {
  it("ON CONFLICT DO NOTHING → patrón IF NOT EXISTS reusando el MISMO parámetro", () => {
    const t = translate("INSERT INTO invites (code, issuer_wallet) VALUES (?, ?) ON CONFLICT (code) DO NOTHING");
    expect(t.paramCount).toBe(2); // el binding nombrado evita duplicar parámetros
    expect(t.sql).toBe(
      "IF NOT EXISTS (SELECT 1 FROM invites WITH (UPDLOCK, HOLDLOCK) WHERE code = @p0) " +
        "INSERT INTO invites (code, issuer_wallet) VALUES (@p0, @p1)"
    );
  });

  it("ON CONFLICT DO UPDATE → MERGE con HOLDLOCK y `excluded` → `src`", () => {
    const t = translate(
      "INSERT INTO votes (proposal_id, wallet, choice) VALUES (?, ?, ?) " +
        "ON CONFLICT (proposal_id, wallet) DO UPDATE SET choice = excluded.choice"
    );
    expect(t.sql).toContain("MERGE votes WITH (HOLDLOCK) AS tgt");
    expect(t.sql).toContain("ON tgt.proposal_id = src.proposal_id AND tgt.wallet = src.wallet");
    expect(t.sql).toContain("WHEN MATCHED THEN UPDATE SET choice = src.choice");
    expect(t.sql).toContain("WHEN NOT MATCHED THEN INSERT (proposal_id, wallet, choice)");
    expect(t.sql.endsWith(";")).toBe(true); // T-SQL exige terminar MERGE con `;`
  });

  it("INSERT OR IGNORE → INSERT que solo se traga el error de clave duplicada", () => {
    const t = translateUpsert("INSERT OR IGNORE INTO users (wallet) VALUES (@p0)");
    expect(t).toContain("BEGIN TRY INSERT INTO users (wallet) VALUES (@p0);");
    expect(t).toContain("IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;");
  });

  it("INSERT OR REPLACE LANZA (no hay equivalente fiel y no se improvisa)", () => {
    expect(() => translateUpsert("INSERT OR REPLACE INTO users (wallet) VALUES (@p0)")).toThrow(UnsupportedSqlError);
  });
});

describe("dialecto T-SQL — consumo atómico de invitaciones, superficie crítica V5 (WP16)", () => {
  it("el UPDATE condicional lleva los lock hints WITH (UPDLOCK, ROWLOCK)", () => {
    // SQL literal de lib/invites.ts consumeInvite().
    const t = translate(
      `UPDATE invites SET used_by = ?
         WHERE code = ? AND used_by IS NULL AND expires_at > datetime('now')`
    );
    expect(t.sql).toContain("UPDATE invites WITH (UPDLOCK, ROWLOCK) SET used_by = @p0");
    expect(t.sql).toContain("used_by IS NULL");
    expect(t.sql).toContain("CONVERT(NVARCHAR(19), SYSUTCDATETIME(), 120)");
    expect(t.paramCount).toBe(2);
  });

  it("el conteo de invitaciones activas y la emisión conservan su semántica", () => {
    const count = translate(
      `SELECT COUNT(*) AS n FROM invites
       WHERE issuer_wallet = ? AND used_by IS NULL AND expires_at > datetime('now')`
    );
    expect(count.sql).toContain("COUNT(*) AS n");
    expect(count.sql).toContain("SYSUTCDATETIME()");
    const gen = translate(
      `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`
    );
    expect(gen.sql).toContain("DATEADD(day, 30, SYSUTCDATETIME())");
    expect(gen.kind).toBe("insert");
  });

  it("la comparación booleana de checkInvite se vuelve CASE WHEN (T-SQL no admite booleanos escalares)", () => {
    // SQL literal de lib/invites.ts checkInvite().
    const t = translate(`SELECT (expires_at <= datetime('now')) AS e FROM invites WHERE code = ?`);
    expect(t.sql).toBe(
      "SELECT CASE WHEN expires_at <= CONVERT(NVARCHAR(19), SYSUTCDATETIME(), 120) THEN 1 ELSE 0 END AS e " +
        "FROM invites WHERE code = @p0"
    );
  });

  it("no confunde funciones ni subconsultas escalares con booleanos", () => {
    expect(translateBooleanSelectItems("SELECT COUNT(*) AS n FROM invites")).toBe("SELECT COUNT(*) AS n FROM invites");
    expect(translateBooleanSelectItems("SELECT COALESCE(SUM(points), 0) AS t FROM points_ledger")).toBe(
      "SELECT COALESCE(SUM(points), 0) AS t FROM points_ledger"
    );
    expect(translateBooleanSelectItems("SELECT (SELECT MAX(id) FROM periods WHERE state = 'Open') AS m")).toBe(
      "SELECT (SELECT MAX(id) FROM periods WHERE state = 'Open') AS m"
    );
    expect(translateBooleanSelectItems("SELECT (used_by IS NULL) AS libre, code FROM invites")).toBe(
      "SELECT CASE WHEN used_by IS NULL THEN 1 ELSE 0 END AS libre, code FROM invites"
    );
  });

  it("un UPDATE que ya trae hints no se duplica", () => {
    const once = addUpdateLockHints("UPDATE invites SET a = 1");
    expect(addUpdateLockHints(once)).toBe(once);
  });

  it("las derivaciones por SUM() pasan intactas (no hay columnas de saldo que migrar)", () => {
    const t = translate("SELECT COALESCE(SUM(points), 0) AS total FROM points_ledger WHERE wallet = ?");
    expect(t.sql).toBe("SELECT COALESCE(SUM(points), 0) AS total FROM points_ledger WHERE wallet = @p0");
  });
});
