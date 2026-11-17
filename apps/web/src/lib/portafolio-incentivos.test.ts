/**
 * Portafolio e incentivos para empresas (/empresas/portafolio, /empresas/incentivos).
 *
 * Pedido del founder (2026-11-17): las dos páginas llevan el diseño de zelena.tech (el
 * cromo claro de la landing), pero en español. Estas pruebas fijan:
 *  - el cromo: las dos rutas traen su propio marco claro, y el documento sigue en español;
 *  - el contenido del portafolio: cada línea lleva a un interés que el formulario ofrece;
 *  - lo que la página de incentivos puede afirmar: lo mismo que /empresas (USDC a la
 *    billetera es lo real; pesos a la cuenta bancaria es la meta), sin promesas de ganancia.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  CABECERA_IDIOMA,
  MENU_EMPRESAS,
  RUTAS_CROMO_CLARO_ES,
  RUTAS_LANDING,
  RUTA_INCENTIVOS,
  RUTA_PORTAFOLIO,
  esRutaCromoClaroEs,
  esRutaLanding,
} from "./menu";
import { RUTAS_SITEMAP } from "./seo";
import { INTERESES, INTERES_A_LA_MEDIDA, SLUGS_INTERES } from "./servicios";
import { CABECERA_EMPRESAS, PIE_EMPRESAS, contactoCon } from "../../app/_landing/copy-empresas";
import { COLABORAR, CUATRO_LINEAS, LINEAS, NECESIDADES, PORTAFOLIO } from "../../app/_landing/copy-portafolio";
import * as INCENTIVOS from "../../app/_landing/copy-incentivos";

// El middleware importa la sesión con el alias "@/" (vitest no lo resuelve).
vi.mock("@/lib/jwt", async () => await import("./jwt"));
import { middleware } from "../../middleware";

const WEB = process.cwd(); // apps/web
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

const PAGINAS = ["app/empresas/portafolio/page.tsx", "app/empresas/incentivos/page.tsx"] as const;
const DE_EMPRESAS = fs
  .readdirSync(path.join(WEB, "app/_landing/empresas"))
  .filter((n) => n.endsWith(".tsx"))
  .map((n) => `app/_landing/empresas/${n}`);

describe("cromo claro en español", () => {
  it("las dos rutas, exactas, y ninguna es de la landing en inglés", () => {
    expect([...RUTAS_CROMO_CLARO_ES]).toEqual(["/empresas/portafolio", "/empresas/incentivos"]);
    expect(RUTA_PORTAFOLIO).toBe("/empresas/portafolio");
    expect(RUTA_INCENTIVOS).toBe("/empresas/incentivos");
    for (const r of RUTAS_CROMO_CLARO_ES) {
      expect(esRutaCromoClaroEs(r), r).toBe(true);
      expect(esRutaLanding(r), r).toBe(false);
      expect(RUTAS_LANDING, r).not.toContain(r);
    }
    for (const r of ["/empresas", "/empresas/servicios", "/empresas/contacto", "/empresas/portafolio/x", "/", ""]) {
      expect(esRutaCromoClaroEs(r), r).toBe(false);
    }
    expect(esRutaCromoClaroEs(null)).toBe(false);
    expect(esRutaCromoClaroEs(undefined)).toBe(false);
  });

  it("MarcoSitio no pinta el menú oscuro alrededor, y el documento sigue en español", async () => {
    const marco = leer("src/components/MarcoSitio.tsx");
    expect(marco).toContain("if (landing || esRutaCromoClaroEs(ruta)) return <>{children}</>;");
    // El lang solo pasa a inglés en la landing: aquí no cambia.
    expect(marco).toContain('document.documentElement.lang = landing ? "en" : "es";');
    for (const r of RUTAS_CROMO_CLARO_ES) {
      const res = await middleware(new NextRequest(`http://localhost${r}`));
      expect(res.headers.get(`x-middleware-request-${CABECERA_IDIOMA}`), r).toBeNull();
    }
  });

  it("MarcoEmpresas: raíz data-landing en español, un solo <main id=\"main\">, las fuentes de la landing y el efecto de aparición", () => {
    const marco = leer("app/_landing/empresas/MarcoEmpresas.tsx");
    expect(marco).toContain('<div data-landing="" lang="es"');
    expect(marco.match(/<main id="main"/g) ?? []).toHaveLength(1);
    expect(marco).toContain('href="#main"');
    expect(marco).toContain('import "@fontsource-variable/archivo/wdth.css";');
    expect(marco).not.toMatch(/@fontsource-variable\/archivo(\/index\.css)?["']/);
    expect(marco).toContain("<Reveal />");
    // No lee la sesión: a una empresa la píldora la lleva a hablar con nosotros.
    expect(marco).not.toMatch(/getSession|getDb/);
    expect(CABECERA_EMPRESAS.pestanas.map((t) => t.href)).toEqual([RUTA_PORTAFOLIO, RUTA_INCENTIVOS]);
    expect(marco).toContain('aria-current={t.pagina === pagina ? "page" : undefined}');
  });

  it("cada página va en ese marco, clara, en español, sin la tarjeta de la comunidad y con un solo h1", () => {
    for (const r of PAGINAS) {
      const src = leer(r);
      expect(src, r).toMatch(/<MarcoEmpresas pagina="(portafolio|incentivos)">/);
      expect(src, r).toContain('export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };');
      expect(src, r).toContain('export const dynamic = "force-dynamic";');
      expect(src, r).toMatch(/idioma: "es",\n[\s\S]*?imagen: null,/);
      // Diseño de la landing: ni la serif ni las clases del tema oscuro.
      expect(src, r).not.toMatch(/font-serif|text-paper|bg-surface|btn-primary/);
    }
    expect(leer(PAGINAS[0])).toContain("ruta: RUTA_PORTAFOLIO,");
    expect(leer(PAGINAS[1])).toContain("ruta: RUTA_INCENTIVOS,");
    // Los id escritos a mano no se repiten dentro de una página (un aria-labelledby
    // repetido rotula la sección con el titular equivocado).
    const ids = (r: string) => [...leer(r).matchAll(/\bid="([a-z-]+)"/g)].map((x) => x[1]);
    const comunes = ["Explorador.tsx", "SeccionesPortafolio.tsx"].flatMap((n) => ids(`app/_landing/empresas/${n}`));
    const dePortafolio = [...ids(PAGINAS[0]), ...comunes];
    expect(dePortafolio.filter((id, i) => dePortafolio.indexOf(id) !== i)).toEqual([]);
    const deIncentivos = [...ids(PAGINAS[1]), ...ids("app/_landing/empresas/SeccionesIncentivos.tsx")];
    expect(deIncentivos.filter((id, i) => deIncentivos.indexOf(id) !== i)).toEqual([]);
    // El único <h1> lo pinta el hero compartido; cada página lo usa una vez.
    const h1 = DE_EMPRESAS.map(leer).join("\n").match(/<h1\b/g) ?? [];
    expect(h1).toHaveLength(1);
    for (const r of PAGINAS) expect(leer(r).match(/<HeroEmpresas\b/g) ?? [], r).toHaveLength(1);
    for (const r of DE_EMPRESAS) expect(leer(r), r).not.toMatch(/font-serif|text-paper|bg-surface|btn-primary/);
  });

  it("están en el menú de empresas, en el sitemap y en el pie del marco", () => {
    const hrefs = MENU_EMPRESAS.map((e) => e.href);
    expect(hrefs).toContain(RUTA_PORTAFOLIO);
    expect(hrefs).toContain(RUTA_INCENTIVOS);
    expect(MENU_EMPRESAS.length).toBeLessThanOrEqual(5); // con seis, la barra pasa al menú desplegable antes
    expect(RUTAS_SITEMAP).toContain(RUTA_PORTAFOLIO);
    expect(RUTAS_SITEMAP).toContain(RUTA_INCENTIVOS);
    const pie = PIE_EMPRESAS.enlaces.map((e) => e.href);
    for (const h of ["/", RUTA_PORTAFOLIO, RUTA_INCENTIVOS, "/empresas/contacto"]) expect(pie).toContain(h);
    // Solo la home está en inglés: es el único enlace del pie que lo marca.
    expect(PIE_EMPRESAS.enlaces.filter((e) => e.enIngles).map((e) => e.href)).toEqual(["/"]);
    expect(leer("app/empresas/page.tsx")).toContain('href="/empresas/portafolio"');
  });
});

describe("portafolio · ocho líneas que llevan a un contacto real", () => {
  it("un producto, un programa de incentivos y seis servicios", () => {
    const cuenta = (t: string) => LINEAS.filter((l) => l.tipo === t).length;
    expect([cuenta("Producto"), cuenta("Programa"), cuenta("Servicio")]).toEqual([1, 1, 6]);
    expect(new Set(LINEAS.map((l) => l.id)).size).toBe(LINEAS.length);
    expect([...CUATRO_LINEAS.cifras]).toEqual(["1 producto propio", "1 programa de incentivos", "6 servicios", "1 comunidad"]);
  });

  // Pedido del founder (2026-11-17): el programa de incentivos va al lado del WMS.
  it("el WMS va primero y el programa de incentivos, a su lado; el filtro sigue ese orden", () => {
    expect(LINEAS.slice(0, 2).map((l) => l.id)).toEqual(["wms", "incentivos"]);
    expect(LINEAS.slice(2).every((l) => l.tipo === "Servicio")).toBe(true);
    expect(PORTAFOLIO.filtros.map((f) => f.valor)).toEqual(["Todo", "Producto", "Programa", "Servicio"]);
  });

  // Pedido del founder (2026-11-17): un servicio para quien quiere construir algo propio.
  it("el desarrollo a la medida es el sexto servicio, con su propio interés en el formulario", () => {
    const medida = LINEAS.find((l) => l.id === "medida");
    expect(medida).toMatchObject({ tipo: "Servicio", interes: INTERES_A_LA_MEDIDA });
    expect(INTERESES.find((i) => i.slug === INTERES_A_LA_MEDIDA)?.nombre).toBe("Desarrollo a la medida");
    expect(NECESIDADES.some((n) => n.lineas.includes("medida"))).toBe(true);
    // Sin plazos ni precios publicados: publicados se vuelven un compromiso.
    expect(JSON.stringify(medida)).not.toMatch(/semanas?|d[ií]as h[aá]biles|USD|garantiza/i);
  });

  it("cada línea pide un interés que el formulario ofrece", () => {
    for (const l of LINEAS) expect(SLUGS_INTERES, l.id).toContain(l.interes);
    expect(contactoCon("harmony")).toBe("/empresas/contacto?interes=harmony");
  });

  it("cada situación recomienda líneas que existen, y todas las líneas son alcanzables", () => {
    const ids = new Set(LINEAS.map((l) => l.id));
    const recomendadas = new Set<string>();
    for (const n of NECESIDADES) {
      expect(n.lineas.length, n.texto).toBeGreaterThan(0);
      for (const id of n.lineas) {
        expect(ids.has(id), `${n.texto} → ${id}`).toBe(true);
        recomendadas.add(id);
      }
    }
    expect([...ids].filter((id) => !recomendadas.has(id))).toEqual([]);
  });

  it("los incentivos tienen página propia y entran por Harmony", () => {
    const inc = LINEAS.find((l) => l.id === "incentivos");
    expect(inc).toMatchObject({ tipo: "Programa", interes: "harmony", enlace: RUTA_INCENTIVOS });
    expect(CUATRO_LINEAS.lineas.map((l) => l.verbo)).toEqual(["Ordenamos", "Operamos", "Reconocemos", "Colaboramos"]);
    expect(CUATRO_LINEAS.lineas[2].href).toBe(RUTA_INCENTIVOS);
  });
});

/**
 * Pedido del founder (2026-11-17): al portafolio le faltaba la parte de colaborar. Dice lo
 * mismo que /metodo y lleva a páginas que existen; no promete pagos ni nombra la red.
 */
