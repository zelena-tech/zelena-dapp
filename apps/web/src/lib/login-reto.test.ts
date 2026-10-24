/**
 * Reingreso por reto-respuesta (hallazgo de la verificación final, severidad importante).
 *
 * Antes `/api/login` aceptaba siempre la misma firma sobre un texto fijo (el payload del
 * CLA), guardada además en `cla_signatures`: quien la capturara, o leyera una copia de la
 * base, entraba para siempre. Estos tests fijan que ahora:
 *   - solo entra una firma sobre un reto vigente, sin usar y de esa wallet;
 *   - una firma vieja (la del CLA, o la de un login anterior) ya no entra;
 *   - el reto se gasta en el primer intento, salga bien o mal;
 *   - el almacén no guarda el reto en claro.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { openDb, type DB } from "./db";
import { claCanonicalHash } from "./cla";
import { claSigningPayload } from "./cla-signing";
import { LOGIN_DOMAIN_SEPARATOR, NONCE_RE, SITIO_ENTRADA_DEFAULT, loginSigningPayload, sitioDesdeUrl } from "./login-signing";
import { AlmacenRetos, RETO_TTL_MS, almacenRetos } from "./login-reto";
import { OnboardError, performLogin, performOnboard } from "./onboard";
import { loginRetoSchema, loginSchema } from "./validation";

const WEB = process.cwd();

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(WEB, "src", "lib", "schema.sql"), "utf8"));
  return db;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const firmar = (kp: Keypair, texto: string) => b64(kp.sign(Buffer.from(texto, "utf8")));

/** Motivo del OnboardError que lanza `fn`, o "ok" si no lanza. */
function motivo(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof OnboardError) return `${e.status}:${e.reason}`;
    throw e;
  }
}

