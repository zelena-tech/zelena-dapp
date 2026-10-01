/**
 * WP31-E1 · etiquetas del Ágora (criterio E1-4). El valor de la base no cambia;
 * lo que cambia es lo que se ve: Cliente / Comunidad y estados en español.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ESTADO_PROYECTO_LABEL,
  REEMPLAZO_DECISION,
  TIPO_PROYECTO_LABEL,
  esActaDeRito,
  esDecisionReemplazada,
  esTipoCliente,
  etiquetaEstado,
  etiquetaTipo,
  huellaCorta,
  queryDesdeTipo,
  tipoDesdeEtiqueta,
  tipoDesdeQuery,
} from "./agora-labels";
import { PROJECT_STATES } from "./state-machine";

// Valores internos tal cual viven en `projects.type` (schema y seed).
const CLIENTE = "SAS";
const COMUNIDAD = "DAO";

describe("etiquetas de tipo y estado", () => {
  it("el tipo se ve como Cliente o Comunidad", () => {
    expect(TIPO_PROYECTO_LABEL[CLIENTE]).toBe("Cliente");
    expect(TIPO_PROYECTO_LABEL[COMUNIDAD]).toBe("Comunidad");
    expect(etiquetaTipo(CLIENTE)).toBe("Cliente");
    expect(etiquetaTipo("otra-cosa")).toBe("otra-cosa");
    expect(esTipoCliente(CLIENTE)).toBe(true);
    expect(esTipoCliente(COMUNIDAD)).toBe(false);
  });

  it("los cinco estados del proyecto tienen nombre en español", () => {
    expect(ESTADO_PROYECTO_LABEL).toEqual({
      Open: "Abierto",
      Assigned: "Asignado",
      Delivered: "Entregado",
      Scored: "Evaluado",
      Distributed: "Recompensas repartidas",
    });
    for (const s of PROJECT_STATES) expect(etiquetaEstado(s)).not.toBe(s);
    expect(etiquetaEstado("Raro")).toBe("Raro");
  });
});

describe("tipo en la URL del Ágora", () => {
  it("acepta cliente|comunidad y el valor heredado, sin distinguir mayúsculas", () => {
    expect(tipoDesdeQuery("cliente")).toBe(CLIENTE);
    expect(tipoDesdeQuery("Cliente")).toBe(CLIENTE);
    expect(tipoDesdeQuery("clientes")).toBe(CLIENTE);
    expect(tipoDesdeQuery("comunidad")).toBe(COMUNIDAD);
    expect(tipoDesdeQuery(CLIENTE)).toBe(CLIENTE);
    expect(tipoDesdeQuery(COMUNIDAD.toLowerCase())).toBe(COMUNIDAD);
  });

  it("cualquier otra cosa es 'sin filtro'", () => {
    expect(tipoDesdeQuery(undefined)).toBeUndefined();
    expect(tipoDesdeQuery("")).toBeUndefined();
    expect(tipoDesdeQuery("Todos")).toBeUndefined();
    expect(tipoDesdeQuery("'; DROP TABLE projects; --")).toBeUndefined();
  });

  it("ida y vuelta entre valor interno, URL y etiqueta del formulario", () => {
    expect(queryDesdeTipo(CLIENTE)).toBe("cliente");
    expect(queryDesdeTipo(COMUNIDAD)).toBe("comunidad");
    expect(tipoDesdeQuery(queryDesdeTipo(CLIENTE))).toBe(CLIENTE);
    expect(tipoDesdeQuery(queryDesdeTipo(COMUNIDAD))).toBe(COMUNIDAD);
    expect(tipoDesdeEtiqueta("cliente")).toBe(CLIENTE);
    expect(tipoDesdeEtiqueta("comunidad")).toBe(COMUNIDAD);
  });
});

describe("decisiones", () => {
  it("reconoce la decisión histórica con la etiqueta vieja, y solo esa", () => {
    expect(
      esDecisionReemplazada(
        `Se abren las dos primeras campañas (5 proyectos) etiquetadas ${CLIENTE}, con hitos y pagos en testnet.`
      )
    ).toBe(true);
    expect(esDecisionReemplazada("…las dos primeras campañas (5 proyectos) etiquetadas como proyectos de cliente…")).toBe(false);
    expect(
      esDecisionReemplazada(
        "Desde hoy los proyectos se etiquetan como de un cliente o de la comunidad. El valor interno no cambia y la decisión anterior se conserva tal cual, con su huella."
      )
    ).toBe(false);
    expect(REEMPLAZO_DECISION).toBe("Las etiquetas de proyecto pasan a Cliente y Comunidad");
  });

  it("las actas de rito empiezan por 'Rito '", () => {
    expect(esActaDeRito("Rito Demo quincenal del 2026-10-09 cerrado · 4 asistentes")).toBe(true);
    expect(esActaDeRito("Ritos de la comunidad")).toBe(false);
    expect(esActaDeRito("Genoma v2")).toBe(false);
  });

  it("huella corta", () => {
    const h = "a".repeat(64);
    expect(huellaCorta({ hash: h })).toBe("a".repeat(16) + "…");
    expect(huellaCorta({ hash: h }, 32)).toBe("a".repeat(32) + "…");
    expect(huellaCorta({ hash: "abc" })).toBe("abc");
  });
});

describe("límite cliente/servidor", () => {
  it("agora-labels.ts no importa nada (lo usa ui.tsx, que también se carga en el cliente)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "agora-labels.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
