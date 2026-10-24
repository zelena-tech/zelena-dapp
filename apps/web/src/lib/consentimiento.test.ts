/**
 * Hallazgo A3 (auditoría 2026-10-21) · prueba de la autorización de datos (Ley 1581).
 *
 *  1. Las APIs de /empresas/contacto y /encuentros RECHAZAN (400, texto claro) una
 *     solicitud sin la casilla marcada, y no guardan nada.
 *  2. Con la casilla, la solicitud y su prueba (versión y huella del aviso de
 *     /privacidad vigente, fecha UTC) se guardan juntas; `lead_consents` es de solo
 *     inserción y no guarda la IP.
 *  3. El texto del aviso está versionado: cambiarlo obliga a subir la versión.
 *  4. Sobre una base con el esquema de PRODUCCIÓN (fixture 58ee2fd) el arranque crea la
 *     tabla nueva sin tocar `leads`, y el segundo arranque no hace nada.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { openDb, prepararSqlite, type DB } from "./db";
import { leadSchema, avisoEncuentrosSchema } from "./validation";
import {
  AVISO_PRIVACIDAD,
  AVISO_PRIVACIDAD_VERSION,
  MENSAJE_AVISO_CAMBIO,
  MENSAJE_SIN_AUTORIZACION,
  textoCanonicoAviso,
  textoFijoAviso,
} from "./aviso-privacidad";
import { avisoVigente, guardarSolicitudConAutorizacion, pruebaDeAutorizacion } from "./consentimiento";

const WEB = process.cwd(); // apps/web
const LIB = path.join(WEB, "src", "lib");
const ESQUEMA = fs.readFileSync(path.join(LIB, "schema.sql"), "utf8");
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

function baseNueva(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(ESQUEMA);
  return db;
}

const cuenta = (db: DB, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

/* ------------------------------------------------------------------ *
 * Las rutas reales, con la base de la prueba (el alias `@/` no existe en vitest).
 * ------------------------------------------------------------------ */
const estado = vi.hoisted(() => ({ db: null as unknown as DB }));
vi.mock("@/lib/db", () => ({ getDb: () => estado.db }));
vi.mock("@/lib/validation", async () => await import("./validation"));
vi.mock("@/lib/rate-limit", async () => await import("./rate-limit"));
vi.mock("@/lib/consentimiento", async () => await import("./consentimiento"));
vi.mock("@/lib/servicios", async () => await import("./servicios"));

import { POST as postContacto } from "../../app/api/empresas/contacto/route";
import { POST as postAviso } from "../../app/api/encuentros/aviso/route";