describe("login por reto: una firma vieja o repetida ya no entra", () => {
  let db: DB;
  let retos: AlmacenRetos;
  let kp: Keypair;
  let wallet: string;
  let firmaCla: string;

  beforeEach(() => {
    db = freshDb();
    retos = new AlmacenRetos();
    kp = Keypair.random();
    wallet = kp.publicKey();
    const hash = claCanonicalHash();
    firmaCla = firmar(kp, claSigningPayload(hash));
    db.prepare(`INSERT INTO invites (code, issuer_wallet, expires_at) VALUES ('RETO-TEST', 'ISSUER', datetime('now','+30 days'))`).run();
    // El alta sigue firmando el CLA, igual que antes (es legal y se ancla).
    performOnboard(db, { code: "RETO-TEST", wallet, name: "Ada", isDemo: false, claHash: hash, signature: firmaCla });
  });

  it("firma sobre un reto vigente de esa wallet: entra", () => {
    const { nonce } = retos.emitir(wallet);
    const r = performLogin(db, { wallet, nonce, signature: firmar(kp, loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce)) }, retos);
    expect(r.wallet).toBe(wallet);
    expect(r.role).toBe("contributor");
  });

  it("la misma firma repetida (replay) ya no entra: el reto se gastó", () => {
    const { nonce } = retos.emitir(wallet);
    const entrada = { wallet, nonce, signature: firmar(kp, loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce)) };
    expect(motivo(() => performLogin(db, entrada, retos))).toBe("ok");
    expect(motivo(() => performLogin(db, entrada, retos))).toBe("401:reto_invalido");
    expect(motivo(() => performLogin(db, entrada, retos))).toBe("401:reto_invalido");
  });

  it("la firma fija del CLA (la que se guarda en cla_signatures) ya no sirve para entrar", () => {
    const guardada = (db.prepare(`SELECT signature FROM cla_signatures WHERE wallet = ?`).get(wallet) as { signature: string }).signature;
    expect(guardada).toBe(firmaCla);
    // Aun con un reto vigente de esa wallet: el separador de dominio es otro.
    const { nonce } = retos.emitir(wallet);
    expect(motivo(() => performLogin(db, { wallet, nonce, signature: guardada }, retos))).toBe("401:firma_invalida");
  });

  it("el cuerpo viejo de /api/login ({ wallet, claHash, signature }) se rechaza en la validación", () => {
    const viejo = { wallet, claHash: claCanonicalHash(), signature: firmaCla };
    expect(loginSchema.safeParse(viejo).success).toBe(false);
    const { nonce } = retos.emitir(wallet);
    expect(loginSchema.safeParse({ ...viejo, nonce }).success).toBe(false); // .strict(): nada de claHash
    expect(loginSchema.safeParse({ wallet, nonce, signature: firmaCla }).success).toBe(true);
  });

  it("una firma de un login anterior no vale con un reto nuevo", () => {
    const primero = retos.emitir(wallet).nonce;
    const firmaVieja = firmar(kp, loginSigningPayload(SITIO_ENTRADA_DEFAULT, primero));
    expect(motivo(() => performLogin(db, { wallet, nonce: primero, signature: firmaVieja }, retos))).toBe("ok");
    const segundo = retos.emitir(wallet).nonce;
    expect(motivo(() => performLogin(db, { wallet, nonce: segundo, signature: firmaVieja }, retos))).toBe("401:firma_invalida");
  });

  it("un reto caducado no entra, aunque la firma sea buena", () => {
    const cortos = new AlmacenRetos(1_000);
    const { nonce } = cortos.emitir(wallet, Date.now() - 5_000); // caducó hace 4 s
    const entrada = { wallet, nonce, signature: firmar(kp, loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce)) };
    expect(motivo(() => performLogin(db, entrada, cortos))).toBe("401:reto_invalido");
  });

  it("un reto que el servidor no emitió no entra", () => {
    const inventado = Buffer.alloc(32, 7).toString("base64url");
    expect(NONCE_RE.test(inventado)).toBe(true);
    const entrada = { wallet, nonce: inventado, signature: firmar(kp, loginSigningPayload(SITIO_ENTRADA_DEFAULT, inventado)) };
    expect(motivo(() => performLogin(db, entrada, retos))).toBe("401:reto_invalido");
  });

  it("un reto pedido para otra wallet no sirve, y queda gastado", () => {
    const otra = Keypair.random().publicKey();
    const { nonce } = retos.emitir(otra);
    const entrada = { wallet, nonce, signature: firmar(kp, loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce)) };
    expect(motivo(() => performLogin(db, entrada, retos))).toBe("401:reto_invalido");
    expect(retos.consumir(nonce, otra)).toBe("inexistente");
  });

  it("un intento con firma inválida también gasta el reto (un solo intento por reto)", () => {
    const { nonce } = retos.emitir(wallet);
    const mala = firmar(Keypair.random(), loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce));
    expect(motivo(() => performLogin(db, { wallet, nonce, signature: mala }, retos))).toBe("401:firma_invalida");
    const buena = firmar(kp, loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce));
    expect(motivo(() => performLogin(db, { wallet, nonce, signature: buena }, retos))).toBe("401:reto_invalido");
  });

  it("acepta la firma SEP-53 de Freighter sobre el reto", () => {
    const { nonce } = retos.emitir(wallet);
    const prefijado = Buffer.from("Stellar Signed Message:\n" + loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce), "utf8");
    const sep53 = b64(kp.sign(createHash("sha256").update(prefijado).digest()));
    expect(motivo(() => performLogin(db, { wallet, nonce, signature: sep53 }, retos))).toBe("ok");
  });

  it("una wallet sin registrar con firma válida sigue siendo 404", () => {
    const ajena = Keypair.random();
    const { nonce } = retos.emitir(ajena.publicKey());
    const entrada = { wallet: ajena.publicKey(), nonce, signature: firmar(ajena, loginSigningPayload(SITIO_ENTRADA_DEFAULT, nonce)) };
    expect(motivo(() => performLogin(db, entrada, retos))).toBe("404:no_registrada");
  });
});

