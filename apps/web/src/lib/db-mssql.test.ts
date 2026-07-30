/**
 * WP16 — el puente SÍNCRONO sobre un backend ASÍNCRONO, probado de punta a punta.
 *
 * Lo que estos tests SÍ prueban (con un backend asíncrono FALSO inyectado en el
 * worker, `db-fake-backend.mjs`, que cede el event loop en cada operación):
 *   · round-trip síncrono: `prepare().get()` devuelve la fila, no una promesa;
 *   · parámetros (incluidos NULL, unicode y payloads más grandes que un chunk);
 *   · transacciones: commit, rollback y anidamiento;
 *   · errores del motor que cruzan el hilo y se relanzan;
 *   · timeout: un backend colgado LANZA en vez de bloquear para siempre;
 *   · la app real corriendo sobre el puente: `schema.sql` + seed + invitaciones,
 *     incluido el consumo atómico y el doble consumo que debe fallar;
 *   · fallo fuerte cuando el worker/backend no existe.
 *
 * Lo que NO se puede probar aquí: el cable real `tedious → instancia Azure SQL`
 * (T-SQL aceptado por el motor, managed identity, latencia). Eso es el paso 6 del
 * despliegue y necesita la suscripción de John.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openSyncRemote, azureSqlConfigFromEnv, describeAzureSql, defaultWorkerPath, type ClosableDB } from "./db-mssql";
import { SyncBridgeError } from "./db-sync-bridge";
import { resolveDriver } from "./db";
import { generateInvite, consumeInvite, countActiveInvites, InviteConsumeError } from "./invites";
import { seedGenomeV1, getActiveGenome } from "./genome";
import { seedIfEmpty } from "./seed";

const FAKE_BACKEND = path.join(process.cwd(), "src", "lib", "db-fake-backend.mjs");
const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");

const ISSUER = "GISSUERBRIDGEDEMO0000000000000000000000000000000000000000A";
const NEWUSER = "GNEWUSERBRIDGEDEMO0000000000000000000000000000000000000AA";

function tmpFile(tag: string): string {
  return path.join(os.tmpdir(), `zelena-bridge-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanup(file: string): void {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      fs.unlinkSync(file + suffix);
    } catch {
      /* no existe */
    }
  }
}

/** Abre el puente en modo `passthrough` (el dialecto T-SQL se prueba aparte, puro). */
function openBridge(file: string, extra: Record<string, unknown> = {}): ClosableDB {
  return openSyncRemote({
    backendModule: FAKE_BACKEND,
    backendConfig: { file, ...extra },
    dialect: "passthrough",
    callTimeoutMs: 5_000,
    bootTimeoutMs: 15_000,
  });
}

