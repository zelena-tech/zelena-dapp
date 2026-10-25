/**
 * WP31-E1 · menú y pie del sitio (criterios E1-2 y E1-6).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  AVISOS_EN_MENU,
  AVISO_LEGAL,
  FOOTER_GRUPOS,
  MENU_EMPRESAS,
  MENU_PUBLICO,
  PUBLICAR_DISPONIBLE,
  RUTA_AVISOS,
  RUTAS_LANDING,
  RUTA_COMUNIDAD,
  RUTA_PUBLICAR,
  RUTA_RITOS,
  RUTA_SEGUIMIENTO,
  URL_LICENCIA,
  esEnlaceExterno,
  esRutaEmpresas,
  esRutaLanding,
  menuPara,
  rutaPublicar,
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

  it("con sesión de equipo: Mi día y Proyectos primero; Clientes solo si es interno y hay clientes", () => {
    const m = menuPara({ ruta: "/", conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo: false, conClientes: true });
    const labels = m.map((e) => e.label);
    expect(labels.slice(0, 2)).toEqual(["Mi día", "Proyectos"]);
    expect(labels).toContain("Clientes");
    expect(labels).not.toContain("Talento");
    expect(labels).not.toContain("Seguimiento");
    expect(labels.slice(-3)).toEqual(["Ágora", "Academia", "Comunidad"]);
    expect(m.find((e) => e.label === "Mi día")?.href).toBe("/equipo/hoy");
    expect(m.find((e) => e.label === "Proyectos")?.href).toBe("/equipo/proyectos");
  });

  it("con sesión de founder o supervisor: además Seguimiento (el dashboard) y Talento", () => {
    const m = menuPara({
      ruta: "/",
      conSesion: true,
      accesoEquipo: true,
      esInterno: true,
      puedeVerTodo: true,
      conAvisos: false,
      conClientes: true,
    });
    expect(m.map((e) => e.label)).toEqual([
      "Mi día",
      "Proyectos",
      "Seguimiento",
      "Talento",
      "Clientes",
      "Ágora",
      "Academia",
      "Comunidad",
    ]);
    expect(m.find((e) => e.label === "Talento")?.href).toBe("/equipo/talento");
    expect(m.find((e) => e.label === "Seguimiento")?.href).toBe("/equipo/dashboard");
    expect(RUTA_SEGUIMIENTO).toBe("/equipo/dashboard");
  });

  // Hallazgo de la verificación final: /equipo/dashboard no tenía enlace en ninguna parte.
  it("Seguimiento solo para quien ve todo el equipo, y su página existe", () => {
    expect(fs.existsSync(path.join(process.cwd(), "app", "equipo", "dashboard", "page.tsx"))).toBe(true);
    for (const puedeVerTodo of [false, true]) {
      const m = menuPara({ ruta: "/", conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo });
      expect(m.some((e) => e.href === RUTA_SEGUIMIENTO)).toBe(puedeVerTodo);
    }
    expect(menuPara({ ruta: "/", conSesion: false, accesoEquipo: true, esInterno: true, puedeVerTodo: true }).some((e) => e.href === RUTA_SEGUIMIENTO)).toBe(false);
  });

  // Hallazgo de la verificación final: /clientes salía en el menú aunque no hubiera clientes
  // ni forma de crearlos desde la web. Sin clientes visibles, no se dibuja.
  it("Clientes se oculta mientras no haya clientes que ver (también para el founder)", () => {
    const base = { ruta: "/", conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo: true };
    expect(menuPara(base).map((e) => e.label)).not.toContain("Clientes");
    expect(menuPara({ ...base, conClientes: false }).map((e) => e.label)).not.toContain("Clientes");
    expect(menuPara({ ...base, conClientes: true }).map((e) => e.label)).toContain("Clientes");
    // Con clientes, pero sin ser del equipo interno: tampoco.
    expect(menuPara({ ...base, esInterno: false, conClientes: true }).map((e) => e.label)).not.toContain("Clientes");
  });

  it("Nav resuelve si hay clientes contra la base, con la regla de la página de /clientes", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "Nav.tsx"), "utf8");
    expect(src).toMatch(/clientActor\(session, db\)/);
    expect(src).toMatch(/listClientsFor\(db, actor\)\.length > 0/);
    expect(src).toContain("conClientes={conClientes}");
    const ctx = fs.readFileSync(path.join(process.cwd(), "src", "components", "NavContextual.tsx"), "utf8");
    expect(ctx).toContain("menuPara({ ruta, conSesion, accesoEquipo, esInterno, puedeVerTodo, conClientes })");
  });

  it("con sesión de comunidad (sin acceso al trabajo): solo Ágora, Academia y Comunidad (los ritos)", () => {
    const m = menuPara({ ruta: "/perfil", conSesion: true, accesoEquipo: false, esInterno: false, puedeVerTodo: false });
    expect(m.map((e) => e.href)).toEqual(["/agora", "/academia", RUTA_RITOS]);
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

  // WP33: la página de ritos (la que antes era /comunidad) vive en /comunidad/ritos.
  it("RUTA_RITOS apunta a /comunidad/ritos y su página existe", () => {
    expect(RUTA_RITOS).toBe("/comunidad/ritos");
    expect(fs.existsSync(path.join(process.cwd(), "app", "comunidad", "ritos", "page.tsx"))).toBe(true);
  });
});

describe("rutas de la landing (WP33)", () => {
  it("solo / y /comunidad, exactas", () => {
    expect([...RUTAS_LANDING]).toEqual(["/", "/comunidad"]);
    for (const r of RUTAS_LANDING) expect(esRutaLanding(r)).toBe(true);
    for (const r of ["/comunidad/ritos", "/comunidad/ritos/3", "/comunidad/", "/manifiesto", "/empresas", "", "/?x=1"]) {
      expect(esRutaLanding(r), r).toBe(false);
    }
    expect(esRutaLanding(null)).toBe(false);
    expect(esRutaLanding(undefined)).toBe(false);
  });

  it("cada ruta de la landing tiene su página", () => {
    expect(fs.existsSync(path.join(process.cwd(), "app", "page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "app", "comunidad", "page.tsx"))).toBe(true);
  });
});

describe("menú con acceso real al trabajo (criterio I6 de WP31)", () => {
  // Nav resuelve `accesoEquipo` contra la base (lib/authz.ts): un contributor con el
  // acuerdo firmado y una membresía tiene acceso aunque no sea del equipo interno.
  const CONTRIBUTOR_MIEMBRO = { conSesion: true, accesoEquipo: true, esInterno: false, puedeVerTodo: false };

  it("un contributor miembro ve Mi día y Proyectos, pero no Seguimiento, Talento ni Clientes", () => {
    const m = menuPara({ ruta: "/", ...CONTRIBUTOR_MIEMBRO, conClientes: true });
    const labels = m.map((e) => e.label);
    expect(labels.slice(0, 2)).toEqual(["Mi día", "Proyectos"]);
    expect(labels).not.toContain("Seguimiento");
    expect(labels).not.toContain("Talento");
    expect(labels).not.toContain("Clientes");
    expect(labels.slice(-3)).toEqual(["Ágora", "Academia", "Comunidad"]);
  });

  it("un contributor sin membresía (sin acceso) no ve el trabajo", () => {
    const m = menuPara({ ruta: "/", ...CONTRIBUTOR_MIEMBRO, accesoEquipo: false });
    expect(m.map((e) => e.label)).not.toContain("Mi día");
    expect(m.filter((e) => INTERNO_PRIVADO.test(e.href))).toEqual([]);
  });

  it("Avisos va después de Proyectos, solo con acceso al trabajo y solo si su página existe", () => {
    const con = menuPara({ ruta: "/", ...CONTRIBUTOR_MIEMBRO, conAvisos: true });
    expect(con.map((e) => e.label).slice(0, 3)).toEqual(["Mi día", "Proyectos", "Avisos"]);
    expect(con.find((e) => e.label === "Avisos")?.href).toBe(RUTA_AVISOS);
    expect(RUTA_AVISOS).toBe("/equipo/avisos");
    const sinAcceso = menuPara({ ruta: "/", ...CONTRIBUTOR_MIEMBRO, accesoEquipo: false, conAvisos: true });
    expect(sinAcceso.map((e) => e.label)).not.toContain("Avisos");
    const sinPagina = menuPara({ ruta: "/", ...CONTRIBUTOR_MIEMBRO, conAvisos: false });
    expect(sinPagina.map((e) => e.label)).not.toContain("Avisos");
    expect(menuPara({ ruta: "/", ...SIN_SESION, conAvisos: true })).toEqual([...MENU_PUBLICO]);
  });

  // Un enlace a una ruta que no existe es un 404 a la vista de todos; y una ruta que ya
  // existe sin su enlace no la encuentra nadie. Quien fusione la página enciende la bandera.
  it("AVISOS_EN_MENU coincide con la existencia de app/equipo/avisos/page.tsx", () => {
    const existe = fs.existsSync(path.join(process.cwd(), "app", "equipo", "avisos", "page.tsx"));
    expect(
      AVISOS_EN_MENU,
      existe
        ? "Ya existe /equipo/avisos: pon AVISOS_EN_MENU = true en src/lib/menu.ts"
        : "No existe /equipo/avisos: AVISOS_EN_MENU tiene que quedar en false"
    ).toBe(existe);
    expect(menuPara({ ruta: "/", ...CONTRIBUTOR_MIEMBRO }).some((e) => e.href === RUTA_AVISOS)).toBe(existe);
  });

  it("PUBLICAR_DISPONIBLE coincide con la existencia de app/equipo/publicar/[id]/page.tsx", () => {
    const existe = fs.existsSync(path.join(process.cwd(), "app", "equipo", "publicar", "[id]", "page.tsx"));
    expect(
      PUBLICAR_DISPONIBLE,
      existe
        ? "Ya existe /equipo/publicar/[id]: pon PUBLICAR_DISPONIBLE = true en src/lib/menu.ts"
        : "No existe /equipo/publicar/[id]: PUBLICAR_DISPONIBLE tiene que quedar en false"
    ).toBe(existe);
    expect(RUTA_PUBLICAR).toBe("/equipo/publicar");
    expect(rutaPublicar(42)).toBe("/equipo/publicar/42");
  });

  it("Nav resuelve el acceso al trabajo contra la base, no con los claims de la cookie", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "components", "Nav.tsx"), "utf8");
    expect(src).toMatch(/accesoEquipo as tieneAccesoEquipo/);
    expect(src).toMatch(/tieneAccesoEquipo\(session, getDb\(\)\)/);
    expect(src).not.toMatch(/const accesoEquipo = esInterno;/);
    expect(src).not.toMatch(/actorFromSession\(/);
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

  it("incluye Ágora, Academia, Decisiones, Manifiesto, Servicios y Contacto", () => {
    for (const h of ["/agora", "/academia", "/gobernanza", "/manifiesto", "/empresas/servicios", "/empresas/contacto"]) {
      expect(hrefs).toContain(h);
    }
    const etiquetas = FOOTER_GRUPOS.flatMap((g) => g.enlaces.map((e) => e.label));
    expect(etiquetas).toContain("Decisiones");
    expect(etiquetas).toContain("Proyectos abiertos");
  });

  // Decisión del founder: el manifiesto cumple la función del whitepaper y es más claro.
  // /whitepaper solo existe como redirección 308 a /manifiesto (next.config.mjs).
  it("ni el menú ni el pie enlazan el whitepaper", () => {
    const todos = [
      ...hrefs,
      ...MENU_PUBLICO.map((e) => e.href),
      ...MENU_EMPRESAS.map((e) => e.href),
      ...menuPara({ ruta: "/", conSesion: true, accesoEquipo: true, esInterno: true, puedeVerTodo: true }).map((e) => e.href),
    ];
    expect(todos.filter((h) => /whitepaper/i.test(h))).toEqual([]);
    const etiquetas = FOOTER_GRUPOS.flatMap((g) => g.enlaces.map((e) => e.label));
    expect(etiquetas.filter((l) => /whitepaper/i.test(l))).toEqual([]);
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