describe("AlmacenRetos", () => {
  it("emite retos aleatorios de 32 bytes en base64url y nunca los guarda en claro", () => {
    const a = new AlmacenRetos();
    const vistos = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { nonce, expiraEn } = a.emitir("GTEST");
      expect(nonce).toMatch(NONCE_RE);
      expect(Buffer.from(nonce, "base64url")).toHaveLength(32);
      expect(a.guardaEnClaro(nonce)).toBe(false);
      expect(expiraEn - Date.now()).toBeLessThanOrEqual(RETO_TTL_MS);
      vistos.add(nonce);
    }
    expect(vistos.size).toBe(50);
    expect(a.tamano).toBe(50);
  });

  it("la caducidad es corta (5 minutos o menos)", () => {
    expect(RETO_TTL_MS).toBeGreaterThan(0);
    expect(RETO_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it("purga los caducados y, lleno, descarta el más viejo", () => {
    const a = new AlmacenRetos(1_000, 3);
    const t0 = 1_000_000;
    const r1 = a.emitir(null, t0);
    a.emitir(null, t0);
    a.emitir(null, t0);
    const r4 = a.emitir(null, t0); // lleno: sale r1
    expect(a.tamano).toBe(3);
    expect(a.consumir(r1.nonce, "G", t0)).toBe("inexistente");
    expect(a.consumir(r4.nonce, "G", t0)).toBe("ok");
    a.emitir(null, t0 + 5_000); // purga los dos que quedaban, ya caducados
    expect(a.tamano).toBe(1);
  });

  it("un reto sin wallet sirve a cualquier wallet (la firma decide), una sola vez", () => {
    const a = new AlmacenRetos();
    const { nonce } = a.emitir(null);
    expect(a.consumir(nonce, "GCUALQUIERA")).toBe("ok");
    expect(a.consumir(nonce, "GCUALQUIERA")).toBe("inexistente");
  });

  it("rechaza sin buscar lo que no tiene forma de reto", () => {
    const a = new AlmacenRetos();
    for (const basura of ["", "corto", "x".repeat(44), "a+b/c=".padEnd(43, "a")]) {
      expect(a.consumir(basura, "G")).toBe("inexistente");
    }
  });

  it("el almacén del proceso es uno solo (cuelga de globalThis)", () => {
    expect(almacenRetos()).toBe(almacenRetos());
  });
});

describe("el mensaje de entrada", () => {
  it("es distinto del que se firma en el alta (otro separador de dominio)", () => {
    expect(LOGIN_DOMAIN_SEPARATOR).toBe("zelena-login-testnet-v1");
    const n = "a".repeat(43);
    expect(loginSigningPayload(SITIO_ENTRADA_DEFAULT, n).startsWith("zelena-cla-")).toBe(false);
  });

  it("nombra el sitio, para que la persona vea en Freighter dónde entra (decisión del founder)", () => {
    const n = "a".repeat(43);
    expect(SITIO_ENTRADA_DEFAULT).toBe("www.zelena.tech");
    expect(loginSigningPayload(SITIO_ENTRADA_DEFAULT, n)).toBe(`zelena-login-testnet-v1:www.zelena.tech:${n}`);
  });

  it("el sitio es el host de SITE_URL; sin él o con un valor raro, www.zelena.tech", () => {
    expect(sitioDesdeUrl("https://www.zelena.tech")).toBe("www.zelena.tech");
    expect(sitioDesdeUrl("https://staging.zelena.tech/")).toBe("staging.zelena.tech");
    expect(sitioDesdeUrl("http://localhost:3000")).toBe("localhost:3000");
    expect(sitioDesdeUrl(undefined)).toBe("www.zelena.tech");
    expect(sitioDesdeUrl("")).toBe("www.zelena.tech");
    expect(sitioDesdeUrl("javascript:alert(1)")).toBe("www.zelena.tech");
    expect(sitioDesdeUrl("no es una url")).toBe("www.zelena.tech");
  });

  it("una firma para OTRO sitio (o la forma vieja, sin sitio) no entra", () => {
    const db = openDb(":memory:");
    db.exec(fs.readFileSync(path.join(WEB, "src", "lib", "schema.sql"), "utf8"));
    const kp = Keypair.random();
    const wallet = kp.publicKey();
    db.prepare(`INSERT INTO users (wallet, display_name, cla_signed) VALUES (?, 'Ada', 1)`).run(wallet);
    const retos = new AlmacenRetos();
    const firmar = (texto: string) => Buffer.from(kp.sign(Buffer.from(texto, "utf8"))).toString("base64");

    const r1 = retos.emitir(wallet).nonce;
    const otroSitio = firmar(loginSigningPayload("sitio-falso.example", r1));
    expect(() => performLogin(db, { wallet, nonce: r1, signature: otroSitio }, retos)).toThrow(/Firma inválida/);

    const r2 = retos.emitir(wallet).nonce;
    const sinSitio = firmar(`${LOGIN_DOMAIN_SEPARATOR}:${r2}`);
    expect(() => performLogin(db, { wallet, nonce: r2, signature: sinSitio }, retos)).toThrow(/Firma inválida/);

    // Con SITE_URL de staging, el servidor espera ese sitio y no el de producción.
    const r3 = retos.emitir(wallet).nonce;
    const prod = firmar(loginSigningPayload(SITIO_ENTRADA_DEFAULT, r3));
    expect(() => performLogin(db, { wallet, nonce: r3, signature: prod }, retos, "staging.zelena.tech")).toThrow(
      /Firma inválida/
    );
    const r4 = retos.emitir(wallet).nonce;
    const staging = firmar(loginSigningPayload("staging.zelena.tech", r4));
    expect(performLogin(db, { wallet, nonce: r4, signature: staging }, retos, "staging.zelena.tech").wallet).toBe(wallet);
  });

  it("pedir un reto acepta una wallet opcional y nada más", () => {
    expect(loginRetoSchema.safeParse({}).success).toBe(true);
    expect(loginRetoSchema.safeParse({ wallet: Keypair.random().publicKey() }).success).toBe(true);
    expect(loginRetoSchema.safeParse({ wallet: "no es una wallet" }).success).toBe(false);
    expect(loginRetoSchema.safeParse({ claHash: "x" }).success).toBe(false);
  });
});

describe("rutas y cliente (estático)", () => {
  const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

  it("/api/login/reto existe, responde GET y POST y no se cachea", () => {
    const src = leer("app/api/login/reto/route.ts");
    expect(src).toMatch(/export async function GET\(/);
    expect(src).toMatch(/export async function POST\(/);
    expect(src).toContain('export const dynamic = "force-dynamic";');
    expect(src).toContain("no-store");
    expect(src).toContain("almacenRetos().emitir(");
  });

  it("/api/login valida el cuerpo nuevo y delega en performLogin", () => {
    const src = leer("app/api/login/route.ts");
    expect(src).toContain("loginSchema.safeParse(");
    expect(src).toContain("performLogin(getDb(), parsed.data)");
  });

  it("/entrar pide un reto, firma el mensaje de entrada y no manda claHash a /api/login", () => {
    const src = leer("app/entrar/page.tsx");
    expect(src).toContain('fetch("/api/login/reto"');
    expect(src).toContain("loginSigningPayload(sitio, nonce)");
    expect(src).toContain("SITIO_RE.test(sitio)");
    const reto = leer("app/api/login/reto/route.ts");
    expect(reto).toContain("const sitio = sitioDeEntrada();");
    expect(reto).toContain("mensaje: loginSigningPayload(sitio, reto.nonce)");
    const login = src.slice(src.indexOf('fetch("/api/login",'));
    expect(login.slice(0, 300)).toMatch(/JSON\.stringify\(\{ wallet, nonce[^}]*signature/);
    expect(login.slice(0, 300)).not.toContain("claHash");
    // El alta sigue firmando el CLA.
    expect(src).toContain("claSigningPayload(claHash)");
  });

  it("tras entrar navega por completo (no con el router, que guardaba la redirección a /entrar)", () => {
    const src = leer("app/entrar/page.tsx");
    expect(src).not.toMatch(/router\.push\("\/perfil"\)/);
    expect(src.match(/irTrasEntrar\(\);/g) ?? []).toHaveLength(3);
    expect(src).toContain("window.location.assign(destinoTrasEntrar())");
    // ?next= solo si, resuelto, sigue siendo del propio sitio.
    expect(src).toContain("url.origin === window.location.origin");
  });
});
