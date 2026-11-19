/**
 * Prueba de caracterización · Redirección del dominio sin www y del host de origen (WP33).
 * Regla: next.config.mjs → redirects(), la última entrada.
 *
 * El dominio sin www llega directo al App Service y las visitas directas al host de
 * azurewebsites.net son un duplicado del sitio: las dos van a https://www.zelena.tech con
 * su ruta y su consulta (308). Front Door siempre envía `x-azure-fdid`, así que lo que entra
 * por www no se toca. Quedan fuera /.well-known/ (validación del certificado), /api/ y
 * robots933456.txt (el calentamiento del App Service).
 *
 * No se reimplementa la regla: se carga next.config.mjs con `loadCustomRoutes` de Next (la
 * misma validación que hace `next build`) y cada petición pasa por las mismas funciones con
 * las que el servidor de Next 14 decide una redirección (`getPathMatch` con
 * `modifyRouteRegex`, `matchHas`, `prepareDestination` y `getRedirectStatus`, como en
 * server/lib/router-utils/filesystem.js y resolve-routes.js). Si una versión nueva de Next
 * cambia cómo casa `has`/`missing` o el host, esta prueba lo dice.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import url from "node:url";
import { stringify } from "node:querystring";
import type { IncomingMessage } from "node:http";
import loadCustomRoutes, { type Redirect } from "next/dist/lib/load-custom-routes";
import { defaultConfig, type NextConfig } from "next/dist/server/config-shared";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { getRedirectStatus, modifyRouteRegex } from "next/dist/lib/redirect-status";

interface RedireccionCompilada {
  regla: Redirect;
  casa: ReturnType<typeof getPathMatch>;
}

/** Como `buildCustomRoute` de router-utils/filesystem.js para una redirección (sin basePath). */
function compilar(regla: Redirect): RedireccionCompilada {
  // `internal` lo añade Next a sus propias reglas (la barra final); el tipo público no lo trae.
  const interna = (regla as Redirect & { internal?: boolean }).internal === true;
  const casa = getPathMatch(regla.source, {
    strict: true,
    removeUnnamedParams: true,
    regexModifier: !interna ? (re: string) => modifyRouteRegex(re, ["/_next"]) : undefined,
    sensitive: false,
  });
  return { regla, casa };
}

let reglas: RedireccionCompilada[] = [];

beforeAll(async () => {
  const mod = (await import("../../../next.config.mjs")) as { default: NextConfig };
  // Una regla inválida hace que Next llame a process.exit(1): aquí se vuelve un error de la prueba.
  const salir = vi.spyOn(process, "exit").mockImplementation((codigo) => {
    throw new Error(`loadCustomRoutes rechazó next.config.mjs (exit ${String(codigo)})`);
  });
  try {
    const rutas = await loadCustomRoutes({ ...defaultConfig, ...mod.default } as NextConfig);
    reglas = rutas.redirects.map(compilar);
  } finally {
    salir.mockRestore();
  }
});

interface Peticion {
  host: string;
  ruta: string;
  cabeceras?: Record<string, string>;
}

/** Lo que respondería Next: `{ estado, destino }` si redirige, o null si la petición sigue. */
function resolver({ host, ruta, cabeceras = {} }: Peticion): { estado: number; destino: string } | null {
  const pedida = url.parse(ruta, true);
  const headers: Record<string, string> = { host };
  for (const [k, v] of Object.entries(cabeceras)) headers[k.toLowerCase()] = v;
  const req = { headers } as unknown as IncomingMessage;
  for (const { regla, casa } of reglas) {
    let params = casa(pedida.pathname ?? "/");
    if (params && (regla.has || regla.missing)) {
      const deHas = matchHas(req, pedida.query, regla.has, regla.missing);
      params = deHas ? Object.assign(params, deHas) : false;
    }
    if (!params) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: regla.destination,
      params,
      query: pedida.query,
    });
    const { query, ...resto } = parsedDestination;
    const destino = url.format({ ...resto, search: stringify(query) });
    return { estado: getRedirectStatus(regla), destino };
  }
  return null;
}

const FDID = { "x-azure-fdid": "test" };

