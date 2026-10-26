/**
 * Prueba de caracterización · feature `login-y-sesion`
 * Ficha: docs/features/login-y-sesion.md · DFD: docs/dfd/login-y-sesion.json
 *
 * Recorre el FLUJO PRINCIPAL de punta a punta, llamando a los handlers reales de
 * `app/api/**` y al `middleware.ts`, contra una base SQLite TEMPORAL arrancada con la
 * misma secuencia que producción (`prepararSqlite`: schema + migraciones + seed):
 *
 *   /api/invite/verify → /api/cla → (firma en el navegador) → /api/onboard
 *   → cookie `zelena_session` → middleware → puertas de authz → /api/logout
 *   → /api/login/reto → (firma del reto) → /api/login
 *
 * Protege el comportamiento ACTUAL, no el deseado. Los `it` marcados "HALLAZGO"
 * fijan conductas que la ficha reporta como problema: si alguien las corrige, este
 * test debe fallar y la ficha debe actualizarse en el mismo cambio. Los marcados
 * "ARREGLADO" eran hallazgos que el release (wp/32-release) corrigió: ahora fijan el
 * arreglo, para que no vuelva el comportamiento viejo.
 *
 * Cómo se aísla de Next sin tocar la app:
 *  - `next/headers` se sustituye por un tarro de cookies en memoria (las rutas usan
 *    `cookies()` a través de `lib/session.ts`);
 *  - los alias `@/lib/*` de las rutas se resuelven a los módulos REALES (vitest no
 *    lee los `paths` de tsconfig);
 *  - `getDb()` devuelve la base temporal (se fija `globalThis.__zelenaDb`).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { NextRequest } from "next/server";

const tarro = vi.hoisted(() => {
  const valores = new Map<string, string>();
  const opciones = new Map<string, unknown>();
  return {
    valores,
    opciones,
    api: {
      get: (n: string) => (valores.has(n) ? { name: n, value: valores.get(n)! } : undefined),
      set: (n: string, v: string, o?: unknown) => {
        valores.set(n, v);
        opciones.set(n, o);
      },
      delete: (n: string) => {
        valores.delete(n);
      },
    },
  };
});

vi.mock("next/headers", () => ({ cookies: () => tarro.api }));
vi.mock("@/lib/jwt", async () => await import("../jwt"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/validation", async () => await import("../validation"));
vi.mock("@/lib/session", async () => await import("../session"));
vi.mock("@/lib/onboard", async () => await import("../onboard"));
vi.mock("@/lib/rate-limit", async () => await import("../rate-limit"));
vi.mock("@/lib/invites", async () => await import("../invites"));
vi.mock("@/lib/cla", async () => await import("../cla"));
vi.mock("@/lib/authz", async () => await import("../authz"));
vi.mock("@/lib/admin", async () => await import("../admin"));
vi.mock("@/lib/epochs", async () => await import("../epochs"));
vi.mock("@/lib/mutation", async () => await import("../mutation"));
vi.mock("@/lib/audits", async () => await import("../audits"));
vi.mock("@/lib/config", async () => await import("../config"));
vi.mock("@/lib/entra", async () => await import("../entra"));
vi.mock("@/lib/salir", async () => await import("../salir"));
vi.mock("@/lib/agora-borradores", async () => await import("../agora-borradores"));
vi.mock("@/lib/login-reto", async () => await import("../login-reto"));
vi.mock("@/lib/login-signing", async () => await import("../login-signing"));

import { openDb, prepararSqlite, type DB } from "../db";
import { FOUNDER_WALLET } from "../config";
import { claSigningPayload } from "../cla-signing";
import { SESSION_COOKIE, signSession, verifySession } from "../jwt";
import { adminActor, equipoActor, equipoInternoActor } from "../authz";
import { seedBootstrapInvite } from "../seed";
import { entraLogin } from "../entra";
import { generateInvite } from "../invites";
import { loginSigningPayload } from "../login-signing";
import { POST as verificarInvitacion } from "../../../app/api/invite/verify/route";
import { GET as leerCla } from "../../../app/api/cla/route";
import { POST as onboard } from "../../../app/api/onboard/route";
import { POST as login } from "../../../app/api/login/route";
import { POST as pedirReto } from "../../../app/api/login/reto/route";
import { POST as logout } from "../../../app/api/logout/route";
import { POST as admin } from "../../../app/api/admin/route";
import { GET as estadoEntra } from "../../../app/api/auth/entra/status/route";
import { middleware, config as configMiddleware } from "../../../middleware";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function post(ruta: string, cuerpo: unknown, ip: string, extra: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...extra },
    body: JSON.stringify(cuerpo),
  });
}

function pagina(ruta: string, token?: string): NextRequest {
  const r = new NextRequest(`http://localhost${ruta}`);
  if (token) r.cookies.set(SESSION_COOKIE, token);
  return r;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

/** Firma como la "wallet de prueba" de /entrar: bytes UTF-8 del payload. */
function firmaDemo(kp: Keypair, hash: string): string {
  return b64(kp.sign(Buffer.from(claSigningPayload(hash), "utf8")));
}

