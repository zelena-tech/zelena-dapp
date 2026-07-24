import { describe, it, expect } from "vitest";
import { computeFitness, recommend, DEFAULT_FITNESS_WEIGHTS } from "./fitness";

describe("computeFitness (WP07 — puro)", () => {
  it("calcula el score como media ponderada de los componentes con datos", () => {
    const r = computeFitness({
      activeUsersPrev: 10,
      retainedUsers: 8, // retención 0.8
      deliveryQuality: [1, 0.5], // calidad 0.75
      checkins: 5,
      expectedCheckins: 10, // participación 0.5
      disputes: 1,
      totalDeliveries: 10, // ausencia de disputas = 0.9
    });
    // pesos default: 0.35/0.35/0.2/0.1 (suman 1) → todos aplicables
    const expected = 0.8 * 0.35 + 0.75 * 0.35 + 0.5 * 0.2 + 0.9 * 0.1;
    expect(r.score).toBeCloseTo(expected, 6);
    expect(r.applicableWeight).toBeCloseTo(1, 6);
    expect(r.components).toHaveLength(4);
  });

  it("degradación explícita: componentes sin datos se excluyen y NO rompen", () => {
    const r = computeFitness({ activeUsersPrev: 4, retainedUsers: 3 }); // solo retención (0.75)
    expect(r.score).toBeCloseTo(0.75, 6); // renormalizado por el único peso aplicable
    expect(r.applicableWeight).toBeCloseTo(DEFAULT_FITNESS_WEIGHTS.retention, 6);
    const missing = r.components.filter((c) => c.value === null);
    expect(missing).toHaveLength(3);
    expect(missing.every((c) => !!c.note)).toBe(true); // cada ausencia tiene nota
  });

  it("sin ningún dato: score 0 sin lanzar", () => {
    const r = computeFitness({});
    expect(r.score).toBe(0);
    expect(r.applicableWeight).toBe(0);
    expect(r.components).toHaveLength(4);
  });

  it("la tasa de disputas es negativa (más disputas → menor fitness)", () => {
    const pocas = computeFitness({ disputes: 0, totalDeliveries: 10 });
    const muchas = computeFitness({ disputes: 8, totalDeliveries: 10 });
    expect(pocas.score).toBeGreaterThan(muchas.score);
  });

  it("respeta pesos del genoma (meta-parámetros mutables)", () => {
    const soloRetencion = computeFitness(
      { activeUsersPrev: 2, retainedUsers: 1, deliveryQuality: [0] },
      { retention: 1, quality: 0, participation: 0, disputes: 0 }
    );
    // quality=0 con peso 0 no contribuye; retención 0.5 con peso 1 domina
    expect(soloRetencion.score).toBeCloseTo(0.5, 6);
  });
});

describe("recommend (keep / revert) — el algoritmo propone, el humano firma", () => {
  it("época mejor que la anterior → keep", () => {
    expect(recommend(0.8, 0.5)).toBe("keep");
  });
  it("época peor que la anterior → revert", () => {
    expect(recommend(0.5, 0.8)).toBe("revert");
  });
  it("empate → keep (no se revierte sin evidencia de empeoramiento)", () => {
    expect(recommend(0.7, 0.7)).toBe("keep");
  });
  it("primera época (sin anterior) → keep", () => {
    expect(recommend(0.6, null)).toBe("keep");
  });
});
