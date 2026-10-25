/**
 * WP33 · el cromo de la landing en inglés: un solo layout raíz que cambia de cromo por
 * ruta (MarcoSitio), el pie con el grupo Legal obligatorio, los enlaces a rutas reales,
 * las fuentes solo en la landing y ninguna imagen por el optimizador de Next.
 * Tests estáticos sobre el código y sobre el copy común (app/_landing/copy-comun.ts).
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { CABECERA_IDIOMA, FOOTER_GRUPOS, RUTAS_LANDING, URL_LICENCIA } from "./menu";
import { IMAGEN_OG_ES, metadatos } from "./seo";
import { SLUGS_INTERES } from "./servicios";
import { AVISOS_LEGALES, CABECERA, ENLACES, PIE, PIE_LEGAL } from "../../app/_landing/copy-comun";

// El middleware importa la sesión con el alias "@/" (vitest no lo resuelve).
vi.mock("@/lib/jwt", async () => await import("./jwt"));
import { middleware, config as configMiddleware } from "../../middleware";

const WEB = process.cwd(); // apps/web
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");
const LANDING = path.join(WEB, "app", "_landing");
/** Todo app/_landing, a cualquier profundidad (las secciones viven en home/ y comunidad/). */
function archivosLanding(dir = LANDING): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return archivosLanding(p);
    return /\.(ts|tsx|css)$/.test(e.name) ? [path.relative(WEB, p).split(path.sep).join("/")] : [];
  });
}

