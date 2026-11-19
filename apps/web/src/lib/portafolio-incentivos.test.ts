/**
 * La inicio (el portafolio), los incentivos y el contacto para empresas (/,
 * /empresas/incentivos, /empresas/contacto).
 *
 * Pedido del founder (2026-11-17): las páginas llevan el diseño de zelena.tech (el cromo
 * claro de la landing), pero en español, y ningún enlace lleva al diseño oscuro viejo.
 * Estas pruebas fijan:
 *  - el cromo: las tres rutas traen su propio marco claro, y el documento sigue en español;
 *  - la historia de la inicio: la frase de gancho, a quiénes hemos impactado y los servicios;
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
  RUTA_CONTACTO,
  RUTA_INCENTIVOS,
  RUTA_PORTAFOLIO,
  esRutaCromoClaroEs,
  esRutaLanding,
} from "./menu";
import { RUTAS_SITEMAP } from "./seo";
import { INTERESES, INTERES_A_LA_MEDIDA, SLUGS_INTERES } from "./servicios";
import * as EMPRESAS from "../../app/_landing/copy-empresas";
import { CABECERA_EMPRESAS, PIE_EMPRESAS, contactoCon } from "../../app/_landing/copy-empresas";
import * as PORTAFOLIO_COPY from "../../app/_landing/copy-portafolio";
import {
  CIERRE_PORTAFOLIO,
  COLABORAR,
  HERO_PORTAFOLIO,
  IMPACTO,
  LINEAS,
  META_PORTAFOLIO,
  NECESIDADES,
  PORTAFOLIO,
} from "../../app/_landing/copy-portafolio";
import * as CONTACTO from "../../app/_landing/copy-contacto";
import { CLIENTES } from "../../app/_landing/copy-home";
import * as INCENTIVOS from "../../app/_landing/copy-incentivos";

// El middleware importa la sesión con el alias "@/" (vitest no lo resuelve).
vi.mock("@/lib/jwt", async () => await import("./jwt"));
import { middleware } from "../../middleware";

const WEB = process.cwd(); // apps/web
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

// El portafolio es la inicio desde el 2026-11-17 (app/page.tsx); /empresas/portafolio redirige.
const PAGINAS = ["app/page.tsx", "app/empresas/incentivos/page.tsx"] as const;
const DE_EMPRESAS = fs
  .readdirSync(path.join(WEB, "app/_landing/empresas"))
  .filter((n) => n.endsWith(".tsx"))
  .map((n) => `app/_landing/empresas/${n}`);

describe("cromo claro en español", () => {
  it("las tres rutas, exactas, y ninguna es de la landing en inglés", () => {
    expect([...RUTAS_CROMO_CLARO_ES]).toEqual(["/", "/empresas/incentivos", "/empresas/contacto"]);
    expect(RUTA_PORTAFOLIO).toBe("/");
    expect(RUTA_INCENTIVOS).toBe("/empresas/incentivos");
    expect(RUTA_CONTACTO).toBe("/empresas/contacto");
    for (const r of RUTAS_CROMO_CLARO_ES) {
      expect(esRutaCromoClaroEs(r), r).toBe(true);
      expect(esRutaLanding(r), r).toBe(false);
      expect(RUTAS_LANDING, r).not.toContain(r);
    }
    for (const r of ["/empresas", "/empresas/servicios", "/empresas/portafolio", "/en", ""]) {
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
    // Servicios | Incentivos | Colaborar | Manifiesto (pedido del founder: faltaban colaborar y el manifiesto).
    expect(CABECERA_EMPRESAS.pestanas.map((t) => t.href)).toEqual(["/#servicios", RUTA_INCENTIVOS, "/#colaborar", "/manifiesto"]);
    expect(CABECERA_EMPRESAS.pestanas.filter((t) => t.enIngles).map((t) => t.href)).toEqual(["/manifiesto"]);
    expect(marco).toContain('aria-current={t.pagina === pagina ? "page" : undefined}');
    expect(marco).toContain('hrefLang={t.enIngles ? "en" : undefined}');
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
    // Un solo <h1> por página: el de incentivos lo pinta el hero compartido (Comunes) y el
    // del portafolio, su hero propio (el del tachado). Cada página usa el suyo una vez.
    const h1De = (r: string) => (leer(r).match(/<h1\b/g) ?? []).length;
    expect(h1De("app/_landing/empresas/Comunes.tsx")).toBe(1);
    expect(h1De("app/_landing/empresas/SeccionesPortafolio.tsx")).toBe(1);
    for (const r of ["Explorador.tsx", "SeccionesIncentivos.tsx", "MarcoEmpresas.tsx"]) {
      expect(h1De(`app/_landing/empresas/${r}`), r).toBe(0);
    }
    expect(leer(PAGINAS[0]).match(/<HeroPortafolio \/>/g) ?? []).toHaveLength(1);
    expect(leer(PAGINAS[0])).not.toMatch(/<HeroEmpresas\b/);
    expect(leer(PAGINAS[1]).match(/<HeroEmpresas\b/g) ?? []).toHaveLength(1);
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
    for (const h of [RUTA_PORTAFOLIO, RUTA_INCENTIVOS, "/empresas/contacto", "/manifiesto", "/en"]) expect(pie).toContain(h);
    // El manifiesto y la landing están en inglés: son los enlaces del pie que lo marcan.
    expect(PIE_EMPRESAS.enlaces.filter((e) => e.enIngles).map((e) => e.href)).toEqual(["/manifiesto", "/en"]);
    expect(leer("app/empresas/page.tsx")).toContain('<Link href="/" className="group');
  });
});

/**
 * Pedido del founder (2026-11-17): ningún enlace del cromo claro en español lleva a una
 * página con el diseño oscuro viejo. /empresas y /empresas/servicios redirigen a la inicio,
 * el contacto se pinta con el diseño de zelena.tech, y la comunidad, el método viejo y el
 * Ágora no se enlazan desde aquí (las dos últimas son del diseño viejo).
 */
