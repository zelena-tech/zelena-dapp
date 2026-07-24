import { describe, it, expect } from "vitest";
import { simulate, compareGenomes, genomePreset, SANE_EMISSION_CEILING, type SimConfig } from "./sim";
import { GENOME_V1, type Genome } from "./genome";

describe("simulador ABM (WP11)", () => {
  it("corre 1.000 épocas con 25 agentes en bastante menos de 1 min", () => {
    const start = Date.now();
    const r = simulate({ genome: genomePreset("v1"), epochs: 1000, population: 25 });
    const elapsedMs = Date.now() - start;
    expect(r.epochs).toBe(1000);
    expect(r.population).toBe(25);
    expect(elapsedMs).toBeLessThan(10_000); // margen amplio; el bucle es O(épocas·agentes)
    expect(r.pointsEmitted).toBeGreaterThan(0);
  });

  it("reporta emisión, Gini de reputación y captura de farmers", () => {
    const r = simulate({ genome: GENOME_V1, epochs: 50, population: 25 });
    expect(r.gini).toBeGreaterThanOrEqual(0);
    expect(r.gini).toBeLessThanOrEqual(1);
    expect(r.farmerCapturePct).toBeGreaterThanOrEqual(0);
    expect(r.farmerCapturePct).toBeLessThanOrEqual(1);
    // Con el genoma v1 la emisión media por época está por debajo del techo de seguridad.
    expect(r.emissionAlert).toBe(false);
    // Todas las estrategias representadas.
    expect(Object.keys(r.byStrategy)).toHaveLength(5);
  });

  it("un genoma con presupuesto ~infinito dispara la alerta de emisión (sanity check)", () => {
    const unbounded: Genome = { ...GENOME_V1, EPOCH_BUDGET: 100_000_000, ACADEMIA_BUDGET: 100_000_000 };
    const r = simulate({ genome: unbounded, epochs: 20, population: 25 });
    expect(r.pointsPerEpoch).toBeGreaterThan(SANE_EMISSION_CEILING);
    expect(r.emissionAlert).toBe(true);
  });

  it("el reporte A/B muestra diferencias explicables entre dos genomas distintos", () => {
    const base: Omit<SimConfig, "genome"> = { epochs: 60, population: 25 };
    // B abre mucho más presupuesto de Academia → los farmers capturan más.
    const genomeB: Genome = { ...GENOME_V1, ACADEMIA_BUDGET: 60_000 };
    const ab = compareGenomes(GENOME_V1, genomeB, base);

    expect(ab.b.farmerCapturePct).toBeGreaterThan(ab.a.farmerCapturePct);
    expect(ab.deltas.farmerCapturePct).toBeGreaterThan(0);
    // Y la emisión total de B es mayor (más Academia pagada).
    expect(ab.deltas.pointsEmitted).toBeGreaterThan(0);
  });

  it("genomePreset('v1') es el genoma canónico y rechaza nombres desconocidos", () => {
    expect(genomePreset("v1")).toEqual(GENOME_V1);
    expect(() => genomePreset("v99")).toThrow(/desconocido/i);
  });
});
