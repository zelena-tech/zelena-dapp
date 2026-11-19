/**
 * WP31-E1 · responsable del tratamiento en /privacidad. El nombre legal y el correo
 * no viven en el repositorio: salen del entorno, con un respaldo honesto.
 */
import { describe, it, expect } from "vitest";
import { responsableTratamiento } from "./legal";

describe("responsableTratamiento", () => {
  it("sin variables: 'Zelena' y sin correo (el canal es el formulario de contacto)", () => {
    expect(responsableTratamiento({} as NodeJS.ProcessEnv)).toEqual({ nombre: "Zelena", contacto: null });
  });

  it("con variables: las usa, sin espacios de sobra", () => {
    const env = { ZELENA_LEGAL_NAME: "  Nombre Legal de Prueba  ", ZELENA_PRIVACY_EMAIL: " datos@example.com " };
    expect(responsableTratamiento(env as unknown as NodeJS.ProcessEnv)).toEqual({
      nombre: "Nombre Legal de Prueba",
      contacto: "datos@example.com",
    });
  });

  it("variables vacías cuentan como ausentes", () => {
    const env = { ZELENA_LEGAL_NAME: "   ", ZELENA_PRIVACY_EMAIL: "" };
    expect(responsableTratamiento(env as unknown as NodeJS.ProcessEnv)).toEqual({ nombre: "Zelena", contacto: null });
  });
});
