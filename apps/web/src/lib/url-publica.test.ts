/**
 * La puerta corporativa detrás de Azure Front Door (NEXTAUTH_URL=https://www.zelena.tech).
 *
 * En App Service, `req.nextUrl` de un route handler lleva el host interno del contenedor
 * (`0.0.0.0:8080`): el intercambio de sesión debe redirigir a la URL PÚBLICA y borrar las
 * cookies seguras de NextAuth con `Secure`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { COOKIES_NEXTAUTH, opcionesBorrado, origenPublico, urlPublica } from "./url-publica";

const WEB = process.cwd();
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");
const PROD = { NEXTAUTH_URL: "https://www.zelena.tech" };
const INTERNO = "http://0.0.0.0:8080";

describe("urlPublica", () => {
  it("con NEXTAUTH_URL, la redirección va al sitio público aunque la petición diga 0.0.0.0", () => {
    expect(urlPublica("/equipo/hoy", INTERNO, PROD).toString()).toBe("https://www.zelena.tech/equipo/hoy");
    const u = urlPublica("/entrar", INTERNO, PROD);
    u.searchParams.set("error", "foreign_tenant");
    expect(u.toString()).toBe("https://www.zelena.tech/entrar?error=foreign_tenant");
  });

  it("NEXTAUTH_URL con barra o ruta: solo cuenta el origen", () => {
    expect(origenPublico({ NEXTAUTH_URL: "https://www.zelena.tech/" })).toBe("https://www.zelena.tech");
    expect(origenPublico({ NEXTAUTH_URL: " https://www.zelena.tech/api/auth " })).toBe("https://www.zelena.tech");
  });

  it("sin NEXTAUTH_URL (desarrollo) o con un valor raro, usa el origen de la petición", () => {
    expect(urlPublica("/equipo/hoy", "http://localhost:3000", {}).toString()).toBe("http://localhost:3000/equipo/hoy");
    expect(origenPublico({ NEXTAUTH_URL: "javascript:alert(1)" })).toBeNull();
    expect(origenPublico({ NEXTAUTH_URL: "no es una url" })).toBeNull();
  });

  it("nunca sale del sitio: una ruta de protocolo relativo cae a la raíz", () => {
    expect(urlPublica("//otro-sitio.com/x", INTERNO, PROD).toString()).toBe("https://www.zelena.tech/");
    expect(urlPublica("https://otro-sitio.com", INTERNO, PROD).toString()).toBe("https://www.zelena.tech/");
  });
});

describe("borrar las cookies de NextAuth", () => {
  it("las que llevan prefijo seguro se borran con Secure (si no, el navegador lo ignora)", () => {
    for (const n of COOKIES_NEXTAUTH) {
      const o = opcionesBorrado(n);
      expect(o.maxAge).toBe(0);
      expect(o.path).toBe("/");
      expect(o.secure).toBe(n.startsWith("__"));
    }
    expect(COOKIES_NEXTAUTH).toContain("__Secure-next-auth.session-token");
    expect(COOKIES_NEXTAUTH).toContain("__Host-next-auth.csrf-token");
    expect(COOKIES_NEXTAUTH).toContain("__Secure-next-auth.pkce.code_verifier");
  });
});

describe("/api/auth/entra/exchange (estático)", () => {
  const src = leer("app/api/auth/entra/exchange/route.ts");

  it("redirige con urlPublica y no con req.nextUrl.clone()", () => {
    expect(src).not.toContain("req.nextUrl.clone()");
    expect(src).toContain("urlPublica(LOGIN_PATH, req.nextUrl.origin)");
    expect(src).toContain("urlPublica(AFTER_LOGIN_PATH, req.nextUrl.origin)");
  });

  it("borra las cookies de NextAuth con sus opciones seguras, no con un delete simple", () => {
    expect(src).not.toMatch(/cookies\.delete\(/);
    expect(src).toContain('res.cookies.set(name, "", opcionesBorrado(name))');
  });

  it("la Redirect URI sigue siendo /api/auth/callback/microsoft-entra-id (id del provider)", () => {
    const opciones = leer("app/api/auth/entra-options.ts");
    expect(opciones).toContain("id: ENTRA_PROVIDER_ID");
    expect(opciones).toMatch(/scope: "openid profile email"/);
  });
});
