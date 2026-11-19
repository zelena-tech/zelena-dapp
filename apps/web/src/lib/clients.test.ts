import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import {
  createClient,
  addMember,
  listClientsFor,
  getClientForActor,
  accessLevelFor,
  addCredential,
  listCredentials,
  credentialAccessLog,
  addBrandAsset,
  listBrandAssets,
  auditSchemaForSecretColumns,
  EXCEPCIONES_AUDITORIA,
  findSecretLike,
  ClientError,
  ClientAccessError,
  type Actor,
} from "./clients";

const SCHEMA = path.join(process.cwd(), "src", "lib", "schema.sql");

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(SCHEMA, "utf8"));
  for (const [w, n] of [
    ["W_FUNDADOR", "Founder"],
    ["W_PLATAFORMA", "Plataforma"],
    ["W_OPERACIONES", "Operaciones"],
    ["W_CONTENIDO", "Contenido"],
  ]) {
    db.prepare(`INSERT INTO users (wallet, display_name, is_founder) VALUES (?, ?, ?)`).run(
      w,
      n,
      w === "W_FUNDADOR" ? 1 : 0
    );
  }
  return db;
}

const fundador: Actor = { wallet: "W_FUNDADOR", isFounder: true };
const plataforma: Actor = { wallet: "W_PLATAFORMA", isFounder: false };
const operaciones: Actor = { wallet: "W_OPERACIONES", isFounder: false };
const contenido: Actor = { wallet: "W_CONTENIDO", isFounder: false };

describe("WP17 · entornos por cliente", () => {
  let db: DB;
  let clienteUno: number;

  beforeEach(() => {
    db = freshDb();
    clienteUno = createClient(db, { name: "Cliente Uno", status: "activo", industry: "distribución" });
    addMember(db, clienteUno, "W_PLATAFORMA", "lead");
    addMember(db, clienteUno, "W_OPERACIONES", "colaborador");
    addMember(db, clienteUno, "W_CONTENIDO", "lectura");
  });

  it("un no-miembro no ve el cliente ni en listados ni por URL directa", () => {
    const otro = createClient(db, { name: "Cliente Ajeno" });
    addMember(db, otro, "W_OPERACIONES", "lead");

    // Plataforma no participa en 'Cliente Ajeno'.
    expect(listClientsFor(db, plataforma).map((c) => c.slug)).toEqual(["cliente-uno"]);
    // Por URL directa: null → la vista responde 404, no 403. El cliente no se revela.
    expect(getClientForActor(db, "cliente-ajeno", plataforma)).toBeNull();
    expect(accessLevelFor(db, otro, plataforma)).toBeNull();
  });

  it("el founder ve todos los clientes", () => {
    createClient(db, { name: "Otro" });
    expect(listClientsFor(db, fundador)).toHaveLength(2);
    expect(accessLevelFor(db, clienteUno, fundador)).toBe("lead");
  });

  it("el nivel 'lectura' NO accede al inventario de credenciales (a nivel de datos, no de UI)", () => {
    addCredential(
      db,
      clienteUno,
      { name: "Shopify Admin API", type: "api", location: "Key Vault kv-ejemplo / cliente-uno-shopify-admin" },
      plataforma
    );
    expect(listCredentials(db, clienteUno, plataforma)).toHaveLength(1);
    expect(listCredentials(db, clienteUno, operaciones)).toHaveLength(1);
    expect(() => listCredentials(db, clienteUno, contenido)).toThrow(ClientAccessError);
  });

  it("'lectura' sí ve la marca: la restricción es del inventario, no del cliente entero", () => {
    addBrandAsset(db, clienteUno, { kind: "color", label: "Verde primario", value: "#3CE109" });
    expect(listBrandAssets(db, clienteUno, contenido)).toHaveLength(1);
  });

  it("solo un lead puede registrar credenciales", () => {
    const input = { name: "DB prod", type: "db", location: "Key Vault / cliente-uno-pg" };
    expect(() => addCredential(db, clienteUno, input, operaciones)).toThrow(ClientAccessError);
    expect(addCredential(db, clienteUno, input, plataforma)).toBeGreaterThan(0);
  });

  it("toda consulta al inventario queda registrada en el log de auditoría", () => {
    addCredential(db, clienteUno, { name: "Token de despliegue", type: "api", location: "1Password / bóveda Clientes" }, plataforma);
    listCredentials(db, clienteUno, plataforma);
    listCredentials(db, clienteUno, operaciones);
    const log = credentialAccessLog(db, clienteUno);
    expect(log).toHaveLength(2);
    expect(log.map((l) => l.wallet).sort()).toEqual(["W_OPERACIONES", "W_PLATAFORMA"]);
    expect(log.every((l) => l.action === "list")).toBe(true);
  });

  it("RECHAZA guardar un secreto en cualquier campo del inventario", () => {
    const casos = [
      { campo: "location", cred: { name: "Shopify", type: "api", location: "shpat_" + "a".repeat(32) } },
      {
        campo: "notes",
        cred: {
          name: "Servidor",
          type: "servidor",
          location: "Key Vault / x",
          notes: "usar postgres://admin:sup3rclave@db.cliente-uno.test:5432/odoo",
        },
      },
      {
        campo: "scope",
        cred: { name: "GH", type: "api", location: "1Password", scope: "ghp_" + "b".repeat(36) },
      },
    ];
    for (const c of casos) {
      expect(() => addCredential(db, clienteUno, c.cred as never, plataforma)).toThrow(ClientError);
    }
    // Y nada se escribió.
    expect(listCredentials(db, clienteUno, plataforma)).toHaveLength(0);
  });

  it("acepta una referencia legible que NO es un secreto", () => {
    const id = addCredential(
      db,
      clienteUno,
      {
        name: "Azure SQL producción",
        type: "db",
        location: "Key Vault kv-ejemplo / secret cliente-uno-sql-prod (managed identity)",
        scope: "db_datareader",
        notes: "Rota cada 90 días. Dueño: TI del cliente.",
      },
      plataforma
    );
    expect(id).toBeGreaterThan(0);
  });
});

