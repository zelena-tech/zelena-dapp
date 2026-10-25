/**
 * WP33 · el cromo de la landing en inglés: un solo layout raíz que cambia de cromo por
 * ruta (MarcoSitio), el pie con el grupo Legal obligatorio, los enlaces a rutas reales,
 * las fuentes solo en la landing y ninguna imagen por el optimizador de Next.
 * Tests estáticos sobre el código y sobre el copy común (app/_landing/copy-comun.ts).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FOOTER_GRUPOS, URL_LICENCIA } from "./menu";
import { SLUGS_INTERES } from "./servicios";
import { AVISOS_LEGALES, CABECERA, ENLACES, PIE, PIE_LEGAL } from "../../app/_landing/copy-comun";

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
    expect(layout).toContain('<html lang="es">');
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
