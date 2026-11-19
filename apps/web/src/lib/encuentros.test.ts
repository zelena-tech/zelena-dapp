import { describe, it, expect } from "vitest";
import { diasPara, fechaLarga } from "./encuentros";

describe("encuentros · fechas", () => {
  const hoy = new Date(2026, 8, 29, 23, 30); // 29 sep 2026, tarde en la noche

  it("cuenta días enteros sin importar la hora del día", () => {
    expect(diasPara("2026-09-29", hoy)).toBe(0);
    expect(diasPara("2026-09-30", hoy)).toBe(1);
    expect(diasPara("2026-10-24", hoy)).toBe(25);
  });

  it("un encuentro que ya pasó da negativo (la página lo oculta)", () => {
    expect(diasPara("2026-09-28", hoy)).toBe(-1);
  });

  it("muestra la fecha en español sin correrse de día por la zona horaria", () => {
    expect(fechaLarga("2026-10-24")).toBe("24 de octubre de 2026");
  });
});
