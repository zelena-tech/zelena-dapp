/**
 * WP31-E2 · Contenido público y repo (spec WP31 §5.E, §13 y criterios E2-1 a E2-6).
 *
 *  E2-1  Whitepaper, README, CONTRIBUTING, CODEOWNERS y los specs y planos citados no
 *        nombran la estructura societaria; docs/ y el repo no nombran clientes ni ventures.
 *  E2-2  S1 sobre una base con el contenido anterior: en su sitio, mismos ids, idempotente.
 *  E2-3  S2: una sola decisión nueva con su hash; la anterior intacta; nada en base nueva.
 *  E2-4  `seedIfEmpty` en base vacía siembra contenido limpio y no se cae si la migración falla.
 *  E2-5  CLA.md, apps/web/CLA.md y LICENSE iguales a `wp31-base` (el hash del CLA ya lo
 *        cubre `migracion-fusion.test.ts` (f): no se duplica).
 *  E2-6  `packages/scripts/smoke-wp31.sh` hace lo que pide el spec §9, sin secretos.
 */
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { openDb, type DB } from "./db";
import { sha256Hex } from "./crypto";
import { seedIfEmpty } from "./seed";
import { translate } from "./sql-dialect";
import {
  ACADEMIA_S1,
  DECISION_S2,
  SLUG_S1,
  SLUG_S1_ANTERIOR,
  aplicarContenidoPublico,
} from "./contenido-publico";

const WEB = process.cwd(); // apps/web (vitest corre desde aquí)
const RAIZ = path.join(WEB, "..", "..");
const LIB = path.join(WEB, "src", "lib");
const leer = (rel: string) => fs.readFileSync(path.join(RAIZ, rel), "utf8");

/** Las dos expresiones de E1-1 (la primera, sensible a mayúsculas para no casar con `tag-sas`). */
const RE_SIGLA = /\bSAS\b|S\.A\.S/;
const RE_ESTRUCTURA = /societari|\bsociedad\b|empresa detr[aá]s|empresa formal|acuerdo de servicios|accionista/i;
const RE_REFERENCIA_INTERNA = /UNIfication/i;

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * E2-1 · Repo público
 * ------------------------------------------------------------------ */

/** El único archivo de `dir` que empieza por `prefijo` (los specs y planos se citan por número). */
function unicoPorPrefijo(dir: string, prefijo: string): string {
  const candidatos = fs.readdirSync(path.join(RAIZ, dir)).filter((n) => n.startsWith(prefijo) && n.endsWith(".md"));
  if (candidatos.length !== 1) throw new Error(`Se esperaba un solo ${dir}/${prefijo}*.md y hay ${candidatos.length}`);
  return `${dir}/${candidatos[0]}`;
}

const ARCHIVOS_E2_1 = [
  "docs/whitepaper.md",
  "README.md",
  "CONTRIBUTING.md",
  "CODEOWNERS",
  ...["WP06", "WP10", "WP19", "WP21", "WP23"].map((n) => unicoPorPrefijo("docs/specs", `${n}-`)),
  ...["01", "02", "04", "07"].map((n) => unicoPorPrefijo("docs/blueprints", `${n}-`)),
];

/** Líneas (1-based) de `texto` que casan con alguna de las expresiones. */
function lineasQueCasan(texto: string, res: readonly RegExp[]): number[] {
  return texto
    .split("\n")
    .map((l, i) => (res.some((re) => re.test(l)) ? i + 1 : 0))
    .filter((n) => n > 0);
}

describe("E2-1 · el repo público no nombra la estructura societaria", () => {
  it.each(ARCHIVOS_E2_1)("%s", (rel) => {
    expect({ rel, lineas: lineasQueCasan(leer(rel), [RE_SIGLA, RE_ESTRUCTURA, RE_REFERENCIA_INTERNA]) }).toEqual({
      rel,
      lineas: [],
    });
  });

  it("el whitepaper no confisca lo ganado ni promete recompras (W-R1..W-R3, W11)", () => {
    const wp = leer("docs/whitepaper.md");
    for (const frase of [
      "se pierde si la propuesta es spam",
      "deja valor en la mesa",
      "pierde lo que más le costó ganar",
      "recompras",
      "por contribuidor",
    ]) {
      expect(wp, frase).not.toContain(frase);
    }
  });

  it("el whitepaper trae los textos de reemplazo del anexo §13", () => {
    const wp = leer("docs/whitepaper.md");
    for (const texto of [
      "Este documento describe cómo funciona la comunidad Zelena.", // W1
      "Zelena se hace cargo de lo que exige una contraparte formal", // W3
      "## 4. La comunidad: tesis y reglas de juego", // W4
      "### 4.2 Quién carga con qué", // W5
      "| **Zelena** | Contraparte formal |", // W6
      "**no te convierte en empleado ni en socio**", // W7
      "Aquí se define si el proyecto es para un cliente o para la comunidad.", // W8
      "Pago por el trabajo (proyectos de clientes)", // W9
      "(c) un umbral de **reputación** para publicar propuestas, en lugar de fianzas que se pierden.", // W11 + W-R1
      "**Comunidad** → repositorio **público**, custodiado por Zelena en nombre de la comunidad.", // W13
      "se ceden a Zelena los derechos patrimoniales", // W15
      "El vesting solo define **cuándo** se puede usar lo ganado, nunca si se conserva.", // W-R2
      "Inflar no paga: la revisión cruzada corrige las evaluaciones infladas", // W-R3
      "un score compuesto **por entrega**", // S3
    ]) {
      expect(wp, texto).toContain(texto);
    }
  });

  it("README, CONTRIBUTING y CODEOWNERS ceden a Zelena y retiran la demo con la URL antigua", () => {
    const readme = leer("README.md");
    expect(readme).toContain("**Zelena**: marca, clientes y responsabilidad frente a ellos.");
    expect(readme).toContain("**La comunidad**: reputación y ZWORK.");
    expect(readme).toContain("se ceden los derechos patrimoniales a Zelena (ver `CLA.md`).");
    expect(readme).not.toContain("azurewebsites.net");
    expect(leer("CONTRIBUTING.md")).toContain("cedes a Zelena los");
    expect(leer("CODEOWNERS")).toContain("(Founder).");
  });
});

