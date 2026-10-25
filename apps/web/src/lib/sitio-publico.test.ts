/**
 * WP31-E1 · sitio público, tests ESTÁTICOS sobre el código fuente.
 *
 * Criterios: E1-1 (sin la estructura societaria), E1-2b (Admin y perfil por rol),
 * E1-3 (redirecciones 308), E1-5 (/empresas), E1-8 (/metodo), E1-9 (privacidad y
 * casilla), E1-10 (landing; desde WP33, la landing en inglés de / y /comunidad), E1-11
 * (jerga) y E1-13 (literales del tipo de proyecto).
 *
 * La lista de archivos públicos se GENERA recorriendo `app/`: una página nueva
 * entra sola, sin que nadie tenga que acordarse de añadirla aquí. Incluye todo
 * app/_landing/** (componentes, copy y hojas de estilo de la landing en inglés).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PASOS_METODO } from "./metodo";
import { RUTA_VOTAR } from "./landing-datos";
import { CABECERA, ENLACES } from "../../app/_landing/copy-comun";
import { BENTO, HARMONY, HERO as HERO_INICIO } from "../../app/_landing/copy-home";
import { CIFRAS, HERO as HERO_COMUNIDAD } from "../../app/_landing/copy-comunidad";

const WEB = process.cwd(); // apps/web
const rel = (p: string) => path.relative(WEB, p).split(path.sep).join("/");
const leer = (r: string) => fs.readFileSync(path.join(WEB, r), "utf8");

function recorrer(dir: string, filtro: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...recorrer(p, filtro));
    else if (filtro.test(e.name)) out.push(p);
  }
  return out;
}

/** Zonas de `app/` que no son sitio público (tienen su propia puerta). */
const PRIVADAS = /^app\/(api|equipo|admin|clientes|perfil)\//;
// WP33: PruebaEnVivo, PruebaTestnet y ProximoEncuentro salieron con la landing anterior
// (sus cifras y fechas las pinta ahora /comunidad, desde lib/landing-datos.ts).
const COMPONENTES_PUBLICOS = ["Nav", "NavContextual", "Footer", "IntroEcosistema", "PruebasTestnetLista", "ui"];
const LIBS_PUBLICAS = ["menu", "metodo", "servicios", "encuentros", "aviso-privacidad", "seo", "landing-datos"];

/** Todo lo de la landing en inglés: componentes, copy y hojas de estilo, a cualquier profundidad. */
const archivosLanding = (): string[] =>
  recorrer(path.join(WEB, "app", "_landing"), /\.(tsx?|css)$/)
    .map(rel)
    .sort();

/**
 * Lista generada de archivos públicos (E1-1). Incluye los `.ts` de `app/`: el copy de la
 * landing en inglés vive en app/_landing/copy-*.ts, y robots y sitemap también son públicos.
 * De la landing entran también sus hojas de estilo (un comentario también se publica).
 */
function archivosPublicos(): string[] {
  const paginas = recorrer(path.join(WEB, "app"), /\.tsx?$/)
    .map(rel)
    .filter((r) => !PRIVADAS.test(r));
  const estilosLanding = archivosLanding().filter((r) => r.endsWith(".css"));
  const componentes = COMPONENTES_PUBLICOS.map((c) => `src/components/${c}.tsx`);
  const libs = LIBS_PUBLICAS.map((l) => `src/lib/${l}.ts`);
  return [...paginas, ...estilosLanding, ...componentes, ...libs].sort();
}

/** Líneas que casan con un patrón, como `archivo:línea: texto`. */
function coincidencias(archivos: string[], patron: RegExp, excepto?: (r: string) => boolean): string[] {
  const out: string[] = [];
  for (const r of archivos) {
    if (excepto?.(r)) continue;
    leer(r)
      .split("\n")
      .forEach((l, i) => {
        if (patron.test(l)) out.push(`${r}:${i + 1}: ${l.trim().slice(0, 120)}`);
      });
  }
  return out;
}

const PUBLICOS = archivosPublicos();

