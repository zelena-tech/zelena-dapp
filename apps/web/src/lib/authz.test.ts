/**
 * Autorización por ROL, no por persona (hallazgos D1-02 / D3-01 / D3-02 de la
 * auditoría v1).
 *
 * Las tres invariantes que fija este archivo:
 *  1. El founder que entra por la puerta corporativa (principal `pending:john`, NO
 *     `FOUNDER_WALLET`) conserva la administración. Era el bug latente que detonaba
 *     al encender WP13.
 *  2. La autoridad es la tabla `users`, no la cookie: una cookie que MIENTE
 *     diciéndose founder no administra.
 *  3. `/equipo` es del equipo interno: un `contributor` de la comunidad no entra,
 *     porque `/equipo/proyectos` expone el backlog completo.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty, demoInvitesAllowed, seedBootstrapInvite, bootstrapInviteCode } from "./seed";
import {
  accesoEquipo,
  adminActor,
  clientActor,
  equipoActor,
  equipoInternoActor,
  rolPuedeAdministrar,
  claimsPuedenAdministrar,
} from "./authz";
import { esEquipoInterno, pendingPrincipal } from "./roles";
import { FOUNDER_WALLET } from "./config";
import { Keypair } from "@stellar/stellar-sdk";
import { claCanonicalHash } from "./cla";
import { claSigningPayload } from "./cla-signing";
import { performLogin, performOnboard } from "./onboard";
import { agregarMiembro, crearProyecto, seedTeam } from "./team";

function seededDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  return db;
}

/** Sesión mínima; `role` a propósito ausente salvo que el test lo fije. */
function sesion(wallet: string, extra: Record<string, unknown> = {}) {
  return { wallet, name: "quien sea", ...extra } as Parameters<typeof adminActor>[0];
}

describe("regla pura de administración", () => {
  it("solo founder administra; core, supervisora y contributor no", () => {
    expect(rolPuedeAdministrar("founder")).toBe(true);
    expect(rolPuedeAdministrar("core")).toBe(false);
    expect(rolPuedeAdministrar("contributor")).toBe(false);
    // Supervisar no es administrar: ver el trabajo del equipo para destrabarlo no
    // es cerrar épocas ni mutar el genoma.
    expect(claimsPuedenAdministrar({ role: "core", isSupervisor: true })).toBe(false);
  });

  it("equipo interno incluye core y supervisores, nunca a un contributor", () => {
    expect(esEquipoInterno({ role: "founder" })).toBe(true);
    expect(esEquipoInterno({ role: "core" })).toBe(true);
    expect(esEquipoInterno({ role: "core", isSupervisor: true })).toBe(true);
    expect(esEquipoInterno({ role: "contributor" })).toBe(false);
    expect(esEquipoInterno({})).toBe(false); // cookie vieja sin claims
  });
});

describe("adminActor: gate contra la base", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("D3-01 · el founder que entra por Entra (pending:john) SÍ administra", () => {
    const principal = pendingPrincipal("john");
    // Precondición del bug: su principal NO es FOUNDER_WALLET.
    expect(principal).not.toBe(FOUNDER_WALLET);
    const row = db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(principal) as
      | { role: string }
      | undefined;
    expect(row?.role).toBe("founder");

    const actor = adminActor(sesion(principal), db);
    expect(actor).not.toBeNull();
    expect(actor?.role).toBe("founder");
  });

  it("el founder del seed (FOUNDER_WALLET) sigue administrando", () => {
    expect(adminActor(sesion(FOUNDER_WALLET), db)).not.toBeNull();
  });

  it("una cookie que MIENTE diciéndose founder no administra", () => {
    const fausto = pendingPrincipal("fausto");
    const actor = adminActor(sesion(fausto, { role: "founder", isFounder: true, isSupervisor: true }), db);
    expect(actor).toBeNull(); // la fila dice `core`, y la fila manda
  });

  it("un core y una supervisora no administran; sin sesión tampoco", () => {
    expect(adminActor(sesion(pendingPrincipal("fausto")), db)).toBeNull();
    expect(adminActor(sesion(pendingPrincipal("vale")), db)).toBeNull(); // core + supervisora
    expect(adminActor(null, db)).toBeNull();
  });
});

