/**
 * WP31-E1 · menú y pie del sitio (criterios E1-2 y E1-6).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AVISO_LEGAL,
  FOOTER_GRUPOS,
  MENU_EMPRESAS,
  MENU_PUBLICO,
  RUTA_COMUNIDAD,
  URL_LICENCIA,
  esEnlaceExterno,
  esRutaEmpresas,
  menuPara,
} from "./menu";

const SIN_SESION = { conSesion: false, accesoEquipo: false, esInterno: false, puedeVerTodo: false };
const INTERNO_PRIVADO = /^\/(equipo|clientes|admin)(\/|$)/;

describe("menuPara (E1-2)", () => {
  it("sin sesión: las 4 puertas públicas, en orden, sin herramientas internas", () => {
    const m = menuPara({ ruta: "/", ...SIN_SESION });
    expect(m).toHaveLength(4);
    expect(m.map((e) => e.href)).toEqual(["/manifiesto", "/metodo", RUTA_COMUNIDAD, "/empresas"]);
    expect(m.map((e) => e.label)).toEqual(["Manifiesto", "Método", "Comunidad", "Para empresas"]);
    expect(m.filter((e) => INTERNO_PRIVADO.test(e.href))).toEqual([]);
    expect(m).toEqual([...MENU_PUBLICO]);
  });

  it("sin sesión, los flags no abren nada (una cookie ausente no es equipo)", () => {
    const m = menuPara({ ruta: "/agora", conSesion: false, accesoEquipo: true, esInterno: true, puedeVerTodo: true });
    expect(m).toEqual([...MENU_PUBLICO]);
  });

  it("con sesión de equipo: Mi día y Proyectos primero; Clientes solo si es interno", () => {
    const m = menuPara({ ruta: "/", conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo: false });
    const labels = m.map((e) => e.label);
    expect(labels.slice(0, 2)).toEqual(["Mi día", "Proyectos"]);
    expect(labels).toContain("Clientes");
    expect(labels).not.toContain("Talento");
    expect(labels.slice(-3)).toEqual(["Ágora", "Academia", "Comunidad"]);
    expect(m.find((e) => e.label === "Mi día")?.href).toBe("/equipo/hoy");
    expect(m.find((e) => e.label === "Proyectos")?.href).toBe("/equipo/proyectos");
  });

  it("con sesión de founder o supervisor: además Talento", () => {
    const m = menuPara({ ruta: "/", conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo: true });
    expect(m.map((e) => e.label)).toEqual(["Mi día", "Proyectos", "Talento", "Clientes", "Ágora", "Academia", "Comunidad"]);
    expect(m.find((e) => e.label === "Talento")?.href).toBe("/equipo/talento");
  });

  it("con sesión de comunidad (sin acceso al trabajo): solo Ágora, Academia y Comunidad", () => {
    const m = menuPara({ ruta: "/perfil", conSesion: true, accesoEquipo: false, esInterno: false, puedeVerTodo: false });
    expect(m.map((e) => e.href)).toEqual(["/agora", "/academia", RUTA_COMUNIDAD]);
    expect(m.filter((e) => INTERNO_PRIVADO.test(e.href))).toEqual([]);
  });

  it("menuPara no incluye Admin ni el perfil (los conserva NavContextual por rol)", () => {
    const todos = menuPara({ ruta: "/", conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo: true });
    expect(todos.some((e) => e.href === "/admin" || e.href === "/perfil")).toBe(false);
  });

  it("en /empresas el menú de empresas, con 'Zelena' y no 'La DAO'", () => {
    for (const ruta of ["/empresas", "/empresas/servicios", "/empresas/contacto"]) {
      for (const conSesion of [false, true]) {
        const m = menuPara({ ruta, ...SIN_SESION, conSesion });
        expect(m).toEqual([...MENU_EMPRESAS]);
      }
    }
    expect(MENU_EMPRESAS.map((e) => e.label)).toContain("Zelena");
    expect(MENU_EMPRESAS.some((e) => /DAO/.test(e.label))).toBe(false);
    expect(esRutaEmpresas("/empresasx")).toBe(false);
  });

  it("RUTA_COMUNIDAD apunta a /comunidad", () => {
    expect(RUTA_COMUNIDAD).toBe("/comunidad");
  });
});

describe("pie y aviso legal (E1-6)", () => {
  const hrefs = FOOTER_GRUPOS.flatMap((g) => g.enlaces.map((e) => e.href));

  it("enlaza el acuerdo, la privacidad y la licencia en GitHub", () => {
    expect(hrefs).toContain("/acuerdo");
    expect(hrefs).toContain("/privacidad");
    expect(hrefs).toContain(URL_LICENCIA);
    expect(URL_LICENCIA).toBe("https://github.com/zelena-tech/zelena-dapp/blob/HEAD/LICENSE");
    const legal = FOOTER_GRUPOS.find((g) => g.titulo === "Legal");
    expect(legal?.enlaces.map((e) => e.label)).toEqual(["Acuerdo de contribución", "Privacidad", "Licencia"]);
  });

  // El repo no tiene rama `main` (la de por defecto es `develop`): con `blob/main/` el
  // enlace daba 404. `blob/HEAD/` lo resuelve GitHub a la rama por defecto, sea cual sea.
  it("la licencia no depende del nombre de una rama", () => {
    expect(URL_LICENCIA).toMatch(/^https:\/\/github\.com\/zelena-tech\/zelena-dapp\/blob\/HEAD\/LICENSE$/);
    expect(URL_LICENCIA).not.toMatch(/\/blob\/(main|master|develop)\//);
  });

  it("incluye Ágora, Academia, Decisiones, Whitepaper, Servicios y Contacto", () => {
    for (const h of ["/agora", "/academia", "/gobernanza", "/whitepaper", "/empresas/servicios", "/empresas/contacto"]) {
      expect(hrefs).toContain(h);
    }
    const etiquetas = FOOTER_GRUPOS.flatMap((g) => g.enlaces.map((e) => e.label));
    expect(etiquetas).toContain("Decisiones");
    expect(etiquetas).toContain("Proyectos abiertos");
  });

  it("AVISO_LEGAL es el texto nuevo y no dice 'sin dinero real'", () => {
    expect(AVISO_LEGAL).toBe(
      "Las funciones de pago de la plataforma corren en la red de pruebas de Stellar. Nada aquí es oferta de valores ni asesoría."
    );
    expect(AVISO_LEGAL.toLowerCase()).not.toContain("sin dinero real");
  });

  it("solo la licencia sale del sitio", () => {
    expect(hrefs.filter(esEnlaceExterno)).toEqual([URL_LICENCIA]);
  });

  it("Footer.tsx pinta FOOTER_GRUPOS y AVISO_LEGAL", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "Footer.tsx"), "utf8");
    expect(src).toContain("FOOTER_GRUPOS.map");
    expect(src).toContain("{AVISO_LEGAL}");
  });
});

describe("límite cliente/servidor", () => {
  it("menu.ts no importa nada (lo usa un componente de cliente)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "menu.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