let ip = 0;
function pedido(url: string, body: unknown): NextRequest {
  ip += 1; // cada envío con su IP: el límite por IP no interfiere entre casos
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(ip / 250)}.${ip % 250}` },
    body: JSON.stringify(body),
  });
}

const CONTACTO = { nombre: "Ana Prueba", email: "ana@ejemplo.test", empresa: "Bodegas X", interes: "harmony", mensaje: "Hola" };
const AVISO = { nombre: "Beto Prueba", email: "beto@ejemplo.test", ciudad: "Bogotá" };

describe("A3 · la API rechaza la solicitud sin la casilla (400, texto claro, nada guardado)", () => {
  beforeEach(() => {
    estado.db = baseNueva();
  });

  const casos: Array<[string, Record<string, unknown>]> = [
    ["sin el campo", {}],
    ["con false", { acepto: false }],
    ["con el texto 'true'", { acepto: "true" }],
    ["con 1", { acepto: 1 }],
  ];

  for (const [nombre, extra] of casos) {
    it(`/api/empresas/contacto ${nombre}`, async () => {
      const res = await postContacto(pedido("/api/empresas/contacto", { ...CONTACTO, ...extra }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: MENSAJE_SIN_AUTORIZACION });
      expect(cuenta(estado.db, "leads")).toBe(0);
      expect(cuenta(estado.db, "lead_consents")).toBe(0);
    });

    it(`/api/encuentros/aviso ${nombre}`, async () => {
      const res = await postAviso(pedido("/api/encuentros/aviso", { ...AVISO, ...extra }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: MENSAJE_SIN_AUTORIZACION });
      expect(cuenta(estado.db, "leads")).toBe(0);
      expect(cuenta(estado.db, "lead_consents")).toBe(0);
    });
  }

  it("el mensaje dice qué hacer", () => {
    expect(MENSAJE_SIN_AUTORIZACION).toMatch(/marca la casilla/);
    expect(MENSAJE_SIN_AUTORIZACION).toMatch(/aviso de privacidad/);
  });

  it("si además falta un dato, se ve primero el error del dato (la casilla va al final)", () => {
    const r = leadSchema.safeParse({ ...CONTACTO, nombre: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Escribe tu nombre.");
    const a = avisoEncuentrosSchema.safeParse({ ...AVISO, email: "no" });
    expect(a.success).toBe(false);
    if (!a.success) expect(a.error.issues[0].message).toBe("Revisa el correo.");
  });

  it("una página vieja (otra versión del aviso) recibe 409 y no se guarda nada", async () => {
    const res = await postContacto(
      pedido("/api/empresas/contacto", { ...CONTACTO, acepto: true, aviso: "2020-01-01" })
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: MENSAJE_AVISO_CAMBIO });
    const res2 = await postAviso(pedido("/api/encuentros/aviso", { ...AVISO, acepto: true, aviso: "2020-01-01" }));
    expect(res2.status).toBe(409);
    expect(cuenta(estado.db, "leads")).toBe(0);
  });
});

describe("A3 · con la casilla se guarda la solicitud con su prueba", () => {
  beforeEach(() => {
    estado.db = baseNueva();
  });

  it("/api/empresas/contacto: lead + prueba con versión, huella y fecha UTC; sin IP", async () => {
    const antes = Date.now();
    const res = await postContacto(
      pedido("/api/empresas/contacto", { ...CONTACTO, acepto: true, aviso: AVISO_PRIVACIDAD_VERSION })
    );
    expect(res.status).toBe(200);
    const lead = estado.db.prepare(`SELECT * FROM leads`).get() as { id: number; email: string; created_at: string };
    expect(lead.email).toBe("ana@ejemplo.test");
    const prueba = pruebaDeAutorizacion(estado.db, lead.id)!;
    expect(prueba).toMatchObject({
      formulario: "empresas/contacto",
      aviso_version: AVISO_PRIVACIDAD_VERSION,
      aviso_sha256: avisoVigente().huella,
    });
    // UTC, en el formato de los defaults de la base, y del mismo instante que la solicitud.
    expect(prueba.accepted_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(prueba.accepted_at).toBe(lead.created_at);
    const instante = Date.parse(prueba.accepted_at.replace(" ", "T") + "Z");
    expect(instante).toBeGreaterThanOrEqual(Math.floor(antes / 1000) * 1000);
    expect(instante).toBeLessThanOrEqual(Date.now());
    // Ninguna columna de la prueba guarda la IP (ni nada parecido).
    const cols = (estado.db.prepare(`PRAGMA table_info(lead_consents)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "lead_id", "formulario", "aviso_version", "aviso_sha256", "accepted_at"]);
    const fila = JSON.stringify(estado.db.prepare(`SELECT * FROM lead_consents`).all());
    expect(fila).not.toContain("10.0.");
  });

  it("/api/encuentros/aviso: igual, con su formulario; sin `aviso` se toma la versión vigente", async () => {
    const res = await postAviso(pedido("/api/encuentros/aviso", { ...AVISO, acepto: true }));
    expect(res.status).toBe(200);
    const lead = estado.db.prepare(`SELECT id, interes, mensaje FROM leads`).get() as { id: number; interes: string; mensaje: string };
    expect(lead).toMatchObject({ interes: "encuentros", mensaje: "Ciudad: Bogotá" });
    expect(pruebaDeAutorizacion(estado.db, lead.id)).toMatchObject({
      formulario: "encuentros",
      aviso_version: AVISO_PRIVACIDAD_VERSION,
    });
  });

  it("el campo trampa lleno responde ok y no guarda nada, ni con la casilla", async () => {
    const res = await postContacto(pedido("/api/empresas/contacto", { ...CONTACTO, acepto: true, sitio: "http://spam" }));
    expect(res.status).toBe(200);
    expect(cuenta(estado.db, "leads")).toBe(0);
    expect(cuenta(estado.db, "lead_consents")).toBe(0);
  });

  it("solicitud y prueba van en una transacción: si la prueba no se puede guardar, no queda la solicitud", () => {
    const db = baseNueva();
    db.exec(`DROP TABLE lead_consents`);
    expect(() =>
      guardarSolicitudConAutorizacion(
        db,
        { nombre: "C", email: "c@ejemplo.test", empresa: null, interes: "wms", mensaje: null },
        "empresas/contacto"
      )
    ).toThrow();
    expect(cuenta(db, "leads")).toBe(0);
  });

  it("la fecha sale de zona-horaria (UTC) aunque se inyecte otro instante", () => {
    const db = baseNueva();
    const g = guardarSolicitudConAutorizacion(
      db,
      { nombre: "D", email: "d@ejemplo.test", empresa: null, interes: "wms", mensaje: null },
      "encuentros",
      { ahora: new Date("2026-10-21T23:30:00-05:00") }
    );
    expect(g.aceptadoEn).toBe("2026-10-22 04:30:00");
    expect(pruebaDeAutorizacion(db, g.leadId)?.accepted_at).toBe("2026-10-22 04:30:00");
  });
});