describe("ningún enlace al diseño oscuro viejo", () => {
  const VIEJAS = ["/empresas", "/empresas/servicios", "/metodo", "/agora", "/entrar"];
  const destino = (h: string) => h.split(/[?#]/)[0] || "/";
  /** Cada texto del copy que es una ruta del sitio ("/..."), recorriendo objetos y listas. */
  const rutas = (v: unknown): string[] =>
    typeof v === "string"
      ? /^\/[^<\s]*$/.test(v)
        ? [v]
        : []
      : v && typeof v === "object"
        ? Object.values(v).flatMap(rutas)
        : [];

  it("los enlaces de la cabecera, el pie, la inicio y el contacto llevan a páginas con el diseño nuevo", () => {
    const hrefs = [
      ...CABECERA_EMPRESAS.pestanas.map((t) => t.href),
      ...PIE_EMPRESAS.enlaces.map((e) => e.href),
      ...rutas(EMPRESAS),
      ...rutas(PORTAFOLIO_COPY),
      ...rutas(CONTACTO),
    ];
    expect(hrefs).toContain("/empresas/contacto?interes=a-la-medida");
    const nuevas = new Set([...RUTAS_CROMO_CLARO_ES, ...RUTAS_LANDING]);
    for (const h of hrefs) {
      expect(VIEJAS, h).not.toContain(destino(h));
      expect(nuevas.has(destino(h)), h).toBe(true);
    }
  });

  it("/empresas y /empresas/servicios redirigen (307) a la inicio y a sus servicios", async () => {
    const mod = (await import("../../next.config.mjs")) as {
      default: { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    };
    const r = await mod.default.redirects();
    expect(r).toContainEqual({ source: "/empresas", destination: "/", permanent: false });
    expect(r).toContainEqual({ source: "/empresas/servicios", destination: "/#servicios", permanent: false });
    expect(PORTAFOLIO.ancla).toBe("servicios");
  });

  it("el contacto va en el marco claro, en español, con el formulario de la demo y su casilla de autorización", () => {
    const src = leer("app/empresas/contacto/page.tsx");
    expect(src).toContain('<MarcoEmpresas pagina="contacto">');
    expect(src).toContain('export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };');
    expect(src).toContain('export const dynamic = "force-dynamic";');
    expect(src).toMatch(/idioma: "es",\n[\s\S]*?imagen: null,/);
    expect(src).toContain("ruta: RUTA_CONTACTO,");
    expect(src).not.toMatch(/font-serif|text-paper|bg-surface|btn-primary|ContactoForm/);
    expect(src).toContain("formulario={FORMULARIO_CONTACTO}");
    // Los intereses son los del formulario de siempre (la API los valida), sin uno marcado de más.
    expect(CONTACTO.FORMULARIO_CONTACTO.intereses.map((i) => i.slug)).toEqual(SLUGS_INTERES);
    expect(CONTACTO.interesContacto("wms")).toBe("wms");
    expect(CONTACTO.interesContacto("no-existe")).toBe("");
    expect(CONTACTO.interesContacto(undefined)).toBe("");
    // La casilla de autorización (Ley 1581) sigue en el formulario que pinta: nunca premarcada.
    const form = leer("app/_landing/demo/FormularioDemo.tsx");
    expect(form).toContain('<input id="demo-acepto" name="acepto" type="checkbox" required');
    expect(form).not.toMatch(/defaultChecked|checked=\{true\}/);
    // Sin plazos inventados.
    expect(JSON.stringify(CONTACTO)).not.toMatch(/24 ?h|horas h[aá]biles|en \d+ d[ií]as/i);
  });
});

describe("portafolio · nueve líneas que llevan a un contacto real", () => {
  it("dos productos propios, un programa de incentivos y seis servicios", () => {
    const cuenta = (t: string) => LINEAS.filter((l) => l.tipo === t).length;
    expect([cuenta("Producto"), cuenta("Programa"), cuenta("Servicio")]).toEqual([2, 1, 6]);
    expect(new Set(LINEAS.map((l) => l.id)).size).toBe(LINEAS.length);
  });

  // Pedido del founder (2026-11-17): el programa de incentivos va al lado del WMS.
  it("el WMS va primero y el programa de incentivos, a su lado; el filtro sigue ese orden", () => {
    expect(LINEAS.slice(0, 3).map((l) => l.id)).toEqual(["wms", "incentivos", "social"]);
    expect(LINEAS.slice(3).every((l) => l.tipo === "Servicio")).toBe(true);
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
    expect(CIERRE_PORTAFOLIO.secundario.href).toBe(RUTA_INCENTIVOS);
  });
});

/**
 * Pedido del founder (2026-11-17): al portafolio le faltaba la parte de colaborar, y en
 * ella el manifiesto. Lleva a páginas que existen y tienen el diseño nuevo; no promete
 * pagos ni nombra la red.
 */
describe("portafolio · la parte de colaborar", () => {
  it("tiene su sección con ancla, y su pestaña en la cabecera y su enlace en el pie", () => {
    expect(COLABORAR.ancla).toBe("colaborar");
    expect(`${COLABORAR.h2.linea1} ${COLABORAR.h2.antes}${COLABORAR.h2.enfasis}`).toBe("Rediseñamos la forma de colaborar.");
    expect(leer("app/page.tsx")).toContain("<Colaborar />");
    expect(leer("app/_landing/empresas/SeccionesPortafolio.tsx")).toContain("id={COLABORAR.ancla}");
    expect(CABECERA_EMPRESAS.pestanas.map((t) => t.label)).toContain("Colaborar");
    expect(PIE_EMPRESAS.enlaces.map((e) => e.href)).toContain("/#colaborar");
  });

  it("sus tres puertas: contarnos una necesidad, la comunidad y el manifiesto", () => {
    expect(COLABORAR.puertas.map((p) => p.href)).toEqual(["/empresas/contacto?interes=a-la-medida", "/comunidad", "/manifiesto"]);
    expect(COLABORAR.puertas.map((p) => p.t)).toEqual(["Trae una necesidad", "Construye con nosotros", "Lee el manifiesto"]);
    for (const r of ["app/comunidad/page.tsx", "app/manifiesto/page.tsx"]) {
      expect(fs.existsSync(path.join(WEB, r)), r).toBe(true);
    }
    // La comunidad y el manifiesto son de la landing en inglés: el enlace lo marca.
    expect(COLABORAR.puertas.filter((p) => p.enIngles).map((p) => p.href)).toEqual(["/comunidad", "/manifiesto"]);
    expect(leer("app/_landing/empresas/SeccionesPortafolio.tsx")).toContain('hrefLang={p.enIngles ? "en" : undefined}');
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

/**
 * Pedido del founder (2026-11-17): la inicio cuenta una historia en tres tiempos (la frase
 * de gancho, a quiénes hemos impactado y los servicios) y nombra a empresas reales. Solo
 * las que él autorizó para la home, y solo con lo que el sitio ya sostiene: nada de cifras
 * de impacto inventadas. Se le habla a "tu negocio", nunca a "tu pyme".
 */
describe("portafolio · la historia y los clientes", () => {
  it("el titular tacha 'complicarte' y el lector de pantalla oye 'Tecnología para mejorar tu negocio.'", () => {
    const h = HERO_PORTAFOLIO.h1;
    expect(`${h.linea1} ${h.resaltado}`).toBe("Tecnología para mejorar tu negocio.");
    expect(h.tachado).toBe("complicarte");
    expect(META_PORTAFOLIO.titulo).toBe("Zelena · Tecnología para mejorar tu negocio");
    const hero = leer("app/_landing/empresas/SeccionesPortafolio.tsx");
    expect(hero).toContain('<span className={e.tachado} aria-hidden="true">');
    // El único movimiento al cargar respeta "menos movimiento".
    const css = leer("app/_landing/empresas/empresas.module.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.tachado::after/);
  });

  it("la historia va en tres tiempos: la frase, a quiénes hemos impactado y los servicios", () => {
    const inicio = leer("app/page.tsx");
    const orden = ["<HeroPortafolio />", "<Impacto />", "<Explorador />", "<CicloDeTrabajo />", "<Colaborar />", "<CierreEmpresas"];
    const pos = orden.map((x) => inicio.indexOf(x));
    expect(pos.every((p) => p >= 0), String(pos)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(IMPACTO.titulo).toBe("A quiénes hemos impactado.");
    // "Un solo aliado" salió: repetía los servicios y alargaba el camino hasta ellos.
    expect(inicio).not.toMatch(/CuatroLineas/);
    expect(leer("app/_landing/empresas/SeccionesPortafolio.tsx")).not.toMatch(/CuatroLineas|CUATRO_LINEAS/);
  });

  it("nunca dice 'pyme': ni la inicio, ni el contacto, ni el cromo", () => {
    for (const m of [PORTAFOLIO_COPY, EMPRESAS, CONTACTO]) expect(JSON.stringify(m)).not.toMatch(/pyme/i);
  });

  it("los clientes son exactamente los autorizados para la home, con su Instagram", () => {
    expect(CLIENTES.map((c) => c.nombre)).toEqual(["Bloomshell", "Montoc", "Burbay"]);
    const seccion = leer("app/_landing/empresas/SeccionesPortafolio.tsx");
    expect(seccion).toContain('import { CLIENTES } from "../copy-home";');
    expect(seccion).toContain("href={`https://www.instagram.com/${c.instagram}/`}");
    expect(seccion).toContain('rel="noopener noreferrer"');
    // Ningún nombre de empresa escrito a mano en el copy del portafolio: salen de CLIENTES.
    expect(leer("app/_landing/copy-portafolio.ts")).not.toMatch(/Bloomshell|Montoc|Burbay/);
  });

  it("lo que se afirma del impacto sale de lo que el sitio ya sostiene, sin cifras inventadas", () => {
    expect(IMPACTO.historia).toContain("Llevamos dos años construyendo junto a operaciones reales en Colombia.");
    const texto = JSON.stringify({ IMPACTO, HERO_PORTAFOLIO });
    // "10 a 200 personas" es el público al que apuntamos (ya publicado), no una cifra de impacto.
    expect(texto).not.toMatch(/\d+ ?%|millones|miles de|cientos de|\d+ (empresas|clientes|bodegas)/i);
  });

  // Pedido del founder (2026-11-17): la lista de situaciones "se hacía eterna". Ahora son
  // píldoras cortas dentro de los servicios, no una sección propia fila por fila.
  it("las situaciones para tachar son píldoras cortas dentro de los servicios, en botones con estado", () => {
    for (const n of NECESIDADES) expect(n.texto.length, n.texto).toBeLessThanOrEqual(34);
    expect(NECESIDADES.length).toBeLessThanOrEqual(12);
    const explorador = leer("app/_landing/empresas/Explorador.tsx");
    expect(explorador).toContain("aria-pressed={elegidas.has(i)}");
    expect(explorador).toContain("{n.texto}");
    // Dentro de la sección de servicios, después de su titular: no una sección aparte.
    expect(explorador.match(/<section\b/g) ?? []).toHaveLength(1);
    expect(explorador.indexOf("PORTAFOLIO.h2")).toBeLessThan(explorador.indexOf("NECESIDADES.map"));
  });

  it("sin etiquetas numeradas encima de los titulares ni aparición al hacer scroll en el portafolio", () => {
    expect(leer("app/_landing/copy-portafolio.ts")).not.toMatch(/etiqueta: "0\d ·/);
    for (const r of ["SeccionesPortafolio.tsx", "Explorador.tsx"]) {
      expect(leer(`app/_landing/empresas/${r}`), r).not.toMatch(/data-reveal=/);
    }
  });
});

/**
 * Pedido del founder (2026-11-17): ZELENA Social Listening entra como segundo producto
 * propio. Dice solo lo que el producto hace hoy (captura de métricas públicas, histórico,
 * metas, gestión de creadoras, comentarios clasificados): nada de demografía de la
 * audiencia ni de ventas, que no se obtienen.
 */
describe("portafolio · ZELENA Social Listening", () => {
  const social = LINEAS.find((l) => l.id === "social");

  it("es un producto, con su interés en el formulario y situaciones que lo recomiendan", () => {
    expect(social).toMatchObject({ tipo: "Producto", nombre: "ZELENA Social Listening", interes: "social-listening" });
    expect(SLUGS_INTERES).toContain("social-listening");
    expect(NECESIDADES.filter((n) => n.lineas.includes("social")).length).toBeGreaterThanOrEqual(2);
    expect(META_PORTAFOLIO.descripcion).toContain("ZELENA Social Listening");
  });

  it("no promete lo que no se obtiene: ni demografía de la audiencia, ni ventas, ni acceso a la cuenta", () => {
    const texto = JSON.stringify(social);
    expect(texto).not.toMatch(/demograf|edad de (tu|la) audiencia|g[eé]nero de (tu|la) audiencia|ventas|ROI|retorno/i);
    expect(texto).toContain("Solo se leen publicaciones públicas");
  });
});

/**
 * Pedido del founder (2026-11-17): zelena.tech/ abre el portafolio (la historia nueva, en
 * español). La landing en inglés no se borra: vive en /en, con su idioma y su cromo, y
 * /empresas/portafolio redirige a la inicio para no romper los enlaces ya compartidos.
 */
describe("la inicio es el portafolio", () => {
  it("/ pinta el portafolio en español y /en la landing en inglés", async () => {
    expect(leer("app/page.tsx")).toContain("<HeroPortafolio />");
    expect(leer("app/en/page.tsx")).toContain('<LandingShell pagina="home">');
    expect(fs.existsSync(path.join(WEB, "app/empresas/portafolio/page.tsx"))).toBe(false);
    const idioma = async (ruta: string) =>
      (await middleware(new NextRequest(`http://localhost${ruta}`))).headers.get(`x-middleware-request-${CABECERA_IDIOMA}`);
    expect(await idioma("/")).toBeNull();
    expect(await idioma("/en")).toBe("en");
    expect(RUTAS_SITEMAP).toContain("/en");
    expect(RUTAS_SITEMAP).not.toContain("/empresas/portafolio");
  });

  it("/empresas/portafolio redirige con 308 a la inicio", async () => {
    const mod = (await import("../../next.config.mjs")) as {
      default: { redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    };
    expect(await mod.default.redirects()).toContainEqual({ source: "/empresas/portafolio", destination: "/", permanent: true });
  });

  it("la landing en inglés enlaza a la inicio en español, y su logo y su pestaña Home van a /en", async () => {
    const { CABECERA, PIE } = await import("../../app/_landing/copy-comun");
    expect(CABECERA.pestanas[0].href).toBe("/en");
    expect(PIE.enlaces.map((e) => e.href)).toContain("/");
  });
});