describe("portafolio · la parte de colaborar", () => {
  it("es la cuarta línea y tiene su sección, con ancla", () => {
    expect(CUATRO_LINEAS.lineas[3]).toMatchObject({ verbo: "Colaboramos", href: "#colaborar" });
    expect(COLABORAR.ancla).toBe("colaborar");
    expect(`${COLABORAR.h2.linea1} ${COLABORAR.h2.antes}${COLABORAR.h2.enfasis}`).toBe("Rediseñamos la forma de colaborar.");
    expect(leer("app/empresas/portafolio/page.tsx")).toContain("<Colaborar />");
    expect(leer("app/_landing/empresas/SeccionesPortafolio.tsx")).toContain("id={COLABORAR.ancla}");
  });

  it("sus puertas llevan a rutas reales: contacto a la medida, proyectos abiertos, método, comunidad y manifiesto", () => {
    expect(COLABORAR.puertas.map((p) => p.href)).toEqual(["/empresas/contacto?interes=a-la-medida", "/agora", "/metodo"]);
    expect(COLABORAR.comunidad.href).toBe("/comunidad");
    expect(COLABORAR.manifiesto.href).toBe("/manifiesto");
    for (const r of ["app/agora/page.tsx", "app/metodo/page.tsx", "app/comunidad/page.tsx", "app/manifiesto/page.tsx"]) {
      expect(fs.existsSync(path.join(WEB, r)), r).toBe(true);
    }
    // La comunidad y el manifiesto son de la landing en inglés: el enlace lo marca.
    const seccion = leer("app/_landing/empresas/SeccionesPortafolio.tsx");
    expect(seccion).toContain('<SecondaryCta href={COLABORAR.comunidad.href} hrefLang="en"');
    expect(seccion).toContain('<SecondaryCta href={COLABORAR.manifiesto.href} hrefLang="en"');
  });

  it("no promete pagos, ni cifras, ni nombra la red", () => {
    const texto = JSON.stringify(COLABORAR);
    expect(texto).not.toMatch(/USDC|d[oó]lar|pesos|red de pruebas|red principal|testnet|mainnet/i);
    expect(texto).not.toMatch(/[$€%]|\b\d{3,}\b|\b(COP|USD)\b/);
    expect(texto).toContain("Se califica la entrega, nunca a la persona.");
  });
});