describe("la lista generada de archivos públicos", () => {
  it("no pasa por vacío: incluye la landing, el método, la privacidad, el acuerdo y los legales", () => {
    expect(PUBLICOS.length).toBeGreaterThan(25);
    for (const r of [
      "app/page.tsx",
      "app/layout.tsx",
      "app/metodo/page.tsx",
      "app/privacidad/page.tsx",
      "app/acuerdo/page.tsx",
      "app/gobernanza/page.tsx",
      "app/academia/page.tsx",
      "app/agora/page.tsx",
      "app/entrar/page.tsx",
      "app/empresas/page.tsx",
      "app/manifiesto/page.tsx",
      "app/comunidad/ritos/page.tsx",
      "app/comunidad/page.tsx",
      "app/_landing/copy-comun.ts",
      "app/_landing/copy-home.ts",
      "app/_landing/copy-comunidad.ts",
      "app/_landing/LandingShell.tsx",
      "app/_landing/landing.module.css",
      "app/_landing/home/HeroBento.tsx",
      "app/_landing/home/FlujoPagos.tsx",
      "app/_landing/home/pagos.module.css",
      "app/_landing/comunidad/Hero.tsx",
      "app/_landing/comunidad/VentanaCodigo.tsx",
      "app/_landing/comunidad/comunidad.module.css",
      "app/robots.ts",
      "app/sitemap.ts",
    ]) {
      expect(PUBLICOS).toContain(r);
    }
    // Todo app/_landing/** entra en la lista: los guardas de abajo la cubren entera.
    expect(archivosLanding().length).toBeGreaterThan(40);
    expect(archivosLanding().filter((r) => !PUBLICOS.includes(r))).toEqual([]);
    expect(PUBLICOS.some((r) => r.startsWith("app/equipo/") || r.startsWith("app/admin/"))).toBe(false);
  });

  it("todos los archivos de la lista existen (un componente renombrado no se escapa)", () => {
    expect(PUBLICOS.filter((r) => !fs.existsSync(path.join(WEB, r)))).toEqual([]);
  });

  it("/ecosistema ya no es una página (redirige a /metodo)", () => {
    expect(fs.existsSync(path.join(WEB, "app", "ecosistema", "page.tsx"))).toBe(false);
  });

  // Decisión del founder: el manifiesto cumple la misma función que el whitepaper y es
  // más claro. docs/whitepaper.md queda en el repo como documento interno, sin servirse.
  it("/whitepaper ya no es una página (redirige a /manifiesto)", () => {
    expect(fs.existsSync(path.join(WEB, "app", "whitepaper"))).toBe(false);
  });

  it("ninguna superficie pública enlaza ni nombra el whitepaper", () => {
    expect(coincidencias(PUBLICOS, /whitepaper/i)).toEqual([]);
  });

  it("el paquete ya no lleva docs/whitepaper.md", () => {
    expect(leer("next.config.mjs")).not.toMatch(/"[^"]*docs\/whitepaper\.md"/);
    expect(leer("scripts/verificar-paquete.mjs")).not.toMatch(/falta docs\/whitepaper/);
  });
});

describe("E1-1 · ninguna superficie pública nombra la estructura societaria", () => {
  it("sin la sigla (sensible a mayúsculas: `tag-sas` es una clase CSS, no texto)", () => {
    expect(coincidencias(PUBLICOS, /\bSAS\b|S\.A\.S/)).toEqual([]);
  });

  it("sin sociedad, societario, empresa detrás, empresa formal, acuerdo de servicios ni accionista", () => {
    expect(
      coincidencias(PUBLICOS, /societari|\bsociedad\b|empresa detr[aá]s|empresa formal|acuerdo de servicios|accionista/i)
    ).toEqual([]);
  });
});

describe("E1-11 · sin jerga en lo público", () => {
  it("sin bounty, on-chain, Intake, Stage, treasury ni farmeo", () => {
    expect(coincidencias(PUBLICOS, /\bbounty|on-chain|\bIntake\b|\bStage\b|treasury|farmeo/i)).toEqual([]);
  });

  it("'hash' solo en /entrar (detalle técnico de la firma); en lo demás es 'huella'", () => {
    expect(coincidencias(PUBLICOS, /\bhash\b/i, (r) => r.startsWith("app/entrar/"))).toEqual([]);
  });

  // Decisión del founder (2026-10-25): "payroll" se queda en la landing en inglés, y solo en
  // sus módulos de copy. En español sigue sin decirse "nómina" (WP31, E1-5).
  it("'payroll' solo en los módulos de copy de la landing en inglés; 'nómina' en ninguna parte", () => {
    expect(coincidencias(PUBLICOS, /payroll/i, (r) => /^app\/_landing\/copy-[a-z]+\.ts$/.test(r))).toEqual([]);
    expect(coincidencias(PUBLICOS, /\bn[oó]minas?\b/i)).toEqual([]);
  });

  it("el producto logístico es el WMS: nunca FMS ni 'fulfillment management'", () => {
    expect(coincidencias(PUBLICOS, /\bFMS\b|fulfillment management/i)).toEqual([]);
  });
});

