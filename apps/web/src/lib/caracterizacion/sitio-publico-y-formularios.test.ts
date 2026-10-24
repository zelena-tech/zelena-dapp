/**
 * Prueba de caracterización · Sitio público y formularios.
 * Ficha: docs/features/sitio-publico-y-formularios.md · DFD: docs/dfd/sitio-publico-y-formularios.json
 * Commit de referencia: 0e07d8f.
 *
 * Protege el comportamiento ACTUAL, no el deseado. Recorre el flujo principal del sitio
 * público que escribe en la base: el formulario de /empresas/contacto llama a
 * POST /api/empresas/contacto, que valida con zod (`leadSchema`), limita por IP y guarda
 * una fila en `leads`. También cubre el aviso de /encuentros (misma tabla), el menú, el
 * pie, las redirecciones y las cifras en vivo de la landing.
 *
 * Los casos marcados "HALLAZGO" fijan una rareza actual que la auditoría reporta. Si
 * alguien la corrige, esta prueba debe fallar y actualizarse en el mismo cambio: así el
 * cambio de comportamiento queda a la vista.
 *
 * Base: SQLite en memoria con `schema.sql` (el mismo patrón que academia.test.ts y
 * ritos.test.ts). La base se inyecta en `globalThis.__zelenaDb`, que es lo primero que
 * mira `getDb()` (lib/db.ts), así que las rutas reales escriben en ella.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

// Las rutas importan con el alias "@/lib/…" y vitest.config.ts no lo declara. Cada alias
// se redirige al módulo REAL (no es un doble): la ruta corre su código de verdad.
vi.mock("@/lib/db", () => import("../db"));
vi.mock("@/lib/validation", () => import("../validation"));
vi.mock("@/lib/rate-limit", () => import("../rate-limit"));
vi.mock("@/lib/servicios", () => import("../servicios"));

import { openDb, type DB } from "../db";
import { seedIfEmpty } from "../seed";
import { POST as postContacto } from "../../../app/api/empresas/contacto/route";
import { POST as postAviso } from "../../../app/api/encuentros/aviso/route";
import { INTERESES, INTERES_ENCUENTROS, SLUGS_INTERES, nombreInteres } from "../servicios";
import { AVISO_LEGAL, FOOTER_GRUPOS, MENU_EMPRESAS, MENU_PUBLICO, URL_LICENCIA, menuPara } from "../menu";
import { ENCUENTROS, diasPara, proximosEncuentros } from "../encuentros";
import { cifrasEnVivo } from "../prueba-en-vivo";
import { responsableTratamiento } from "../legal";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");

const g = globalThis as unknown as { __zelenaDb?: DB };
const dbPrevia = g.__zelenaDb;

function baseTemporal(conSiembra = false): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  if (conSiembra) seedIfEmpty(db, { NODE_ENV: "test" } as NodeJS.ProcessEnv);
  return db;
}

let db: DB;
let ipSiguiente = 1;

beforeEach(() => {
  db = baseTemporal();
  g.__zelenaDb = db;
});

afterAll(() => {
  g.__zelenaDb = dbPrevia;
});

/** Una IP nueva por caso: el límite de tasa vive en memoria del proceso (lib/rate-limit.ts). */
function ipNueva(): string {
  return `198.51.100.${ipSiguiente++}`;
}