describe("cromo por ruta (un solo layout raíz)", () => {
  it("el layout pasa menú, aviso y pie a MarcoSitio, que los quita en la landing", () => {
    const layout = leer("app/layout.tsx");
    expect(layout).toMatch(/<MarcoSitio nav=\{<Nav session=\{session\} \/>\} banner=\{<MutationBanner \/>\} footer=\{<Footer \/>\}>/);
    // El idioma del documento sigue a la página (AP-14, WCAG 3.1.1): ver "idioma del documento".
    expect(layout).toContain("<html lang={idioma}>");
    const marco = leer("src/components/MarcoSitio.tsx");
    expect(marco).toMatch(/^"use client";/);
    expect(marco).toContain("esRutaLanding(ruta)");
    expect(marco).toContain('<main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8">');
  });

  it("el layout raíz no fija canónica, og:url, og:title ni robots (cada página pone los suyos)", () => {
    const layout = leer("app/layout.tsx");
    const meta = layout.slice(layout.indexOf("export const metadata"), layout.indexOf("export const viewport"));
    expect(meta).not.toMatch(/canonical|url:|robots:/);
    expect(meta).not.toMatch(/openGraph:\s*\{[^}]*title:/);
  });

  it("globals.css pasa el documento a claro solo con la landing en la página", () => {
    const css = leer("app/globals.css");
    expect(css).toContain(":root:has([data-landing])");
    expect(css).toMatch(/body:has\(\[data-landing\]\)::before,\s*body:has\(\[data-landing\]\)::after\s*\{\s*display: none;/);
  });

  it("LandingShell: raíz data-landing en inglés, un solo <main id=\"main\"> y el enlace para saltar", () => {
    const shell = leer("app/_landing/LandingShell.tsx");
    expect(shell).toContain('<div data-landing="" lang="en"');
    expect(shell).toContain('<main id="main"');
    expect(shell).toContain('href="#main"');
    expect(shell.match(/<main id="main"/g) ?? []).toHaveLength(1);
  });
});

/**
 * Hallazgo AP-14 de la revisión (WCAG 3.1.1): "/" y "/comunidad" están en inglés y el
 * documento decía `<html lang="es">`, también para el <title> y la descripción. El
 * middleware marca la petición de la landing y el layout raíz pone el lang con eso.
 */
describe("idioma del documento", () => {
  const idiomaDe = async (ruta: string) =>
    (await middleware(new NextRequest(`http://localhost${ruta}`))).headers.get(
      `x-middleware-request-${CABECERA_IDIOMA}`
    );

  it("el middleware marca en inglés solo las rutas exactas de la landing", async () => {
    for (const r of RUTAS_LANDING) {
      expect(configMiddleware.matcher, r).toContain(r);
      expect(await idiomaDe(r), r).toBe("en");
    }
    for (const r of ["/comunidad/ritos", "/manifiesto", "/empresas"]) expect(await idiomaDe(r), r).toBeNull();
  });

  it("el layout raíz lee esa cabecera y, sin ella, el documento es español", () => {
    const layout = leer("app/layout.tsx");
    expect(layout).toContain('const idioma = headers().get(CABECERA_IDIOMA) === "en" ? "en" : "es";');
    expect(layout).not.toContain('<html lang="es">');
  });

  it("al navegar dentro del sitio, MarcoSitio corrige el lang (el layout raíz no se vuelve a pintar)", () => {
    expect(leer("src/components/MarcoSitio.tsx")).toContain('document.documentElement.lang = landing ? "en" : "es";');
  });
});

/**
 * Hallazgo F1 / SEO-1 / CC-1 de la revisión: `app/opengraph-image.png` y
 * `app/twitter-image.png` le ganaban a los metadatos de "/" (mismo segmento), y la home
 * en inglés se compartía con la tarjeta vieja en español ("red de pruebas", "sin dinero
 * real"). La imagen va ahora por configuración, desde public/og/.
 */
describe("imágenes para compartir", () => {
  function archivosApp(dir = path.join(WEB, "app")): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? archivosApp(p) : [path.relative(WEB, p).split(path.sep).join("/")];
    });
  }

  it("ningún opengraph-image.* ni twitter-image.* dentro de app/ (le ganarían a la página)", () => {
    expect(archivosApp().filter((r) => /\/(opengraph|twitter)-image\.[a-z]+$/.test(r))).toEqual([]);
  });

  it("la imagen en español existe en public/ con las medidas declaradas y no es la de app/", () => {
    expect(IMAGEN_OG_ES.url).toBe("/og/sitio-es.png");
    const b = fs.readFileSync(path.join(WEB, "public", IMAGEN_OG_ES.url));
    expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([IMAGEN_OG_ES.width, IMAGEN_OG_ES.height]);
  });

  it('"/" y "/comunidad" no llevan imagen; la tarjeta de Twitter es "summary" y concuerda', () => {
    for (const r of ["app/page.tsx", "app/comunidad/page.tsx"]) {
      const src = leer(r);
      expect(src, r).toContain('idioma: "en",');
      expect(src, r).not.toMatch(/imagen:/);
    }
    const m = metadatos({ ruta: "/", idioma: "en", titulo: "t", descripcion: "d" });
    expect(m.openGraph).not.toHaveProperty("images");
    expect(m.twitter).toMatchObject({ card: "summary" });
    expect(m.twitter).not.toHaveProperty("images");
    const es = metadatos({ ruta: "/manifiesto", idioma: "es", titulo: "t", descripcion: "d" });
    expect(es.twitter).toMatchObject({ card: "summary_large_image", images: [IMAGEN_OG_ES.url] });
  });

  it("las páginas de empresas no llevan la tarjeta de la comunidad", () => {
    for (const r of ["app/empresas/page.tsx", "app/empresas/servicios/page.tsx", "app/empresas/contacto/page.tsx"]) {
      expect(leer(r), r).toMatch(/idioma: "es",\n[\s\S]*?imagen: null,/);
    }
  });
});