describe("E1-13 · los literales del tipo de proyecto viven solo en agora-labels.ts", () => {
  it("ningún archivo de app/ ni src/components/ escribe el valor interno entre comillas", () => {
    const todos = [
      ...recorrer(path.join(WEB, "app"), /\.(ts|tsx|js|jsx|mjs)$/),
      ...recorrer(path.join(WEB, "src", "components"), /\.(ts|tsx|js|jsx|mjs)$/),
    ].map(rel);
    expect(todos.length).toBeGreaterThan(40);
    expect(coincidencias(todos, /["'`](SAS|DAO)["'`]/)).toEqual([]);
  });

  it("agora-labels.ts es su dueño", () => {
    expect(leer("src/lib/agora-labels.ts")).toMatch(/"SAS" \| "DAO"/);
  });

  it("el Tag y el filtro del Ágora usan las etiquetas, no el valor crudo", () => {
    const ui = leer("src/components/ui.tsx");
    expect(ui).toContain("etiquetaTipo(type)");
    expect(ui).toContain("etiquetaEstado(state)");
    const agora = leer("app/agora/page.tsx");
    expect(agora).toContain("tipoDesdeQuery(searchParams.tipo ?? searchParams.type)");
    expect(agora).toContain('label: "Clientes"');
    expect(agora).toContain('label: "Comunidad"');
    expect(agora).toContain("Red de pruebas");
    const ficha = leer("app/agora/[id]/page.tsx");
    expect(ficha).toContain("Para quién");
    expect(ficha).toContain("Este proyecto ya no recibe aplicaciones ({etiquetaEstado(project.state)}).");
    expect(ficha).toContain("Red de pruebas");
  });
});

describe("E1-2b · el menú conserva Admin (por rol) y el botón de perfil", () => {
  it("NavContextual dibuja /admin solo con el rol de founder y pinta el acceso de sesión", () => {
    const src = leer("src/components/NavContextual.tsx");
    expect(src).toContain('href="/admin"');
    expect(src).toMatch(/const conAdmin = isFounder && !enEmpresas;/);
    expect((src.match(/\{conAdmin \? \(\s*<Link\s+href="\/admin"/g) ?? []).length).toBe(2); // escritorio y móvil
    expect(src).toContain("accesoDao");
    expect(src).toContain("menuPara(");
  });

  it("Nav decide el rol por claims (no por persona) y arma el botón de perfil", () => {
    const src = leer("src/components/Nav.tsx");
    expect(src).toContain("claimsPuedenAdministrar(");
    expect(src).toContain('href="/perfil"');
    expect(src).not.toMatch(/FOUNDER_WALLET/);
  });
});

describe("E1-3 · redirecciones permanentes (308)", () => {
  it("next.config.mjs#redirects() lleva /ecosistema → /metodo y el slug viejo de la Academia", async () => {
    const mod = (await import("../../next.config.mjs")) as {
      default: { redirects?: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>> };
    };
    expect(typeof mod.default.redirects).toBe("function");
    const r = await mod.default.redirects!();
    expect(r).toContainEqual({ source: "/ecosistema", destination: "/metodo", permanent: true });
    expect(r).toContainEqual({ source: "/whitepaper", destination: "/manifiesto", permanent: true });
    expect(r).toContainEqual({
      source: "/academia/por-que-sas-dao",
      destination: "/academia/construir-sin-riesgo",
      permanent: true,
    });
  });

  // WP33: el dominio sin www y las visitas directas al host de azurewebsites van a www. Lo
  // que llega por Front Door (siempre con x-azure-fdid) no se toca; /.well-known/, /api/ y
  // el calentamiento del App Service quedan fuera.
  it("redirige el dominio sin www y el host de origen a https://www.zelena.tech, conservando la ruta", async () => {
    const mod = (await import("../../next.config.mjs")) as { default: { redirects: () => Promise<unknown[]> } };
    const r = await mod.default.redirects();
    expect(r).toContainEqual({
      source: "/:path((?!\\.well-known/|api/|robots933456\\.txt).*)",
      has: [{ type: "host", value: "(?:zelena\\.tech|zelena-dao\\.azurewebsites\\.net)" }],
      missing: [{ type: "header", key: "x-azure-fdid" }],
      destination: "https://www.zelena.tech/:path",
      permanent: true,
    });
  });
});

describe("E1-5 · /empresas sin promesas que no podemos sostener", () => {
  const src = leer("app/empresas/page.tsx");
  it("sin 'Nómina', 'Blend', 'rendimiento', 'mainnet' (en español: 'red principal') ni 'fulfillment'", () => {
    expect(src).not.toMatch(/n[oó]mina/i);
    expect(src).not.toMatch(/blend/i);
    expect(src).not.toMatch(/rendimiento/i);
    expect(src).not.toMatch(/mainnet/i);
    expect(src).not.toMatch(/fulfillment/i);
  });

  // WP33 (hallazgo H10 de la revisión de la landing): desde septiembre de 2026 Harmony paga
  // bonos reales en USDC en la red principal de Stellar, a la billetera de cada operador. El
  // contrato que automatiza el reparto y la plataforma de la comunidad siguen en la red de
  // pruebas, y el pago a cuenta bancaria en moneda local es la meta, no lo que ya funciona.
  // Antes esta prueba exigía "piloto en testnet": decía menos de lo que ya es real.
  it("dice qué es real y qué es de prueba: bonos en USDC en la red principal; reparto y comunidad en la de pruebas", () => {
    expect(src).toContain("Incentivos por desempeño");
    expect(src).toContain("El WMS que opera el almacén.");
    expect(src).toContain(
      "Harmony ya paga bonos reales en USDC, en la red principal de Stellar, a la billetera de cada operador"
    );
    expect(src).toContain("El contrato que automatiza el reparto todavía se prueba en la red de pruebas.");
    expect(src).toContain(
      "La plataforma de la comunidad (entrada, proyectos, Ágora, puntos) corre en la red de pruebas de Stellar."
    );
    expect(src).toContain("La meta es entregar el bono en moneda local");
    expect(src).not.toMatch(/sin dinero real|piloto en testnet|todo corre en la red de pruebas/i);
    expect(src).not.toMatch(/entregadas? en moneda local/i);
  });
});

describe("E1-8 · /metodo en lenguaje llano", () => {
  it("ocho pasos, numerados en orden", () => {
    expect(PASOS_METODO).toHaveLength(8);
    expect(PASOS_METODO.map((p) => p.n)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08"]);
  });

  it("ningún paso dice bounty, on-chain, wallet, hash ni Intake", () => {
    for (const p of PASOS_METODO) {
      expect(`${p.titulo} ${p.texto}`).not.toMatch(/bounty|on-chain|wallet|\bhash\b|intake/i);
    }
  });

  it("el paso 7 dice qué corre en la red de pruebas, sin 'sin dinero real'", () => {
    const p7 = PASOS_METODO[6];
    expect(p7.titulo).toBe("Se paga el hito.");
    expect(p7.texto).toContain("red de pruebas");
    expect(p7.texto.toLowerCase()).not.toContain("sin dinero real");
  });

  it("la página /metodo pinta PASOS_METODO con el H1 del copy", () => {
    const src = leer("app/metodo/page.tsx");
    expect(src).toContain("PASOS_METODO.map");
    expect(src).toMatch(/De una necesidad a una entrega <em[^>]*>que se paga\.<\/em>/);
  });
});

describe("E1-9 · aviso de privacidad y casilla de autorización", () => {
  it("/privacidad nombra los derechos y lee el responsable del entorno", () => {
    // El texto vive en lib/aviso-privacidad.ts (versionado, hallazgo A3) y la página lo pinta.
    const src = leer("app/privacidad/page.tsx");
    const aviso = leer("src/lib/aviso-privacidad.ts");
    expect(aviso).toContain("conocer, actualizar, rectificar");
    expect(aviso).toContain("revocar");
    expect(src).toContain("AVISO_PRIVACIDAD.derechos");
    expect(src).toContain("responsableTratamiento()");
    expect(src).toContain('href="/empresas/contacto"');
  });

  for (const form of ["src/components/ContactoForm.tsx", "src/components/AvisoEncuentrosForm.tsx"]) {
    it(`${form}: enlaza /privacidad y tiene una casilla obligatoria NO premarcada`, () => {
      const src = leer(form);
      expect(src).toContain('href="/privacidad"');
      expect(src).toContain("Acepto el tratamiento de mis datos según el");
      const casillas = src.match(/<input[^>]*type="checkbox"[^>]*\/>/g) ?? [];
      expect(casillas).toHaveLength(1);
      expect(casillas[0]).toMatch(/\brequired\b/);
      expect(casillas[0]).not.toMatch(/defaultChecked|\bchecked\b/);
      expect(src).not.toContain("defaultChecked");
      // La casilla viaja al servidor (hallazgo A3): sin ella la API responde 400.
      expect(casillas[0]).toContain('name="acepto"');
      expect(src).toMatch(/\bacepto, aviso: AVISO_PRIVACIDAD_VERSION\b/);
    });
  }

  it("/entrar y /acuerdo enlazan el aviso", () => {
    expect(leer("app/entrar/page.tsx")).toContain('href="/privacidad"');
    expect(leer("app/acuerdo/page.tsx")).toContain('href="/privacidad"');
  });
});

/**
 * E1-10 · la landing. Desde WP33 es la landing en inglés del diseño "Zelena Stellar Web":
 * "/" para empresas (medir el trabajo y pagar el bono) y "/comunidad" para quien contribuye
 * (cifras reales, proyectos, decisiones y encuentros). El contrato anterior (H1 en español,
 * las 4 puertas, "¿Construimos?" y una sola tarjeta de pruebas) era de la landing que esta
 * reemplaza: sus enlaces viven ahora en el pie y la cabecera, sus cifras en /comunidad y la
 * prueba verificable en /metodo#compruebalo.
 */
describe("E1-10 · la landing en inglés (/ y /comunidad)", () => {
  const inicio = leer("app/page.tsx");
  const comunidad = leer("app/comunidad/page.tsx");
  const shell = leer("app/_landing/LandingShell.tsx");
  const heroInicio = leer("app/_landing/home/HeroBento.tsx");
  const heroComunidad = leer("app/_landing/comunidad/Hero.tsx");
  const LANDING = archivosLanding();
  /** Los .tsx que pinta una página: los de su carpeta y los compartidos (cabecera, pie, shell). */
  const deLaPagina = (carpeta: "home" | "comunidad") =>
    LANDING.filter(
      (r) => r.endsWith(".tsx") && (r.startsWith(`app/_landing/${carpeta}/`) || !/\/(home|comunidad)\//.test(r))
    );

  it("las dos páginas van dentro del cromo de la landing: raíz data-landing en inglés, clara y dinámica", () => {
    expect(inicio).toContain('<LandingShell pagina="home">');
    expect(comunidad).toContain('<LandingShell pagina="comunidad">');
    expect(shell).toContain('<div data-landing="" lang="en"');
    for (const src of [inicio, comunidad]) {
      expect(src).toContain('export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };');
      expect(src).toContain('export const dynamic = "force-dynamic";');
      expect(src).toContain('idioma: "en",');
    }
    expect(inicio).toContain('ruta: "/",');
    expect(comunidad).toContain('ruta: "/comunidad",');
  });

  it("/ tiene el H1 en inglés del copy (dos líneas, LATAM resaltado) y es el único h1 de la página", () => {
    expect(HERO_INICIO.h1.linea1).toBe("Performance-based payroll");
    expect(`${HERO_INICIO.h1.antes}${HERO_INICIO.h1.resaltado}${HERO_INICIO.h1.despues}`).toBe("for LATAM logistics.");
    expect(heroInicio).toMatch(/<h1 id="inicio-titulo"[^>]*>\s*\{HERO\.h1\.linea1\}\{" "\}\s*<br \/>/);
    expect(heroInicio).toContain("<span className={s.resaltado}>{HERO.h1.resaltado}</span>");
    const h1 = [inicio, ...deLaPagina("home").map(leer)].join("\n").match(/<h1\b/g) ?? [];
    expect(h1).toHaveLength(1);
  });

  it("/comunidad tiene su H1 en inglés, de texto real en el HTML del servidor, y es el único h1", () => {
    expect([...HERO_COMUNIDAD.titulo]).toEqual(["The value you deliver", "decides what you get."]);
    expect(heroComunidad).toMatch(/<h1 id="comunidad-titulo"[^>]*>\s*\{linea1\} <br \/>\s*\{linea2\}\s*<\/h1>/);
    // El efecto de consola es una capa aparte, oculta al lector de pantalla, que se monta al hidratar.
    const decodificar = leer("app/_landing/comunidad/DecodificarTitulo.tsx");
    expect(decodificar.startsWith('"use client";')).toBe(true);
    expect(decodificar).toContain('aria-hidden="true"');
    const h1 = [comunidad, ...deLaPagina("comunidad").map(leer)].join("\n").match(/<h1\b/g) ?? [];
    expect(h1).toHaveLength(1);
  });

  it("Book a demo lleva al formulario con Harmony elegido (en el hero y en el cierre); Log in, a /entrar", () => {
    expect(ENLACES.reservarDemo).toBe("/empresas/contacto?interes=harmony");
    expect(heroInicio).toContain("<PrimaryCta href={ENLACES.reservarDemo}");
    expect(leer("app/_landing/home/CierreHome.tsx")).toContain("href={ENLACES.reservarDemo}");
    expect(ENLACES.entrar).toBe("/entrar");
    expect(CABECERA.entrar).toBe("Log in");
    expect(shell).toContain("if (!session) return { href: ENLACES.entrar, etiqueta: CABECERA.entrar };");
    expect(leer("app/_landing/Header.tsx")).toContain("<Link href={cuenta.href}");
  });

  it("/comunidad cuenta solo lo real (cifrasEnVivo y puntosRepartidos) y, si la base falla, sale con sus ceros", () => {
    expect(comunidad).toContain("datosComunidad(getDb(), new Date())");
    expect(comunidad).toMatch(/catch \(e\) \{[\s\S]*?cifras: CIFRAS_EN_CERO/);
    const datos = leer("src/lib/landing-datos.ts");
    expect(datos).toContain("const c = cifrasEnVivo(db);");
    expect(datos).toContain("puntosRepartidos(db)");
    // cohortStats cuenta también las filas sembradas de demostración.
    expect(datos).not.toContain("cohortStats");
    // Con todo en cero se muestra el cero, con su llamada a la acción.
    expect(CIFRAS.nota).toBe("We only count what\u2019s real: no test accounts.");
    for (const c of [CIFRAS.firmas, CIFRAS.proyectos, CIFRAS.puntos]) expect(c.cero.texto.length).toBeGreaterThan(0);
    expect(leer("app/_landing/comunidad/Cifras.tsx")).toContain("{d.valor === 0 ? <LineaDelCero cero={d.cero} /> : null}");
  });

  it("/ no lee la base: sus cifras son ejemplos rotulados; los proyectos de /comunidad salen sin campaña ni valor interno", () => {
    for (const src of [inicio, ...LANDING.filter((r) => r.startsWith("app/_landing/home/")).map(leer)]) {
      expect(src).not.toMatch(/@\/lib\/db|getDb|listProjects|datosComunidad/);
    }
    expect(BENTO.b.muestra).toBe("Sample");
    expect(BENTO.b.filas.map((f) => f.nombre)).toEqual(["Operator 01", "Operator 02", "Operator 03"]);
    expect(HARMONY.pieTelefono).toMatch(/^Sample screen/);
    const datos = leer("src/lib/landing-datos.ts");
    expect(datos).toContain(
      "SELECT id, title, type, budget_usd, weeks FROM projects WHERE state = 'Open' AND draft = 0"
    );
    expect(datos).toContain("etiquetaTipo: etiquetaTipoEn(String(p.type)),");
    expect(coincidencias(LANDING, /\bcampaign\b/)).toEqual([]);
  });

  it("sin votos de mentira: ninguna isla de cliente vota; el botón de votar es un enlace a /gobernanza", () => {
    const islas = LANDING.filter((r) => /\.tsx?$/.test(r) && leer(r).startsWith('"use client";'));
    expect(islas.length).toBeGreaterThan(4);
    for (const r of islas) expect(leer(r), r).not.toMatch(/vot[eo]|vota|governance|fetch\(|\/api\//i);
    expect(RUTA_VOTAR).toBe("/gobernanza");
    const decisiones = leer("app/_landing/comunidad/Decisiones.tsx");
    expect(decisiones.startsWith('"use client";')).toBe(false);
    expect(decisiones).toContain("<Link href={v.href}");
    expect(decisiones).not.toMatch(/onClick|<button/);
  });

  it("/comunidad/ritos (la página de ritos que antes era /comunidad): 'Cómo participar' lleva a la misma llamada, y /encuentros tiene el ancla del aviso", () => {
    const ritos = leer("app/comunidad/ritos/page.tsx");
    expect(ritos).toContain("llamadaParticipar(encuentros[0] ?? null, proximoRitoPreparado(db), tz)");
    expect(ritos).toMatch(/href=\{llamada\.href\}[^>]*>\s*\{llamada\.texto\}\s*</);
    expect(leer("app/encuentros/page.tsx")).toMatch(/<div id="aviso" [^>]*>[\s\S]*<AvisoEncuentrosForm \/>/);
  });

  it("no importa Type ni next/image, ni carga fuentes de fuera", () => {
    for (const r of [...LANDING, "app/page.tsx", "app/comunidad/page.tsx"]) {
      const src = leer(r);
      expect(src, r).not.toMatch(/components\/Type|<Type\b/);
      expect(src, r).not.toMatch(/from\s+["']next\/image["']/);
      expect(src, r).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });
});

describe("lenguaje editorial en lo público", () => {
  // WP31: las páginas en español usan la serif editorial y no el componente Type. La landing
  // en inglés de WP33 (/ y /comunidad) tiene otra voz, la del diseño que encargó el founder:
  // mono, botones "[[ book_a_demo ]]" e indicaciones "$ zelena …". Esa voz vive solo en
  // app/_landing; las páginas en español no la toman.
  it("las páginas en español nuevas o reescritas usan serif y no el componente Type", () => {
    for (const r of [
      "app/metodo/page.tsx",
      "app/privacidad/page.tsx",
      "app/acuerdo/page.tsx",
      "app/gobernanza/page.tsx",
      "app/academia/page.tsx",
      "app/empresas/page.tsx",
      "app/manifiesto/page.tsx",
      "app/comunidad/ritos/page.tsx",
    ]) {
      const src = leer(r);
      expect(src, r).toContain("font-serif");
      expect(src, r).not.toMatch(/components\/Type|<Type\b/);
    }
  });

  it("la voz de comandos de la landing ([[ … ]] y $ zelena …) solo en app/_landing; la landing no usa la serif", () => {
    const VOZ_COMANDO = /\[\[ \{?[a-z_]+\}? \]\]|\$ zelena\b|\$ (cat|ls) /;
    const fuera = PUBLICOS.filter((r) => !r.startsWith("app/_landing/"));
    expect(coincidencias(fuera, VOZ_COMANDO)).toEqual([]);
    // La landing sí la usa (si este guarda deja de ver la voz, deja de proteger nada).
    expect(leer("app/_landing/Ctas.tsx")).toContain("[[ {comando} ]]");
    expect(leer("app/_landing/copy-home.ts")).toMatch(/eyebrow: "\$ zelena /);
    const landing = [...archivosLanding(), "app/page.tsx", "app/comunidad/page.tsx"];
    expect(coincidencias(landing, /font-serif|Playfair/)).toEqual([]);
  });

  it("los titulares de /gobernanza y /academia en lenguaje llano", () => {
    const gob = leer("app/gobernanza/page.tsx");
    expect(gob).toContain("Cada decisión se registra aquí con su razón y su huella, para que cualquiera pueda revisarla.");
    expect(gob).toContain("Lo que aprendimos de cada regla");
    expect(gob).toContain("huella:");
    // Solo la versión vigente de una decisión reemplazada (decisión del founder, 2026-10-21).
    expect(gob).toContain("decisionesVigentes(db)");
    expect(gob).not.toContain("Reemplazada por:");
    expect(gob).toContain("esActaDeRito(");
    const aca = leer("app/academia/page.tsx");
    expect(aca).toContain("Se premia aprender, no acumular sin aprender.");
    expect(aca).toContain(
      "La Academia se está preparando. Mientras tanto, explora el Ágora y toma tu primer proyecto: tu reputación puede empezar hoy."
    );
  });

  it("el consentimiento de /entrar es fiel al acuerdo y está en el paso de firma", () => {
    const src = leer("app/entrar/page.tsx");
    expect(src).toContain("Al firmar cedes a Zelena los derechos patrimoniales de lo que aportes");
    expect(src).toContain("Firmar no te convierte en empleado ni en socio.");
    expect(src).toContain("Tres pasos: tu invitación, tu cuenta y tu firma.");
    expect(src).toContain("<IntroEcosistema compacta />");
  });
});

/**
 * La wallet creada en el navegador es una cuenta REAL (decisión del founder, 2026-10-21:
 * `is_demo` lo decide el servidor por el código de invitación), pero su llave vive solo
 * en el navegador. El camino principal sigue siendo la wallet propia (Freighter); la del
 * navegador es la opción secundaria y avisa, con claridad, de dónde vive la llave.
 */
describe("/entrar · el camino principal es la wallet propia; la del navegador avisa", () => {
  const src = leer("app/entrar/page.tsx");

  /** Etiqueta de apertura del botón que dispara `accion` (desde `<button` hasta el onClick). */
  function boton(accion: string): string {
    const i = src.indexOf(accion);
    expect(i, accion).toBeGreaterThan(0);
    expect(src.indexOf(accion, i + 1), `${accion} aparece una sola vez`).toBe(-1);
    return src.slice(src.lastIndexOf("<button", i), i);
  }

  /** ¿Está `accion` dentro de un `<details>` (escondida tras "Ver detalle")? */
  function trasVerDetalle(accion: string): boolean {
    const antes = src.slice(0, src.indexOf(accion));
    return (antes.match(/<details\b/g) ?? []).length > (antes.match(/<\/details>/g) ?? []).length;
  }

  const CONECTAR = "onClick={connectFreighter}";
  const PRUEBA = "onClick={() => void elegirWalletNavegador()}";

  it("conectar tu propia wallet es el botón principal y está a la vista", () => {
    expect(boton(CONECTAR)).toContain("btn-primary");
    expect(trasVerDetalle(CONECTAR)).toBe(false);
  });

  it("la wallet del navegador es la opción secundaria, es una cuenta real y avisa de dónde vive la llave", () => {
    expect(boton(PRUEBA)).not.toContain("btn-primary");
    expect(src.indexOf(CONECTAR)).toBeLessThan(src.indexOf(PRUEBA));
    expect(src.replace(/\s+/g, " ")).toContain(
      "Es tu cuenta de verdad: con ella te sumas a proyectos y registras tu asistencia."
    );
    expect(src).toContain("<AvisoLlaveNavegador />");
    const aviso = leer("src/components/AvisoLlaveNavegador.tsx").replace(/\s+/g, " ");
    expect(aviso).toContain("la llave de esta wallet vive solo en este navegador");
    expect(aviso).toContain("pierdes el acceso a tu cuenta");
    expect(aviso).toContain("Freighter (freighter.app)");
    expect(aviso).toContain("href={FREIGHTER_URL}");
    expect(aviso).toContain('FREIGHTER_URL = "https://www.freighter.app/"');
  });

  it("el navegador ya no declara si la cuenta es de demostración: lo decide el servidor", () => {
    expect(src).not.toMatch(/isDemo/);
    expect(src.match(/setWalletLocal\(true\)/g) ?? []).toHaveLength(2); // crear una nueva o usar la guardada
    expect(src).toMatch(/async function connectFreighter\(\)[\s\S]*?setWalletLocal\(false\)/);
  });

  it("/perfil avisa de la llave del navegador y lee is_demo de la base", () => {
    const perfil = leer("app/perfil/page.tsx");
    expect(perfil).toContain("<AvisoLlaveNavegador wallet={wallet} />");
    expect(perfil).toContain("user.is_demo === 1");
    expect(perfil).not.toMatch(/\{session\.isDemo \?/);
  });

  it("no le pone la etiqueta '(demo)' a nadie", () => {
    expect(src).not.toMatch(/\(demo\)/i);
  });
});

/**
 * Nombres de clientes y proyectos privados: la lista NO se versiona (el repo es
 * público). Este test guarda solo sus HUELLAS (sha256 del nombre normalizado: sin
 * tildes, en minúscula, con las palabras separadas por un espacio y también
 * pegadas) y busca, en cada archivo, cada palabra y cada par de palabras seguidas.
 * Si falla, dice el archivo y la huella, nunca el nombre.
 *
 * Quien tenga la lista también puede pasarla por el entorno, separada por comas:
 *   ZELENA_NOMBRES_PRIVADOS="nombre uno,nombre dos" npx vitest run sitio-publico
 */
const HUELLAS_NOMBRES_PRIVADOS: ReadonlySet<string> = new Set([
  "05a39e5e50545963a87b2b2b8b69b0c1004fe12fe7d6651133d528bd6db5f475",
  "7530476f73a5e3be78b484df94bb8c3f030f9ad825e7567555e1cf7b2493450d",
  "845b0e4242fa32738120883aecd63c4baca45b8eef628896b7612a803a058544",
  "94f241e4ee6f3f84fffb77adf9fe9202c2c91090c5d2a949892983b66bc8df71",
  "ce9ef553e37e13a7dce4f67d2a764ae657e7870d134d10507b47523a792f22b9",
  "3bef3c5a199824a9fa9d23559ce94d930cb6ce18666649e3db9410858f31c1a2",
  "eef361be4b662d571e7c44742a2449cf3c00a2f92c3fadf9488daacc062224d3",
  "3ae5c495a869ed787f1646a29f3c3b97334cb334bde8842a61423dd661a5c71d",
  "369058ca6eb45855eb9c67fad01f608d772e69a79f8c50d731f1f23aa53e893c",
  "4a83018c8c05a4d300ef66b301be50c2af389434634d284b54b795f9e1fe99e8",
  "38d5f08d2604ae14222603ee93b4d44a21bfee26a2063e25a314a0eea64cd7cd",
]);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function palabras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Huellas del conjunto que aparecen en el texto (palabra sola o par de palabras, separadas o pegadas). */
function huellasEn(texto: string, huellas: ReadonlySet<string>): string[] {
  const p = palabras(texto);
  const out = new Set<string>();
  for (let i = 0; i < p.length; i++) {
    const candidatas = i + 1 < p.length ? [p[i], `${p[i]} ${p[i + 1]}`, `${p[i]}${p[i + 1]}`] : [p[i]];
    for (const c of candidatas) {
      const h = sha256(c);
      if (huellas.has(h)) out.add(h);
    }
  }
  return [...out];
}

/** Archivos de este paquete que podrían mostrar o filtrar un nombre: lo público, los datos y sus módulos. */
const REVISAR_NOMBRES = [
  ...PUBLICOS,
  ...archivosLanding(),
  "src/data/pruebas-testnet.json",
  "next.config.mjs",
  ...["ContactoForm", "AvisoEncuentrosForm", "MutationBanner"].map((c) => `src/components/${c}.tsx`),
  ...["agora-labels", "legal", "pruebas-testnet", "prueba-en-vivo"].map((l) => `src/lib/${l}.ts`),
].filter((r, i, todos) => todos.indexOf(r) === i);

describe("sin nombres privados en lo público", () => {
  it("el detector encuentra un nombre separado, pegado o con guion, y no confunde una palabra parecida", () => {
    const ficticio = new Set([sha256("cliente ficticio"), sha256("clienteficticio")]);
    expect(huellasEn("Un proyecto para Cliente  Ficticio.", ficticio)).not.toEqual([]);
    expect(huellasEn("const x = 'ClienteFicticio';", ficticio)).not.toEqual([]);
    expect(huellasEn("cliente-ficticio", ficticio)).not.toEqual([]);
    expect(huellasEn("Clientes ficticios", ficticio)).toEqual([]);
    expect(huellasEn("Un cliente. Ficticio no.", new Set([sha256("ficticio")]))).not.toEqual([]);
  });

  it("ninguna huella de la lista aparece en los archivos públicos ni en los datos públicos", () => {
    expect(HUELLAS_NOMBRES_PRIVADOS.size).toBe(11);
    // La landing en inglés entra entera (componentes, copy y estilos), y los datos que pinta.
    for (const r of [...archivosLanding(), "src/lib/landing-datos.ts", "src/lib/seo.ts"]) {
      expect(REVISAR_NOMBRES).toContain(r);
    }
    const hallados = REVISAR_NOMBRES.flatMap((r) =>
      huellasEn(leer(r), HUELLAS_NOMBRES_PRIVADOS).map((h) => `${r}: ${h.slice(0, 12)}…`)
    );
    expect(hallados).toEqual([]);
  });

  const nombres = (process.env.ZELENA_NOMBRES_PRIVADOS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  it.skipIf(nombres.length === 0)("con la lista del entorno: ninguno aparece", () => {
    const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patron = new RegExp(nombres.map(escapar).join("|"), "i");
    expect(coincidencias(REVISAR_NOMBRES, patron)).toEqual([]);
  });
});