/**
 * Nombres de clientes y ventures que no pueden aparecer en lo versionado (salvo
 * `seed.ts` y `__fixtures__/`, spec E2-1). La lista NO se versiona: aquí solo viven
 * sus sha256 con prefijo, sobre el nombre en minúsculas y sin tildes. Se comparan
 * contra cada palabra y cada grupo de hasta tres palabras seguidas del texto.
 * `ZELENA_NOMBRES_VETADOS` (separados por comas) añade nombres sin versionarlos.
 */
const PREFIJO_VETADO = "zelena:nombre-vetado:";
const NOMBRES_VETADOS_SHA256: readonly string[] = [
  "cb11637384c207cb47dad0d725582c1ac262b99a34324eb33a6f8338648e3e10",
  "45d484b2517309481b60ad8b4c842301349b174d0c5e3e19d06388d84456ffe8",
  "4bcb54ed9d1ae83cd05c8f67ded005e9f2ed75dcbae8dc451136a3b2394f20b4",
  "735debefefaf523e137f491faa226edfb7cdd18fba0196cc58834a384aef52f4",
  "e9a303ac48dc9d4c740f9108b585fd5bc8e2eddb6135fa9feea9bbc377e243d8",
  "5aee1132881efbf8c242dbc7ad8d7e1c8e8ddeb6063115ffb04a21da880397e4",
  "0a0e2c9cfbcdf6a99bfa8ecfcddc3c4fc08ef8dd38593bd415ffd6fdc9ef328e",
  "be1fa38ce4386fe4d2594befbb852094adc5983bef8cb12c293b9a8396b64084",
  "9977fd2393f4540c15a8b17715e8eaa90254ec3f4bf422fe8e2926aa9938bf1c",
];
const MAX_PALABRAS_NOMBRE = 3;

const palabras = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const hashVetado = (nombreNormalizado: string) =>
  createHash("sha256").update(PREFIJO_VETADO + nombreNormalizado).digest("hex");

function hashesVetados(): Set<string> {
  const extra = (process.env.ZELENA_NOMBRES_VETADOS ?? "")
    .split(",")
    .map((n) => palabras(n).join(" "))
    .filter(Boolean)
    .map(hashVetado);
  return new Set([...NOMBRES_VETADOS_SHA256, ...extra]);
}

/** Líneas (1-based) donde empieza una aparición de un nombre vetado. Nunca devuelve el nombre. */
function lineasConNombreVetado(texto: string, hashes: Set<string>): number[] {
  const fichas: Array<{ palabra: string; linea: number }> = [];
  texto.split("\n").forEach((l, i) => {
    for (const p of palabras(l)) fichas.push({ palabra: p, linea: i + 1 });
  });
  const lineas = new Set<number>();
  for (let i = 0; i < fichas.length; i++) {
    let grupo = "";
    for (let k = 0; k < MAX_PALABRAS_NOMBRE && i + k < fichas.length; k++) {
      grupo = k === 0 ? fichas[i].palabra : `${grupo} ${fichas[i + k].palabra}`;
      if (hashes.has(hashVetado(grupo))) lineas.add(fichas[i].linea);
    }
  }
  return [...lineas].sort((a, b) => a - b);
}

/** Archivos de texto bajo `dir` (relativos a la raíz), recursivo. */
function archivosBajo(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...archivosBajo(rel));
    else out.push(rel);
  }
  return out;
}

const EXENTOS_DE_NOMBRES = (rel: string) =>
  rel === "apps/web/src/lib/seed.ts" || rel.startsWith("apps/web/src/lib/__fixtures__/");

function hallazgosDeNombres(rels: readonly string[]): string[] {
  const hashes = hashesVetados();
  const hallazgos: string[] = [];
  for (const rel of rels) {
    if (EXENTOS_DE_NOMBRES(rel)) continue;
    const buf = fs.readFileSync(path.join(RAIZ, rel));
    if (buf.includes(0)) continue; // binario
    for (const n of lineasConNombreVetado(buf.toString("utf8"), hashes)) hallazgos.push(`${rel}:${n}`);
  }
  return hallazgos;
}