/** Firma como Freighter reciente (SEP-53): sha256("Stellar Signed Message:\n" + payload). */
function firmaFreighter(kp: Keypair, hash: string): string {
  return firmaSep53(kp, claSigningPayload(hash));
}

function firmaSep53(kp: Keypair, mensaje: string): string {
  const pre = createHash("sha256")
    .update(Buffer.from("Stellar Signed Message:\n" + mensaje, "utf8"))
    .digest();
  return b64(kp.sign(pre));
}

/** Lo que responde `/api/login/reto`: el reto de un solo uso y el texto exacto a firmar. */
interface RetoEntrada {
  nonce: string;
  sitio: string;
  mensaje: string;
  expiraEn: string;
}

/** Pide un reto de entrada (con `wallet`, atado a esa wallet). La IP del reto cuenta aparte de la del login. */
async function reto(ip: string, wallet?: string): Promise<RetoEntrada> {
  const res = await pedirReto(post("/api/login/reto", wallet ? { wallet } : {}, ip));
  expect(res.status).toBe(200);
  return (await res.json()) as RetoEntrada;
}

/** Firma el mensaje del reto como la wallet del navegador: bytes UTF-8 del texto. */
function firmaReto(kp: Keypair, r: RetoEntrada): string {
  return b64(kp.sign(Buffer.from(r.mensaje, "utf8")));
}

/** Reingreso completo: reto → firma → `/api/login`. Cada reto sale de otra IP (su límite es de 20/min). */
let ipsDeReto = 0;
async function entrar(kp: Keypair, ip: string, extra: Record<string, string> = {}) {
  const r = await reto(`10.8.0.${++ipsDeReto}`, kp.publicKey());
  return login(post("/api/login", { wallet: kp.publicKey(), nonce: r.nonce, signature: firmaReto(kp, r) }, ip, extra));
}

const contar = (db: DB, sql: string): number => Number((db.prepare(sql).get() as { n: number }).n);
const filas = (db: DB, tabla: string): number => contar(db, `SELECT COUNT(*) AS n FROM ${tabla}`);

// ---------------------------------------------------------------------------
// Base temporal
// ---------------------------------------------------------------------------

let dir = "";
let db: DB;
let claHash = "";
const persona = Keypair.random(); // wallet de prueba generada en el navegador
let firma = "";
let tokenContribuidor = "";

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "zelena-caract-login-"));
  const archivo = path.join(dir, "zelena.db");
  db = openDb(archivo);
  // Misma secuencia que init(), sin escotilla ni cohorte en el entorno.
  vi.stubEnv("FOUNDER_BOOTSTRAP_CODE", "");
  vi.stubEnv("SEED_COHORT", "");
  vi.stubEnv("AUTH_ENTRA_ENABLED", "");
  // Sin SITE_URL el mensaje de entrada nombra www.zelena.tech; sin el ID de Front Door
  // no se confía en X-Azure-ClientIP (lib/rate-limit.ts).
  vi.stubEnv("SITE_URL", "");
  vi.stubEnv("AZURE_FRONT_DOOR_ID", "");
  // Sin roster del entorno: la plantilla de roles del código (A8, b97448a). El caso de Entra
  // lee la fila `pending:founder`, que no existe si ZELENA_TEAM_ROSTER trae otro roster.
  vi.stubEnv("ZELENA_TEAM_ROSTER", "");
  prepararSqlite(db, { archivo, founderWallet: FOUNDER_WALLET });
  (globalThis as unknown as { __zelenaDb?: DB }).__zelenaDb = db;
});

