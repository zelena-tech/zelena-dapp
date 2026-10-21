/**
 * IP del cliente detrás de Azure Front Door.
 *
 *  - Hallazgo M4 de la auditoría: el primer valor de X-Forwarded-For lo manda el cliente y
 *    con él se esquivaba el límite de intentos. Se toma el ÚLTIMO valor.
 *  - Revisión del release (2026-10-21): X-Azure-ClientIP también la puede mandar el cliente
 *    si le habla directo a App Service (*.azurewebsites.net). Solo se cree si la petición
 *    trae `X-Azure-FDID` igual a `AZURE_FRONT_DOOR_ID` (el ID de NUESTRO Front Door, que
 *    Front Door escribe y sobrescribe); si no, el último valor de X-Forwarded-For.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { clientIp, rateLimit } from "./rate-limit";

const h = (o: Record<string, string>) => new Headers(o);
/** ID ficticio de un perfil de Front Door (un GUID; el real va en App Settings). */
const FDID = "0f1e2d3c-4b5a-4978-8a9b-0c1d2e3f4a5b";
const OTRO_FDID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  vi.stubEnv("AZURE_FRONT_DOOR_ID", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("clientIp", () => {
  it("con NUESTRO Front Door (X-Azure-FDID = AZURE_FRONT_DOOR_ID) prefiere X-Azure-ClientIP", () => {
    vi.stubEnv("AZURE_FRONT_DOOR_ID", FDID);
    expect(
      clientIp(h({ "x-azure-fdid": FDID, "x-azure-clientip": "203.0.113.7", "x-forwarded-for": "1.1.1.1, 203.0.113.7" }))
    ).toBe("203.0.113.7");
    // El ID se compara sin mayúsculas ni espacios (es un GUID).
    expect(clientIp(h({ "x-azure-fdid": ` ${FDID.toUpperCase()} `, "x-azure-clientip": "203.0.113.7" }))).toBe(
      "203.0.113.7"
    );
  });

  it("sin AZURE_FRONT_DOOR_ID configurada no se cree X-Azure-ClientIP: el último valor de X-Forwarded-For", () => {
    expect(clientIp(h({ "x-azure-clientip": "203.0.113.7", "x-forwarded-for": "1.1.1.1, 198.51.100.4" }))).toBe(
      "198.51.100.4"
    );
    // Aunque traiga un X-Azure-FDID: sin el ID configurado no hay con qué compararlo.
    expect(
      clientIp(h({ "x-azure-fdid": FDID, "x-azure-clientip": "203.0.113.7", "x-forwarded-for": "198.51.100.4" }))
    ).toBe("198.51.100.4");
  });

  it("llamada directa a App Service (sin X-Azure-FDID, o con el de otro Front Door): no se cree", () => {
    vi.stubEnv("AZURE_FRONT_DOOR_ID", FDID);
    expect(clientIp(h({ "x-azure-clientip": "203.0.113.7", "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(
      clientIp(h({ "x-azure-fdid": OTRO_FDID, "x-azure-clientip": "203.0.113.7", "x-forwarded-for": "198.51.100.4" }))
    ).toBe("198.51.100.4");
    expect(clientIp(h({ "x-azure-fdid": "", "x-azure-clientip": "203.0.113.7" }))).toBe("local");
  });

  it("rotar X-Azure-ClientIP sin nuestro Front Door no esquiva el límite (25 intentos: 5 cortados)", () => {
    vi.stubEnv("AZURE_FRONT_DOOR_ID", FDID);
    const ruta = `login-reto-prueba:${Math.random()}`;
    let cortados = 0;
    for (let i = 0; i < 25; i++) {
      const ip = clientIp(
        h({ "x-azure-clientip": `203.0.113.${i + 1}`, "x-azure-fdid": OTRO_FDID, "x-forwarded-for": "198.51.100.4" })
      );
      if (!rateLimit(`${ruta}:${ip}`, 20, 60_000)) cortados++;
    }
    expect(cortados).toBe(5);
  });

  it("detrás de nuestro Front Door, cada cliente cuenta aparte aunque compartan el borde", () => {
    vi.stubEnv("AZURE_FRONT_DOOR_ID", FDID);
    const a = clientIp(h({ "x-azure-fdid": FDID, "x-azure-clientip": "203.0.113.7", "x-forwarded-for": "203.0.113.7, 147.243.0.1" }));
    const b = clientIp(h({ "x-azure-fdid": FDID, "x-azure-clientip": "203.0.113.8", "x-forwarded-for": "203.0.113.8, 147.243.0.1" }));
    expect(a).not.toBe(b);
  });

  it("avisa UNA vez si llega tráfico de Front Door sin AZURE_FRONT_DOOR_ID configurada", async () => {
    vi.resetModules();
    const fresco = await import("./rate-limit");
    const aviso = vi.mocked(console.warn);
    aviso.mockClear();
    for (let i = 0; i < 3; i++) fresco.clientIp(h({ "x-azure-fdid": FDID, "x-forwarded-for": "198.51.100.4" }));
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toContain("AZURE_FRONT_DOOR_ID");
    // Sin X-Azure-FDID (desarrollo, o App Service sin Front Door) no hay nada que avisar.
    vi.resetModules();
    const otro = await import("./rate-limit");
    aviso.mockClear();
    otro.clientIp(h({ "x-forwarded-for": "198.51.100.4" }));
    expect(aviso).not.toHaveBeenCalled();
  });

  it("sin X-Azure-ClientIP toma el ÚLTIMO valor de X-Forwarded-For, no el que manda el cliente", () => {
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(h({ "x-forwarded-for": " 6.6.6.6 ,  198.51.100.4 , " }))).toBe("198.51.100.4");
  });

  it("un cliente que cambia el primer valor de X-Forwarded-For no cambia su clave", () => {
    const a = clientIp(h({ "x-forwarded-for": "1.1.1.1, 198.51.100.4" }));
    const b = clientIp(h({ "x-forwarded-for": "2.2.2.2, 198.51.100.4" }));
    expect(a).toBe(b);
  });

  it("quita el puerto que agrega App Service (IPv4 e IPv6)", () => {
    vi.stubEnv("AZURE_FRONT_DOOR_ID", FDID);
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.4:51234" }))).toBe("198.51.100.4");
    expect(clientIp(h({ "x-azure-fdid": FDID, "x-azure-clientip": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-azure-fdid": FDID, "x-azure-clientip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("sin cabeceras de proxy: x-real-ip o 'local'", () => {
    vi.stubEnv("AZURE_FRONT_DOOR_ID", FDID);
    expect(clientIp(h({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(clientIp(h({}))).toBe("local");
    expect(clientIp(h({ "x-azure-fdid": FDID, "x-azure-clientip": "  " }))).toBe("local");
  });
});

describe("docs/DESPLIEGUE-V1.md: cerrar la puerta directa a App Service es un paso obligatorio", () => {
  const doc = fs.readFileSync(path.join(process.cwd(), "..", "..", "docs", "DESPLIEGUE-V1.md"), "utf8");
  const a2 = doc.slice(doc.indexOf("### A2."), doc.indexOf("### A3."));

  it("A2 pide la restricción de acceso (AzureFrontDoor.Backend + X-Azure-FDID) y AZURE_FRONT_DOOR_ID", () => {
    expect(a2.length).toBeGreaterThan(0);
    expect(a2).toMatch(/\*\*Obligatorio con Azure Front Door delante/);
    expect(a2).toContain("AzureFrontDoor.Backend");
    expect(a2).toContain("X-Azure-FDID");
    expect(a2).toContain("--http-header x-azure-fdid=");
    expect(a2).toContain("`AZURE_FRONT_DOOR_ID`");
    expect(a2).toMatch(/azurewebsites\.net\/` responde\s+\*\*403\*\*/);
  });
});

describe("rateLimit", () => {
  it("corta al pasar el límite dentro de la ventana", () => {
    const k = `prueba:${Math.random()}`;
    expect(rateLimit(k, 2, 60_000)).toBe(true);
    expect(rateLimit(k, 2, 60_000)).toBe(true);
    expect(rateLimit(k, 2, 60_000)).toBe(false);
  });
});