describe("E2-1 · ningún nombre de cliente ni de venture en lo público", () => {
  it("el detector encuentra un nombre por su hash (sin versionarlo) y en grupos de palabras", () => {
    const hashes = new Set([hashVetado("cliente de prueba")]);
    expect(lineasConNombreVetado("uno\nhola, Cliente\nde Prueba.\n", hashes)).toEqual([2]);
    expect(lineasConNombreVetado("cliente-de-prueba", hashes)).toEqual([1]);
    expect(lineasConNombreVetado("cliente de pruebas", hashes)).toEqual([]);
    // Normaliza tildes y mayúsculas igual que los hashes versionados.
    expect(lineasConNombreVetado("CLIÉNTE DE PRUEBA", hashes)).toEqual([1]);
  });

  it("docs/, los archivos de la raíz, el smoke y este módulo están limpios", () => {
    const raiz = fs
      .readdirSync(RAIZ, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((n) => /\.md$|^CODEOWNERS$|^LICENSE$/.test(n));
    const rels = [
      ...archivosBajo("docs"),
      ...raiz,
      "packages/scripts/smoke-wp31.sh",
      "apps/web/src/lib/contenido-publico.ts",
      "apps/web/src/lib/contenido-publico.test.ts",
    ];
    expect(hallazgosDeNombres(rels)).toEqual([]);
  });

  // Barrido de TODO lo versionado (spec E2-1). Lo corre el líder antes de desplegar:
  //   ZELENA_BARRIDO_NOMBRES=1 npx vitest run src/lib/contenido-publico.test.ts
  // Va aparte porque otros paquetes limpian sus propios archivos (A, C2, B, el líder).
  it.skipIf(process.env.ZELENA_BARRIDO_NOMBRES !== "1")("barrido completo de lo versionado", () => {
    const versionados = execFileSync("git", ["ls-files", "-z"], { cwd: RAIZ, encoding: "utf8" })
      .split("\0")
      .filter(Boolean)
      .filter((rel) => fs.existsSync(path.join(RAIZ, rel)));
    expect(hallazgosDeNombres(versionados)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * E2-2 y E2-3 · Migración del contenido sembrado
 * ------------------------------------------------------------------ */

const ESQUEMA = fs.readFileSync(path.join(LIB, "schema.sql"), "utf8");
/** 2026-10-01 05:00 en Bogotá. */
const AHORA = new Date("2026-10-01T10:00:00.000Z");

/** La decisión histórica del 2026-07-01, con su hash público. */
const DECISION_ANTERIOR: [string, string, string] = [
  "2026-07-01",
  "Publicación de campañas",
  "Se abren al Ágora las dos primeras campañas (5 bounties) etiquetadas SAS, con hitos y criterios de aceptación públicos.",
];

/** Base con la forma del contenido de producción ANTES de la migración (orden 1..4). */
function baseConContenidoAnterior(opts: { preguntasS1?: number; conDestino?: boolean } = {}): DB {
  const db = openDb(":memory:");
  db.exec(ESQUEMA);
  db.exec(`INSERT INTO periods (id, name, epoch_budget, academia_budget, state) VALUES (1, 'Época Génesis', 100000, 5000, 'Open')`);
  db.exec(`INSERT INTO users (wallet, display_name, cla_signed) VALUES ('GLECTORA', 'Lectora', 1)`);
  const insC = db.prepare(
    `INSERT INTO academia_content (slug, kind, title, summary, points, min_seconds, body, ord) VALUES (?, 'article', ?, ?, 150, 45, ?, ?)`
  );
  insC.run(SLUG_S1_ANTERIOR, "Título anterior", "Resumen anterior", "## Cuerpo anterior", 1); // id 1
  insC.run("el-triangulo-de-activos", "El triángulo de activos", "Tres activos.", "## Triángulo", 2); // id 2
  insC.run(
    "como-se-mide-el-valor",
    "Cómo se mide el valor",
    "Ocho pasos.",
    "El supervisor genera un **score compuesto** por contribuidor: calculado.",
    3
  ); // id 3
  insC.run("video-que-es-zelena-dao", "Qué es Zelena (video)", "Video.", null, 4); // id 4
  if (opts.conDestino) insC.run(SLUG_S1, "Ya migrado a mano", "r", "b", 9);

  const insQ = db.prepare(`INSERT INTO academia_quiz (content_id, question, options, correct) VALUES (?, ?, ?, ?)`);
  for (let i = 0; i < (opts.preguntasS1 ?? 5); i++) insQ.run(1, `Pregunta anterior ${i + 1}`, JSON.stringify(["a", "b", "c", "d"]), 0);
  insQ.run(3, "¿Cuántos pasos tiene la metodología?", JSON.stringify(["4", "6", "8", "12"]), 2);

  // Lo ganado y lo leído en el módulo S1 (no se puede tocar).
  db.exec(`INSERT INTO academia_awards (wallet, content_id, day, ord_of_day, points) VALUES ('GLECTORA', 1, '2026-09-01', 1, 150)`);
  db.exec(`INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES ('GLECTORA', 150, 1, 'academia', 'Academia #1')`);
  db.exec(
    `INSERT INTO reading_sessions (token, wallet, content_id, started_at, active_seconds, last_beat, completed, passed)
     VALUES ('t1', 'GLECTORA', 1, 1000, 50, 2000, 1, 1)`
  );

  const insD = db.prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (?, ?, ?, ?)`);
  insD.run("2026-06-15", "Adopción del reglamento", "Marco de operación.", sha256Hex("2026-06-15|Adopción del reglamento|Marco de operación."));
  insD.run(...DECISION_ANTERIOR, sha256Hex(DECISION_ANTERIOR.join("|")));
  return db;
}

const todas = (db: DB, sql: string) => db.prepare(sql).all();
const huella = (db: DB, tablas: readonly string[]) =>
  Object.fromEntries(tablas.map((t) => [t, JSON.stringify(todas(db, `SELECT * FROM ${t} ORDER BY 1`))]));
const LO_GANADO = ["academia_awards", "points_ledger", "reading_sessions", "reputation_events"] as const;
const CONTENIDO = ["academia_content", "academia_quiz", "decision_log"] as const;

describe("E2-2 · S1 y S3: la Academia pasa al contenido nuevo en su sitio", () => {
  it("cambia slug, título, resumen y cuerpo; reescribe las 5 preguntas con los MISMOS ids", () => {
    const db = baseConContenidoAnterior();
    const idsAntes = (todas(db, `SELECT id FROM academia_quiz WHERE content_id = 1 ORDER BY id`) as Array<{ id: number }>).map((q) => q.id);
    const otroQuiz = todas(db, `SELECT * FROM academia_quiz WHERE content_id = 3`);

    const r = aplicarContenidoPublico(db, AHORA);

    expect(r.academia).toBe(true);
    expect(db.prepare(`SELECT id, slug, title, summary, body FROM academia_content WHERE id = 1`).get()).toEqual({
      id: 1,
      slug: SLUG_S1,
      title: "Construir sin cargar con el riesgo",
      summary: "Quién responde ante los clientes, qué es tuyo para siempre y por qué firmar no te convierte en empleado.",
      body: ACADEMIA_S1.body,
    });
    expect(db.prepare(`SELECT id FROM academia_content WHERE slug = ?`).get(SLUG_S1_ANTERIOR)).toBeUndefined();

    const quiz = todas(db, `SELECT id, question, options, correct FROM academia_quiz WHERE content_id = 1 ORDER BY id`) as Array<{
      id: number;
      question: string;
      options: string;
      correct: number;
    }>;
    expect(quiz.map((q) => q.id)).toEqual(idsAntes);
    expect(quiz.map((q) => [q.question, JSON.parse(q.options), q.correct])).toEqual(
      ACADEMIA_S1.quiz.map(([p, o, c]) => [p, [...o], c])
    );
    expect(quiz.map((q) => q.question)[0]).toBe("¿Quién responde ante el cliente por lo que se entrega?");
    expect(quiz.map((q) => JSON.parse(q.options)[q.correct])).toEqual([
      "Zelena",
      "No",
      "La entrega",
      "No",
      "La recompensa de la madurez",
    ]);
    // El quiz de otro módulo no cambia.
    expect(todas(db, `SELECT * FROM academia_quiz WHERE content_id = 3`)).toEqual(otroQuiz);
  });

  it("no toca lo ganado ni lo leído: academia_awards, points_ledger y reading_sessions intactos", () => {
    const db = baseConContenidoAnterior();
    const antes = huella(db, LO_GANADO);
    aplicarContenidoPublico(db, AHORA);
    expect(huella(db, LO_GANADO)).toEqual(antes);
  });

  it("orden nuevo: primero «Cómo se mide el valor», después S1 y los demás en su orden relativo", () => {
    const db = baseConContenidoAnterior();
    aplicarContenidoPublico(db, AHORA);
    expect(todas(db, `SELECT slug, ord FROM academia_content ORDER BY ord, id`)).toEqual([
      { slug: "como-se-mide-el-valor", ord: 1 },
      { slug: SLUG_S1, ord: 2 },
      { slug: "el-triangulo-de-activos", ord: 3 },
      { slug: "video-que-es-zelena-dao", ord: 4 },
    ]);
  });

  it("S3: «score compuesto por contribuidor» pasa a «por entrega» (con y sin negrita) y cuenta los reemplazos", () => {
    const db = baseConContenidoAnterior();
    db.prepare(`UPDATE academia_content SET body = ? WHERE id = 2`).run(
      "Un score compuesto por contribuidor. Otra vez: score compuesto por contribuidor."
    );
    const r = aplicarContenidoPublico(db, AHORA);
    expect(r.reemplazos).toBe(3);
    const cuerpos = (todas(db, `SELECT id, body FROM academia_content ORDER BY id`) as Array<{ id: number; body: string | null }>)
      .map((c) => c.body ?? "")
      .join("\n");
    expect(cuerpos).not.toContain("por contribuidor");
    expect(db.prepare(`SELECT body FROM academia_content WHERE id = 3`).get()).toEqual({
      body: "El supervisor genera un **score compuesto** por entrega: calculado.",
    });
  });

  it("la segunda corrida no hace nada", () => {
    const db = baseConContenidoAnterior();
    aplicarContenidoPublico(db, AHORA);
    const tras1 = huella(db, [...CONTENIDO, ...LO_GANADO]);
    expect(aplicarContenidoPublico(db, new Date("2026-10-05T15:00:00Z"))).toEqual({
      academia: false,
      decision: false,
      reemplazos: 0,
    });
    expect(huella(db, [...CONTENIDO, ...LO_GANADO])).toEqual(tras1);
  });

  it("con el slug destino ya existente no toca el módulo anterior (guarda contra el UNIQUE)", () => {
    const db = baseConContenidoAnterior({ conDestino: true });
    db.prepare(`UPDATE academia_content SET body = 'sin cambios' WHERE id = 3`).run(); // aísla S1 de S3
    const antes = huella(db, ["academia_content", "academia_quiz"]);
    const r = aplicarContenidoPublico(db, AHORA);
    expect(r.academia).toBe(false);
    expect(huella(db, ["academia_content", "academia_quiz"])).toEqual(antes);
  });

  it("si el quiz no tiene exactamente 5 preguntas, no lo toca y avisa", () => {
    const db = baseConContenidoAnterior({ preguntasS1: 4 });
    const quizAntes = todas(db, `SELECT * FROM academia_quiz ORDER BY id`);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = aplicarContenidoPublico(db, AHORA);
    expect(r.academia).toBe(true);
    expect(todas(db, `SELECT * FROM academia_quiz ORDER BY id`)).toEqual(quizAntes);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toMatch(/4 preguntas/);
    expect(db.prepare(`SELECT slug FROM academia_content WHERE id = 1`).get()).toEqual({ slug: SLUG_S1 });
  });

  it("una base nueva sale con la misma forma final que una base migrada", () => {
    const nueva = openDb(":memory:");
    nueva.exec(ESQUEMA);
    seedIfEmpty(nueva);
    const migrada = baseConContenidoAnterior();
    aplicarContenidoPublico(migrada, AHORA);

    const s1 = (db: DB) => db.prepare(`SELECT title, summary, body, ord FROM academia_content WHERE slug = ?`).get(SLUG_S1);
    expect(s1(nueva)).toEqual(s1(migrada));
    const quizS1 = (db: DB) =>
      todas(
        db,
        `SELECT q.question, q.options, q.correct FROM academia_quiz q JOIN academia_content c ON c.id = q.content_id
          WHERE c.slug = '${SLUG_S1}' ORDER BY q.id`
      );
    expect(quizS1(nueva)).toEqual(quizS1(migrada));
    const orden = (db: DB) => (todas(db, `SELECT slug FROM academia_content ORDER BY ord, id`) as Array<{ slug: string }>).map((c) => c.slug);
    expect(orden(nueva)).toEqual(orden(migrada));
  });
});

describe("E2-3 · S2: una decisión nueva y transparente; la anterior conserva su huella", () => {
  const decisiones = (db: DB) =>
    todas(db, `SELECT id, date, title, reason, hash FROM decision_log ORDER BY id`) as Array<{
      id: number;
      date: string;
      title: string;
      reason: string;
      hash: string;
    }>;

  it("inserta UNA decisión con fecha de hoy en Bogotá y hash sha256(fecha|título|razón)", () => {
    const db = baseConContenidoAnterior();
    const antes = decisiones(db);
    const r = aplicarContenidoPublico(db, AHORA);
    expect(r.decision).toBe(true);
    const despues = decisiones(db);
    expect(despues.slice(0, antes.length)).toEqual(antes); // la anterior, intacta
    expect(despues).toHaveLength(antes.length + 1);
    const nueva = despues[despues.length - 1];
    expect(nueva).toMatchObject({
      date: "2026-10-01",
      title: "Las etiquetas de proyecto pasan a Cliente y Comunidad",
      reason:
        "Desde hoy los proyectos se etiquetan como de un cliente o de la comunidad. El valor interno no cambia y la decisión anterior se conserva tal cual, con su huella.",
    });
    expect(nueva.hash).toBe(sha256Hex(`2026-10-01|${DECISION_S2.title}|${DECISION_S2.reason}`));
    expect(RE_SIGLA.test(nueva.title + nueva.reason) || RE_ESTRUCTURA.test(nueva.title + nueva.reason)).toBe(false);
  });

  it("«hoy» es el día de Bogotá, no el de UTC (23:30 en Bogotá = 04:30 UTC del día siguiente)", () => {
    const db = baseConContenidoAnterior();
    aplicarContenidoPublico(db, new Date("2026-10-02T04:30:00.000Z"));
    expect(db.prepare(`SELECT date FROM decision_log WHERE title = ?`).get(DECISION_S2.title)).toEqual({ date: "2026-10-01" });
  });

  it("una segunda corrida no inserta otra", () => {
    const db = baseConContenidoAnterior();
    aplicarContenidoPublico(db, AHORA);
    aplicarContenidoPublico(db, new Date("2026-11-01T12:00:00Z"));
    expect(decisiones(db).filter((d) => d.title === DECISION_S2.title)).toHaveLength(1);
  });

  it("en una base nueva no inserta nada: la siembra ya dice «proyectos de cliente»", () => {
    const db = openDb(":memory:");
    db.exec(ESQUEMA);
    seedIfEmpty(db);
    expect(decisiones(db).filter((d) => d.title === DECISION_S2.title)).toEqual([]);
    expect(decisiones(db).some((d) => d.reason.includes("etiquetadas como proyectos de cliente"))).toBe(true);
    const antes = huella(db, [...CONTENIDO, ...LO_GANADO]);
    expect(aplicarContenidoPublico(db, AHORA)).toEqual({ academia: false, decision: false, reemplazos: 0 });
    expect(huella(db, [...CONTENIDO, ...LO_GANADO])).toEqual(antes);
  });

  it("todo el SQL de la migración se traduce a T-SQL (la ruta Azure SQL también la corre)", () => {
    const real = baseConContenidoAnterior();
    const vistos: string[] = [];
    const espia: DB = {
      prepare: (sql) => {
        vistos.push(sql);
        return real.prepare(sql);
      },
      exec: (sql) => real.exec(sql),
      pragma: (d) => real.pragma(d),
      transaction: (fn) => real.transaction(fn),
    };
    const r = aplicarContenidoPublico(espia, AHORA);
    expect(r).toEqual({ academia: true, decision: true, reemplazos: 1 });
    expect(vistos.length).toBeGreaterThan(5);
    for (const sql of vistos) expect(() => translate(sql), sql).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * E2-4 · Arranque
 * ------------------------------------------------------------------ */

describe("E2-4 · seedIfEmpty siembra contenido limpio y no se cae por contenido", () => {
  it("en base vacía, ni la Academia, ni su quiz, ni las decisiones nombran la estructura societaria", () => {
    const db = openDb(":memory:");
    db.exec(ESQUEMA);
    seedIfEmpty(db);
    const textos: Array<[string, string]> = [
      ...(todas(db, `SELECT slug, title, summary, body FROM academia_content`) as Array<Record<string, string | null>>).flatMap((c) =>
        ["title", "summary", "body"].map((k): [string, string] => [`academia_content ${c.slug}.${k}`, c[k] ?? ""])
      ),
      ...(todas(db, `SELECT id, question, options FROM academia_quiz`) as Array<{ id: number; question: string; options: string }>).map(
        (q): [string, string] => [`academia_quiz ${q.id}`, `${q.question} ${q.options}`]
      ),
      ...(todas(db, `SELECT id, title, reason FROM decision_log`) as Array<{ id: number; title: string; reason: string }>).map(
        (d): [string, string] => [`decision_log ${d.id}`, `${d.title} ${d.reason}`]
      ),
    ];
    expect(textos.length).toBeGreaterThan(20);
    const sucios = textos.filter(([, t]) => RE_SIGLA.test(t) || RE_ESTRUCTURA.test(t) || t.includes("por contribuidor"));
    expect(sucios.map(([donde]) => donde)).toEqual([]);
    expect(db.prepare(`SELECT ord FROM academia_content WHERE slug = 'como-se-mide-el-valor'`).get()).toEqual({ ord: 1 });
    expect(db.prepare(`SELECT ord FROM academia_content WHERE slug = ?`).get(SLUG_S1)).toEqual({ ord: 2 });
  });

  it("si aplicarContenidoPublico lanza, seedIfEmpty no lanza: lo registra y el arranque sigue", () => {
    const db = openDb(":memory:");
    db.exec(ESQUEMA);
    seedIfEmpty(db);
    // Falla real de base (no un doble): sin la tabla, la primera consulta de la migración lanza.
    db.exec(`ALTER TABLE academia_content RENAME TO academia_content_apartada`);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => seedIfEmpty(db)).not.toThrow();
    const llamadas = error.mock.calls.filter((c) => c[0] === "[seed] contenido público");
    expect(llamadas).toHaveLength(1);
    expect(String(llamadas[0][1])).toMatch(/academia_content/);
  });
});

/* ------------------------------------------------------------------ *
 * E2-5 · Los documentos legales no se tocan
 * ------------------------------------------------------------------ */

/** ¿Está la etiqueta de la base en este clon? (en CI con clon superficial puede faltar). */
function hayEtiquetaBase(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "wp31-base^{commit}"], { cwd: RAIZ, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("E2-5 · CLA.md, apps/web/CLA.md y LICENSE salen intactos", () => {
  // El hash del CLA (03293c93…) y claCanonicalHash() ya los comprueba migracion-fusion.test.ts (f).
  it.skipIf(!hayEtiquetaBase())("git diff --exit-code wp31-base -- CLA.md apps/web/CLA.md LICENSE sale con 0", () => {
    expect(() =>
      execFileSync("git", ["diff", "--quiet", "--exit-code", "wp31-base", "--", "CLA.md", "apps/web/CLA.md", "LICENSE"], {
        cwd: RAIZ,
        stdio: "ignore",
      })
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * E2-6 · Smoke de producción
 * ------------------------------------------------------------------ */

describe("E2-6 · packages/scripts/smoke-wp31.sh", () => {
  const RUTA = "packages/scripts/smoke-wp31.sh";
  const guion = () => leer(RUTA);
  /** Valor de una variable `NOMBRE="..."` del guion. */
  const variable = (nombre: string) => {
    const m = new RegExp(`^${nombre}="([^"]*)"$`, "m").exec(guion());
    if (!m) throw new Error(`falta ${nombre} en ${RUTA}`);
    return m[1];
  };

  it("existe, es bash y usa fin de línea LF", () => {
    expect(guion().startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(guion()).not.toContain("\r");
  });

  it("pide en 200 exactamente las rutas del spec §9", () => {
    expect(variable("RUTAS_200").split(" ")).toEqual([
      "/",
      "/metodo",
      "/comunidad",
      "/manifiesto",
      "/encuentros",
      "/empresas",
      "/privacidad",
      "/acuerdo",
      "/agora",
      "/academia",
      "/academia/construir-sin-riesgo",
      "/whitepaper",
      "/gobernanza",
    ]);
  });

  it("busca la estructura societaria en las públicas y deja fuera las excepciones legales", () => {
    const rutas = variable("RUTAS_SIN_ESTRUCTURA").split(" ");
    expect(rutas).toEqual([
      "/",
      "/metodo",
      "/comunidad",
      "/agora",
      "/academia",
      "/academia/construir-sin-riesgo",
      "/whitepaper",
      "/empresas",
      "/encuentros",
    ]);
    for (const legal of ["/acuerdo", "/entrar", "/gobernanza", "/privacidad"]) expect(rutas).not.toContain(legal);
    expect(guion()).toContain(`PATRON_ESTRUCTURA='\\bSAS\\b|S\\.A\\.S|societari|sociedad'`);
    expect(guion()).toContain(`grep -cE "$PATRON_ESTRUCTURA"`);
    // El paso 7 revisa lo que bajó el paso 1: toda ruta revisada se pide en 200, y una
    // página de error se descarta para que no cuente como página limpia.
    const en200 = variable("RUTAS_200").split(" ");
    for (const r of rutas) expect(en200, r).toContain(r);
    expect(guion()).toContain(`rm -f "$pagina"`);
  });

  it("comprueba 308, la puerta de /equipo, el cron sin cabecera, el CLA y la prueba en testnet", () => {
    const g = guion();
    expect(g).toContain(`"/ecosistema /metodo"`);
    expect(g).toContain(`"/academia/por-que-sas-dao /academia/construir-sin-riesgo"`);
    expect(g).toMatch(/"308"/);
    expect(g).toContain(`pedir "/equipo/hoy"`);
    expect(g).toContain("*/entrar*");
    expect(g).toMatch(/-X POST "\$BASE\/api\/cron\/recordatorios"/);
    expect(g).toMatch(/"401"/);
    const hashCla = createHash("sha256").update(fs.readFileSync(path.join(RAIZ, "CLA.md"))).digest("hex");
    expect(variable("HASH_CLA")).toBe(hashCla);
    expect(g).toContain(`pedir "/api/cla"`);
    expect(g).toContain(`PATRON_TX='stellar\\.expert/explorer/testnet/tx/[0-9a-f]{64}'`);
  });

  it("acepta SIN_CRON=1 y SIN_COMUNIDAD=1", () => {
    const g = guion();
    expect(g).toContain(`if [ "$SIN_CRON" = "1" ]; then`);
    expect(g).toContain(`[ "$1" = "/comunidad" ] && [ "$SIN_COMUNIDAD" = "1" ]`);
  });

  it("no contiene ni usa secretos", () => {
    const g = guion();
    expect(g).not.toMatch(/x-cron-secret|CRON_SECRET|SESSION_SECRET|RITES_SECRET|TOKEN|Authorization|Bearer|password|api[_-]?key/i);
    expect(g).not.toMatch(/\bS[A-Z2-7]{55}\b/); // semilla de Stellar
    expect(g).not.toMatch(/-H\s/); // ninguna cabecera: el cron se prueba sin ella
    const hexLargos = g.match(/\b[0-9a-f]{40,}\b/g) ?? [];
    expect(hexLargos).toEqual([variable("HASH_CLA")]);
  });

  it("con SIN_COMUNIDAD=1 busca enlaces a /comunidad en las páginas que bajó el paso 1", () => {
    const g = guion();
    expect(g).toContain(`PATRON_ENLACE_COMUNIDAD='href="/comunidad[/?#"]'`);
    expect(g).toContain(`grep -cE "$PATRON_ENLACE_COMUNIDAD"`);
    const paso8 = g.slice(g.indexOf('echo "8.'));
    expect(paso8).toMatch(/^echo "8\.[^\n]*\nif \[ "\$SIN_COMUNIDAD" = "1" \]; then\n(?: {2}#[^\n]*\n)* {2}for ruta in \$RUTAS_200; do\n/);
  });
});

/* ------------------------------------------------------------------ *
 * E2-6 · El smoke, corrido de verdad contra un sitio de mentira
 * ------------------------------------------------------------------ */

/** Bash candidatos (en Windows, primero el de Git: el de WSL no alcanza el 127.0.0.1 de Windows). */
function bashCandidatos(): string[] {
  const git =
    process.platform === "win32"
      ? path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
      : "";
  return [...(git && fs.existsSync(git) ? [git] : []), "bash"];
}

interface Corrida {
  codigo: number;
  salida: string;
}

/** Corre bash sin bloquear el bucle de eventos (el sitio de mentira vive en este proceso). */
function correr(bash: string, args: string[], env: Record<string, string>): Promise<Corrida> {
  return new Promise((resolve) => {
    execFile(
      bash,
      args,
      {
        cwd: RAIZ,
        timeout: 90_000,
        // Sin proxy hacia 127.0.0.1, y sin heredar SIN_CRON/SIN_COMUNIDAD de quien corre los tests.
        env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", ...env },
      },
      (err, stdout, stderr) => {
        const codigo = err ? (typeof err.code === "number" ? err.code : -1) : 0;
        resolve({ codigo, salida: `${stdout}${stderr}` });
      }
    );
  });
}

/** Un escenario del sitio de mentira: si `/comunidad` existe y qué enlaces lleva cada página. */
interface Escenario {
  comunidadExiste: boolean;
  /** En el menú de todas las páginas. */
  enlaces: string[];
  /** Además, en una sola página. */
  enlacesEn?: Record<string, string[]>;
}

const ESCENARIOS: Record<string, Escenario> = {
  // D llegó: /comunidad en 200 y enlazada desde el menú y el CTA.
  "con-comunidad": { comunidadExiste: true, enlaces: ["/comunidad", "/comunidad#proximos"] },
  // D no llegó y el líder ya cambió RUTA_COMUNIDAD. Ni /comunidades ni una consulta que la
  // nombre cuentan como enlace a /comunidad.
  "sin-comunidad": {
    comunidadExiste: false,
    enlaces: ["/encuentros", "/encuentros#proximos", "/comunidades", "/encuentros?de=/comunidad"],
  },
  // D no llegó y se olvidó la línea de RUTA_COMUNIDAD (lo que vio el revisor).
  "sin-comunidad-enlazada": {
    comunidadExiste: false,
    enlaces: [],
    enlacesEn: {
      "/": ["/comunidad"], // menú y puerta 03 de la landing
      "/manifiesto": ["/comunidad#proximos"], // CTA "Ven a la próxima demo"
      "/encuentros": ["/comunidad/ritos/1"], // acta de un rito
    },
  },
};

describe.concurrent("E2-6 · smoke-wp31.sh contra un sitio de mentira", () => {
  const HASH_CLA = createHash("sha256").update(fs.readFileSync(path.join(RAIZ, "CLA.md"))).digest("hex");
  const TX = `https://stellar.expert/explorer/testnet/tx/${"0f".repeat(32)}`;
  const PAGINAS = new Set([
    "/",
    "/metodo",
    "/manifiesto",
    "/encuentros",
    "/empresas",
    "/privacidad",
    "/acuerdo",
    "/agora",
    "/academia",
    "/academia/construir-sin-riesgo",
    "/whitepaper",
    "/gobernanza",
  ]);
  const REDIRECCIONES: Record<string, [number, string]> = {
    "/ecosistema": [308, "/metodo"],
    "/academia/por-que-sas-dao": [308, "/academia/construir-sin-riesgo"],
    "/equipo/hoy": [307, "/entrar?next=%2Fequipo%2Fhoy"],
  };

  // Cada escenario vive bajo su prefijo (`/<escenario>/...`): así las corridas van en paralelo.
  const servidor = http.createServer((req, res) => {
    const m = /^\/([^/?]+)(\/[^?]*)?/.exec(req.url ?? "/");
    const esc = m ? ESCENARIOS[m[1]] : undefined;
    if (!m || !esc) return void res.writeHead(404).end();
    const prefijo = `/${m[1]}`;
    const ruta = m[2] || "/";
    if (req.method === "POST" && ruta === "/api/cron/recordatorios") return void res.writeHead(401).end();
    if (req.method !== "GET") return void res.writeHead(405).end();
    if (ruta === "/api/cla") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ hash: HASH_CLA }));
    }
    const redir = REDIRECCIONES[ruta];
    if (redir) return void res.writeHead(redir[0], { location: prefijo + redir[1] }).end();
    if (PAGINAS.has(ruta) || (ruta === "/comunidad" && esc.comunidadExiste)) {
      const menu = [...esc.enlaces, ...(esc.enlacesEn?.[ruta] ?? [])].map((h) => `<a href="${h}">Enlace</a>`).join("");
      const prueba = ruta === "/" ? `<a href="${TX}">Prueba en testnet</a>` : "";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return void res.end(`<!DOCTYPE html><html><body><nav>${menu}</nav><main>Hola ${prueba}</main></body></html>`);
    }
    res.writeHead(404, { "content-type": "text/html" }).end("<h1>404</h1>");
  });
  let raiz = "";
  let bash: string | null = null;

  beforeAll(async () => {
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    raiz = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    for (const candidato of bashCandidatos()) {
      const sonda = 'curl -s -o /dev/null -w "%{http_code}" "$1/con-comunidad/api/cla"';
      const r = await correr(candidato, ["-c", sonda, "_", raiz], {});
      if (r.codigo === 0 && r.salida.trim() === "200") {
        bash = candidato;
        break;
      }
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  const smoke = (escenario: keyof typeof ESCENARIOS, env: Record<string, string> = {}) =>
    correr(bash!, ["packages/scripts/smoke-wp31.sh", `${raiz}/${escenario}`], { SIN_CRON: "0", SIN_COMUNIDAD: "0", ...env });

  // Sin un bash con curl que alcance 127.0.0.1 estas corridas se omiten (el CI de Linux las corre).
  it("con /comunidad en 200 y enlazada: en verde", async ({ expect, skip }) => {
    if (!bash) return skip();
    const r = await smoke("con-comunidad");
    expect(r, r.salida).toMatchObject({ codigo: 0 });
    expect(r.salida).toContain("Smoke WP31 en verde.");
  }, 90_000);

  it("sin SIN_COMUNIDAD sigue exigiendo /comunidad en 200", async ({ expect, skip }) => {
    if (!bash) return skip();
    const r = await smoke("sin-comunidad");
    expect(r, r.salida).toMatchObject({ codigo: 1 });
    expect(r.salida).toContain("FALLA  /comunidad respondió 404");
  }, 90_000);

  it("con SIN_COMUNIDAD=1 y RUTA_COMUNIDAD ya en /encuentros: en verde", async ({ expect, skip }) => {
    if (!bash) return skip();
    const r = await smoke("sin-comunidad", { SIN_COMUNIDAD: "1" });
    expect(r, r.salida).toMatchObject({ codigo: 0 });
    expect(r.salida).toContain("omite  /comunidad (SIN_COMUNIDAD=1)");
    expect(r.salida).toContain("ok     / no enlaza /comunidad");
  }, 90_000);

  it("con SIN_COMUNIDAD=1 falla si alguna página aún enlaza /comunidad (menú, puerta o CTA en 404)", async ({ expect, skip }) => {
    if (!bash) return skip();
    const r = await smoke("sin-comunidad-enlazada", { SIN_COMUNIDAD: "1" });
    expect(r, r.salida).toMatchObject({ codigo: 1 });
    for (const ruta of ["/", "/manifiesto", "/encuentros"]) {
      expect(r.salida).toContain(`FALLA  ${ruta} enlaza /comunidad con SIN_COMUNIDAD=1`);
    }
    expect(r.salida).toContain("ok     /metodo no enlaza /comunidad");
    expect(r.salida).toContain("Smoke WP31 con 3 falla(s).");
  }, 90_000);
});
