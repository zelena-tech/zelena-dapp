/**
 * Prueba de caracterización · Anclaje en Stellar testnet (docs/features/anclaje-stellar.md, §8).
 *
 * Flujo principal, de punta a punta, con los handlers reales de las rutas y una base
 * SQLite temporal (en memoria, con `schema.sql`):
 *
 *   1. una persona firma el acuerdo (formato SEP-53, el de Freighter) → POST /api/onboard
 *      → fila en `cla_signatures` + fila `pending` en `anchor_queue`;
 *   2. un cron (cabecera `x-anchor-secret`) dispara una pasada  → POST /api/anchor/run
 *      → `manageData(data_key, payload_hash)` firmado por la cuenta de servicio;
 *   3. la fila queda `anchored` con su `tx_id`, la firma también, y la landing la usa
 *      como respaldo de la tarjeta "Compruébalo tú mismo".
 *
 * La red NO se toca: `Horizon.Server` es un doble que registra la transacción firmada y
 * devuelve su hash real; el resto del SDK (Keypair, TransactionBuilder) es el de verdad.
 * Protege el comportamiento ACTUAL, incluidos los puntos discutibles que la ficha lista
 * como hallazgos (UPDATE por wallet). Escrita contra 0e07d8f y actualizada al release
 * wp/32-release: los casos "ARREGLADO" fijan el tope de intentos con estado `failed` y la
 * reserva de filas (27a3044, hallazgo M23), y el secreto del cron de 32 caracteres o más.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { Keypair } from "@stellar/stellar-sdk";
import { openDb, type DB } from "../db";

const red = vi.hoisted(() => ({
  enviadas: [] as Array<{ fuente: string; ops: Array<{ type: string; name?: string; value?: string }>; hash: string }>,
  fallarEnvio: null as null | string,
  sesion: null as null | Record<string, unknown>,
  cookies: [] as Array<Record<string, unknown>>,
}));

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class HorizonFalso {
    constructor(public url: string) {}
    async loadAccount(pub: string) {
      return new real.Account(pub, "1000");
    }
    async submitTransaction(tx: InstanceType<typeof real.Transaction>) {
      if (red.fallarEnvio) throw new Error(red.fallarEnvio);
      const hash = tx.hash().toString("hex");
      red.enviadas.push({
        fuente: tx.source,
        ops: tx.operations.map((o) => {
          const op = o as { type: string; name?: string; value?: Buffer };
          return { type: op.type, name: op.name, value: op.value?.toString("utf8") };
        }),
        hash,
      });
      return { hash };
    }
  }
  return { ...real, Horizon: { ...real.Horizon, Server: HorizonFalso } };
});

vi.mock("@/lib/session", () => ({
  getSession: async () => red.sesion,
  setSessionCookie: async (d: Record<string, unknown>) => {
    red.cookies.push(d);
  },
}));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/validation", async () => await import("../validation"));
vi.mock("@/lib/rate-limit", async () => await import("../rate-limit"));
vi.mock("@/lib/onboard", async () => await import("../onboard"));
vi.mock("@/lib/authz", async () => await import("../authz"));
vi.mock("@/lib/anchor", async () => await import("../anchor"));
vi.mock("@/lib/config", async () => await import("../config"));

import { POST as onboardPOST } from "../../../app/api/onboard/route";
import { GET as anclarGET, POST as anclarPOST } from "../../../app/api/anchor/run/route";
import { claCanonicalHash } from "../cla";
import { claSigningPayload } from "../cla-signing";
import { cifrasEnVivo } from "../prueba-en-vivo";
import { PRUEBAS_TESTNET, contenidoTarjeta, txVerificable } from "../pruebas-testnet";
import { ANCLAJE_MAX_INTENTOS } from "../anchor";

const g = globalThis as unknown as { __zelenaDb?: DB };
const SECRETO_CRON = "secreto-de-prueba-para-el-cron-0001"; // valor de prueba, no es un secreto real
const servicio = Keypair.random(); // cuenta de servicio de PRUEBA, generada en cada corrida

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  db.prepare(
    `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES ('INVITA-PRUEBA-1', 'GEMISOR', datetime('now','+30 days'))`
  ).run();
  return db;
}

/** Firma SEP-53 (lo que hace Freighter): ed25519 sobre sha256("Stellar Signed Message:\n" + payload). */
function firmaSep53(kp: Keypair, payload: string): string {
  const pre = createHash("sha256").update(Buffer.from("Stellar Signed Message:\n" + payload, "utf8")).digest();
  return kp.sign(pre).toString("base64");
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.2", ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

describe("Anclaje en Stellar testnet · flujo principal (firma → cola → pasada → evidencia)", () => {
  let db: DB;
  let persona: Keypair;
  const envAntes = { ...process.env };

  beforeEach(() => {
    db = freshDb();
    g.__zelenaDb = db;
    red.enviadas = [];
    red.fallarEnvio = null;
    red.sesion = null;
    red.cookies = [];
    persona = Keypair.random();
    process.env.ANCHOR_RUN_SECRET = SECRETO_CRON;
    process.env.SERVICE_ACCOUNT_SECRET = servicio.secret();
  });

  afterEach(() => {
    process.env = { ...envAntes };
  });

  async function firmarAcuerdo(): Promise<string> {
    const hash = claCanonicalHash();
    const r = await onboardPOST(
      post("/api/onboard", {
        code: "INVITA-PRUEBA-1",
        wallet: persona.publicKey(),
        name: "Ada Prueba",
        isDemo: false,
        claHash: hash,
        signature: firmaSep53(persona, claSigningPayload(hash)),
      })
    );
    expect(r.status).toBe(200);
    return hash;
  }

  it("la firma del acuerdo se encola y una pasada del cron la ancla con manageData", async () => {
    const hash = await firmarAcuerdo();
    const wallet = persona.publicKey();
    expect(red.cookies).toHaveLength(1);
    expect(red.cookies[0]).toMatchObject({ wallet, claSigned: true, role: "contributor" });

    // 1. Lo que dejó el alta: firma pendiente + fila en la cola.
    expect(db.prepare(`SELECT anchor_status, tx_id, cla_hash FROM cla_signatures WHERE wallet = ?`).get(wallet)).toEqual({
      anchor_status: "pending",
      tx_id: null,
      cla_hash: hash,
    });
    const cola = db.prepare(`SELECT id, kind, ref, data_key, payload_hash, status, attempts FROM anchor_queue`).all();
    expect(cola).toEqual([
      {
        id: 1,
        kind: "cla",
        ref: wallet,
        data_key: `cla:v1:${wallet.slice(0, 12)}`, // solo 12 caracteres de la wallet
        payload_hash: hash, // el hash del DOCUMENTO (igual para todos), no la firma
        status: "pending",
        attempts: 0,
      },
    ]);

    // 2. El cron consulta y dispara la pasada.
    const consulta = await anclarGET(new NextRequest("http://localhost/api/anchor/run", { headers: { "x-anchor-secret": SECRETO_CRON } }));
    expect(await consulta.json()).toEqual({ pendientes: 1 });

    const r = await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }));
    expect(r.status).toBe(200);
    const res = (await r.json()) as { pendientes: number; anclados: number; fallidos: number; cuenta: string; detalle: unknown[] };
    expect(res).toMatchObject({ pendientes: 1, anclados: 1, fallidos: 0, cuenta: servicio.publicKey() });

    // Lo que viajó a la red: UNA operación manageData firmada por la cuenta de servicio.
    expect(red.enviadas).toHaveLength(1);
    const tx = red.enviadas[0];
    expect(tx.fuente).toBe(servicio.publicKey());
    expect(tx.ops).toEqual([{ type: "manageData", name: `cla:v1:${wallet.slice(0, 12)}`, value: hash }]);
    expect(txVerificable(tx.hash)).toBe(true);
    expect(res.detalle).toEqual([{ id: 1, kind: "cla", tx: tx.hash }]);

    // 3. Estado final en la base.
    expect(db.prepare(`SELECT status, tx_id, attempts, last_error FROM anchor_queue WHERE id = 1`).get()).toEqual({
      status: "anchored",
      tx_id: tx.hash,
      attempts: 1,
      last_error: null,
    });
    expect(db.prepare(`SELECT anchor_status, tx_id FROM cla_signatures WHERE wallet = ?`).get(wallet)).toEqual({
      anchor_status: "anchored",
      tx_id: tx.hash,
    });

    // 4. Evidencia pública: la landing la cuenta y la usa de respaldo.
    const cifras = cifrasEnVivo(db);
    expect(cifras.firmasRegistradas).toBe(1);
    expect(cifras.ultimaFirmaAnclada?.tx).toBe(tx.hash);
    // Con el JSON versionado lleno, la tarjeta muestra SU última transacción (no el respaldo)…
    const conJson = contenidoTarjeta(PRUEBAS_TESTNET, cifras.ultimaFirmaAnclada);
    expect(conJson?.tx?.tx).toBe(PRUEBAS_TESTNET.transacciones[PRUEBAS_TESTNET.transacciones.length - 1].tx);
    expect(conJson?.contratos).toHaveLength(3);
    // …y con el JSON vacío, cae a la última firma anclada de verdad.
    const sinJson = contenidoTarjeta({ actualizado: null, transacciones: [], contratos: [] }, cifras.ultimaFirmaAnclada);
    expect(sinJson?.tx).toMatchObject({ tipo: "anclaje", tx: tx.hash, etiqueta: "La última firma del acuerdo de contribución" });

    // Una segunda pasada no reenvía nada.
    const otra = (await (await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }))).json()) as {
      pendientes: number;
    };
    expect(otra.pendientes).toBe(0);
    expect(red.enviadas).toHaveLength(1);
  });

  it("puerta de /api/anchor/run: sin secreto ni sesión de founder → 401; secreto equivocado → 401", async () => {
    await firmarAcuerdo();
    expect((await anclarPOST(post("/api/anchor/run", {}))).status).toBe(401);
    expect((await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": "otro" }))).status).toBe(401);
    // Una sesión de contribuidor no basta (el rol se lee de la base).
    red.sesion = { wallet: persona.publicKey(), name: "Ada", tier: "Bronze", isFounder: true, role: "founder", claSigned: true, isDemo: false };
    expect((await anclarPOST(post("/api/anchor/run", {}))).status).toBe(401);
    expect(red.enviadas).toHaveLength(0);
  });

  it("ARREGLADO: un ANCHOR_RUN_SECRET de menos de 32 caracteres no abre la puerta, y ?limite= que no es entero ya no da 500", async () => {
    await firmarAcuerdo();
    // 76ed59e: anchorRunSecret() exige 32 caracteres o más; uno corto es como no tenerlo.
    process.env.ANCHOR_RUN_SECRET = "corto-de-prueba";
    expect((await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": "corto-de-prueba" }))).status).toBe(401);
    expect(red.enviadas).toHaveLength(0);
    // 27a3044: `?limite=abc` usa 8 (antes, Number("abc") llegaba a la consulta y respondía 500).
    process.env.ANCHOR_RUN_SECRET = SECRETO_CRON;
    const r = await anclarPOST(post("/api/anchor/run?limite=abc", {}, { "x-anchor-secret": SECRETO_CRON }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ anclados: 1, fallidos: 0 });
  });

  it("sin SERVICE_ACCOUNT_SECRET y con pendientes → 500 con el motivo; nada cambia", async () => {
    await firmarAcuerdo();
    delete process.env.SERVICE_ACCOUNT_SECRET;
    const r = await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }));
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: string }).error).toMatch(/SERVICE_ACCOUNT_SECRET no configurado/);
    expect(db.prepare(`SELECT status, attempts FROM anchor_queue`).get()).toEqual({ status: "pending", attempts: 0 });
  });

  it("si la red rechaza el envío: la fila vuelve a 'pending', suma un intento y guarda el error; la siguiente pasada la reintenta", async () => {
    await firmarAcuerdo();
    red.fallarEnvio = "tx_bad_seq";
    const res = (await (await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }))).json()) as {
      anclados: number;
      fallidos: number;
    };
    expect(res).toMatchObject({ anclados: 0, fallidos: 1 });
    expect(db.prepare(`SELECT status, attempts, last_error FROM anchor_queue`).get()).toEqual({
      status: "pending",
      attempts: 1,
      last_error: "tx_bad_seq",
    });
    expect(db.prepare(`SELECT anchor_status FROM cla_signatures`).get()).toEqual({ anchor_status: "pending" });

    // La siguiente pasada la reintenta (sin espera) y entonces sí la ancla.
    red.fallarEnvio = null;
    await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }));
    expect(db.prepare(`SELECT status, attempts, claimed_at FROM anchor_queue`).get()).toEqual({
      status: "anchored",
      attempts: 2,
      claimed_at: null,
    });
  });

  it("ARREGLADO (M23): tras ANCLAJE_MAX_INTENTOS fallos la fila queda 'failed', la firma también, y no se reintenta más", async () => {
    // 27a3044: antes no había estado final y una fila rota se reintentaba para siempre.
    expect(ANCLAJE_MAX_INTENTOS).toBe(8);
    await firmarAcuerdo();
    red.fallarEnvio = "tx_failed";
    for (let i = 0; i < ANCLAJE_MAX_INTENTOS; i++) {
      await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }));
    }
    expect(db.prepare(`SELECT status, attempts, last_error FROM anchor_queue`).get()).toEqual({
      status: "failed",
      attempts: ANCLAJE_MAX_INTENTOS,
      last_error: "tx_failed",
    });
    expect(db.prepare(`SELECT anchor_status FROM cla_signatures`).get()).toEqual({ anchor_status: "failed" });

    // Ya no cuenta como pendiente ni se vuelve a enviar, aunque la red se recupere.
    red.fallarEnvio = null;
    const otra = (await (await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }))).json()) as {
      pendientes: number;
    };
    expect(otra.pendientes).toBe(0);
    expect(red.enviadas).toHaveLength(0);
  });

  it("ARREGLADO (M23): dos pasadas a la vez no anclan la misma fila dos veces (reserva pending → processing)", async () => {
    await firmarAcuerdo();
    const [a, b] = await Promise.all([
      anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON })),
      anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON })),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(red.enviadas).toHaveLength(1);
    expect(db.prepare(`SELECT status, attempts FROM anchor_queue`).get()).toEqual({ status: "anchored", attempts: 1 });
    // Firma y dos pasadas enteras: en el runner de CI cargado rozó los 5 s por defecto.
  }, 20_000);

  it("la raíz Merkle de una época (kind 'merkle_root', como la encola cerrarYAbrirEpoca) deja la época 'Anchored'", async () => {
    db.prepare(
      `INSERT INTO periods (id, name, epoch_budget, academia_budget, state, merkle_root) VALUES (1, 'Época 1', 100000, 10000, 'Closed', ?)`
    ).run("ab".repeat(32));
    db.prepare(`INSERT INTO anchor_queue (kind, ref, data_key, payload_hash) VALUES ('merkle_root', '1', 'epoch:1', ?)`).run("ab".repeat(32));
    await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }));
    const periodo = db.prepare(`SELECT state, anchor_tx_id FROM periods WHERE id = 1`).get() as { state: string; anchor_tx_id: string };
    expect(periodo.state).toBe("Anchored");
    expect(periodo.anchor_tx_id).toBe(red.enviadas[0].hash);
    expect(red.enviadas[0].ops).toEqual([{ type: "manageData", name: "epoch:1", value: "ab".repeat(32) }]);
  });

  it("comportamiento actual discutible: anclar la fila 'cla' marca TODAS las versiones firmadas por esa wallet", async () => {
    await firmarAcuerdo();
    const wallet = persona.publicKey();
    // Simula una firma de una versión futura del acuerdo, todavía sin anclar.
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature, anchor_status) VALUES (?, 2, ?, 'firma-v2', 'pending')`
    ).run(wallet, "cd".repeat(32));
    await anclarPOST(post("/api/anchor/run", {}, { "x-anchor-secret": SECRETO_CRON }));
    const filas = db.prepare(`SELECT cla_version, anchor_status, tx_id FROM cla_signatures WHERE wallet = ? ORDER BY cla_version`).all(wallet) as Array<{
      cla_version: number;
      anchor_status: string;
      tx_id: string;
    }>;
    expect(filas.map((f) => f.anchor_status)).toEqual(["anchored", "anchored"]);
    expect(filas[1].tx_id).toBe(filas[0].tx_id); // la v2 hereda la transacción de la v1
  });
});
