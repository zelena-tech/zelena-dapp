/**
 * WP31-D · código de asistencia rotativo y huella de cierre (criterios D2 y D4).
 */
import { describe, it, expect } from "vitest";
import { bucketDe, codigoRito, expiraEnS, hashCierre, ritesSecret, verificarCodigo } from "./ritos-codigo";
import { sha256Hex } from "./crypto";
import { GENOME_DEFAULTS } from "./genome";

const ROT = GENOME_DEFAULTS.RITE_CODE_ROTATION_S; // 90 s
const SECRETO = "secreto-de-prueba-para-ritos-0123456789";
const T = Date.parse("2026-10-09T21:10:00.000Z");

describe("D2 · código de 6 dígitos", () => {
  it("es determinista, de 6 dígitos (con ceros) y cambia por sesión y por tramo", () => {
    const b = bucketDe(T, ROT);
    const c = codigoRito(SECRETO, 7, b);
    expect(c).toMatch(/^\d{6}$/);
    expect(codigoRito(SECRETO, 7, b)).toBe(c);
    expect(codigoRito(SECRETO, 8, b)).not.toBe(c);
    expect(codigoRito(SECRETO, 7, b + 1)).not.toBe(c);
    expect(codigoRito("otro-secreto-distinto-0123456789", 7, b)).not.toBe(c);
    // Muchos tramos: siempre 6 caracteres (los ceros a la izquierda se conservan).
    for (let i = 0; i < 300; i++) expect(codigoRito(SECRETO, 1, i)).toMatch(/^\d{6}$/);
  });

  it("acepta el tramo actual y el anterior; rechaza dos atrás, el siguiente y el de otra sesión", () => {
    const b = bucketDe(T, ROT);
    expect(verificarCodigo(SECRETO, 7, codigoRito(SECRETO, 7, b), T, ROT)).toBe(true);
    expect(verificarCodigo(SECRETO, 7, codigoRito(SECRETO, 7, b - 1), T, ROT)).toBe(true);
    const dosAtras = codigoRito(SECRETO, 7, b - 2);
    const siguiente = codigoRito(SECRETO, 7, b + 1);
    const otraSesion = codigoRito(SECRETO, 8, b);
    const validos = new Set([codigoRito(SECRETO, 7, b), codigoRito(SECRETO, 7, b - 1)]);
    // Con este secreto y este instante no hay colisiones (6 dígitos: 1 en un millón).
    for (const c of [dosAtras, siguiente, otraSesion]) expect(validos.has(c)).toBe(false);
    expect(verificarCodigo(SECRETO, 7, dosAtras, T, ROT)).toBe(false);
    expect(verificarCodigo(SECRETO, 7, siguiente, T, ROT)).toBe(false);
    expect(verificarCodigo(SECRETO, 7, otraSesion, T, ROT)).toBe(false);
  });

  it("rechaza lo que no tiene forma de código (ya normalizado: 6 dígitos o nada)", () => {
    expect(verificarCodigo(SECRETO, 7, "", T, ROT)).toBe(false);
    expect(verificarCodigo(SECRETO, 7, "12345", T, ROT)).toBe(false);
    expect(verificarCodigo(SECRETO, 7, "1234567", T, ROT)).toBe(false);
    expect(verificarCodigo(SECRETO, 7, "abcdef", T, ROT)).toBe(false);
    expect(verificarCodigo(SECRETO, 7, undefined as unknown as string, T, ROT)).toBe(false);
  });

  it("los tramos duran la rotación del genoma y el código dice cuánto le queda", () => {
    const inicioTramo = bucketDe(T, ROT) * ROT * 1000;
    expect(bucketDe(inicioTramo, ROT)).toBe(bucketDe(inicioTramo + ROT * 1000 - 1, ROT));
    expect(bucketDe(inicioTramo + ROT * 1000, ROT)).toBe(bucketDe(inicioTramo, ROT) + 1);
    expect(expiraEnS(inicioTramo, ROT)).toBe(ROT);
    expect(expiraEnS(inicioTramo + 30_500, ROT)).toBe(ROT - 30);
    expect(expiraEnS(inicioTramo + ROT * 1000 - 1, ROT)).toBe(1);
    expect(() => bucketDe(T, 0)).toThrow(RangeError);
  });
});

