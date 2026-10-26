import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb } from "./db";
import { diaLocal, diaSemanaIso, horaLocal, instanteDb, instanteLocal, parseInstanteDb } from "./zona-horaria";

const BOGOTA = "America/Bogota";

describe("zona-horaria (WP31 §5.0, criterio B1b)", () => {
  it("instanteDb escribe el mismo formato que el default de SQLite (UTC, sin Z)", () => {
    const db = openDb(":memory:");
    const { ahora } = db.prepare(`SELECT datetime('now') AS ahora`).get() as { ahora: string };
    expect(ahora).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(instanteDb(new Date("2026-10-01T04:30:15.987Z"))).toBe("2026-10-01 04:30:15");
    // Mismo formato, mismo largo: compara como texto igual que las filas con el default.
    expect(instanteDb(new Date()).length).toBe(ahora.length);
    // Y la base lo lee como el mismo instante.
    const { iso } = db.prepare(`SELECT strftime('%Y-%m-%dT%H:%M:%SZ', ?) AS iso`).get(instanteDb(new Date("2026-10-01T04:30:15Z"))) as {
      iso: string;
    };
    expect(iso).toBe("2026-10-01T04:30:15Z");
  });

  it("parseInstanteDb lee el formato de SQLite como UTC y el ISO tal cual", () => {
    expect(parseInstanteDb("2026-10-01 04:30:00").toISOString()).toBe("2026-10-01T04:30:00.000Z");
    expect(parseInstanteDb("2026-10-01T04:30:00Z").toISOString()).toBe("2026-10-01T04:30:00.000Z");
    expect(parseInstanteDb("2026-10-01T04:30:00.250Z").toISOString()).toBe("2026-10-01T04:30:00.250Z");
    expect(parseInstanteDb("2026-09-30T23:30:00-05:00").toISOString()).toBe("2026-10-01T04:30:00.000Z");
    // ISO sin zona: también UTC (nunca la hora local del servidor).
    expect(parseInstanteDb("2026-10-01T04:30").toISOString()).toBe("2026-10-01T04:30:00.000Z");
    expect(parseInstanteDb("2026-10-01").toISOString()).toBe("2026-10-01T00:00:00.000Z");
    // Ida y vuelta con instanteDb.
    const d = new Date("2026-12-31T23:59:59.000Z");
    expect(parseInstanteDb(instanteDb(d)).getTime()).toBe(d.getTime());
    // Lo ilegible da una fecha inválida, sin lanzar.
    expect(Number.isNaN(parseInstanteDb("ayer").getTime())).toBe(true);
  });

  it("parseInstanteDb no depende de la zona del proceso", () => {
    // El formato sin Z se arma con Date.UTC: el resultado es el mismo con cualquier TZ.
    const prev = process.env.TZ;
    try {
      process.env.TZ = "America/Bogota";
      expect(parseInstanteDb("2026-10-01 04:30:00").toISOString()).toBe("2026-10-01T04:30:00.000Z");
    } finally {
      process.env.TZ = prev;
    }
  });

  it("frontera 23:30 de Bogotá (04:30 UTC del día siguiente): diaLocal da el día de Bogotá", () => {
    const instante = parseInstanteDb("2026-10-02 04:30:00"); // jueves 1 de octubre, 23:30 en Bogotá
    expect(diaLocal(instante, BOGOTA)).toBe("2026-10-01");
    expect(horaLocal(instante, BOGOTA)).toBe(23);
    // En UTC ya es el día siguiente.
    expect(diaLocal(instante, "UTC")).toBe("2026-10-02");
    expect(horaLocal(instante, "UTC")).toBe(4);
    // Medianoche local: hora 0 (nunca 24).
    expect(horaLocal(new Date("2026-10-02T05:00:00Z"), BOGOTA)).toBe(0);
    expect(diaLocal(new Date("2026-10-02T05:00:00Z"), BOGOTA)).toBe("2026-10-02");
  });

  it("diaSemanaIso: 1 = lunes … 7 = domingo", () => {
    expect(diaSemanaIso("2026-10-05")).toBe(1); // lunes
    expect(diaSemanaIso("2026-10-09")).toBe(5); // viernes (ancla de la demo)
    expect(diaSemanaIso("2026-10-10")).toBe(6);
    expect(diaSemanaIso("2026-10-11")).toBe(7); // domingo
    expect(() => diaSemanaIso("2026-02-30")).toThrow(RangeError);
    expect(() => diaSemanaIso("05/10/2026")).toThrow(RangeError);
  });

  it("instanteLocal: hora local → instante, ida y vuelta", () => {
    const i = instanteLocal("2026-10-05", "09:00", BOGOTA);
    expect(i.toISOString()).toBe("2026-10-05T14:00:00.000Z"); // Bogotá = UTC−5
    expect(diaLocal(i, BOGOTA)).toBe("2026-10-05");
    expect(horaLocal(i, BOGOTA)).toBe(9);

    // Las 23:30 locales caen en el día siguiente en UTC y vuelven al mismo día local.
    const noche = instanteLocal("2026-10-01", "23:30", BOGOTA);
    expect(noche.toISOString()).toBe("2026-10-02T04:30:00.000Z");
    expect(diaLocal(noche, BOGOTA)).toBe("2026-10-01");

    // Sin constantes de zona: funciona con horario de verano (Madrid, UTC+2 en julio, +1 en diciembre).
    expect(instanteLocal("2026-07-01", "10:00", "Europe/Madrid").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(instanteLocal("2026-12-01", "10:00", "Europe/Madrid").toISOString()).toBe("2026-12-01T09:00:00.000Z");
    // Y en el día del cambio de hora (29 de marzo de 2026 en Madrid).
    const cambio = instanteLocal("2026-03-29", "12:00", "Europe/Madrid");
    expect(cambio.toISOString()).toBe("2026-03-29T10:00:00.000Z");
    expect(horaLocal(cambio, "Europe/Madrid")).toBe(12);

    // Todas las horas del día de Bogotá van y vuelven.
    for (let h = 0; h < 24; h++) {
      const hhmm = `${String(h).padStart(2, "0")}:15`;
      const x = instanteLocal("2026-10-01", hhmm, BOGOTA);
      expect(diaLocal(x, BOGOTA)).toBe("2026-10-01");
      expect(horaLocal(x, BOGOTA)).toBe(h);
    }
  });

  it("instanteLocal rechaza entradas mal formadas", () => {
    expect(() => instanteLocal("2026-10-01", "9:00", BOGOTA)).toThrow(RangeError);
    expect(() => instanteLocal("2026-10-01", "24:00", BOGOTA)).toThrow(RangeError);
    expect(() => instanteLocal("2026-13-01", "09:00", BOGOTA)).toThrow(RangeError);
    expect(() => instanteLocal("2026-10-01", "09:00", "Zona/Inexistente")).toThrow(RangeError);
  });

  it("es apto para cliente: sin imports (ni db, ni crypto, ni node:)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "zona-horaria.ts"), "utf8");
    // Solo el código: los comentarios explican justamente lo que no se usa.
    const codigo = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/^\s*import\s/m);
    expect(codigo).not.toMatch(/require\(|node:/);
    // Ni las funciones de fecha que dependen de la zona del servidor.
    expect(codigo).not.toMatch(/\.getHours\(|\.getDate\(|\btoday\(/);
  });
});