describe("fuentes e imágenes de la landing", () => {
  it("Archivo con el eje de anchura (wdth.css), nunca index.css, y solo desde la landing", () => {
    const shell = leer("app/_landing/LandingShell.tsx");
    expect(shell).toContain('import "@fontsource-variable/archivo/wdth.css";');
    expect(shell).toContain('import "@fontsource/caveat/600.css";');
    expect(shell).not.toMatch(/@fontsource-variable\/archivo(\/index\.css)?["']/);
    expect(leer("app/layout.tsx")).not.toMatch(/archivo|jetbrains|caveat/i);
  });

  it("los guardas de abajo ven las secciones de las dos páginas, no solo los archivos compartidos", () => {
    const todos = archivosLanding();
    for (const r of ["app/_landing/home/HeroBento.tsx", "app/_landing/comunidad/Hero.tsx", "app/_landing/comunidad/comunidad.module.css"]) {
      expect(todos).toContain(r);
    }
  });

  it("sin Google Fonts ni recursos externos (CSP: font-src y style-src 'self')", () => {
    for (const r of archivosLanding()) expect(leer(r), r).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it("ninguna imagen por next/image (en standalone no hay sharp: daría 500)", () => {
    for (const r of archivosLanding()) expect(leer(r), r).not.toMatch(/from\s+["']next\/image["']|import\(["']next\/image/);
  });

  it("las imágenes de la landing existen en public/landing con las medidas declaradas", async () => {
    const { IMG } = await import("../../app/_landing/assets");
    for (const [nombre, img] of Object.entries(IMG)) {
      const archivo = path.join(WEB, "public", img.src);
      expect(fs.existsSync(archivo), nombre).toBe(true);
      const b = fs.readFileSync(archivo);
      expect([b.readUInt32BE(16), b.readUInt32BE(20)], nombre).toEqual([img.width, img.height]);
    }
    expect(fs.existsSync(path.join(WEB, "public", "landing", "zelena-wordmark.svg"))).toBe(true);
  });
});

describe("cabecera, enlaces y pie (en inglés, a rutas reales)", () => {
  it("Home y Community son dos rutas, y la cabecera marca la activa con aria-current", () => {
    expect(CABECERA.pestanas.map((t) => t.href)).toEqual(["/", "/comunidad"]);
    expect(leer("app/_landing/Header.tsx")).toContain('aria-current={t.pagina === activa ? "page" : undefined}');
  });

  it("Book a demo lleva al formulario con Harmony elegido (el slug existe)", () => {
    expect(ENLACES.reservarDemo).toBe("/empresas/contacto?interes=harmony");
    expect(SLUGS_INTERES).toContain("harmony");
    expect(ENLACES.entrar).toBe("/entrar");
    expect(ENLACES.proyectosAbiertos).toBe("/comunidad#open-projects");
  });

  it("el grupo Legal del pie es el de FOOTER_GRUPOS (mismos destinos y orden), en inglés", () => {
    const legal = FOOTER_GRUPOS.find((g) => g.titulo === "Legal");
    expect(PIE_LEGAL.map((e) => e.href)).toEqual(legal?.enlaces.map((e) => e.href));
    expect(PIE_LEGAL.map((e) => e.label)).toEqual(["Contribution agreement", "Privacy", "License"]);
    expect(PIE_LEGAL.filter((e) => e.externo).map((e) => e.href)).toEqual([URL_LICENCIA]);
  });

  it("el pie enlaza el manifiesto, el método y las decisiones, con la línea de marca", () => {
    const hrefs = PIE.enlaces.map((e) => e.href);
    for (const h of ["/manifiesto", "/metodo", "/gobernanza"]) expect(hrefs).toContain(h);
    expect(PIE.linea).toBe("© 2026 Zelena · Performance-based payroll for LATAM logistics, built on Stellar");
  });

  it("los avisos legales: pagos de bonos en la red principal, el reparto y la comunidad en la de pruebas", () => {
    expect(AVISOS_LEGALES.home).toMatch(/USDC on Stellar mainnet/);
    expect(AVISOS_LEGALES.home).toMatch(/split contract runs on the Stellar testnet/);
    expect(AVISOS_LEGALES.comunidad).toMatch(/Stellar testnet/);
    expect(AVISOS_LEGALES.comunidad).toMatch(/no monetary value/);
    for (const a of Object.values(AVISOS_LEGALES)) {
      expect(a).toContain("Nothing here is a securities offering or investment advice.");
      expect(a).not.toMatch(/payroll|bank|bounty|on-chain/i);
    }
  });

  // El founder eligió "payroll" para la landing en inglés (2026-10-25); en las páginas en
  // español sigue sin decirse "nómina" (E1-5).
  it("la palabra de nómina en inglés solo vive en los módulos de copy", () => {
    for (const r of archivosLanding().filter((r) => !/copy-[a-z]+\.ts$/.test(r))) {
      expect(leer(r), r).not.toMatch(/payroll/i);
    }
  });
});
