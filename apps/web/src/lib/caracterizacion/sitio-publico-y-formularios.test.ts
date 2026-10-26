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
 * cambio de comportamiento queda a la vista. Los marcados "ARREGLADO" eran hallazgos que
 * el release wp/32-release corrigió (A3: autorización de datos obligatoria y probada,
 * dab355c; IP del límite, 05a2f4e; proyectos sembrados en borrador, 2c049eb; whitepaper
 * fuera del sitio, 67a78df) y ahora fijan el arreglo.
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
vi.mock("@/lib/consentimiento", () => import("../consentimiento"));

import { openDb, type DB } from "../db";
import { seedIfEmpty } from "../seed";
import { POST as postContacto } from "../../../app/api/empresas/contacto/route";
import { POST as postAviso } from "../../../app/api/encuentros/aviso/route";
import { INTERESES, INTERES_ENCUENTROS, SLUGS_INTERES, nombreInteres } from "../servicios";
import { AVISO_LEGAL, FOOTER_GRUPOS, MENU_EMPRESAS, MENU_PUBLICO, URL_LICENCIA, menuPara } from "../menu";
import { ENCUENTROS, diasPara, proximosEncuentros } from "../encuentros";
import { cifrasEnVivo } from "../prueba-en-vivo";
import { responsableTratamiento } from "../legal";
import { AVISO_PRIVACIDAD_VERSION, MENSAJE_AVISO_CAMBIO, MENSAJE_SIN_AUTORIZACION } from "../aviso-privacidad";
import { avisoVigente } from "../consentimiento";

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
const consentimientos = () =>
  db.prepare(`SELECT lead_id, formulario, aviso_version, aviso_sha256, accepted_at FROM lead_consents ORDER BY id`).all() as Array<{
    lead_id: number;
    formulario: string;
    aviso_version: string;
    aviso_sha256: string;
    accepted_at: string;
  }>;

/** Lo que manda la casilla marcada desde dab355c (A3): `acepto: true` y la versión del aviso. */
const AUTORIZA = { acepto: true, aviso: AVISO_PRIVACIDAD_VERSION } as const;

/** Copia de `o` sin la clave `k` (lo que manda un cliente que no la envía). */
function sinCampo<T extends object>(o: T, k: keyof T): Partial<T> {
  const copia: Partial<T> = { ...o };
  delete copia[k];
  return copia;
}

