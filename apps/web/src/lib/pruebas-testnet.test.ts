/**
 * WP31-E1 · tarjeta "Compruébalo tú mismo" (criterio E1-7) y el JSON público
 * `src/data/pruebas-testnet.json`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PruebasTestnetLista from "../components/PruebasTestnetLista";
import {
  EXPLORADOR_CONTRATO,
  EXPLORADOR_TX,
  PRUEBAS_TESTNET,
  contenidoTarjeta,
  contratoVerificable,
  pruebasVisibles,
  txVerificable,
  type PruebasTestnet,
} from "./pruebas-testnet";

const TX_A = "93f247ecdca40a2e9c361bb752158d70391b7e6ee588c20ae651c9eed8733440";
const TX_B = "7528bae6b5ac4d5fa1c195a51ffcac9a135435ac05a2583019ece666e59c0cc4";
const CONTRATO = "CCAUZ6XIMA5ZIAIMMS2DOOUB2CFDRHZXQYXEQSV7RQJCSOZ74YE6NYUX";
const VACIO: PruebasTestnet = { actualizado: null, transacciones: [], contratos: [] };

describe("formatos verificables", () => {
  it("txVerificable: 64 hexadecimales en minúscula", () => {
    expect(txVerificable(TX_A)).toBe(true);
    expect(txVerificable(TX_A.toUpperCase())).toBe(false);
    expect(txVerificable(TX_A.slice(1))).toBe(false);
    expect(txVerificable(TX_A + "0")).toBe(false);
    expect(txVerificable("SEEDTX_FOUNDER_ANCHORED_0001")).toBe(false);
    expect(txVerificable(` ${TX_A}`)).toBe(false);
    expect(txVerificable("g".repeat(64))).toBe(false);
  });

  it("contratoVerificable: C + 55 de base32", () => {
    expect(contratoVerificable(CONTRATO)).toBe(true);
    expect(contratoVerificable("G" + CONTRATO.slice(1))).toBe(false); // una cuenta, no un contrato
    expect(contratoVerificable(CONTRATO.slice(0, 55))).toBe(false);
    expect(contratoVerificable(CONTRATO.toLowerCase())).toBe(false);
    expect(contratoVerificable(CONTRATO.slice(0, 55) + "1")).toBe(false); // '1' no es base32
  });

  it("los exploradores son los públicos de la red de pruebas", () => {
    expect(EXPLORADOR_TX).toBe("https://stellar.expert/explorer/testnet/tx/");
    expect(EXPLORADOR_CONTRATO).toBe("https://stellar.expert/explorer/testnet/contract/");
  });
});

describe("pruebasVisibles", () => {
  it("descarta hashes que no son 64 hex, tipos desconocidos y contratos mal formados", () => {
    const p = {
      actualizado: "2026-10-01",
      transacciones: [
        { etiqueta: "buena", tipo: "pago", tx: TX_A, fecha: "2026-10-01" },
        { etiqueta: "corta", tipo: "pago", tx: "abc", fecha: "2026-10-01" },
        { etiqueta: "sembrada", tipo: "anclaje", tx: "SEEDTX_X", fecha: "2026-10-01" },
        { etiqueta: "tipo raro", tipo: "otro", tx: TX_B, fecha: "2026-10-01" },
      ],
      contratos: [
        { etiqueta: "bueno", id: CONTRATO },
        { etiqueta: "malo", id: "C123" },
      ],
    } as unknown as PruebasTestnet;
    const v = pruebasVisibles(p);
    expect(v.transacciones.map((t) => t.etiqueta)).toEqual(["buena"]);
    expect(v.contratos.map((c) => c.etiqueta)).toEqual(["bueno"]);
    expect(v.actualizado).toBe("2026-10-01");
  });
});

describe("contenidoTarjeta (qué pinta 'Compruébalo tú mismo')", () => {
  it("JSON vacío y sin firma anclada → la tarjeta no se pinta", () => {
    expect(contenidoTarjeta(VACIO, null)).toBeNull();
  });

  it("JSON vacío y una firma con tx sembrada → tampoco", () => {
    expect(contenidoTarjeta(VACIO, { tx: "SEEDTX_FOUNDER_ANCHORED_0001", fecha: "2026-09-01" })).toBeNull();
  });

  it("JSON vacío y una firma anclada de verdad → la firma", () => {
    const c = contenidoTarjeta(VACIO, { tx: TX_B, fecha: "2026-09-30" });
    expect(c?.tx?.tx).toBe(TX_B);
    expect(c?.tx?.tipo).toBe("anclaje");
    expect(c?.contratos).toEqual([]);
  });

  it("con transacciones en el JSON manda la ÚLTIMA del arreglo (no la firma)", () => {
    const p: PruebasTestnet = {
      actualizado: "2026-10-01",
      transacciones: [
        { etiqueta: "primera", tipo: "contrato", tx: TX_A, fecha: "2026-10-01" },
        { etiqueta: "última", tipo: "pago", tx: TX_B, fecha: "2026-10-01" },
      ],
      contratos: [{ etiqueta: "Fábrica", id: CONTRATO }],
    };
    const c = contenidoTarjeta(p, { tx: "f".repeat(64), fecha: "2026-09-30" });
    expect(c?.tx?.etiqueta).toBe("última");
    expect(c?.contratos).toHaveLength(1);
  });

  it("solo contratos → se pintan los contratos", () => {
    const c = contenidoTarjeta({ ...VACIO, contratos: [{ etiqueta: "Fábrica", id: CONTRATO }] }, null);
    expect(c?.tx).toBeNull();
    expect(c?.contratos).toHaveLength(1);
  });
});

describe("src/data/pruebas-testnet.json", () => {
  const archivo = path.join(process.cwd(), "src", "data", "pruebas-testnet.json");
  const texto = fs.readFileSync(archivo, "utf8");

  it("tiene la forma del contrato y nada se descarta en silencio", () => {
    const json = JSON.parse(texto) as PruebasTestnet;
    expect(Object.keys(json).sort()).toEqual(["actualizado", "contratos", "transacciones"]);
    expect(Array.isArray(json.transacciones)).toBe(true);
    expect(Array.isArray(json.contratos)).toBe(true);
    const v = pruebasVisibles(PRUEBAS_TESTNET);
    expect(v.transacciones).toHaveLength(json.transacciones.length);
    expect(v.contratos).toHaveLength(json.contratos.length);
  });

  it("si trae datos, la tarjeta tiene una transacción que enlazar", () => {
    if (PRUEBAS_TESTNET.transacciones.length === 0) return;
    const c = contenidoTarjeta(PRUEBAS_TESTNET, null);
    expect(c?.tx && txVerificable(c.tx.tx)).toBe(true);
  });

  it("solo datos públicos: ni cuentas ni llaves secretas de Stellar", () => {
    expect(texto).not.toMatch(/\bG[A-Z2-7]{55}\b/); // cuentas
    expect(texto).not.toMatch(/\bS[A-Z2-7]{55}\b/); // llaves secretas
    expect(texto.toLowerCase()).not.toMatch(/secret|passphrase|seed/);
  });
});

/*
 * Hallazgo de la verificación final: la evidencia casi no se veía. La landing solo
 * muestra la última transacción y ninguna página listaba las demás. /metodo tiene ahora
 * la sección "Compruébalo tú mismo" con TODAS las transacciones y TODOS los contratos.
 */