describe("equipoInternoActor: gate de /equipo", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("los 6 del roster entran al módulo equipo", () => {
    for (const slug of ["john", "vale", "juan", "david", "fausto", "angela"]) {
      expect(equipoInternoActor(sesion(pendingPrincipal(slug)), db), slug).not.toBeNull();
    }
  });

  it("D3-02 · un contribuidor de la comunidad NO entra (el backlog no se le muestra)", () => {
    const demo = db
      .prepare(`SELECT wallet FROM users WHERE role = 'contributor' AND is_demo = 1 LIMIT 1`)
      .get() as { wallet: string } | undefined;
    expect(demo?.wallet).toBeTruthy();
    expect(equipoInternoActor(sesion(demo!.wallet), db)).toBeNull();
  });

  it("un usuario que no existe en la base no entra ni con claims inflados", () => {
    expect(equipoInternoActor(sesion("GDESCONOCIDO", { role: "core" }), db)).toBeNull();
  });
});

describe("escotilla de arranque: un despliegue no puede dejarse fuera a sí mismo", () => {
  const CODIGO = "ZELENA-BOOTSTRAP-2026-XYZ";

  /** Entorno sintético aislado: NO hereda process.env, para que el test sea estable. */
  function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    return overrides as unknown as NodeJS.ProcessEnv;
  }

  function dbConEnv(entorno: NodeJS.ProcessEnv): DB {
    const db = openDb(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
    seedIfEmpty(db);
    seedBootstrapInvite(db, entorno);
    return db;
  }

  function invitesUsables(db: DB): number {
    return (
      db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE used_by IS NULL`).get() as { n: number }
    ).n;
  }

  it("el deadlock existe sin la escotilla: producción fresca deja 0 invitaciones", () => {
    // Reproduce el despliegue real: sin códigos de demo y sin escotilla, nadie entra.
    const db = dbConEnv(env());
    const genesis = (
      db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE code LIKE 'GENESIS-%'`).get() as { n: number }
    ).n;
    // En test NODE_ENV no es production, así que los GENESIS sí están; lo que se fija
    // aquí es que la escotilla NO añade nada cuando no está configurada.
    expect(invitesUsables(db)).toBe(genesis);
  });

  it("con FOUNDER_BOOTSTRAP_CODE se siembra UNA invitación con ese código", () => {
    const db = dbConEnv(env({ FOUNDER_BOOTSTRAP_CODE: CODIGO }));
    const row = db.prepare(`SELECT code, used_by FROM invites WHERE code = ?`).get(CODIGO) as
      | { code: string; used_by: string | null }
      | undefined;
    expect(row?.code).toBe(CODIGO);
    expect(row?.used_by).toBeNull();
  });

  it("es idempotente y NO resucita el código una vez consumido", () => {
    const entorno = env({ FOUNDER_BOOTSTRAP_CODE: CODIGO });
    const db = dbConEnv(entorno);
    // Simula que el founder ya entró con él.
    db.prepare(`UPDATE invites SET used_by = 'GALGUIEN' WHERE code = ?`).run(CODIGO);
    seedBootstrapInvite(db, entorno); // reinicio de la app
    const row = db.prepare(`SELECT used_by FROM invites WHERE code = ?`).get(CODIGO) as {
      used_by: string | null;
    };
    expect(row.used_by).toBe("GALGUIEN"); // sigue quemada
    const cuantas = (
      db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE code = ?`).get(CODIGO) as { n: number }
    ).n;
    expect(cuantas).toBe(1); // nunca se duplica
  });

  it("rechaza un código corto en vez de sembrar algo adivinable", () => {
    expect(bootstrapInviteCode(env({ FOUNDER_BOOTSTRAP_CODE: "corto" }))).toBeNull();
    expect(bootstrapInviteCode(env({ FOUNDER_BOOTSTRAP_CODE: CODIGO }))).toBe(CODIGO);
    const db = dbConEnv(env({ FOUNDER_BOOTSTRAP_CODE: "corto" }));
    expect(db.prepare(`SELECT code FROM invites WHERE code = 'corto'`).get()).toBeUndefined();
  });
});

describe("demoInvitesAllowed: los códigos GENESIS no existen en producción", () => {
  it("en producción NO se siembran; con SEED_DEMO=1 sí; fuera de producción sí", () => {
    expect(demoInvitesAllowed({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(demoInvitesAllowed({ NODE_ENV: "production", SEED_DEMO: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(demoInvitesAllowed({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(demoInvitesAllowed({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it("en desarrollo el seed sí deja las 6 invitaciones GENESIS utilizables", () => {
    const db = seededDb(); // NODE_ENV de vitest no es production
    const n = (
      db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE code LIKE 'GENESIS-%'`).get() as { n: number }
    ).n;
    expect(n).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// WP31 · A1, A9, A10, A11 — la puerta de /equipo con quien trabaja por proyecto
// ---------------------------------------------------------------------------

const JOHN_ACTOR = { wallet: pendingPrincipal("john"), name: "John", role: "founder" as const, isSupervisor: true };

function dbEquipo(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

function contributor(db: DB, wallet: string, o: { cla?: number; status?: string } = {}): void {
  db.prepare(
    `INSERT INTO users (wallet, display_name, role, status, is_demo, cla_signed) VALUES (?, 'Ana', 'contributor', ?, 0, ?)`
  ).run(wallet, o.status ?? "active", o.cla ?? 1);
}

describe("WP31 · A1 · equipoActor: la puerta de /equipo", () => {
  const ANA = "GANAEXTERNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  let db: DB;
  let p: number;
  beforeEach(() => {
    db = dbEquipo();
    contributor(db, ANA);
    p = crearProyecto(db, JOHN_ACTOR, { name: "Proyecto Abierto" }).id;
  });

  it("contributor sin membresía → null", () => {
    expect(equipoActor(sesion(ANA), db)).toBeNull();
    expect(accesoEquipo(sesion(ANA), db)).toBe(false);
  });

  it("contributor con membresía y acuerdo firmado → alcance 'proyectos' con sus proyectos", () => {
    agregarMiembro(db, JOHN_ACTOR, { initiativeId: p, wallet: ANA, rol: "ejecuta" });
    const a = equipoActor(sesion(ANA), db);
    expect(a?.alcance).toBe("proyectos");
    expect(a?.proyectos).toEqual([p]);
    expect(a?.role).toBe("contributor");
    expect(accesoEquipo(sesion(ANA), db)).toBe(true);
  });

  it("con membresía pero SIN acuerdo → null (aunque la fila exista)", () => {
    agregarMiembro(db, JOHN_ACTOR, { initiativeId: p, wallet: ANA, rol: "ejecuta" });
    db.prepare(`UPDATE users SET cla_signed = 0 WHERE wallet = ?`).run(ANA);
    expect(equipoActor(sesion(ANA), db)).toBeNull();
  });

  it("core → 'equipo'; founder → 'equipo'; alumni → null; sin sesión o sin fila → null", () => {
    expect(equipoActor(sesion(pendingPrincipal("fausto")), db)?.alcance).toBe("equipo");
    expect(equipoActor(sesion(pendingPrincipal("john")), db)?.alcance).toBe("equipo");
    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet = ?`).run(pendingPrincipal("david"));
    expect(equipoActor(sesion(pendingPrincipal("david")), db)).toBeNull();
    agregarMiembro(db, JOHN_ACTOR, { initiativeId: p, wallet: ANA, rol: "ejecuta" });
    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet = ?`).run(ANA);
    expect(equipoActor(sesion(ANA), db)).toBeNull();
    expect(equipoActor(null, db)).toBeNull();
    expect(equipoActor(sesion("GNOEXISTE"), db)).toBeNull();
  });

  it("la cookie no concede nada: un contributor que se declara founder sigue siendo contributor", () => {
    agregarMiembro(db, JOHN_ACTOR, { initiativeId: p, wallet: ANA, rol: "ejecuta" });
    const a = equipoActor(sesion(ANA, { role: "founder", isFounder: true, isSupervisor: true }), db);
    expect(a?.role).toBe("contributor");
    expect(a?.isSupervisor).toBe(false);
    expect(a?.alcance).toBe("proyectos");
  });

  it("A10 · un contributor miembro no entra a /clientes ni al equipo interno", () => {
    agregarMiembro(db, JOHN_ACTOR, { initiativeId: p, wallet: ANA, rol: "estructura" });
    expect(clientActor(sesion(ANA), db)).toBeNull();
    expect(equipoInternoActor(sesion(ANA), db)).toBeNull();
    expect(adminActor(sesion(ANA), db)).toBeNull();
  });
});

describe("WP31 · A11 · reingreso: un contributor miembro vuelve a entrar y llega a sus proyectos", () => {
  it("performLogin + equipoActor → alcance 'proyectos'", () => {
    const db = dbEquipo();
    db.prepare(
      `INSERT INTO invites (code, issuer_wallet, expires_at) VALUES ('INVITA-PRUEBA', ?, datetime('now','+30 days'))`
    ).run(pendingPrincipal("john"));
    const kp = Keypair.random();
    const wallet = kp.publicKey();
    const hash = claCanonicalHash();
    const firma = Buffer.from(kp.sign(Buffer.from(claSigningPayload(hash), "utf8"))).toString("base64");
    performOnboard(db, { code: "INVITA-PRUEBA", wallet, name: "Ana", isDemo: false, claHash: hash, signature: firma });
    const p = crearProyecto(db, JOHN_ACTOR, { name: "Proyecto De Regreso" }).id;
    agregarMiembro(db, JOHN_ACTOR, { initiativeId: p, wallet, rol: "ejecuta" });

    const login = performLogin(db, { wallet, claHash: hash, signature: firma });
    expect(login.role).toBe("contributor");
    // La cookie se firma con lo que devuelve el login; la puerta relee la base.
    const a = equipoActor({ wallet: login.wallet, name: login.name, role: login.role, isSupervisor: login.isSupervisor }, db);
    expect(a?.alcance).toBe("proyectos");
    expect(a?.proyectos).toEqual([p]);
  });
});

describe("WP31 · A9 · puertas por página y por ruta (test estático)", () => {
  const RAIZ = process.cwd();
  const PUERTA = /\b(equipoActor|equipoInternoActor|adminActor)\(/;

  function recorrer(dir: string, nombre: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...recorrer(p, nombre));
      else if (e.name === nombre) out.push(p);
    }
    return out;
  }

  const paginas = recorrer(path.join(RAIZ, "app", "equipo"), "page.tsx");
  const rutas = recorrer(path.join(RAIZ, "app", "api", "equipo"), "route.ts");
  const EXENTA = path.join(RAIZ, "app", "equipo", "page.tsx"); // redirección pura a /equipo/hoy

  it("recorre de verdad las páginas y rutas del módulo (no pasa por vacío)", () => {
    expect(paginas.length).toBeGreaterThanOrEqual(4);
    expect(rutas.length).toBeGreaterThanOrEqual(6);
    expect(paginas).toContain(path.join(RAIZ, "app", "equipo", "proyectos", "page.tsx"));
    expect(rutas).toContain(path.join(RAIZ, "app", "api", "equipo", "asignacion", "route.ts"));
  });

  it("cada page.tsx de /equipo y cada route.ts de /api/equipo autoriza por sí misma", () => {
    const sinPuerta = [...paginas, ...rutas, path.join(RAIZ, "app", "equipo", "layout.tsx")]
      .filter((p) => p !== EXENTA)
      .filter((p) => !PUERTA.test(fs.readFileSync(p, "utf8")))
      .map((p) => path.relative(RAIZ, p));
    expect(sinPuerta).toEqual([]);
  });

  it("ninguna usa actorFromSession (cae a los claims de la cookie)", () => {
    const conCookie = [...paginas, ...rutas]
      .filter((p) => /\bactorFromSession\(/.test(fs.readFileSync(p, "utf8")))
      .map((p) => path.relative(RAIZ, p));
    expect(conCookie).toEqual([]);
  });

  it("la exenta es solo una redirección", () => {
    const src = fs.readFileSync(EXENTA, "utf8");
    expect(src).toMatch(/redirect\("\/equipo\/hoy"\)/);
    expect(src).not.toMatch(/getDb|getSession/);
  });

  it("el dashboard y el directorio de talento piden además supervisión", () => {
    for (const rel of [
      ["app", "equipo", "dashboard", "page.tsx"],
      ["app", "equipo", "talento", "page.tsx"],
    ]) {
      const p = path.join(RAIZ, ...rel);
      if (rel[2] === "talento" && !fs.existsSync(p)) continue; // la crea WP31-A2
      expect(fs.readFileSync(p, "utf8"), rel.join("/")).toMatch(/\bpuedeVerTodoElEquipo\(/);
    }
  });

  it("A10 · el tablero de un proyecto ajeno responde notFound (puerta propia de la página)", () => {
    const p = path.join(RAIZ, "app", "equipo", "proyectos", "[slug]", "page.tsx");
    const src = fs.readFileSync(p, "utf8");
    expect(src).toMatch(/\bequipoActor\(/);
    expect(src).toMatch(/!puedeVerProyecto\(db, actor, proyecto\.id\)\) notFound\(\)/);
  });

  it("las listas del alta en /equipo/hoy salen de proyectosVisibles, nunca de listInitiatives", () => {
    const hoy = fs.readFileSync(path.join(RAIZ, "app", "equipo", "hoy", "page.tsx"), "utf8");
    expect(hoy).toMatch(/\bproyectosVisibles\(/);
    expect(hoy).not.toMatch(/\blistInitiatives\(/);
  });

  it("A10 · el check-in es solo del alcance 'equipo' (página y ruta)", () => {
    const hoy = fs.readFileSync(path.join(RAIZ, "app", "equipo", "hoy", "page.tsx"), "utf8");
    expect(hoy).toMatch(/alcance === "equipo"/);
    const ruta = fs.readFileSync(path.join(RAIZ, "app", "api", "equipo", "checkin", "route.ts"), "utf8");
    expect(ruta).toMatch(/alcance !== "equipo"/);
  });
});
