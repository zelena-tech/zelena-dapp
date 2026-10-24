/**
 * Renderizador Markdown propio (src/components/Markdown.tsx) con el texto legal real.
 *
 * Hallazgo de la verificación final: /acuerdo (y el paso de firma de /entrar) pintaban
 * mal el CLA. Sus cláusulas parten línea con 3 espacios de sangría, el renderizador no
 * admitía continuaciones y salían 5 listas numeradas 1, 1, 2, 1, 1 con `**` sueltos.
 * CLA.md no se toca: su sha256 es lo que firman las altas.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, tokenize } from "../components/Markdown";

const WEB = process.cwd();
const CLA_RAIZ = fs.readFileSync(path.join(WEB, "..", "..", "CLA.md"), "utf8");
const CLA_APP = fs.readFileSync(path.join(WEB, "CLA.md"), "utf8");

const html = (md: string) => renderToStaticMarkup(React.createElement(Markdown, { source: md }));
/** Texto visible (sin etiquetas) de un HTML. */
const texto = (h: string) => h.replace(/<[^>]+>/g, "");

describe("Markdown con el CLA real", () => {
  it("el CLA sigue siendo el que se firma (sha256 03293c93…)", () => {
    for (const cla of [CLA_RAIZ, CLA_APP]) {
      expect(createHash("sha256").update(Buffer.from(cla, "utf8")).digest("hex")).toBe(
        "03293c9378146cbd7fcbd49a0df467134a118d7a7e0379664c5d069c0398edb9"
      );
    }
  });

  it("las 5 cláusulas salen en UNA sola lista numerada", () => {
    const listas = tokenize(CLA_RAIZ).filter((t) => t.t === "ol");
    expect(listas).toHaveLength(1);
    const items = (listas[0] as { t: "ol"; items: string[] }).items;
    expect(items).toHaveLength(5);
    expect(items.map((i) => /^\*\*([^*]+)\*\*/.exec(i)?.[1])).toEqual([
      "Cesión de derechos patrimoniales.",
      "Derechos morales.",
      "Originalidad.",
      "Sin relación laboral.",
      "Identidad.",
    ]);
    // Cada cláusula conserva su texto completo, también lo que venía en la línea partida.
    expect(items[0]).toContain("constituida)** la totalidad de los derechos patrimoniales");
    expect(items[0]).toContain("351/1993, Ley 1915/2018");
    expect(items[3]).toContain("no constituyen salario.");
    expect(items[4]).toContain("firmar este CLA anclando su hash on-chain.");
  });

  it("en el HTML: un solo <ol>, 5 <li> y ningún ** a la vista", () => {
    const h = html(CLA_RAIZ);
    expect(h.match(/<ol\b/g) ?? []).toHaveLength(1);
    const ol = h.slice(h.indexOf("<ol"), h.indexOf("</ol>"));
    expect(ol.match(/<li>/g) ?? []).toHaveLength(5);
    expect(texto(h)).not.toContain("**");
    // La negrita que cruzaba de línea ahora es una sola.
    expect(h).toContain("<strong");
    expect(texto(h)).toContain("una vez constituida) la totalidad de los derechos patrimoniales");
    expect(texto(h)).toContain("Cede a Zelena (y a Zelena ");
  });

  it("no se come nada: cita final y párrafos siguen ahí", () => {
    const tipos = tokenize(CLA_RAIZ).map((t) => t.t);
    expect(tipos).toEqual(["h", "p", "p", "ol", "p", "quote"]);
  });
});

describe("Markdown: listas y continuaciones", () => {
  it("una línea sangrada continúa el ítem anterior (también en listas con viñeta)", () => {
    expect(tokenize("- uno\n  sigue uno\n- dos")).toEqual([{ t: "ul", items: ["uno sigue uno", "dos"] }]);
    expect(tokenize("1. a\n   b\n2. c")).toEqual([{ t: "ol", items: ["a b", "c"] }]);
  });

  it("una línea sin sangría después de la lista es un párrafo aparte", () => {
    expect(tokenize("1. a\n2. b\nfin")).toEqual([
      { t: "ol", items: ["a", "b"] },
      { t: "p", text: "fin" },
    ]);
  });

  it("una línea en blanco cierra la lista", () => {
    expect(tokenize("- a\n\n  sangrada")).toEqual([
      { t: "ul", items: ["a"] },
      { t: "p", text: "  sangrada" },
    ]);
  });

  it("una sublista sangrada no se pega como texto al ítem anterior", () => {
    expect(tokenize("1. a\n   - sub\n2. b")).toEqual([
      { t: "ol", items: ["a"] },
      { t: "ul", items: ["sub"] },
      { t: "ol", items: ["b"] },
    ]);
  });
});