describe("garantía de cero secretos en el esquema (criterio de aceptación automatizado)", () => {
  it("ninguna columna del esquema puede almacenar un secreto", () => {
    const sql = fs.readFileSync(SCHEMA, "utf8");
    const hallazgos = auditSchemaForSecretColumns(sql);
    // Si esto falla, el PR NO se mergea: alguien añadió una columna de secreto.
    expect(hallazgos, `Columnas sospechosas: ${hallazgos.join(", ")}`).toEqual([]);
  });

  it("las excepciones están documentadas una por una, con motivo", () => {
    for (const [col, motivo] of Object.entries(EXCEPCIONES_AUDITORIA)) {
      expect(col).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(motivo.length).toBeGreaterThan(20);
    }
  });

  it("el auditor detecta de verdad una columna de secreto (control negativo)", () => {
    const malo = `CREATE TABLE IF NOT EXISTS fuga (
      id INTEGER PRIMARY KEY,
      api_key TEXT NOT NULL,
      location TEXT
    );`;
    expect(auditSchemaForSecretColumns(malo)).toEqual(["fuga.api_key"]);
  });

  it("no marca como secreto una columna que es una referencia", () => {
    const bueno = `CREATE TABLE IF NOT EXISTS ok (
      id INTEGER PRIMARY KEY,
      vault_ref TEXT,
      secret_location TEXT,
      token_name TEXT
    );`;
    expect(auditSchemaForSecretColumns(bueno)).toEqual([]);
  });

  it("findSecretLike reconoce los formatos comunes", () => {
    expect(findSecretLike("shpat_" + "0".repeat(32))).toMatch(/Shopify/);
    expect(findSecretLike("-----BEGIN RSA PRIVATE KEY-----")).toMatch(/privada/);
    expect(findSecretLike("Key Vault kv-ejemplo / cliente-uno-shopify")).toBeNull();
    expect(findSecretLike(null)).toBeNull();
  });
});