describe("D2 · ritesSecret: el secreto sale de la configuración, nunca del repo", () => {
  const SESION = "s".repeat(40);

  it("usa RITES_SECRET si tiene 16 caracteres o más", () => {
    expect(ritesSecret({ RITES_SECRET: "r".repeat(16), NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe("r".repeat(16));
  });

  it("si no, lo deriva de SESSION_SECRET (≥ 32): estable y distinto del de sesión", () => {
    const env = { SESSION_SECRET: SESION, NODE_ENV: "production" } as NodeJS.ProcessEnv;
    const s = ritesSecret(env);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).not.toBe(SESION);
    expect(ritesSecret(env)).toBe(s);
    // Un RITES_SECRET demasiado corto no vale: se deriva igual.
    expect(ritesSecret({ ...env, RITES_SECRET: "corto" } as NodeJS.ProcessEnv)).toBe(s);
  });

  it("en producción, sin RITES_SECRET ni SESSION_SECRET válidos, LANZA", () => {
    expect(() => ritesSecret({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/RITES_SECRET|SESSION_SECRET/);
    expect(() =>
      ritesSecret({ NODE_ENV: "production", SESSION_SECRET: "corto", RITES_SECRET: "corto" } as NodeJS.ProcessEnv)
    ).toThrow();
  });

  it("fuera de producción cae al de desarrollo (no protege nada real)", () => {
    const dev = ritesSecret({ NODE_ENV: "test" } as NodeJS.ProcessEnv);
    expect(dev).toMatch(/^[0-9a-f]{64}$/);
    expect(ritesSecret({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(dev);
  });
});

/** Todos los subconjuntos de `n` elementos de `xs` (para enumerar listas candidatas). */
function subconjuntos<T>(xs: T[], n: number): T[][] {
  if (n === 0) return [[]];
  if (xs.length < n) return [];
  const [x, ...resto] = xs;
  return [...subconjuntos(resto, n - 1).map((s) => [x, ...s]), ...subconjuntos(resto, n)];
}

/**
 * El ataque que la huella tiene que resistir (§4.D.6): quien conoce las wallets
 * candidatas (cualquiera del equipo, o quien vea perfiles) y los datos públicos del
 * cierre (tipo, fecha, conteo y resumen) prueba cada lista de tamaño N con cada
 * anfitrión y relator posibles, y compara con la huella publicada.
 */
function enumerarLista(
  huella: string,
  publico: { kind: string; scheduledFor: string; asistentes: number; summary: string | null },
  candidatas: string[]
): string[] | null {
  const papeles = [null, ...candidatas];
  for (const lista of subconjuntos(candidatas, publico.asistentes)) {
    for (const host of papeles) {
      for (const recorder of papeles) {
        const canonico = JSON.stringify({
          asistentes: [...lista].sort(),
          host,
          kind: publico.kind,
          recorder,
          scheduledFor: publico.scheduledFor,
          summary: publico.summary,
        });
        if (sha256Hex(canonico) === huella) return lista;
      }
    }
  }
  return null;
}

describe("D4 · hashCierre: huella determinista del cierre, con el secreto del servidor", () => {
  const base = {
    kind: "demo" as const,
    scheduledFor: "2026-10-09T21:00:00.000Z",
    asistentes: ["GB", "GA", "GC"],
    host: "GH",
    recorder: "GR",
    summary: "Se mostró el tablero.",
  };

  it("no depende del orden ni de duplicados de la lista de asistentes", () => {
    const h = hashCierre(base, SECRETO);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCierre({ ...base, asistentes: ["GC", "GA", "GB", "GA"] }, SECRETO)).toBe(h);
  });

  it("cambia si cambia cualquier dato del cierre", () => {
    const h = hashCierre(base, SECRETO);
    expect(hashCierre({ ...base, asistentes: ["GA", "GB"] }, SECRETO)).not.toBe(h);
    expect(hashCierre({ ...base, summary: null }, SECRETO)).not.toBe(h);
    expect(hashCierre({ ...base, host: null }, SECRETO)).not.toBe(h);
    expect(hashCierre({ ...base, recorder: "GX" }, SECRETO)).not.toBe(h);
    expect(hashCierre({ ...base, kind: "retro" }, SECRETO)).not.toBe(h);
    expect(hashCierre({ ...base, scheduledFor: "2026-10-23T21:00:00.000Z" }, SECRETO)).not.toBe(h);
  });

  it("mismo cierre y mismo secreto → misma huella; con otro secreto, otra", () => {
    const h = hashCierre(base, SECRETO);
    expect(hashCierre({ ...base }, SECRETO)).toBe(h);
    expect(hashCierre(base, "otro-secreto-distinto-0123456789")).not.toBe(h);
    // Sin secreto explícito usa el de los ritos (el mismo que firma el código).
    expect(hashCierre(base)).toBe(hashCierre(base, ritesSecret()));
  });

  it("sin el secreto, enumerar las wallets candidatas no saca la lista nominal", () => {
    const candidatas = ["GA", "GB", "GC", "GD", "GE", "GH", "GR"];
    const publico = { kind: base.kind, scheduledFor: base.scheduledFor, asistentes: 3, summary: base.summary };
    // Control: la enumeración SÍ acierta contra una huella sin secreto (el sha256 de antes).
    const sinSecreto = sha256Hex(
      JSON.stringify({
        asistentes: ["GA", "GB", "GC"],
        host: "GH",
        kind: "demo",
        recorder: "GR",
        scheduledFor: base.scheduledFor,
        summary: base.summary,
      })
    );
    expect(enumerarLista(sinSecreto, publico, candidatas)).toEqual(["GA", "GB", "GC"]);
    // La huella de verdad no se deja enumerar.
    expect(enumerarLista(hashCierre(base, SECRETO), publico, candidatas)).toBeNull();
  });
});
