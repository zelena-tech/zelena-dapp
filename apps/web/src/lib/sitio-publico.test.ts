/**
 * WP31-E1 · sitio público, tests ESTÁTICOS sobre el código fuente.
 *
 * Criterios: E1-1 (sin la estructura societaria), E1-2b (Admin y perfil por rol),
 * E1-3 (redirecciones 308), E1-5 (/empresas), E1-8 (/metodo), E1-9 (privacidad y
 * casilla), E1-10 (landing), E1-11 (jerga) y E1-13 (literales del tipo de proyecto).
 *
 * La lista de archivos públicos se GENERA recorriendo `app/`: una página nueva
 * entra sola, sin que nadie tenga que acordarse de añadirla aquí.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PASOS_METODO } from "./metodo";

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
const COMPONENTES_PUBLICOS = ["Nav", "NavContextual", "Footer", "IntroEcosistema", "PruebaEnVivo", "PruebaTestnet", "ProximoEncuentro", "ui"];
const LIBS_PUBLICAS = ["menu", "metodo", "servicios", "encuentros"];

/** Lista generada de archivos públicos (E1-1). */
function archivosPublicos(): string[] {
  const paginas = recorrer(path.join(WEB, "app"), /\.tsx$/)
    .map(rel)
    .filter((r) => !PRIVADAS.test(r));
  const componentes = COMPONENTES_PUBLICOS.map((c) => `src/components/${c}.tsx`);
  const libs = LIBS_PUBLICAS.map((l) => `src/lib/${l}.ts`);
  return [...paginas, ...componentes, ...libs].sort();
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
    ]) {
      expect(PUBLICOS).toContain(r);
    }
    expect(PUBLICOS.some((r) => r.startsWith("app/equipo/") || r.startsWith("app/admin/"))).toBe(false);
  });

  it("todos los archivos de la lista existen (un componente renombrado no se escapa)", () => {
    expect(PUBLICOS.filter((r) => !fs.existsSync(path.join(WEB, r)))).toEqual([]);
  });

  it("/ecosistema ya no es una página (redirige a /metodo)", () => {
    expect(fs.existsSync(path.join(WEB, "app", "ecosistema", "page.tsx"))).toBe(false);
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
    expect(r).toContainEqual({
      source: "/academia/por-que-sas-dao",
      destination: "/academia/construir-sin-riesgo",
      permanent: true,
    });
  });
});

describe("E1-5 · /empresas sin promesas que no podemos sostener", () => {
  const src = leer("app/empresas/page.tsx");
  it("sin 'Nómina', 'Blend', 'rendimiento' ni 'mainnet'", () => {
    expect(src).not.toMatch(/n[oó]mina/i);
    expect(src).not.toMatch(/blend/i);
    expect(src).not.toMatch(/rendimiento/i);
    expect(src).not.toMatch(/mainnet/i);
  });
  it("los pagos a cuentas bancarias se marcan como piloto en testnet", () => {
    expect(src).toContain("piloto en testnet");
    expect(src).toContain("Incentivos por desempeño");
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
    const src = leer("app/privacidad/page.tsx");
    expect(src).toContain("conocer, actualizar, rectificar");
    expect(src).toContain("revocar");
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
    });
  }

  it("/entrar y /acuerdo enlazan el aviso", () => {
    expect(leer("app/entrar/page.tsx")).toContain('href="/privacidad"');
    expect(leer("app/acuerdo/page.tsx")).toContain('href="/privacidad"');
  });
});