function peticion(url: string, cuerpo: unknown, ip: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

type Lead = {
  id: number;
  nombre: string;
  email: string;
  empresa: string | null;
  interes: string;
  mensaje: string | null;
  estado: string;
  created_at: string;
};

const leads = (): Lead[] => db.prepare(`SELECT * FROM leads ORDER BY id`).all() as Lead[];

const SOLICITUD = {
  nombre: "  Persona de Prueba  ",
  email: "persona@ejemplo.test",
  empresa: "Operador de Prueba",
  interes: "wms",
  mensaje: "Dos bodegas y veinte personas en piso.",
  sitio: "",
};

describe("flujo principal · /empresas/contacto → POST /api/empresas/contacto → leads", () => {
  it("una solicitud válida responde 200 {ok:true} y deja UNA fila con estado 'nuevo'", async () => {
    const res = await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ipNueva()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const filas = leads();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      nombre: "Persona de Prueba", // zod hace trim
      email: "persona@ejemplo.test",
      empresa: "Operador de Prueba",
      interes: "wms",
      mensaje: "Dos bodegas y veinte personas en piso.",
      estado: "nuevo", // DEFAULT de schema.sql; ningún código lo cambia después
    });
    expect(filas[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); // UTC de SQLite
  });

  it("empresa y mensaje vacíos (opcionales) se guardan como NULL", async () => {
    const res = await postContacto(
      peticion("/api/empresas/contacto", { ...SOLICITUD, empresa: "", mensaje: "   " }, ipNueva())
    );
    expect(res.status).toBe(200);
    expect(leads()[0]).toMatchObject({ empresa: null, mensaje: null });
  });

  it("el selector ofrece Harmony, las seis líneas del catálogo y 'otro'; la ruta acepta solo esos slugs", () => {
    expect(INTERESES.map((i) => i.slug)).toEqual([
      "harmony",
      "gestion-ti",
      "odoo",
      "wms",
      "transformacion",
      "datos",
      "cloud",
      "otro",
    ]);
    expect(SLUGS_INTERES).not.toContain(INTERES_ENCUENTROS);
  });

  it("correo inválido → 400 con el mensaje en español que pinta ContactoForm", async () => {
    const res = await postContacto(peticion("/api/empresas/contacto", { ...SOLICITUD, email: "no-es-correo" }, ipNueva()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Revisa el correo." });
    expect(leads()).toHaveLength(0);
  });

  it("nombre de una letra → 400 'Escribe tu nombre.'", async () => {
    const res = await postContacto(peticion("/api/empresas/contacto", { ...SOLICITUD, nombre: "A" }, ipNueva()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Escribe tu nombre." });
  });

  it("interés fuera del catálogo (incluido 'encuentros') → 400 'Elige qué te interesa.'", async () => {
    for (const interes of ["inventado", INTERES_ENCUENTROS]) {
      const res = await postContacto(peticion("/api/empresas/contacto", { ...SOLICITUD, interes }, ipNueva()));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Elige qué te interesa." });
    }
    expect(leads()).toHaveLength(0);
  });

  it("cuerpo que no es JSON → 400 'Revisa los datos del formulario.'", async () => {
    const res = await postContacto(peticion("/api/empresas/contacto", "esto no es json", ipNueva()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Revisa los datos del formulario." });
  });

  it("campo trampa `sitio` lleno → 200 {ok:true} y NO guarda nada (no le da señal al bot)", async () => {
    const res = await postContacto(
      peticion("/api/empresas/contacto", { ...SOLICITUD, sitio: "https://spam.example" }, ipNueva())
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(leads()).toHaveLength(0);
  });

  it("límite por IP: 5 envíos cada 10 minutos; el 6.º → 429 y no se guarda", async () => {
    const ip = ipNueva();
    for (let i = 0; i < 5; i++) {
      expect((await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ip))).status).toBe(200);
    }
    const sexto = await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ip));
    expect(sexto.status).toBe(429);
    expect(await sexto.json()).toEqual({ error: "Demasiados envíos seguidos. Intenta de nuevo en unos minutos." });
    expect(leads()).toHaveLength(5);
  });

  it("HALLAZGO: la ruta no recibe ni guarda la casilla de autorización (Ley 1581); sin ella también guarda", async () => {
    // ContactoForm exige la casilla solo en el navegador (`required`) y no la envía.
    const res = await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ipNueva()));
    expect(res.status).toBe(200);
    const columnas = (db.prepare(`PRAGMA table_info(leads)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(columnas).toEqual(["id", "nombre", "email", "empresa", "interes", "mensaje", "estado", "created_at"]);
  });

  it("HALLAZGO: la IP del límite es el PRIMER valor de X-Forwarded-For (lo controla quien llama)", async () => {
    const real = ipNueva();
    for (let i = 0; i < 5; i++) await postContacto(peticion("/api/empresas/contacto", SOLICITUD, real));
    expect((await postContacto(peticion("/api/empresas/contacto", SOLICITUD, real))).status).toBe(429);
    // Misma IP real al final de la cadena, otra "IP" inventada al principio: pasa.
    const res = await postContacto(peticion("/api/empresas/contacto", SOLICITUD, `${ipNueva()}, ${real}`));
    expect(res.status).toBe(200);
  });
});

describe("aviso de /encuentros → POST /api/encuentros/aviso → leads (interes = 'encuentros')", () => {
  it("guarda nombre y correo; empresa NULL; la ciudad va en `mensaje` como 'Ciudad: …'", async () => {
    const res = await postAviso(
      peticion("/api/encuentros/aviso", { nombre: "Persona Aviso", email: "aviso@ejemplo.test", ciudad: " Bogotá ", sitio: "" }, ipNueva())
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(leads()[0]).toMatchObject({
      nombre: "Persona Aviso",
      email: "aviso@ejemplo.test",
      empresa: null,
      interes: "encuentros",
      mensaje: "Ciudad: Bogotá",
      estado: "nuevo",
    });
  });

  it("sin ciudad, `mensaje` queda NULL", async () => {
    await postAviso(peticion("/api/encuentros/aviso", { nombre: "Sin Ciudad", email: "sc@ejemplo.test" }, ipNueva()));
    expect(leads()[0].mensaje).toBeNull();
  });

  it("campo trampa lleno → 200 sin guardar; correo inválido → 400 'Revisa el correo.'", async () => {
    const trampa = await postAviso(
      peticion("/api/encuentros/aviso", { nombre: "Bot", email: "bot@ejemplo.test", sitio: "x" }, ipNueva())
    );
    expect(trampa.status).toBe(200);
    const malo = await postAviso(peticion("/api/encuentros/aviso", { nombre: "Persona", email: "x" }, ipNueva()));
    expect(malo.status).toBe(400);
    expect(await malo.json()).toEqual({ error: "Revisa el correo." });
    expect(leads()).toHaveLength(0);
  });

  it("su límite es aparte del de contacto (prefijo 'aviso:' contra 'lead:')", async () => {
    const ip = ipNueva();
    for (let i = 0; i < 5; i++) await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ip));
    expect((await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ip))).status).toBe(429);
    const aviso = await postAviso(peticion("/api/encuentros/aviso", { nombre: "Persona", email: "p@ejemplo.test" }, ip));
    expect(aviso.status).toBe(200);
  });

  it("/admin separa las dos listas por `interes` y les pone nombre con nombreInteres", () => {
    expect(nombreInteres(INTERES_ENCUENTROS)).toBe("Aviso de encuentros");
    expect(nombreInteres("wms")).toBe("WMS ZELENA");
    expect(nombreInteres("slug-desconocido")).toBe("slug-desconocido");
  });
});

describe("menú, pie y redirecciones", () => {
  it("sin sesión: las 4 puertas públicas, en orden", () => {
    expect(MENU_PUBLICO.map((e) => e.href)).toEqual(["/manifiesto", "/metodo", "/comunidad", "/empresas"]);
    const m = menuPara({ ruta: "/", conSesion: false, accesoEquipo: true, esInterno: true, puedeVerTodo: true });
    expect(m).toEqual([...MENU_PUBLICO]); // sin sesión, los flags no abren nada
  });

  it("en /empresas* el menú es el de empresas, con o sin sesión", () => {
    for (const ruta of ["/empresas", "/empresas/servicios", "/empresas/contacto"]) {
      expect(menuPara({ ruta, conSesion: false, accesoEquipo: false, esInterno: false, puedeVerTodo: false })).toEqual([
        ...MENU_EMPRESAS,
      ]);
      expect(menuPara({ ruta, conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo: true })).toEqual([
        ...MENU_EMPRESAS,
      ]);
    }
  });

  it("con sesión de comunidad (sin acceso al trabajo): Ágora, Academia y Comunidad", () => {
    const m = menuPara({ ruta: "/", conSesion: true, accesoEquipo: false, esInterno: false, puedeVerTodo: false });
    expect(m.map((e) => e.href)).toEqual(["/agora", "/academia", "/comunidad"]);
  });

  it("el pie trae el grupo Legal (acuerdo, privacidad, licencia) y el de Empresas; el aviso de red de pruebas", () => {
    const legal = FOOTER_GRUPOS.find((x) => x.titulo === "Legal");
    expect(legal?.enlaces.map((e) => e.href)).toEqual(["/acuerdo", "/privacidad", URL_LICENCIA]);
    const empresas = FOOTER_GRUPOS.find((x) => x.titulo === "Empresas");
    expect(empresas?.enlaces.map((e) => e.href)).toEqual(["/empresas/servicios", "/empresas/contacto"]);
    expect(AVISO_LEGAL).toMatch(/red de pruebas de Stellar/);
  });

  it("redirecciones 308 de next.config.mjs (y, si ya existe, /whitepaper → /manifiesto)", async () => {
    const mod = (await import("../../../next.config.mjs")) as {
      default: { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    };
    const r = await mod.default.redirects();
    expect(r).toContainEqual({ source: "/ecosistema", destination: "/metodo", permanent: true });
    expect(r).toContainEqual({
      source: "/academia/por-que-sas-dao",
      destination: "/academia/construir-sin-riesgo",
      permanent: true,
    });
    // El retiro del whitepaper va en otra rama: cuando llegue, la redirección debe ser permanente y a /manifiesto.
    const wp = r.find((x) => x.source === "/whitepaper");
    if (wp) expect(wp).toEqual({ source: "/whitepaper", destination: "/manifiesto", permanent: true });
  });
});

describe("landing y páginas que leen datos", () => {
  it("cifras en vivo en una base vacía: todo en cero y sin firma que mostrar", () => {
    expect(cifrasEnVivo(db)).toEqual({
      proyectosAbiertos: 0,
      entregasAprobadas: 0,
      firmasRegistradas: 0,
      ultimaFirmaAnclada: null,
    });
  });

  it("con la siembra demo: no cuenta firmas ni entregas de cuentas demo, pero SÍ cuenta sus proyectos abiertos", () => {
    const sembrada = baseTemporal(true);
    const abiertos = (sembrada.prepare(`SELECT COUNT(*) AS n FROM projects WHERE state = 'Open'`).get() as { n: number }).n;
    const c = cifrasEnVivo(sembrada);
    expect(c.firmasRegistradas).toBe(0); // las SEEDTX_… no son hash de Stellar y son de cuentas demo
    expect(c.entregasAprobadas).toBe(0);
    expect(c.ultimaFirmaAnclada).toBeNull();
    expect(c.proyectosAbiertos).toBe(abiertos); // HALLAZGO: el conteo de proyectos no filtra lo demo
  });

  it("una firma real anclada (tx de 64 hex, cuenta no demo) cuenta y es la que muestra la tarjeta", () => {
    const tx = "a".repeat(64);
    db.prepare(`INSERT INTO users (wallet, display_name, is_demo, cla_signed) VALUES ('GREAL', 'Real', 0, 1)`).run();
    db.prepare(`INSERT INTO users (wallet, display_name, is_demo, cla_signed) VALUES ('GDEMO', 'Demo', 1, 1)`).run();
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_hash, signature, anchor_status, tx_id, signed_at) VALUES ('GREAL', 'h', 's', 'anchored', ?, '2026-10-01 10:00:00')`
    ).run(tx);
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_hash, signature, anchor_status, tx_id) VALUES ('GDEMO', 'h', 's', 'anchored', ?)`
    ).run("b".repeat(64));
    const c = cifrasEnVivo(db);
    expect(c.firmasRegistradas).toBe(1);
    expect(c.ultimaFirmaAnclada).toEqual({ tx, fecha: "2026-10-01" });
  });

  it("encuentros: la lista publicada está vacía, así que la landing ofrece 'Ven a la próxima demo'", () => {
    expect(ENCUENTROS).toEqual([]);
    expect(proximosEncuentros()).toEqual([]);
    expect(diasPara("2026-10-22", new Date("2026-10-21T12:00:00Z"))).toBe(1);
    expect(diasPara("2026-10-20", new Date("2026-10-21T12:00:00Z"))).toBe(-1);
  });

  it("/privacidad: sin configuración dice 'Zelena' y manda al formulario; con ella, nombre y correo del entorno", () => {
    expect(responsableTratamiento({} as NodeJS.ProcessEnv)).toEqual({ nombre: "Zelena", contacto: null });
    expect(
      responsableTratamiento({
        ZELENA_LEGAL_NAME: " Responsable ",
        ZELENA_PRIVACY_EMAIL: " datos@ejemplo.test ",
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ nombre: "Responsable", contacto: "datos@ejemplo.test" });
  });
});