const SOLICITUD = {
  nombre: "  Persona de Prueba  ",
  email: "persona@ejemplo.test",
  empresa: "Operador de Prueba",
  interes: "wms",
  mensaje: "Dos bodegas y veinte personas en piso.",
  sitio: "",
  ...AUTORIZA,
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
    expect(filas[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/); // UTC (instanteDb)
    // Y, junto a ella, la prueba de la autorización (A3).
    expect(consentimientos()).toEqual([
      {
        lead_id: filas[0].id,
        formulario: "empresas/contacto",
        aviso_version: AVISO_PRIVACIDAD_VERSION,
        aviso_sha256: avisoVigente().huella,
        accepted_at: filas[0].created_at,
      },
    ]);
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

  it("ARREGLADO (A3): sin la casilla de autorización la ruta responde 400 y no guarda nada; con una versión vieja del aviso, 409", async () => {
    // dab355c: antes la casilla solo vivía en el navegador y la ruta guardaba igual.
    const sinCasilla = sinCampo(SOLICITUD, "acepto");
    for (const cuerpo of [sinCasilla, { ...SOLICITUD, acepto: false }, { ...SOLICITUD, acepto: "si" }]) {
      const res = await postContacto(peticion("/api/empresas/contacto", cuerpo, ipNueva()));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: MENSAJE_SIN_AUTORIZACION });
    }
    const vieja = await postContacto(peticion("/api/empresas/contacto", { ...SOLICITUD, aviso: "2020-01-01" }, ipNueva()));
    expect(vieja.status).toBe(409);
    expect(await vieja.json()).toEqual({ error: MENSAJE_AVISO_CAMBIO });
    expect(leads()).toHaveLength(0);
    expect(consentimientos()).toHaveLength(0);
    // Sin `aviso` (cliente viejo) se toma la versión vigente, que es la que enlaza la casilla.
    const sinVersion = sinCampo(SOLICITUD, "aviso");
    expect((await postContacto(peticion("/api/empresas/contacto", sinVersion, ipNueva()))).status).toBe(200);
    expect(consentimientos().map((c) => c.aviso_version)).toEqual([AVISO_PRIVACIDAD_VERSION]);
    // La prueba no guarda la IP ni datos del navegador.
    const columnas = (db.prepare(`PRAGMA table_info(lead_consents)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(columnas).toEqual(["id", "lead_id", "formulario", "aviso_version", "aviso_sha256", "accepted_at"]);
  });

  it("ARREGLADO: la IP del límite es el ÚLTIMO valor de X-Forwarded-For (el que agrega el proxy), no el que manda quien llama", async () => {
    // 05a2f4e: antes anteponer otra "IP" abría un contador nuevo.
    const real = ipNueva();
    for (let i = 0; i < 5; i++) await postContacto(peticion("/api/empresas/contacto", SOLICITUD, real));
    expect((await postContacto(peticion("/api/empresas/contacto", SOLICITUD, real))).status).toBe(429);
    // Misma IP real al final de la cadena, otra "IP" inventada al principio: sigue limitada.
    const res = await postContacto(peticion("/api/empresas/contacto", SOLICITUD, `${ipNueva()}, ${real}`));
    expect(res.status).toBe(429);
    expect(leads()).toHaveLength(5);
  });
});

describe("aviso de /encuentros → POST /api/encuentros/aviso → leads (interes = 'encuentros')", () => {
  it("guarda nombre y correo; empresa NULL; la ciudad va en `mensaje` como 'Ciudad: …'", async () => {
    const res = await postAviso(
      peticion(
        "/api/encuentros/aviso",
        { nombre: "Persona Aviso", email: "aviso@ejemplo.test", ciudad: " Bogotá ", sitio: "", ...AUTORIZA },
        ipNueva()
      )
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
    expect(consentimientos()).toMatchObject([{ lead_id: leads()[0].id, formulario: "encuentros", aviso_version: AVISO_PRIVACIDAD_VERSION }]);
  });

  it("ARREGLADO (A3): el aviso de encuentros sin la casilla → 400 y nada guardado", async () => {
    const res = await postAviso(peticion("/api/encuentros/aviso", { nombre: "Persona", email: "p@ejemplo.test" }, ipNueva()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: MENSAJE_SIN_AUTORIZACION });
    expect(leads()).toHaveLength(0);
  });

  it("sin ciudad, `mensaje` queda NULL", async () => {
    await postAviso(peticion("/api/encuentros/aviso", { nombre: "Sin Ciudad", email: "sc@ejemplo.test", ...AUTORIZA }, ipNueva()));
    expect(leads()[0].mensaje).toBeNull();
  });

  it("campo trampa lleno → 200 sin guardar; correo inválido → 400 'Revisa el correo.'", async () => {
    const trampa = await postAviso(
      peticion("/api/encuentros/aviso", { nombre: "Bot", email: "bot@ejemplo.test", sitio: "x", ...AUTORIZA }, ipNueva())
    );
    expect(trampa.status).toBe(200);
    // Sin la casilla, el error que se ve es el del dato (la autorización va al final del esquema).
    const malo = await postAviso(peticion("/api/encuentros/aviso", { nombre: "Persona", email: "x" }, ipNueva()));
    expect(malo.status).toBe(400);
    expect(await malo.json()).toEqual({ error: "Revisa el correo." });
    expect(leads()).toHaveLength(0);
  });

  it("su límite es aparte del de contacto (prefijo 'aviso:' contra 'lead:')", async () => {
    const ip = ipNueva();
    for (let i = 0; i < 5; i++) await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ip));
    expect((await postContacto(peticion("/api/empresas/contacto", SOLICITUD, ip))).status).toBe(429);
    const aviso = await postAviso(peticion("/api/encuentros/aviso", { nombre: "Persona", email: "p@ejemplo.test", ...AUTORIZA }, ip));
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

  it("con sesión de comunidad (sin acceso al trabajo): Ágora, Academia y Comunidad (los ritos)", () => {
    const m = menuPara({ ruta: "/", conSesion: true, accesoEquipo: false, esInterno: false, puedeVerTodo: false });
    // WP33: con sesión, "Comunidad" lleva a los ritos; /comunidad es la landing en inglés.
    expect(m.map((e) => e.href)).toEqual(["/agora", "/academia", "/comunidad/ritos"]);
  });

  it("el pie trae el grupo Legal (acuerdo, privacidad, licencia) y el de Empresas; el aviso de red de pruebas", () => {
    const legal = FOOTER_GRUPOS.find((x) => x.titulo === "Legal");
    expect(legal?.enlaces.map((e) => e.href)).toEqual(["/acuerdo", "/privacidad", URL_LICENCIA]);
    const empresas = FOOTER_GRUPOS.find((x) => x.titulo === "Empresas");
    expect(empresas?.enlaces.map((e) => e.href)).toEqual(["/empresas/servicios", "/empresas/contacto"]);
    expect(AVISO_LEGAL).toMatch(/red de pruebas de Stellar/);
    // 67a78df: el pie enlaza el manifiesto, ya no el whitepaper.
    const enlaces = FOOTER_GRUPOS.flatMap((x) => x.enlaces.map((e) => e.href));
    expect(enlaces).toContain("/manifiesto");
    expect(enlaces).not.toContain("/whitepaper");
  });

  it("redirecciones 308 de next.config.mjs, incluidas /whitepaper → /manifiesto y /equipo/seguimiento → /equipo/dashboard", async () => {
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
    // 67a78df: el whitepaper salió del sitio y su enlace viejo lleva al manifiesto.
    expect(r).toContainEqual({ source: "/whitepaper", destination: "/manifiesto", permanent: true });
    // 4032c7c: la pantalla de seguimiento de la línea anterior la reemplaza el tablero.
    expect(r).toContainEqual({ source: "/equipo/seguimiento", destination: "/equipo/dashboard", permanent: true });
    expect(fs.existsSync(path.join(process.cwd(), "app", "whitepaper"))).toBe(false);
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

  it("ARREGLADO: con la siembra demo no cuenta firmas, entregas ni proyectos sembrados (nacen en borrador)", () => {
    const sembrada = baseTemporal(true);
    const abiertos = (sembrada.prepare(`SELECT COUNT(*) AS n FROM projects WHERE state = 'Open'`).get() as { n: number }).n;
    expect(abiertos).toBeGreaterThan(0);
    // 2c049eb: los proyectos del seed nacen con draft = 1 y la landing cuenta solo los publicados.
    expect(sembrada.prepare(`SELECT COUNT(*) AS n FROM projects WHERE draft = 0`).get()).toEqual({ n: 0 });
    const c = cifrasEnVivo(sembrada);
    expect(c.firmasRegistradas).toBe(0); // las SEEDTX_… no son hash de Stellar y son de cuentas demo
    expect(c.entregasAprobadas).toBe(0);
    expect(c.ultimaFirmaAnclada).toBeNull();
    expect(c.proyectosAbiertos).toBe(0);
    // Publicado por el founder, cuenta.
    sembrada.prepare(`UPDATE projects SET draft = 0 WHERE id = (SELECT MIN(id) FROM projects WHERE state = 'Open')`).run();
    expect(cifrasEnVivo(sembrada).proyectosAbiertos).toBe(1);
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
