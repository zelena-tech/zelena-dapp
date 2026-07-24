import { describe, it, expect } from "vitest";
import { violatesB8, withinEpochBudget } from "./rules";

describe("regla B8 (no evaluar a tu invitado directo)", () => {
  it("viola cuando el supervisor es el invitador directo", () => {
    expect(violatesB8("SUP", "SUP")).toBe(true);
  });
  it("no viola cuando el invitador es otro", () => {
    expect(violatesB8("SUP", "OTRO")).toBe(false);
  });
  it("no viola cuando no hay invitador", () => {
    expect(violatesB8("SUP", null)).toBe(false);
  });
});

describe("presupuesto de época", () => {
  it("permite emisión dentro del techo", () => {
    expect(withinEpochBudget(90_000, 5_000, 100_000)).toBe(true);
  });
  it("rechaza emisión que excede el techo", () => {
    expect(withinEpochBudget(98_000, 5_000, 100_000)).toBe(false);
  });
  it("permite alcanzar exactamente el techo", () => {
    expect(withinEpochBudget(95_000, 5_000, 100_000)).toBe(true);
  });
});