describe("E1-10 · la landing", () => {
  const src = leer("app/page.tsx");

  it("tiene el H1 exacto", () => {
    expect(src).toMatch(/<h1[^>]*>\s*Lo que entregas decide lo que recibes\.\s*<\/h1>/);
    expect(src).toContain("No el cargo. No la antigüedad. No las horas.");
  });

  it("las 4 puertas, en orden: manifiesto, método, comunidad y empresas", () => {
    const bloque = src.slice(src.indexOf("const PUERTAS"), src.indexOf("];", src.indexOf("const PUERTAS")));
    const pos = ['href: "/manifiesto"', 'href: "/metodo"', "href: RUTA_COMUNIDAD", 'href: "/empresas"'].map((h) =>
      bloque.indexOf(h)
    );
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it("los 2 CTA del cierre: Entrar y, según haya encuentros, el encuentro o la próxima demo", () => {
    expect(src).toContain("¿Construimos?");
    expect(src).toMatch(/href="\/entrar"[^>]*>\s*Entrar\s*</);
    expect(src).toMatch(/href="\/encuentros"[^>]*>\s*Ven a un encuentro\s*</);
    expect(src).toMatch(/href=\{`\$\{RUTA_COMUNIDAD\}#proximos`\}[^>]*>\s*Ven a la próxima demo\s*</);
  });

  it("no importa Type ni lista proyectos", () => {
    expect(src).not.toMatch(/components\/Type/);
    expect(src).not.toContain("listProjects");
  });

  it("una sola tarjeta de pruebas: PruebaEnVivo es solo cifras", () => {
    expect(src.match(/<PruebaTestnet\b/g) ?? []).toHaveLength(1);
    const enVivo = leer("src/components/PruebaEnVivo.tsx");
    expect(enVivo).not.toMatch(/stellar\.expert|EXPLORADOR/);
    expect(enVivo).toContain("Esto no es");
    expect(enVivo).toContain("Contamos solo lo real: sin cuentas de prueba.");
    expect(enVivo).toContain("Las primeras entregas se registran aquí, a la vista de todos.");
  });
});

describe("lenguaje editorial en lo público", () => {
  it("las páginas nuevas o reescritas usan serif y no el componente Type", () => {
    for (const r of ["app/page.tsx", "app/metodo/page.tsx", "app/privacidad/page.tsx", "app/acuerdo/page.tsx", "app/gobernanza/page.tsx", "app/academia/page.tsx"]) {
      const src = leer(r);
      expect(src, r).toContain("font-serif");
      expect(src, r).not.toMatch(/components\/Type|<Type\b/);
    }
  });

  it("los titulares de /gobernanza y /academia en lenguaje llano", () => {
    const gob = leer("app/gobernanza/page.tsx");
    expect(gob).toContain("Cada decisión se registra aquí con su razón y su huella, para que cualquiera pueda revisarla.");
    expect(gob).toContain("Lo que aprendimos de cada regla");
    expect(gob).toContain("huella:");
    expect(gob).toContain("Reemplazada por:");
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
 * La wallet de prueba se registra con `is_demo = 1`: no cuenta en las cifras de la
 * landing ("sin cuentas de prueba"), ni en el equipo ni en el dashboard, y su clave
 * vive solo en el navegador. Si fuera el botón principal, los invitados reales
 * quedarían como cuentas de prueba sin saberlo. El camino principal es la wallet
 * propia; la de prueba es la opción secundaria y lo dice.
 */
describe("/entrar · el camino principal es una cuenta real, no una de prueba", () => {
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
  const PRUEBA = "onClick={() => void elegirWalletDemo()}";

  it("conectar tu propia wallet es el botón principal y está a la vista", () => {
    expect(boton(CONECTAR)).toContain("btn-primary");
    expect(trasVerDetalle(CONECTAR)).toBe(false);
  });

  it("la wallet de prueba es la opción secundaria y avisa de lo que implica", () => {
    expect(boton(PRUEBA)).not.toContain("btn-primary");
    expect(src.indexOf(CONECTAR)).toBeLessThan(src.indexOf(PRUEBA));
    expect(src.replace(/\s+/g, " ")).toContain(
      "Es una cuenta de prueba: vive solo en este navegador y no cuenta en las cifras públicas."
    );
  });

  it("solo la wallet de prueba se registra como cuenta de prueba", () => {
    expect(src.match(/setIsDemo\(true\)/g) ?? []).toHaveLength(2); // crear una nueva o usar la guardada
    expect(src).toMatch(/async function connectFreighter\(\)[\s\S]*?setIsDemo\(false\)/);
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
