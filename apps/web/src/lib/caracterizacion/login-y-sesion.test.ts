/**
 * Prueba de caracterización · feature `login-y-sesion`
 * Ficha: docs/features/login-y-sesion.md · DFD: docs/dfd/login-y-sesion.json
 *
 * Recorre el FLUJO PRINCIPAL de punta a punta, llamando a los handlers reales de
 * `app/api/**` y al `middleware.ts`, contra una base SQLite TEMPORAL arrancada con la
 * misma secuencia que producción (`prepararSqlite`: schema + migraciones + seed):
 *
 *   /api/invite/verify → /api/cla → (firma en el navegador) → /api/onboard
 *   → cookie `zelena_session` → middleware → puertas de authz → /api/logout → /api/login
 *
 * Protege el comportamiento ACTUAL, no el deseado. Los `it` marcados "HALLAZGO"
 * fijan conductas que la ficha reporta como problema: si alguien las corrige, este
 * test debe fallar y la ficha debe actualizarse en el mismo cambio.
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

import { openDb, prepararSqlite, type DB } from "../db";
import { FOUNDER_WALLET } from "../config";
import { claSigningPayload } from "../cla-signing";
import { SESSION_COOKIE, signSession, verifySession } from "../jwt";
import { adminActor, equipoActor, equipoInternoActor } from "../authz";
import { seedBootstrapInvite } from "../seed";
import { entraLogin } from "../entra";
import { POST as verificarInvitacion } from "../../../app/api/invite/verify/route";
import { GET as leerCla } from "../../../app/api/cla/route";
import { POST as onboard } from "../../../app/api/onboard/route";
import { POST as login } from "../../../app/api/login/route";
import { POST as logout } from "../../../app/api/logout/route";
import { POST as admin } from "../../../app/api/admin/route";
import { GET as estadoEntra } from "../../../app/api/auth/entra/status/route";
import { middleware, config as configMiddleware } from "../../../middleware";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function post(ruta: string, cuerpo: unknown, ip: string): NextRequest {
  return new NextRequest(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
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
  const pre = createHash("sha256")
    .update(Buffer.from("Stellar Signed Message:\n" + claSigningPayload(hash), "utf8"))
    .digest();
  return b64(kp.sign(pre));
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

  it("7 · /api/logout borra la cookie del navegador; el JWT emitido NO se revoca (sin estado en servidor)", async () => {
    tarro.valores.set(SESSION_COOKIE, tokenContribuidor);
    const res = await logout();
    expect(await res.json()).toEqual({ ok: true });
    expect(tarro.valores.has(SESSION_COOKIE)).toBe(false);
    // HALLAZGO (ficha §7): una copia del token sigue siendo válida hasta su exp (24 h).
    expect(await verifySession(tokenContribuidor)).not.toBeNull();
  });

  it("8 · /api/login (reingreso): la firma de la wallet registrada abre sesión sin escribir en la base", async () => {
    const usadas = `SELECT COUNT(*) AS n FROM invites WHERE used_by IS NOT NULL`;
    const antes = { users: filas(db, "users"), cla: filas(db, "cla_signatures"), usadas: contar(db, usadas) };
    const res = await login(post("/api/login", { wallet: persona.publicKey(), claHash, signature: firma }, "10.0.0.4"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, returning: true });
    expect(await verifySession(tarro.valores.get(SESSION_COOKIE)!)).toMatchObject({
      wallet: persona.publicKey(),
      role: "contributor",
      claSigned: true,
    });
    expect({ users: filas(db, "users"), cla: filas(db, "cla_signatures"), usadas: contar(db, usadas) }).toEqual(antes);
  });

  it("9 · HALLAZGO: la firma del login es SIEMPRE la misma (sin reto ni nonce) y la base la guarda tal cual", async () => {
    // ed25519 es determinista y el payload es fijo (domain separator + hash del CLA):
    // la firma del alta sirve tal cual para cualquier login futuro.
    expect(firmaDemo(persona, claHash)).toBe(firma);
    const guardada = (
      db.prepare(`SELECT signature FROM cla_signatures WHERE wallet = ?`).get(persona.publicKey()) as { signature: string }
    ).signature;
    const res = await login(post("/api/login", { wallet: persona.publicKey(), claHash, signature: guardada }, "10.0.0.5"));
    expect(res.status).toBe(200);
  });

  it("10 · fallas del login: firma ajena 401, wallet sin registro 404, CLA viejo 400, cuerpo inválido 400", async () => {
    const otra = Keypair.random();
    const ajena = await login(
      post("/api/login", { wallet: persona.publicKey(), claHash, signature: firmaDemo(otra, claHash) }, "10.0.0.6")
    );
    expect(ajena.status).toBe(401);
    expect(await ajena.json()).toEqual({
      error: "Firma inválida: no corresponde a la wallet declarada.",
      reason: "firma_invalida",
    });

    const sinRegistro = await login(
      post("/api/login", { wallet: otra.publicKey(), claHash, signature: firmaDemo(otra, claHash) }, "10.0.0.6")
    );
    expect(sinRegistro.status).toBe(404);
    expect((await sinRegistro.json()).reason).toBe("no_registrada");

    const viejo = await login(
      post("/api/login", { wallet: persona.publicKey(), claHash: "0".repeat(64), signature: firma }, "10.0.0.6")
    );
    expect(viejo.status).toBe(400);
    expect((await viejo.json()).reason).toBe("cla_desactualizado");

    const roto = await login(post("/api/login", { wallet: "minusculas" }, "10.0.0.6"));
    expect(roto.status).toBe(400);
    expect(await roto.json()).toEqual({ error: "Entrada inválida." });
  });

  it("11 · Freighter: una firma SEP-53 (lo que firma Freighter reciente) también da de alta", async () => {
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
    expect(db.prepare(`SELECT is_demo, role FROM users WHERE wallet = ?`).get(freighter.publicKey())).toEqual({
      is_demo: 0,
      role: "contributor",
    });
  });

  it("12 · límite de 10 intentos por minuto y por IP; HALLAZGO: la IP sale de X-Forwarded-For, que manda el cliente", async () => {
    const cuerpo = { wallet: persona.publicKey(), claHash, signature: firma };
    for (let i = 0; i < 10; i++) {
      expect((await login(post("/api/login", cuerpo, "10.9.9.9"))).status).toBe(200);
    }
    const once = await login(post("/api/login", cuerpo, "10.9.9.9"));
    expect(once.status).toBe(429);
    expect(await once.json()).toEqual({ error: "Demasiados intentos." });
    // Cambiar el encabezado basta para empezar de cero.
    expect((await login(post("/api/login", cuerpo, "10.9.9.10"))).status).toBe(200);
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

  it("el middleware solo cubre páginas: ninguna ruta /api pasa por él", () => {
    expect(configMiddleware.matcher).toEqual(["/perfil/:path*", "/admin/:path*", "/equipo/:path*", "/clientes/:path*"]);
  });
});