afterAll(() => {
  vi.unstubAllEnvs();
  (globalThis as unknown as { __zelenaDb?: DB }).__zelenaDb = undefined;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows puede retener el archivo: limpieza de cortesía */
  }
});

// ---------------------------------------------------------------------------
// Flujo principal: alta por invitación + firma del acuerdo (puerta de comunidad)
// ---------------------------------------------------------------------------

describe("login-y-sesion · flujo principal (invitación + wallet + firma del CLA)", () => {
  it("1 · fuera de producción el seed deja las invitaciones demo y /api/invite/verify las valida sin consumirlas", async () => {
    const res = await verificarInvitacion(post("/api/invite/verify", { code: "GENESIS-0001" }, "10.0.0.1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const malo = await verificarInvitacion(post("/api/invite/verify", { code: "NO-EXISTE" }, "10.0.0.1"));
    // Un código inválido responde 200 con ok:false (no 4xx).
    expect(malo.status).toBe(200);
    expect(await malo.json()).toEqual({ ok: false, error: "Código no válido." });

    expect(db.prepare(`SELECT used_by FROM invites WHERE code = 'GENESIS-0001'`).get()).toEqual({ used_by: null });
  });

  it("2 · /api/cla entrega el texto y el hash; el navegador recalcula el mismo SHA-256", async () => {
    const res = await leerCla();
    const { text, hash } = (await res.json()) as { text: string; hash: string };
    expect(hash).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    claHash = hash;
    firma = firmaDemo(persona, claHash);
  });

  it("3 · /api/onboard: firma válida → alta contributor, invitación consumida, firma encolada y cookie emitida", async () => {
    const antes = { users: filas(db, "users"), cla: filas(db, "cla_signatures"), cola: filas(db, "anchor_queue") };
    const res = await onboard(
      post(
        "/api/onboard",
        { code: "GENESIS-0001", wallet: persona.publicKey(), name: "Persona Prueba", isDemo: true, claHash, signature: firma },
        "10.0.0.2"
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(
      db
        .prepare(
          `SELECT display_name, tier, role, is_supervisor, is_demo, cla_signed, invited_by, auth_provider, status
             FROM users WHERE wallet = ?`
        )
        .get(persona.publicKey())
    ).toEqual({
      display_name: "Persona Prueba",
      tier: "Bronze",
      role: "contributor",
      is_supervisor: 0,
      is_demo: 1,
      cla_signed: 1,
      invited_by: FOUNDER_WALLET,
      auth_provider: "invite",
      status: "active",
    });
    expect(db.prepare(`SELECT used_by FROM invites WHERE code = 'GENESIS-0001'`).get()).toEqual({
      used_by: persona.publicKey(),
    });
    expect({ users: filas(db, "users"), cla: filas(db, "cla_signatures"), cola: filas(db, "anchor_queue") }).toEqual({
      users: antes.users + 1,
      cla: antes.cla + 1,
      cola: antes.cola + 1,
    });
    expect(
      db.prepare(`SELECT cla_hash, signature, anchor_status FROM cla_signatures WHERE wallet = ?`).get(persona.publicKey())
    ).toEqual({ cla_hash: claHash, signature: firma, anchor_status: "pending" });
    expect(
      db.prepare(`SELECT kind, data_key, payload_hash, status FROM anchor_queue WHERE ref = ?`).get(persona.publicKey())
    ).toEqual({ kind: "cla", data_key: `cla:v1:${persona.publicKey().slice(0, 12)}`, payload_hash: claHash, status: "pending" });

    // La cookie: JWT HS256 firmado, httpOnly, SameSite=lax, 24 h.
    tokenContribuidor = tarro.valores.get(SESSION_COOKIE)!;
    expect(tokenContribuidor).toBeTruthy();
    expect(tarro.opciones.get(SESSION_COOKIE)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false, // `secure` solo con NODE_ENV=production
      path: "/",
      maxAge: 86400,
    });
    const claims = await verifySession(tokenContribuidor);
    expect(claims).toMatchObject({
      wallet: persona.publicKey(),
      name: "Persona Prueba",
      tier: "Bronze",
      isFounder: false,
      role: "contributor",
      isSupervisor: false,
      claSigned: true,
      isDemo: true,
    });
    expect(Number(claims!.exp) - Number(claims!.iat)).toBe(86400);
  });

  it("4 · la misma wallet con OTRO código: 409 wallet_registrada y el segundo código NO se gasta", async () => {
    const res = await onboard(
      post(
        "/api/onboard",
        { code: "GENESIS-0002", wallet: persona.publicKey(), name: "Persona Prueba", isDemo: true, claHash, signature: firma },
        "10.0.0.2"
      )
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Esta wallet ya está registrada.", reason: "wallet_registrada" });
    expect(db.prepare(`SELECT used_by FROM invites WHERE code = 'GENESIS-0002'`).get()).toEqual({ used_by: null });
  });

  it("5 · middleware: sin cookie redirige a /entrar?next=…; con la cookie del contribuidor deja pasar /perfil, /admin y /equipo", async () => {
    const sin = await middleware(pagina("/admin"));
    expect(sin.status).toBe(307);
    expect(sin.headers.get("location")).toBe("http://localhost/entrar?next=%2Fadmin");

    for (const ruta of ["/perfil", "/admin", "/equipo/hoy"]) {
      const r = await middleware(pagina(ruta, tokenContribuidor));
      expect(r.headers.get("location"), ruta).toBeNull(); // NextResponse.next()
    }
    // Rutas públicas: el middleware no mira la cookie.
    expect((await middleware(pagina("/manifiesto"))).headers.get("location")).toBeNull();
    // Un token alterado es como no tener sesión.
    const alterado = await middleware(pagina("/perfil", tokenContribuidor.slice(0, -2) + "xx"));
    expect(alterado.headers.get("location")).toBe("http://localhost/entrar?next=%2Fperfil");
  });

  it("6 · las puertas reales leen la BASE: el contribuidor no administra ni entra al equipo interno", async () => {
    const claims = (await verifySession(tokenContribuidor))!;
    expect(adminActor(claims, db)).toBeNull();
    expect(equipoInternoActor(claims, db)).toBeNull();
    expect(equipoActor(claims, db)).toBeNull(); // sin membresía en ningún proyecto

    // Una cookie que MIENTE no concede nada: manda users.role.
    const mentira = { ...claims, role: "founder", isFounder: true, isSupervisor: true };
    expect(adminActor(mentira, db)).toBeNull();

    tarro.valores.set(SESSION_COOKIE, tokenContribuidor);
    const res = await admin(post("/api/admin", { action: "toggleContent", contentId: 1 }, "10.0.0.3"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Solo el founder puede administrar." });
  });

  it("7 · /api/logout borra la cookie y dice, leyendo la BASE, si la cuenta es demo; el JWT emitido NO se revoca", async () => {
    tarro.valores.set(SESSION_COOKIE, tokenContribuidor);
    const res = await logout();
    // 41c8ba8: la respuesta dice si la cuenta es de demostración según `users.is_demo`
    // (GENESIS-0001 es un código demo), para que SalirButton solo borre la llave de una demo.
    expect(await res.json()).toEqual({ ok: true, esDemo: true, wallet: persona.publicKey() });
    expect(tarro.valores.has(SESSION_COOKIE)).toBe(false);
    // HALLAZGO (ficha §7, amenaza 6): una copia del token sigue siendo válida hasta su exp (24 h).
    expect(await verifySession(tokenContribuidor)).not.toBeNull();
    // Sin sesión: cierra igual y no afirma nada.
    expect(await (await logout()).json()).toEqual({ ok: true, esDemo: false, wallet: null });
  });

  it("8 · /api/login (reingreso): reto de un solo uso que nombra el sitio → firma → sesión, sin escribir en la base", async () => {
    const usadas = `SELECT COUNT(*) AS n FROM invites WHERE used_by IS NOT NULL`;
    const antes = { users: filas(db, "users"), cla: filas(db, "cla_signatures"), usadas: contar(db, usadas) };

    const res0 = await pedirReto(post("/api/login/reto", { wallet: persona.publicKey() }, "10.0.0.4"));
    expect(res0.status).toBe(200);
    expect(res0.headers.get("cache-control")).toBe("no-store");
    const r = (await res0.json()) as RetoEntrada;
    expect(r.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.sitio).toBe("www.zelena.tech"); // sin SITE_URL
    expect(r.mensaje).toBe(`zelena-login-testnet-v1:www.zelena.tech:${r.nonce}`);
    expect(r.mensaje).toBe(loginSigningPayload(r.sitio, r.nonce));

    const res = await login(
      post("/api/login", { wallet: persona.publicKey(), nonce: r.nonce, signature: firmaReto(persona, r) }, "10.0.0.4")
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, returning: true });
    expect(await verifySession(tarro.valores.get(SESSION_COOKIE)!)).toMatchObject({
      wallet: persona.publicKey(),
      role: "contributor",
      claSigned: true,
    });
    expect({ users: filas(db, "users"), cla: filas(db, "cla_signatures"), usadas: contar(db, usadas) }).toEqual(antes);
  });

  it("9 · ARREGLADO: la firma fija del CLA ya no abre sesión y cada reto sirve una sola vez, para su wallet", async () => {
    // 7f7882c + ca0d63e: antes el login aceptaba la firma del alta, siempre la misma y
    // guardada en cla_signatures. Ahora se firma un reto de un solo uso emitido por el servidor.
    const guardada = (
      db.prepare(`SELECT signature FROM cla_signatures WHERE wallet = ?`).get(persona.publicKey()) as { signature: string }
    ).signature;
    expect(guardada).toBe(firma); // la base la sigue guardando (es la prueba legal del acuerdo)

    // La forma vieja del cuerpo ({ wallet, claHash, signature }) se rechaza (loginSchema .strict()).
    const vieja = await login(post("/api/login", { wallet: persona.publicKey(), claHash, signature: guardada }, "10.0.0.5"));
    expect(vieja.status).toBe(400);
    expect(await vieja.json()).toEqual({ error: "Entrada inválida." });

    // Con un reto vigente pero la firma del CLA: otro separador de dominio → 401.
    const r1 = await reto("10.0.0.5", persona.publicKey());
    const conCla = await login(
      post("/api/login", { wallet: persona.publicKey(), nonce: r1.nonce, signature: guardada }, "10.0.0.5")
    );
    expect(conCla.status).toBe(401);
    expect((await conCla.json()).reason).toBe("firma_invalida");
    // …y ese reto quedó gastado: ni con la firma correcta vuelve a servir.
    const repetido = await login(
      post("/api/login", { wallet: persona.publicKey(), nonce: r1.nonce, signature: firmaReto(persona, r1) }, "10.0.0.5")
    );
    expect(repetido.status).toBe(401);
    expect(await repetido.json()).toEqual({
      error: "El reto de entrada caducó o ya se usó. Vuelve a intentarlo.",
      reason: "reto_invalido",
    });

    // Un reto pedido para OTRA wallet no sirve para esta.
    const otra = Keypair.random();
    const r2 = await reto("10.0.0.5", otra.publicKey());
    const ajeno = await login(
      post("/api/login", { wallet: persona.publicKey(), nonce: r2.nonce, signature: firmaReto(persona, r2) }, "10.0.0.5")
    );
    expect(ajeno.status).toBe(401);
    expect((await ajeno.json()).reason).toBe("reto_invalido");

    // Cada entrada firma un texto distinto: la firma de una no sirve para la siguiente.
    const r3 = await reto("10.0.0.5", persona.publicKey());
    const r4 = await reto("10.0.0.5", persona.publicKey());
    expect(firmaReto(persona, r3)).not.toBe(firmaReto(persona, r4));
    const cruzada = await login(
      post("/api/login", { wallet: persona.publicKey(), nonce: r4.nonce, signature: firmaReto(persona, r3) }, "10.0.0.5")
    );
    expect(cruzada.status).toBe(401);
    expect((await cruzada.json()).reason).toBe("firma_invalida");
  });

  it("10 · fallas del login: firma ajena 401, wallet sin registro 404, reto inventado 401, cuerpo inválido 400; CLA viejo en el alta 400", async () => {
    const otra = Keypair.random();
    const r1 = await reto("10.0.0.6", persona.publicKey());
    const ajena = await login(
      post("/api/login", { wallet: persona.publicKey(), nonce: r1.nonce, signature: firmaReto(otra, r1) }, "10.0.0.6")
    );
    expect(ajena.status).toBe(401);
    expect(await ajena.json()).toEqual({
      error: "Firma inválida: no corresponde a la wallet declarada.",
      reason: "firma_invalida",
    });

    const sinRegistro = await entrar(otra, "10.0.0.6");
    expect(sinRegistro.status).toBe(404);
    expect((await sinRegistro.json()).reason).toBe("no_registrada");

    // Un reto con la forma correcta que el servidor nunca emitió.
    const inventado = "A".repeat(43);
    const firmaInventada = b64(persona.sign(Buffer.from(loginSigningPayload("www.zelena.tech", inventado), "utf8")));
    const falso = await login(
      post("/api/login", { wallet: persona.publicKey(), nonce: inventado, signature: firmaInventada }, "10.0.0.6")
    );
    expect(falso.status).toBe(401);
    expect((await falso.json()).reason).toBe("reto_invalido");

    const roto = await login(post("/api/login", { wallet: "minusculas" }, "10.0.0.6"));
    expect(roto.status).toBe(400);
    expect(await roto.json()).toEqual({ error: "Entrada inválida." });

    // "CLA viejo": desde 7f7882c el login ya no recibe claHash, pero el ALTA sigue exigiendo
    // la versión oficial. Una firma de otro texto del acuerdo → 400 y el código no se gasta.
    const codigo = generateInvite(db, FOUNDER_WALLET, "Gold");
    const antes = filas(db, "users");
    const viejo = await onboard(
      post(
        "/api/onboard",
        { code: codigo, wallet: otra.publicKey(), name: "Persona Prueba", claHash: "0".repeat(64), signature: firmaDemo(otra, "0".repeat(64)) },
        "10.0.0.16"
      )
    );
    expect(viejo.status).toBe(400);
    expect((await viejo.json()).reason).toBe("cla_desactualizado");
    expect(filas(db, "users")).toBe(antes);
    expect(db.prepare(`SELECT used_by FROM invites WHERE code = ?`).get(codigo)).toEqual({ used_by: null });
  });

  it("11 · Freighter: una firma SEP-53 da de alta y entra; si la cuenta es demo lo decide el CÓDIGO, no el navegador", async () => {
    const freighter = Keypair.random();
    const res = await onboard(
      post(
        "/api/onboard",
        {
          code: "GENESIS-0003",
          wallet: freighter.publicKey(),
          name: "Otra Persona",
          isDemo: false,
          claHash,
          signature: firmaFreighter(freighter, claHash),
        },
        "10.0.0.7"
      )
    );
    expect(res.status).toBe(200);
    // 4291a2d: GENESIS-0001..0006 son códigos de demostración → is_demo = 1 aunque el navegador diga false.
    expect(db.prepare(`SELECT is_demo, role FROM users WHERE wallet = ?`).get(freighter.publicKey())).toEqual({
      is_demo: 1,
      role: "contributor",
    });
    // Reingreso con Freighter: firma SEP-53 del mensaje del reto.
    const r = await reto("10.0.0.7", freighter.publicKey());
    const vuelta = await login(
      post(
        "/api/login",
        { wallet: freighter.publicKey(), nonce: r.nonce, signature: firmaSep53(freighter, r.mensaje) },
        "10.0.0.7"
      )
    );
    expect(vuelta.status).toBe(200);

    // Con una invitación personal (no demo), la wallet del navegador es una cuenta REAL aunque declare isDemo.
    const real = Keypair.random();
    const codigo = generateInvite(db, FOUNDER_WALLET, "Gold");
    const alta = await onboard(
      post(
        "/api/onboard",
        { code: codigo, wallet: real.publicKey(), name: "Persona Real", isDemo: true, claHash, signature: firmaDemo(real, claHash) },
        "10.0.0.7"
      )
    );
    expect(alta.status).toBe(200);
    expect(db.prepare(`SELECT is_demo FROM users WHERE wallet = ?`).get(real.publicKey())).toEqual({ is_demo: 0 });
    expect(await verifySession(tarro.valores.get(SESSION_COOKIE)!)).toMatchObject({ isDemo: false });
  });

  it("12 · límite de 10 intentos por minuto y por IP; ARREGLADO: la IP es el ÚLTIMO valor de X-Forwarded-For (el que pone el proxy)", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await entrar(persona, "10.9.9.9")).status).toBe(200);
    }
    const once = await entrar(persona, "10.9.9.9");
    expect(once.status).toBe(429);
    expect(await once.json()).toEqual({ error: "Demasiados intentos." });
    // 05a2f4e: anteponer otro valor ya no reinicia el límite (el proxy agrega la IP real al final).
    expect((await entrar(persona, "10.9.9.10, 10.9.9.9")).status).toBe(429);
    // 642e412: X-Azure-ClientIP solo vale con el X-Azure-FDID de NUESTRO Front Door (AZURE_FRONT_DOOR_ID).
    const ajenoFd = { "x-azure-clientip": "10.9.9.11", "x-azure-fdid": "otro-front-door" };
    expect((await entrar(persona, "10.9.9.9", ajenoFd)).status).toBe(429);
    // Otra IP real sí tiene su propio contador.
    expect((await entrar(persona, "10.9.9.10")).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Caminos alternos: escotilla del founder y puerta corporativa (Entra)
// ---------------------------------------------------------------------------

describe("login-y-sesion · escotilla de arranque del founder", () => {
  it("con FOUNDER_BOOTSTRAP_CODE el alta nace founder + supervisor y pasa la puerta de /api/admin", async () => {
    vi.stubEnv("FOUNDER_BOOTSTRAP_CODE", "arranque-prueba-0001");
    seedBootstrapInvite(db); // lo que hace cada arranque (seedIfEmpty)
    const codigo = "ARRANQUE-PRUEBA-0001"; // se guarda y se compara en mayúsculas
    expect(db.prepare(`SELECT issuer_wallet, used_by FROM invites WHERE code = ?`).get(codigo)).toEqual({
      issuer_wallet: FOUNDER_WALLET,
      used_by: null,
    });

    const founder = Keypair.random();
    const res = await onboard(
      post(
        "/api/onboard",
        {
          code: codigo,
          wallet: founder.publicKey(),
          name: "Persona Uno", // "fundador" está reservado (validation.ts)
          isDemo: false,
          claHash,
          signature: firmaFreighter(founder, claHash),
        },
        "10.0.1.1"
      )
    );
    expect(res.status).toBe(200);
    expect(db.prepare(`SELECT role, is_supervisor FROM users WHERE wallet = ?`).get(founder.publicKey())).toEqual({
      role: "founder",
      is_supervisor: 1,
    });
    const claims = (await verifySession(tarro.valores.get(SESSION_COOKIE)!))!;
    expect(claims).toMatchObject({ role: "founder", isFounder: true, isSupervisor: true });
    expect(adminActor(claims, db)?.role).toBe("founder");
    expect(equipoInternoActor(claims, db)).not.toBeNull();

    // Pasa la puerta: el 400 es de la validación de la acción, no del rol.
    const r = await admin(post("/api/admin", { action: "accion-que-no-existe" }, "10.0.1.1"));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Entrada inválida." });

    // Un solo uso.
    expect(db.prepare(`SELECT used_by FROM invites WHERE code = ?`).get(codigo)).toEqual({ used_by: founder.publicKey() });
    vi.stubEnv("FOUNDER_BOOTSTRAP_CODE", "");
  });
});

describe("login-y-sesion · puerta corporativa (Entra) detrás del flag", () => {
  it("sin AUTH_ENTRA_ENABLED el botón no se ofrece y la resolución no escribe nada", async () => {
    const res = await estadoEntra();
    expect(await res.json()).toMatchObject({ provider: "microsoft-entra-id", available: false, enabled: false });

    const antes = filas(db, "users");
    const r = entraLogin(
      db,
      { tid: "tenant-prueba", oid: "oid-prueba", preferred_username: "persona@ejemplo.test" },
      { enabled: false, tenantId: "tenant-prueba", corporateDomain: "ejemplo.test" }
    );
    expect(r).toMatchObject({ ok: false, reason: "flag_disabled" });
    expect(filas(db, "users")).toBe(antes);
  });

  it("encendido: alguien del tenant fuera del roster nace `entra:<oid>` core, SIN wallet y SIN CLA", async () => {
    const r = entraLogin(
      db,
      { tid: "tenant-prueba", oid: "oid-prueba-2", preferred_username: "persona.nueva@ejemplo.test", name: "Persona Nueva" },
      { enabled: true, tenantId: "tenant-prueba", corporateDomain: "ejemplo.test" }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.login).toMatchObject({
      wallet: "entra:oid-prueba-2",
      role: "core",
      claSigned: false,
      mode: "created",
      needsRecoveryEmail: true,
    });
    // La misma forma de cookie que firma /api/auth/entra/exchange (claSigned:false):
    const token = await signSession({
      wallet: r.login.wallet,
      name: r.login.name,
      tier: r.login.tier,
      isFounder: false,
      claSigned: false,
      isDemo: false,
      role: r.login.role,
      isSupervisor: r.login.isSupervisor,
    });
    // …entra a /equipo (solo sesión), pero el middleware lo manda a /entrar en /perfil y /admin.
    expect((await middleware(pagina("/equipo/hoy", token))).headers.get("location")).toBeNull();
    expect((await middleware(pagina("/perfil", token))).headers.get("location")).toBe(
      "http://localhost/entrar?next=%2Fperfil"
    );
    expect(equipoInternoActor((await verifySession(token))!, db)?.role).toBe("core");
  });

  it("ARREGLADO: un correo o un nombre parecido a una fila del roster ya no la hereda (ni la del founder)", () => {
    // 74e9321: antes `rosterMemberForIdentity` vinculaba por nombre o parte local del correo.
    // Ahora solo resuelve por oid o por correo EXACTO ya vinculado; si no, alta propia `core`.
    const filaFounder = db.prepare(`SELECT role, entra_oid FROM users WHERE wallet = 'pending:founder'`).get();
    expect(filaFounder).toEqual({ role: "founder", entra_oid: null });
    const r = entraLogin(
      db,
      { tid: "tenant-prueba", oid: "oid-prueba-3", preferred_username: "founder@ejemplo.test", name: "Founder" },
      { enabled: true, tenantId: "tenant-prueba", corporateDomain: "ejemplo.test" }
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.login).toMatchObject({ wallet: "entra:oid-prueba-3", role: "core", mode: "created" });
    expect(db.prepare(`SELECT role, entra_oid FROM users WHERE wallet = 'pending:founder'`).get()).toEqual(filaFounder);
  });

  // WP33: las rutas de la landing ("/", "/comunidad" y, desde 2026-10-26, la demo y el
  // manifiesto) entran solo para marcar el idioma del documento (sin sesión).
  it("el middleware solo cubre páginas: ninguna ruta /api pasa por él", () => {
    expect(configMiddleware.matcher).toEqual([
      "/perfil/:path*",
      "/admin/:path*",
      "/equipo/:path*",
      "/clientes/:path*",
      "/",
      "/comunidad",
      "/book-a-demo",
      "/manifiesto",
    ]);
  });
});