describe("/metodo · Compruébalo tú mismo con todas las pruebas", () => {
  const html = (p?: PruebasTestnet) =>
    renderToStaticMarkup(React.createElement(PruebasTestnetLista, p ? { pruebas: p } : {}));

  it("pinta cada transacción y cada contrato del JSON, enlazados a stellar.expert de testnet", () => {
    const h = html();
    const v = pruebasVisibles(PRUEBAS_TESTNET);
    expect(v.transacciones.length).toBeGreaterThan(1);
    for (const t of v.transacciones) {
      expect(h).toContain(`href="https://stellar.expert/explorer/testnet/tx/${t.tx}"`);
      expect(h).toContain(t.etiqueta);
    }
    for (const c of v.contratos) {
      expect(h).toContain(`href="https://stellar.expert/explorer/testnet/contract/${c.id}"`);
      expect(h).toContain(c.etiqueta);
    }
    expect(h.match(/stellar\.expert\/explorer\/testnet\/tx\//g) ?? []).toHaveLength(v.transacciones.length);
    expect(h).toContain('id="compruebalo"');
    expect(h).toContain("Compruébalo");
    expect(h).toContain('target="_blank"');
    expect(h).toContain('rel="noopener noreferrer"');
  });

  it("no enlaza lo que no se puede verificar, y sin nada no se pinta", () => {
    const h = html({
      actualizado: null,
      transacciones: [
        { etiqueta: "buena", tipo: "pago", tx: TX_A, fecha: "2026-10-01" },
        { etiqueta: "rota", tipo: "pago", tx: "SEEDTX_X", fecha: "2026-10-01" },
      ],
      contratos: [{ etiqueta: "mal formado", id: "CNO" }],
    });
    expect(h).toContain(TX_A);
    expect(h).not.toContain("SEEDTX_X");
    expect(h).not.toContain("mal formado");
    expect(html(VACIO)).toBe("");
  });

  it("/metodo la incluye y la tarjeta de la landing enlaza a ella", () => {
    const metodo = fs.readFileSync(path.join(process.cwd(), "app", "metodo", "page.tsx"), "utf8");
    expect(metodo).toContain('import PruebasTestnetLista from "@/components/PruebasTestnetLista"');
    expect(metodo).toContain("<PruebasTestnetLista />");
    const tarjeta = fs.readFileSync(path.join(process.cwd(), "src", "components", "PruebaTestnet.tsx"), "utf8");
    expect(tarjeta).toContain('href="/metodo#compruebalo"');
  });
});
