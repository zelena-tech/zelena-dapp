/**
 * "Salir y borrar mi wallet de este equipo" se decide con la BASE, no con la cookie
 * (revisión del release, 2026-10-21).
 *
 * La migración del arranque pasa a reales (`is_demo` 1 → 0) las cuentas creadas con la
 * wallet del navegador, pero su cookie conserva `isDemo = true` hasta 24 h (la sesión no
 * se recalcula hasta volver a entrar). Si la barra decide con la cookie, le ofrece a una
 * cuenta REAL borrar la llave de `localStorage`, que es su única copia: pulsarlo es perder
 * el acceso para siempre.
 *
 *  - Nav (servidor) decide si ofrece el botón leyendo `users.is_demo` de la base.
 *  - `/api/logout` vuelve a leer la base en el momento de salir, y `SalirButton` solo borra
 *    la llave si el servidor confirma que la cuenta es de demostración Y la llave guardada en
 *    este navegador es la de esa cuenta. Ante cualquier duda, la llave se queda.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { openDb, type DB } from "./db";
import { marcarCuentasDeNavegadorComoReales } from "./cuentas-reales";
import { DEMO_INVITE_CODES } from "./config";
import type { SessionData } from "./jwt";
import { esDemoSegunBase, puedeBorrarLlave, walletDeLlaveGuardada } from "./salir";

const WEB = process.cwd();
const SCHEMA = fs.readFileSync(path.join(WEB, "src", "lib", "schema.sql"), "utf8");
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

/** Lo que guarda /entrar en `localStorage` al crear la wallet del navegador. */
const guardada = (kp: Keypair) => JSON.stringify({ public: kp.publicKey(), secret: kp.secret() });

describe("la cookie dice demo, la base dice real (tras la migración del arranque)", () => {
  let db: DB;
  const navegador = Keypair.random(); // entró con invitación válida y la wallet del navegador
  const conCodigoDemo = Keypair.random(); // entró con un código de demostración: sigue demo

  beforeEach(() => {
    db = openDb(":memory:");
    db.exec(SCHEMA);
    db.exec(`
      INSERT INTO users (wallet, display_name, invited_by, is_demo, is_founder, cla_signed) VALUES
        ('${navegador.publicKey()}', 'Navegador', NULL, 1, 0, 1),
        ('${conCodigoDemo.publicKey()}', 'Demo', NULL, 1, 0, 1);
      INSERT INTO cla_signatures (wallet, cla_hash, signature, anchor_status, tx_id) VALUES
        ('${navegador.publicKey()}', 'h1', 'firma-ed25519-1', 'pending', NULL),
        ('${conCodigoDemo.publicKey()}', 'h2', 'firma-ed25519-2', 'pending', NULL);
      INSERT INTO invites (code, issuer_wallet, used_by, expires_at) VALUES
        ('${DEMO_INVITE_CODES[1]}', 'GEMISOR', '${conCodigoDemo.publicKey()}', '2026-12-01 00:00:00');
    `);
  });

  it("tras la migración, la cuenta del navegador es real según la base aunque su cookie diga demo", () => {
    // La cookie se firmó ANTES del despliegue y vive 24 h.
    const cookie: Pick<SessionData, "wallet" | "isDemo"> = { wallet: navegador.publicKey(), isDemo: true };
    expect(esDemoSegunBase(db, cookie.wallet)).toBe(true);

    expect(marcarCuentasDeNavegadorComoReales(db)).toEqual([navegador.publicKey()]);

    expect(cookie.isDemo).toBe(true); // la cookie no cambia...
    expect(esDemoSegunBase(db, cookie.wallet)).toBe(false); // ...la base sí: no se ofrece borrar
    expect(esDemoSegunBase(db, conCodigoDemo.publicKey())).toBe(true);
  });

  it("sin fila en la base no es demo: ante la duda, no se ofrece borrar nada", () => {
    expect(esDemoSegunBase(db, Keypair.random().publicKey())).toBe(false);
    expect(esDemoSegunBase(db, "")).toBe(false);
  });

  it("el servidor que dice 'real' impide el borrado aunque el botón se hubiera pintado", () => {
    marcarCuentasDeNavegadorComoReales(db);
    const w = navegador.publicKey();
    const respuesta = { ok: true, esDemo: esDemoSegunBase(db, w), wallet: w };
    expect(puedeBorrarLlave(respuesta, guardada(navegador))).toBe(false);
  });
});