describe("redirección al host canónico (www.zelena.tech)", () => {
  it("next.config.mjs pasa la validación de Next y la regla está cargada", () => {
    expect(reglas.some((r) => r.regla.destination === "https://www.zelena.tech/:path")).toBe(true);
  });

  it("el dominio sin www va a www con 308, conservando la ruta y la consulta", () => {
    expect(resolver({ host: "zelena.tech", ruta: "/" })).toEqual({ estado: 308, destino: "https://www.zelena.tech/" });
    expect(resolver({ host: "zelena.tech", ruta: "/manifiesto?x=1" })).toEqual({
      estado: 308,
      destino: "https://www.zelena.tech/manifiesto?x=1",
    });
    expect(resolver({ host: "zelena.tech", ruta: "/comunidad/ritos/3?a=1&b=dos" })).toEqual({
      estado: 308,
      destino: "https://www.zelena.tech/comunidad/ritos/3?a=1&b=dos",
    });
    // El puerto y las mayúsculas del host no cambian nada (Next los quita antes de comparar).
    expect(resolver({ host: "zelena.tech:443", ruta: "/metodo" })?.destino).toBe("https://www.zelena.tech/metodo");
    expect(resolver({ host: "ZELENA.TECH", ruta: "/metodo" })?.destino).toBe("https://www.zelena.tech/metodo");
  });

  it("el host de azurewebsites sin la cabecera de Front Door también va a www", () => {
    expect(resolver({ host: "zelena-dao.azurewebsites.net", ruta: "/agora" })).toEqual({
      estado: 308,
      destino: "https://www.zelena.tech/agora",
    });
  });

  it("lo que llega por Front Door (con x-azure-fdid) no se redirige, ni con el host de origen", () => {
    expect(resolver({ host: "zelena.tech", ruta: "/", cabeceras: FDID })).toBeNull();
    expect(resolver({ host: "zelena.tech", ruta: "/manifiesto?x=1", cabeceras: FDID })).toBeNull();
    expect(resolver({ host: "zelena-dao.azurewebsites.net", ruta: "/agora", cabeceras: FDID })).toBeNull();
  });

  it("www, localhost y la IP local no se redirigen", () => {
    for (const host of ["www.zelena.tech", "localhost:3000", "127.0.0.1:8080"]) {
      expect(resolver({ host, ruta: "/" }), host).toBeNull();
      expect(resolver({ host, ruta: "/manifiesto?x=1" }), host).toBeNull();
    }
  });

  it("quedan fuera /.well-known/ (certificado), /api/ y robots933456.txt (calentamiento)", () => {
    for (const ruta of ["/.well-known/acme", "/.well-known/acme-challenge/abc", "/api/cla", "/api/governance/vote", "/robots933456.txt"]) {
      expect(resolver({ host: "zelena.tech", ruta }), ruta).toBeNull();
      expect(resolver({ host: "zelena-dao.azurewebsites.net", ruta }), ruta).toBeNull();
    }
  });

  it("un host parecido no casa (la expresión va anclada de principio a fin)", () => {
    for (const host of [
      "evilzelena.tech",
      "zelena.tech.evil.example",
      "xzelena-dao.azurewebsites.net",
      "zelena-dao.azurewebsites.net.evil.example",
      "zelena-daoXazurewebsites.net",
    ]) {
      expect(resolver({ host, ruta: "/" }), host).toBeNull();
    }
  });

  it("las redirecciones de rutas viejas van primero: en el dominio sin www son dos saltos", () => {
    // Comportamiento actual: /ecosistema casa antes su propia regla (destino relativo); el
    // navegador pide /metodo al mismo host y ahí salta a www.
    expect(resolver({ host: "zelena.tech", ruta: "/ecosistema" })).toEqual({ estado: 308, destino: "/metodo" });
    expect(resolver({ host: "zelena.tech", ruta: "/metodo" })?.destino).toBe("https://www.zelena.tech/metodo");
    expect(resolver({ host: "www.zelena.tech", ruta: "/whitepaper" })).toEqual({ estado: 308, destino: "/manifiesto" });
  });
});