describe("A3 · la huella identifica el texto exacto del aviso", () => {
  it("cambia con el responsable o con una letra del texto", () => {
    const base = textoCanonicoAviso({ nombre: "Zelena", contacto: null });
    expect(textoCanonicoAviso({ nombre: "Otra", contacto: null })).not.toBe(base);
    expect(textoCanonicoAviso({ nombre: "Zelena", contacto: "a@b.test" })).not.toBe(base);
    expect(avisoVigente({ ZELENA_LEGAL_NAME: "Zelena" } as unknown as NodeJS.ProcessEnv).huella).toBe(
      createHash("sha256").update(base).digest("hex")
    );
  });

  it("el texto fijo está congelado en su versión: si lo cambias, sube AVISO_PRIVACIDAD_VERSION y esta huella", () => {
    const huella = createHash("sha256").update(textoFijoAviso()).digest("hex");
    expect({ version: AVISO_PRIVACIDAD_VERSION, huella }).toEqual({
      version: "2026-10-21",
      huella: "217002405dae5920514e41b50795d7dbc28a684e5e835d2948b9edf866041418",
    });
  });

  it("/privacidad dice exactamente qué se guarda como prueba (versión, huella, fecha UTC) y que no se guarda la IP", () => {
    const aut = AVISO_PRIVACIDAD.autorizacion.join(" ");
    expect(aut).toContain("la versión de este aviso que aceptaste, su huella");
    expect(aut).toContain("la fecha y hora en que lo aceptaste, en UTC");
    expect(aut).toContain("ni tu dirección IP");
    expect(aut).toContain("el servidor la rechaza y no guarda nada");
    expect(AVISO_PRIVACIDAD.derechos.join(" ")).toContain("pedir prueba de esa autorización");
    const pagina = leer("app/privacidad/page.tsx");
    expect(pagina).toContain("AVISO_PRIVACIDAD.autorizacion.map(parrafo)");
    expect(pagina).toContain("Versión de este aviso: {AVISO_PRIVACIDAD_VERSION}");
    expect(pagina).toContain("avisoVigente()");
  });
});

describe("A3 · los formularios envían la casilla y `lead_consents` es de solo inserción", () => {
  for (const form of ["src/components/ContactoForm.tsx", "src/components/AvisoEncuentrosForm.tsx"]) {
    it(`${form} manda acepto y la versión del aviso`, () => {
      const src = leer(form);
      expect(src).toContain('name="acepto"');
      expect(src).toContain('namedItem("acepto")');
      expect(src).toMatch(/JSON\.stringify\(\{[^}]*\bacepto, aviso: AVISO_PRIVACIDAD_VERSION \}\)/);
    });
  }

  it("ningún archivo del código actualiza ni borra lead_consents", () => {
    const recorrer = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? recorrer(p) : /\.(ts|tsx|mjs|sql)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
      });
    const archivos = [...recorrer(path.join(WEB, "app")), ...recorrer(path.join(WEB, "src"))];
    const malos = archivos.filter((f) => /(UPDATE\s+lead_consents|DELETE\s+FROM\s+lead_consents)/i.test(fs.readFileSync(f, "utf8")));
    expect(malos).toEqual([]);
    expect(leer("app/api/empresas/contacto/route.ts")).not.toMatch(/INSERT INTO leads/);
    expect(leer("app/api/encuentros/aviso/route.ts")).not.toMatch(/INSERT INTO leads/);
  });
});

describe("A3 · sobre una base con el esquema de producción", () => {
  const FIXTURE = fs.readFileSync(path.join(LIB, "__fixtures__", "schema-58ee2fd.sql"), "utf8");
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-a3-"));
    file = path.join(dir, "zelena.db");
  });
  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows puede retener el archivo */
    }
  });

  it("el arranque crea lead_consents, no toca leads y el segundo arranque no cambia nada", () => {
    const db = openDb(file);
    db.exec(FIXTURE);
    db.exec(
      `INSERT INTO leads (nombre, email, interes, mensaje, created_at) VALUES ('Prospecto', 'p@ejemplo.test', 'wms', 'hola', '2026-09-01 10:00:00')`
    );
    const leadsAntes = JSON.stringify(db.prepare(`SELECT * FROM leads ORDER BY id`).all());

    prepararSqlite(db, { archivo: file, founderWallet: null, sembrar: false });
    expect(JSON.stringify(db.prepare(`SELECT * FROM leads ORDER BY id`).all())).toBe(leadsAntes);
    expect(cuenta(db, "lead_consents")).toBe(0); // lo viejo no inventa pruebas que no hubo

    const g = guardarSolicitudConAutorizacion(
      db,
      { nombre: "Nueva", email: "n@ejemplo.test", empresa: null, interes: "wms", mensaje: null },
      "empresas/contacto"
    );
    expect(pruebaDeAutorizacion(db, g.leadId)?.aviso_version).toBe(AVISO_PRIVACIDAD_VERSION);
    expect(db.prepare(`PRAGMA foreign_key_check`).all()).toEqual([]);

    const tras1 = JSON.stringify([
      db.prepare(`SELECT * FROM leads ORDER BY id`).all(),
      db.prepare(`SELECT * FROM lead_consents ORDER BY id`).all(),
    ]);
    const inf2 = prepararSqlite(db, { archivo: file, founderWallet: null, sembrar: false });
    expect(inf2.migro).toBe(false);
    expect(
      JSON.stringify([
        db.prepare(`SELECT * FROM leads ORDER BY id`).all(),
        db.prepare(`SELECT * FROM lead_consents ORDER BY id`).all(),
      ])
    ).toBe(tras1);
  });
});