describe("incentivos · lo que la página puede afirmar", () => {
  const copy = leer("app/_landing/copy-incentivos.ts");
  const publico = JSON.stringify(INCENTIVOS);

  it("habla de dólares digitales y de sus tres beneficios: ahorro, productividad y pertenencia", () => {
    expect(INCENTIVOS.HERO_INCENTIVOS.h1.resaltado).toBe("dólares digitales.");
    expect(INCENTIVOS.BENEFICIOS.puntos.map((b) => b.t)).toEqual([
      "Una herramienta de ahorro para tu equipo",
      "Más productividad, porque se premia lo que se mide",
      "Sentido de pertenencia",
    ]);
  });

  it("dice lo mismo que /empresas: USDC a la billetera es lo real; pesos a la cuenta bancaria, la meta", () => {
    expect(publico).toContain("Su nombre técnico es USDC.");
    expect(publico).toContain("Hoy el incentivo llega en dólares digitales a la billetera de cada persona.");
    expect(publico).toContain("es la meta en la que trabajamos");
    // Nada que suene a que el paso a pesos ya está: ni "convertibles", ni "se vuelve pesos".
    expect(publico).not.toMatch(/convertibles? a pesos|se vuelve pesos|lo convierte a pesos/i);
    expect(publico).not.toMatch(/piloto|red de pruebas|testnet|mainnet/i);
  });

  it("sin promesas de ganancia y sin tocar el salario", () => {
    expect(publico).toContain("Es adicional al salario. Nunca lo reemplaza.");
    expect(publico).toContain("su valor en pesos sube y baja con la tasa de cambio");
    expect(copy).not.toMatch(/rendimiento|rentabilidad|inter[eé]s(es)? (anual|mensual)|ganancia garantizada|sin riesgo|n[oó]mina/i);
    expect(publico).not.toMatch(/m[aá]s estable que el peso/i);
    // Ni garantía de paridad ni absolutos que nadie respalda (revisión del 2026-11-17).
    expect(publico).not.toMatch(/siempre vale|valer siempre|sin monto m[ií]nimo/i);
    expect(publico).toContain("Sigue al dólar");
  });

  // En /empresas el supervisor revisa y aplica el multiplicador de calidad: esta página no
  // puede decir que el incentivo no depende del criterio de nadie, ni prometer a Harmony
  // el historial "que no se borra" (eso es de la comunidad, /metodo).
  it("no contradice a /empresas: hay revisión de calidad, y el historial imborrable no es de Harmony", () => {
    expect(leer("app/empresas/page.tsx")).toContain("El supervisor revisa y aplica el multiplicador de calidad.");
    expect(publico).toContain("El supervisor revisa la calidad contra el criterio acordado");
    expect(publico).not.toMatch(/criterio de un jefe|no se borra|historial de logros/i);
    expect(JSON.stringify(LINEAS.find((l) => l.id === "incentivos"))).not.toMatch(/criterio de un jefe|historial de logros/i);
  });
});
