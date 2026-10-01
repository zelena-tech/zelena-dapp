/**
 * WP31-D · ritos: cadencia, ventana y copy (criterio D1 y la parte de D8 que toca a
 * este módulo). Todo puro: sin base, con la cadencia por defecto del genoma.
 *
 * Calendario de referencia (America/Bogota, UTC−5, sin horario de verano):
 * jue 1 oct 2026. Sync: lunes 09:00 (14:00 UTC). Demo: viernes 16:00 (21:00 UTC)
 * cada dos semanas desde el ancla 2026-10-09. Retro: primer lunes 10:00 (15:00 UTC).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { GENOME_DEFAULTS, type Genome } from "./genome";
import {
  AUDIENCIA_LABEL,
  RITE_KINDS,
  RITE_LABEL,
  cadenciaValida,
  cuandoRito,
  dentroDeVentana,
  duracionTexto,
  elegirProximo,
  esOcurrenciaValida,
  fechaLargaRito,
  fechaRito,
  horaRito,
  margenTexto,
  normalizarCodigo,
  personasRegistradas,
  proximasOcurrencias,
  proximoRitoTexto,
  ventanaRito,
  zonaTexto,
} from "./ritos-labels";

const CAD = GENOME_DEFAULTS.RITES_CADENCE;
const TZ = GENOME_DEFAULTS.BUSINESS_TZ;
const AHORA = new Date("2026-10-01T12:00:00.000Z"); // jueves 07:00 en Bogotá

const iso = (o: { inicio: Date }) => o.inicio.toISOString();

describe("D1 · proximasOcurrencias calcula la cadencia del genoma", () => {
  it("sync lunes 09:00, demo quincenal desde el ancla y retro el primer lunes 10:00, en orden", () => {
    const os = proximasOcurrencias(CAD, AHORA, TZ, 6);
    expect(os.map((o) => `${o.kind}@${iso(o)}`)).toEqual([
      "sync@2026-10-05T14:00:00.000Z",
      "retro@2026-10-05T15:00:00.000Z",
      "demo@2026-10-09T21:00:00.000Z",
      "sync@2026-10-12T14:00:00.000Z",
      "sync@2026-10-19T14:00:00.000Z",
      "demo@2026-10-23T21:00:00.000Z",
    ]);
    expect(os[0].duracionMin).toBe(30);
    expect(os[2].duracionMin).toBe(60);
  });

  it("con audiencia 'comunidad' no aparece el sync (es del equipo)", () => {
    const os = proximasOcurrencias(CAD, AHORA, TZ, 5, "comunidad");
    expect(os.map((o) => `${o.kind}@${iso(o)}`)).toEqual([
      "retro@2026-10-05T15:00:00.000Z",
      "demo@2026-10-09T21:00:00.000Z",
      "demo@2026-10-23T21:00:00.000Z",
      "retro@2026-11-02T15:00:00.000Z",
      "demo@2026-11-06T21:00:00.000Z",
    ]);
    expect(proximasOcurrencias(CAD, AHORA, TZ, 5, "equipo").every((o) => o.kind === "sync")).toBe(true);
  });

  it("el primer lunes se calcula por mes (diciembre de 2026 empieza en martes)", () => {
    const retros = proximasOcurrencias({ ...CAD }, AHORA, TZ, 20).filter((o) => o.kind === "retro").map(iso);
    expect(retros.slice(0, 3)).toEqual([
      "2026-10-05T15:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
      "2026-12-07T15:00:00.000Z",
    ]);
  });

  it("un rito en curso sigue siendo 'próximo'; uno que ya terminó, no", () => {
    expect(iso(proximasOcurrencias(CAD, new Date("2026-10-05T14:10:00Z"), TZ, 1)[0])).toBe("2026-10-05T14:00:00.000Z");
    expect(iso(proximasOcurrencias(CAD, new Date("2026-10-05T14:30:00Z"), TZ, 1)[0])).toBe("2026-10-05T15:00:00.000Z");
  });

  it("la serie quincenal empieza en su ancla (no inventa demos anteriores)", () => {
    const os = proximasOcurrencias(CAD, new Date("2026-08-01T00:00:00Z"), TZ, 10, "comunidad");
    expect(os.filter((o) => o.kind === "retro").map(iso).slice(0, 2)).toEqual([
      "2026-08-03T15:00:00.000Z",
      "2026-09-07T15:00:00.000Z",
    ]);
    expect(iso(os.filter((o) => o.kind === "demo")[0])).toBe("2026-10-09T21:00:00.000Z");
  });

  it("en una zona con horario de verano la hora local se mantiene (09:00 antes y después del cambio)", () => {
    const tz = "America/New_York"; // el horario de verano termina el 1 nov 2026
    const syncs = proximasOcurrencias(CAD, new Date("2026-10-24T00:00:00Z"), tz, 2, "equipo").map(iso);
    expect(syncs).toEqual(["2026-10-26T13:00:00.000Z", "2026-11-02T14:00:00.000Z"]);
  });

  it("una cadencia mal escrita en el genoma no tumba nada: ese rito deja de anunciarse", () => {
    const rota = {
      ...CAD,
      demo: { ...CAD.demo, ancla: "2026-10-08" }, // jueves: no coincide con su día
      retro: { ...CAD.retro, hora: "25:00" },
    } as Genome["RITES_CADENCE"];
    const os = proximasOcurrencias(rota, AHORA, TZ, 10);
    expect(os.every((o) => o.kind === "sync")).toBe(true);
    expect(os).toHaveLength(10);
    expect(proximasOcurrencias(undefined as unknown as Genome["RITES_CADENCE"], AHORA, TZ, 3)).toEqual([]);
    expect(proximasOcurrencias(CAD, AHORA, TZ, 0)).toEqual([]);
    expect(cadenciaValida(CAD.sync)).toBe(true);
    expect(cadenciaValida({ frecuencia: "diaria", dia_semana: 1, hora: "09:00", duracion_min: 30 })).toBe(false);
  });
});

describe("esOcurrenciaValida · solo fechas reales de la cadencia y cercanas", () => {
  const valida = (kind: "sync" | "demo" | "retro", inicio: string, ahora = AHORA) =>
    esOcurrenciaValida(CAD, kind, new Date(inicio), TZ, ahora);

  it("acepta las ocurrencias exactas", () => {
    expect(valida("demo", "2026-10-09T21:00:00Z")).toBe(true);
    expect(valida("sync", "2026-10-05T14:00:00Z")).toBe(true);
    expect(valida("retro", "2026-11-02T15:00:00Z")).toBe(true);
  });

  it("rechaza otro día, otra hora o la semana de descanso de la demo", () => {
    expect(valida("demo", "2026-10-16T21:00:00Z")).toBe(false); // viernes de por medio
    expect(valida("demo", "2026-10-09T20:00:00Z")).toBe(false); // 15:00 en Bogotá
    expect(valida("retro", "2026-10-12T15:00:00Z")).toBe(false); // segundo lunes
    expect(valida("sync", "2026-10-06T14:00:00Z")).toBe(false); // martes
  });

  it("rechaza lo que queda fuera de [ahora − 24 h, ahora + 60 d]", () => {
    expect(valida("sync", "2026-10-05T14:00:00Z", new Date("2026-10-06T15:00:00Z"))).toBe(false); // 25 h antes
    expect(valida("sync", "2026-10-05T14:00:00Z", new Date("2026-10-06T13:00:00Z"))).toBe(true); // 23 h antes
    expect(valida("sync", "2026-12-07T14:00:00Z")).toBe(false); // > 60 días
    expect(valida("sync", "fecha" as string)).toBe(false);
  });
});

describe("ventana del rito", () => {
  it("es [inicio − margen, inicio + duración + margen]", () => {
    const v = ventanaRito(new Date("2026-10-05T14:00:00Z"), 30, GENOME_DEFAULTS.RITE_WINDOW_MIN);
    expect(v.abre.toISOString()).toBe("2026-10-05T13:30:00.000Z");
    expect(v.cierra.toISOString()).toBe("2026-10-05T15:00:00.000Z");
    expect(dentroDeVentana(new Date("2026-10-05T13:30:00Z"), v)).toBe(true);
    expect(dentroDeVentana(new Date("2026-10-05T15:00:00Z"), v)).toBe(true);
    expect(dentroDeVentana(new Date("2026-10-05T13:29:59Z"), v)).toBe(false);
    expect(dentroDeVentana(new Date("2026-10-05T15:00:01Z"), v)).toBe(false);
  });
});

describe("normalizarCodigo", () => {
  it("acepta espacios, guiones y dígitos de ancho completo; rechaza lo que no es un código", () => {
    expect(normalizarCodigo("123456")).toBe("123456");
    expect(normalizarCodigo(" 123 456 ")).toBe("123456");
    expect(normalizarCodigo("123-456")).toBe("123456");
    expect(normalizarCodigo("１２３４５６")).toBe("123456");
    expect(normalizarCodigo("12345")).toBeNull();
    expect(normalizarCodigo("1234567")).toBeNull();
    expect(normalizarCodigo("12a456")).toBeNull();
    expect(normalizarCodigo(123456)).toBeNull();
  });
});

describe("copy de los ritos (§8.4)", () => {
  it("nombres, descripciones y audiencias", () => {
    expect(RITE_KINDS).toEqual(["sync", "demo", "retro"]);
    expect(RITE_LABEL.sync).toEqual({
      nombre: "Sync semanal",
      descripcion: "Qué avanzó, qué está trabado y qué sigue.",
      audiencia: "equipo",
    });
    expect(RITE_LABEL.demo.nombre).toBe("Demo quincenal");
    expect(RITE_LABEL.demo.audiencia).toBe("comunidad");
    expect(RITE_LABEL.retro.nombre).toBe("Retro mensual");
    expect(RITE_LABEL.retro.audiencia).toBe("comunidad");
    expect(AUDIENCIA_LABEL.equipo).toBe("Del equipo y de quien trabaja en un proyecto.");
    expect(AUDIENCIA_LABEL.comunidad).toBe("Abierta a la comunidad.");
  });

  it("cuándo, cuánto y en qué zona, derivado del genoma", () => {
    expect(cuandoRito(CAD.sync)).toBe("Cada lunes a las 09:00");
    expect(cuandoRito(CAD.demo)).toBe("Un viernes sí y otro no, a las 16:00");
    expect(cuandoRito(CAD.retro)).toBe("El primer lunes de cada mes, a las 10:00");
    expect(cuandoRito({ frecuencia: "otra" })).toBeNull();
    expect(duracionTexto(30)).toBe("30 min");
    expect(duracionTexto(60)).toBe("1 h");
    expect(duracionTexto(90)).toBe("1 h 30 min");
    expect(margenTexto(30)).toBe("media hora");
    expect(margenTexto(60)).toBe("una hora");
    expect(margenTexto(15)).toBe("15 minutos");
    expect(zonaTexto("America/Bogota")).toBe("hora de Bogotá");
    expect(zonaTexto("America/Mexico_City")).toBe("hora de Mexico City");
  });

  it("fechas y horas en la zona del genoma, no en la del servidor", () => {
    const d = new Date("2026-10-10T02:30:00Z"); // viernes 21:30 en Bogotá; ya sábado en UTC
    expect(fechaRito(d, TZ)).toBe("viernes 9 de octubre");
    expect(fechaLargaRito(d, TZ)).toBe("9 de octubre de 2026");
    expect(horaRito(d, TZ)).toBe("21:30");
  });

  it("solo conteos, nunca nombres", () => {
    expect(personasRegistradas(0)).toBe("0 personas registradas");
    expect(personasRegistradas(1)).toBe("1 persona registrada");
    expect(personasRegistradas(7)).toBe("7 personas registradas");
  });
});

describe("lo próximo en la landing (§8.1)", () => {
  it("«Próxima demo: viernes 16:00» en la zona del genoma, con el día aparte", () => {
    expect(proximoRitoTexto("demo", new Date("2026-10-09T21:00:00Z"), TZ)).toEqual({
      titulo: "Próxima demo",
      cuando: "viernes 16:00",
      fecha: "9 de octubre",
    });
    // 21:30 del viernes en Bogotá ya es sábado en UTC: manda la zona del genoma.
    expect(proximoRitoTexto("retro", new Date("2026-10-10T02:30:00Z"), TZ)).toEqual({
      titulo: "Próxima retro",
      cuando: "viernes 21:30",
      fecha: "9 de octubre",
    });
  });

  it("elegirProximo: lo que llegue antes; el mismo día gana el encuentro; sin nada, null", () => {
    const demo = new Date("2026-10-09T21:00:00Z"); // viernes 9 en Bogotá
    expect(elegirProximo(null, null, TZ)).toBeNull();
    expect(elegirProximo(null, demo, TZ)).toBe("rito");
    expect(elegirProximo("2026-10-20", null, TZ)).toBe("encuentro");
    expect(elegirProximo("2026-10-08", demo, TZ)).toBe("encuentro");
    expect(elegirProximo("2026-10-09", demo, TZ)).toBe("encuentro");
    expect(elegirProximo("2026-10-10", demo, TZ)).toBe("rito");
    // El día del rito es el de Bogotá: el viernes 21:30 local no "pasa" al sábado.
    expect(elegirProximo("2026-10-10", new Date("2026-10-10T02:30:00Z"), TZ)).toBe("rito");
    expect(elegirProximo("no-es-fecha", demo, TZ)).toBe("rito");
    expect(elegirProximo("2026-10-10", new Date("x"), TZ)).toBe("encuentro");
  });
});

describe("D8 (parte de este módulo) · ritos-labels.ts es apto para cliente", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "ritos-labels.ts"), "utf8");
  const imports = src.split("\n").filter((l) => /^\s*import\b/.test(l));

  it("no importa crypto, la base, la sesión ni nada con node:", () => {
    expect(imports.length).toBeGreaterThan(0);
    for (const l of imports) {
      if (/^\s*import type\b/.test(l)) continue; // los tipos se borran al compilar
      expect(l).not.toMatch(/crypto|["']\.\/db["']|["']@\/lib\/db["']|session|node:|ritos-codigo|["']\.\/ritos["']/);
    }
  });

  it("no usa la hora del servidor (today, getHours, getDate)", () => {
    expect(src).not.toMatch(/\btoday\(|\.getHours\(|\.getDate\(/);
  });
});