describe("puedeBorrarLlave: solo con confirmación del servidor y la llave de esa misma cuenta", () => {
  const demo = Keypair.random();
  const otra = Keypair.random();
  const ok = (esDemo: unknown, wallet: unknown) => ({ ok: true, esDemo, wallet });

  it("cuenta de demostración según el servidor y llave guardada de esa cuenta: sí", () => {
    expect(puedeBorrarLlave(ok(true, demo.publicKey()), guardada(demo))).toBe(true);
  });

  it("cuenta real según el servidor: no", () => {
    expect(puedeBorrarLlave(ok(false, demo.publicKey()), guardada(demo))).toBe(false);
  });

  it("la llave guardada es de OTRA cuenta (p. ej. una real en el mismo navegador): no", () => {
    expect(puedeBorrarLlave(ok(true, demo.publicKey()), guardada(otra))).toBe(false);
  });

  it("respuesta rara, sin red o sin llave guardada: no", () => {
    expect(puedeBorrarLlave(null, guardada(demo))).toBe(false);
    expect(puedeBorrarLlave(undefined, guardada(demo))).toBe(false);
    expect(puedeBorrarLlave({ ok: true }, guardada(demo))).toBe(false); // /api/logout de antes
    expect(puedeBorrarLlave(ok("true", demo.publicKey()), guardada(demo))).toBe(false);
    expect(puedeBorrarLlave(ok(1, demo.publicKey()), guardada(demo))).toBe(false);
    expect(puedeBorrarLlave(ok(true, null), guardada(demo))).toBe(false);
    expect(puedeBorrarLlave({ ok: false, esDemo: true, wallet: demo.publicKey() }, guardada(demo))).toBe(false);
    expect(puedeBorrarLlave(ok(true, demo.publicKey()), null)).toBe(false);
    expect(puedeBorrarLlave(ok(true, demo.publicKey()), "{no es json")).toBe(false);
  });

  it("walletDeLlaveGuardada lee la parte pública y nada más", () => {
    expect(walletDeLlaveGuardada(guardada(demo))).toBe(demo.publicKey());
    expect(walletDeLlaveGuardada(JSON.stringify({ public: 42 }))).toBeNull();
    expect(walletDeLlaveGuardada("null")).toBeNull();
    expect(walletDeLlaveGuardada(null)).toBeNull();
  });
});

describe("el cableado: Nav, /api/logout y SalirButton leen la base, nunca la cookie", () => {
  it("Nav no decide el botón con la cookie: lee is_demo de la base con getDb()", () => {
    const src = leer("src/components/Nav.tsx");
    expect(src).not.toMatch(/session\.isDemo/);
    expect(src).toMatch(/esDemoSegunBase\(getDb\(\), session\.wallet\)/);
    expect(src).toMatch(/<SalirButton esDemo=\{cuentaDemo\(session\)\} \/>/);
  });

  it("/api/logout lee la base antes de cerrar la sesión y responde esDemo y wallet", () => {
    const src = leer("app/api/logout/route.ts");
    expect(src).toMatch(/esDemoSegunBase\(getDb\(\), session\.wallet\)/);
    expect(src.indexOf("esDemoSegunBase(")).toBeLessThan(src.indexOf("clearSessionCookie()"));
    expect(src).toMatch(/NextResponse\.json\(\{ ok: true, esDemo, wallet: session\?\.wallet \?\? null \}\)/);
  });

  it("SalirButton solo borra la llave si puedeBorrarLlave lo confirma con la respuesta del servidor", () => {
    const src = leer("src/components/SalirButton.tsx");
    const borrados = src.match(/localStorage\.removeItem\(/g) ?? [];
    expect(borrados).toHaveLength(1);
    const i = src.indexOf("localStorage.removeItem(");
    const antes = src.slice(0, i);
    expect(antes).toMatch(/if \(puedeBorrarLlave\(respuesta, localStorage\.getItem\(CLAVE_WALLET_NAVEGADOR\)\)\) \{\s*$/);
    // Primero se pregunta al servidor (que lee la base) y después se decide.
    expect(antes.indexOf('fetch("/api/logout"')).toBeGreaterThan(-1);
  });
});