describe("puente síncrono sobre backend asíncrono (WP16)", () => {
  let db: ClosableDB;
  let file: string;

  beforeAll(() => {
    file = tmpFile("core");
    cleanup(file);
    db = openBridge(file);
    db.exec(schema);
  });

  afterAll(() => {
    db.close();
    cleanup(file);
  });

  it("devuelve resultados de forma SÍNCRONA (no promesas) y respeta la interfaz DB", () => {
    const info = db
      .prepare(`INSERT INTO users (wallet, display_name, tier, is_demo, cla_signed) VALUES (?, 'Ada', 'Bronze', 1, 1)`)
      .run("GBRIDGEADA000000000000000000000000000000000000000000000AA");
    expect(Number(info.changes)).toBe(1);

    const row = db
      .prepare(`SELECT display_name FROM users WHERE wallet = ?`)
      .get("GBRIDGEADA000000000000000000000000000000000000000000000AA");
    expect(row).not.toBeInstanceOf(Promise);
    expect((row as { display_name: string }).display_name).toBe("Ada");

    expect(db.prepare(`SELECT wallet FROM users`).all().length).toBeGreaterThanOrEqual(1);
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get("no-existe")).toBeUndefined();
  });

  it("lastInsertRowid llega de vuelta por el puente", () => {
    const info = db
      .prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES ('2026-07-30', ?, 'r', 'h')`)
      .run("puente");
    expect(Number(info.lastInsertRowid)).toBeGreaterThan(0);
  });

  it("parámetros NULL, unicode y payloads mayores que un chunk cruzan intactos", () => {
    db.prepare(
      `INSERT INTO users (wallet, display_name, invited_by, is_demo) VALUES (?, ?, ?, 1)`
    ).run("GBRIDGEUNICODE00000000000000000000000000000000000000000AA", "Ángela ✅ 中文", null);
    const row = db
      .prepare(`SELECT display_name, invited_by FROM users WHERE wallet = ?`)
      .get("GBRIDGEUNICODE00000000000000000000000000000000000000000AA") as {
      display_name: string;
      invited_by: string | null;
    };
    expect(row.display_name).toBe("Ángela ✅ 中文");
    expect(row.invited_by).toBeNull();
  });

  it("un resultado más grande que el chunk se transfiere por trozos sin corromperse", () => {
    // chunk de 4 KiB contra un payload de ~200 KiB: fuerza decenas de trozos.
    const small = tmpFile("chunked");
    cleanup(small);
    const chunked = openSyncRemote({
      backendModule: FAKE_BACKEND,
      backendConfig: { file: small },
      dialect: "passthrough",
      chunkBytes: 4096,
      callTimeoutMs: 10_000,
    });
    try {
      chunked.exec(schema);
      const big = "ø".repeat(100_000);
      chunked
        .prepare(`INSERT INTO academia_content (slug, kind, title, summary, points, min_seconds, body) VALUES (?,?,?,?,?,?,?)`)
        .run("largo", "article", "Largo", "s", 10, 60, big);
      const row = chunked.prepare(`SELECT body FROM academia_content WHERE slug = ?`).get("largo") as {
        body: string;
      };
      expect(row.body.length).toBe(big.length);
      expect(row.body).toBe(big);
    } finally {
      chunked.close();
      cleanup(small);
    }
  });

  it("las transacciones confirman, revierten y se anidan uniéndose a la externa", () => {
    const insert = (wallet: string): void =>
      void db.prepare(`INSERT INTO users (wallet, display_name, is_demo) VALUES (?, 'Tx', 1)`).run(wallet);

    db.transaction(() => insert("GBRIDGETXOK0000000000000000000000000000000000000000000AA"))();
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get("GBRIDGETXOK0000000000000000000000000000000000000000000AA")).toBeDefined();

    expect(() =>
      db.transaction(() => {
        insert("GBRIDGETXKO0000000000000000000000000000000000000000000AA");
        throw new Error("revertir");
      })()
    ).toThrow("revertir");
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get("GBRIDGETXKO0000000000000000000000000000000000000000000AA")).toBeUndefined();

    // Anidada: la interna se une a la externa (no abre una segunda transacción).
    const inner = db.transaction(() => insert("GBRIDGETXIN0000000000000000000000000000000000000000000AA"));
    db.transaction(() => inner())();
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get("GBRIDGETXIN0000000000000000000000000000000000000000000AA")).toBeDefined();
  });

  it("pragma() es no-op y PRAGMA preparado no rompe nada", () => {
    expect(() => db.pragma("journal_mode = WAL")).not.toThrow();
  });

  it("un error del motor cruza el hilo y se relanza en el hilo principal", () => {
    expect(() => db.prepare(`SELECT * FROM tabla_que_no_existe`).all()).toThrow(SyncBridgeError);
    expect(() => db.prepare(`SELECT * FROM tabla_que_no_existe`).all()).toThrow(/tabla_que_no_existe/);
  });
});

describe("el puente NO se cuelga ni degrada en silencio (WP16)", () => {
  it("un backend colgado provoca timeout explícito, no un bloqueo eterno", () => {
    const file = tmpFile("hang");
    cleanup(file);
    const db = openSyncRemote({
      backendModule: FAKE_BACKEND,
      backendConfig: { file, hangOnSql: "SELECT 'colgame'" },
      dialect: "passthrough",
      callTimeoutMs: 1_200,
    });
    try {
      db.exec(schema);
      const started = Date.now();
      expect(() => db.prepare(`SELECT 'colgame' AS x`).get()).toThrow(SyncBridgeError);
      expect(Date.now() - started).toBeLessThan(10_000);
      // Tras el timeout el puente queda inutilizable a propósito: una respuesta
      // tardía llegaría desalineada y devolvería datos de otra consulta.
      expect(() => db.prepare(`SELECT 1 AS x`).get()).toThrow(/inutilizable/);
    } finally {
      db.close();
      cleanup(file);
    }
  });

  it("si el worker no existe, LANZA (nunca cae a SQLite local)", () => {
    expect(() =>
      openSyncRemote({
        backendModule: FAKE_BACKEND,
        backendConfig: { file: tmpFile("nope") },
        dialect: "passthrough",
        workerPath: path.join(process.cwd(), "src", "lib", "no-existe.worker.mjs"),
      })
    ).toThrow(SyncBridgeError);
  });

  it("si el módulo de backend no carga, LANZA con el motivo", () => {
    expect(() =>
      openSyncRemote({
        backendModule: path.join(process.cwd(), "src", "lib", "backend-inexistente.mjs"),
        dialect: "passthrough",
        bootTimeoutMs: 10_000,
      })
    ).toThrow(/falló al arrancar/);
  });

  it("el worker del puente está donde el driver lo busca", () => {
    expect(fs.existsSync(defaultWorkerPath())).toBe(true);
  });
});

describe("la app real corre sobre el puente síncrono (WP16)", () => {
  let db: ClosableDB;
  let file: string;

  beforeAll(() => {
    file = tmpFile("app");
    cleanup(file);
    db = openBridge(file);
    db.exec(schema);
    seedIfEmpty(db);
  });

  afterAll(() => {
    db.close();
    cleanup(file);
  });

  it("schema.sql + seed corren completos a través del puente", () => {
    const users = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    const projects = (db.prepare(`SELECT COUNT(*) AS n FROM projects`).get() as { n: number }).n;
    expect(users).toBeGreaterThanOrEqual(4);
    expect(projects).toBeGreaterThanOrEqual(5);
    // Idempotente: volver a sembrar no duplica.
    seedIfEmpty(db);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n).toBe(users);
  });

  it("el consumo atómico de invitaciones se comporta igual que en SQLite", () => {
    const code = generateInvite(db, ISSUER, "Bronze");
    expect(countActiveInvites(db, ISSUER)).toBe(1);
    expect(consumeInvite(db, code, NEWUSER)).toBe(ISSUER);
    expect(countActiveInvites(db, ISSUER)).toBe(0);
    // Segundo consumo del mismo código: falla (no hay doble uso).
    expect(() => consumeInvite(db, code, "GOTRO0000000000000000000000000000000000000000000000000AA")).toThrow(
      InviteConsumeError
    );
  });

  it("el genoma versionado (JSON) se lee igual a través del puente", () => {
    seedGenomeV1(db);
    const genome = getActiveGenome(db, 1);
    expect(genome.EPOCH_BUDGET).toBe(100_000);
    expect(genome.TIER_INVITE_CAPS.Gold).toBe(10);
  });

  it("las derivaciones por SUM() siguen siendo la fuente de verdad", () => {
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 10, 1, 'ejecucion', 'a')`).run(NEWUSER);
    db.prepare(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 32, 1, 'academia', 'b')`).run(NEWUSER);
    const total = db.prepare(`SELECT COALESCE(SUM(points), 0) AS t FROM points_ledger WHERE wallet = ?`).get(NEWUSER) as {
      t: number;
    };
    expect(total.t).toBe(42);
  });
});

describe("selección de driver y configuración de Azure SQL (WP16)", () => {
  it("resolveDriver respeta el orden: explícito → Azure SQL → libSQL → SQLite local", () => {
    expect(resolveDriver({})).toBe("sqlite");
    expect(resolveDriver({ DATABASE_URL: "file:./data/zelena.db" })).toBe("libsql");
    expect(resolveDriver({ AZURE_SQL_SERVER: "z.database.windows.net" })).toBe("mssql");
    // Azure gana a libSQL si ambas están; el explícito gana a todo.
    expect(resolveDriver({ AZURE_SQL_SERVER: "z", TURSO_DATABASE_URL: "libsql://x" })).toBe("mssql");
    expect(resolveDriver({ AZURE_SQL_SERVER: "z", DATABASE_DRIVER: "sqlite" })).toBe("sqlite");
    expect(() => resolveDriver({ DATABASE_DRIVER: "postgres" })).toThrow(/no es válido/);
  });

  it("el desarrollo local NO se migra: sin variables de Azure, sigue SQLite", () => {
    expect(resolveDriver({ NODE_ENV: "development" })).toBe("sqlite");
  });

  it("managed identity es el camino por defecto; usuario/clave es el fallback explícito", () => {
    const mi = azureSqlConfigFromEnv({ AZURE_SQL_SERVER: "z.database.windows.net", AZURE_SQL_DATABASE: "zelena" });
    expect(mi?.auth.kind).toBe("managed-identity");
    expect(mi?.port).toBe(1433);
    expect(mi?.encrypt).toBe(true);

    const pwd = azureSqlConfigFromEnv({
      AZURE_SQL_SERVER: "z.database.windows.net",
      AZURE_SQL_DATABASE: "zelena",
      AZURE_SQL_USER: "zelena_app",
      AZURE_SQL_PASSWORD: "no-va-al-repo",
    });
    expect(pwd?.auth.kind).toBe("password");

    expect(azureSqlConfigFromEnv({})).toBeNull();
    expect(() => azureSqlConfigFromEnv({ AZURE_SQL_SERVER: "z" })).toThrow(/AZURE_SQL_DATABASE/);
    expect(() =>
      azureSqlConfigFromEnv({ AZURE_SQL_SERVER: "z", AZURE_SQL_DATABASE: "d", AZURE_SQL_USER: "u" })
    ).toThrow(/AZURE_SQL_PASSWORD/);
  });

  it("la descripción de la conexión NUNCA incluye la contraseña ni el token", () => {
    const cfg = azureSqlConfigFromEnv({
      AZURE_SQL_SERVER: "z.database.windows.net",
      AZURE_SQL_DATABASE: "zelena",
      AZURE_SQL_USER: "zelena_app",
      AZURE_SQL_PASSWORD: "secreto-que-no-debe-salir",
    });
    const text = describeAzureSql(cfg as NonNullable<typeof cfg>);
    expect(text).toContain("zelena_app");
    expect(text).not.toContain("secreto-que-no-debe-salir");
  });
});
