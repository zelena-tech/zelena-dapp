/**
 * IP del cliente detrás de Azure Front Door (hallazgo M4 de la auditoría): el primer
 * valor de X-Forwarded-For lo manda el cliente y con él se esquivaba el límite de
 * intentos. Se prefiere X-Azure-ClientIP y, si no está, el ÚLTIMO valor de X-Forwarded-For.
 */
import { describe, it, expect } from "vitest";
import { clientIp, rateLimit } from "./rate-limit";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("prefiere X-Azure-ClientIP aunque X-Forwarded-For diga otra cosa", () => {
    expect(clientIp(h({ "x-azure-clientip": "203.0.113.7", "x-forwarded-for": "1.1.1.1, 203.0.113.7" }))).toBe(
      "203.0.113.7"
    );
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
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.4:51234" }))).toBe("198.51.100.4");
    expect(clientIp(h({ "x-azure-clientip": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
    expect(clientIp(h({ "x-azure-clientip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("sin cabeceras de proxy: x-real-ip o 'local'", () => {
    expect(clientIp(h({ "x-real-ip": "192.0.2.1" }))).toBe("192.0.2.1");
    expect(clientIp(h({}))).toBe("local");
    expect(clientIp(h({ "x-azure-clientip": "  " }))).toBe("local");
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
