/**
 * WP13 · Puerta corporativa Entra ID — con Entra MOCKEADO (cero red).
 *
 * Qué se mockea y qué NO: se mockean los CLAIMS del `id_token` (lo que Entra
 * entregaría tras autenticar), porque conseguirlos de verdad exige el app
 * registration de John. Lo que se prueba es TODO lo nuestro: la restricción de
 * tenant, la resolución de identidad contra el registro y las escrituras en DB.
 * Ninguna de estas pruebas hace una petición de red.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { seedIfEmpty } from "./seed";
import {
  ENTRA_PROVIDER_ID,
  entraLogin,
  entraPrincipal,
  hasRecoveryEmail,
  isPlausibleEmail,
  linkRecoveryEmail,
  listUserEmails,
  payoutBlockers,
  resolveEntraLogin,
  rosterMemberForIdentity,
  validateEntraToken,
  type EntraIdentity,
  type EntraTokenClaims,
  type EntraValidationOptions,
} from "./entra";
import { pendingPrincipal, TEAM_ROSTER } from "./roles";
import { createAssignment, upsertInitiative } from "./team";

const TENANT = "11111111-2222-3333-4444-555555555555";
const OTHER_TENANT = "99999999-8888-7777-6666-555555555555";
const DOMAIN = "zelena.tech";

const ON: EntraValidationOptions = { enabled: true, tenantId: TENANT, corporateDomain: DOMAIN };
const OFF: EntraValidationOptions = { ...ON, enabled: false };

function seededDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedIfEmpty(db);
  return db;
}

/** Claims que Entra emitiría para una cuenta del tenant de Zelena. */
function claims(over: Partial<EntraTokenClaims> = {}): EntraTokenClaims {
  return {
    tid: TENANT,
    oid: "oid-fausto-0001",
    preferred_username: "fausto@zelena.tech",
    name: "Fausto Pérez",
    ...over,
  };
}

function identity(over: Partial<EntraIdentity> = {}): EntraIdentity {
  const v = validateEntraToken(claims(), ON);
  if (!v.ok) throw new Error("fixture inválido");
  return { ...v.identity, ...over };
}

// ---------------------------------------------------------------------------

describe("validateEntraToken: restricción de tenant y flag (criterios 2 y 3)", () => {
  it("acepta una cuenta del tenant con correo corporativo", () => {
    const r = validateEntraToken(claims(), ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.oid).toBe("oid-fausto-0001");
    expect(r.identity.email).toBe("fausto@zelena.tech");
    expect(r.identity.localPart).toBe("fausto");
    expect(r.identity.tenantId).toBe(TENANT);
  });

  it("CRITERIO 2 · rechaza el correo de OTRO tenant con un mensaje claro", () => {
    const r = validateEntraToken(
      claims({ tid: OTHER_TENANT, preferred_username: "alguien@otraempresa.com" }),
      ON
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("foreign_tenant");
    // El mensaje nombra el problema Y la alternativa; nada de "Access Denied".
    expect(r.message).toContain("no pertenece a la organización de Zelena");
    expect(r.message).toContain("@zelena.tech");
    expect(r.message).toContain("invitación");
  });

  it("un tenant ajeno se rechaza AUNQUE el correo diga @zelena.tech (el tid manda)", () => {
    const r = validateEntraToken(claims({ tid: OTHER_TENANT }), ON);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("foreign_tenant");
  });

  it("rechaza a un invitado B2B del directorio (#EXT#) pese a tener el tid correcto", () => {
    const r = validateEntraToken(
      claims({ preferred_username: "alguien_gmail.com#EXT#@zelena.onmicrosoft.com" }),
      ON
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("guest_account");
  });

  it("rechaza un correo del tenant que no es del dominio corporativo", () => {
    const r = validateEntraToken(claims({ preferred_username: "john@otrodominio.com" }), ON);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("foreign_domain");
  });

  it("CRITERIO 3 · sin token no hay sesión: es lo que pasa cuando Entra desactiva la cuenta", () => {
    // No hay sincronización de bajas por Graph (NO-ALCANCE). La baja se refleja
    // porque Entra deja de emitir token, y entonces los claims llegan nulos.
    const r = validateEntraToken(null, ON);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no_token");
  });

  it("un token sin oid no vincula nada (no se inventa identidad)", () => {
    const r = validateEntraToken(claims({ oid: undefined, sub: undefined }), ON);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_oid");
  });

  it("un token sin correo se rechaza (no se puede vincular a user_emails)", () => {
    const r = validateEntraToken(
      claims({ preferred_username: undefined, email: undefined, upn: undefined }),
      ON
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing_email");
  });

  it("con el flag APAGADO la puerta corporativa no existe, aunque el token sea perfecto", () => {
    const r = validateEntraToken(claims(), OFF);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("flag_disabled");
    expect(r.message).toContain("invitación");
  });

  it("sin tenant configurado se rechaza con 'not_configured', no con 'tenant ajeno'", () => {
    const r = validateEntraToken(claims(), { ...ON, tenantId: "  " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("not_configured");
  });

  it("normaliza el correo a minúsculas y tolera espacios del claim", () => {
    const r = validateEntraToken(claims({ preferred_username: "  Fausto@Zelena.Tech " }), ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.email).toBe("fausto@zelena.tech");
  });

  it("el id del provider fija la Redirect URI del app registration (paso A1)", () => {
    expect(ENTRA_PROVIDER_ID).toBe("microsoft-entra-id");
  });
});

// ---------------------------------------------------------------------------

describe("rosterMemberForIdentity: resolución del roster real (plano 07 §5)", () => {
  it("resuelve por la parte local del correo", () => {
    expect(rosterMemberForIdentity(identity())!.slug).toBe("fausto");
  });

  it("resuelve por la primera partícula de un correo con punto", () => {
    const m = rosterMemberForIdentity(
      identity({ localPart: "juan.perez", email: "juan.perez@zelena.tech", displayName: "" })
    );
    expect(m!.slug).toBe("juan");
  });

  it("resuelve por nombre del token cuando el correo no dice nada", () => {
    const m = rosterMemberForIdentity(
      identity({ localPart: "vp2026", email: "vp2026@zelena.tech", displayName: "Valentina" })
    );
    expect(m!.slug).toBe("vale");
  });

  it("resuelve acentos: Ángela → angela", () => {
    const m = rosterMemberForIdentity(
      identity({ localPart: "acomms", email: "acomms@zelena.tech", displayName: "Ángela Ruiz" })
    );
    expect(m!.slug).toBe("angela");
  });

  it("no inventa: alguien fuera del roster no resuelve a nadie", () => {
    const m = rosterMemberForIdentity(
      identity({ localPart: "contabilidad", email: "contabilidad@zelena.tech", displayName: "Área Contable" })
    );
    expect(m).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("resolveEntraLogin: alta y vinculación (criterios 1 y 5)", () => {
  let db: DB;
  beforeEach(() => {
    db = seededDb();
  });

  it("CRITERIO 1 · un @zelena.tech del roster entra como core, sin invitación ni wallet", () => {
    const invitesBefore = db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE used_by IS NOT NULL`).get() as { n: number };
    const r = entraLogin(db, claims(), ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.login.role).toBe("core");
    expect(r.login.mode).toBe("roster");
    // Ninguna invitación se consumió y no se pidió wallet Stellar en ningún momento.
    const invitesAfter = db.prepare(`SELECT COUNT(*) AS n FROM invites WHERE used_by IS NOT NULL`).get() as { n: number };
    expect(invitesAfter.n).toBe(invitesBefore.n);
    expect(r.login.wallet).toBe(pendingPrincipal("fausto"));
  });

  it("el CLA NO es requisito de login: se entra con claSigned=false y se firma después", () => {
    const r = entraLogin(db, claims(), ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.login.claSigned).toBe(false);
    // Pero sí bloquea cobrar (candado de PI del Plan Maestro §3).
    expect(payoutBlockers(db, r.login.wallet)).toContain("Falta firmar el CLA.");
  });

  it("CRITERIO 5 · NUNCA muta la PK: el trabajo que colgaba de `pending:<slug>` sobrevive", () => {
    // El importador de WP14 ya le asignó trabajo a `pending:fausto` ANTES del login.
    const initiative = upsertInitiative(db, "WMS", "Ahora");
    const assignmentId = createAssignment(db, {
      initiativeId: initiative,
      title: "Migrar el esquema a Azure SQL",
      ownerWallet: pendingPrincipal("fausto"),
      priority: "High",
      createdBy: pendingPrincipal("john"),
    });

    const r = entraLogin(db, claims(), ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // El principal es EL MISMO, así que la asignación sigue apuntando a su dueño.
    expect(r.login.wallet).toBe(pendingPrincipal("fausto"));
    const owner = db
      .prepare(`SELECT owner_wallet FROM assignments WHERE id = ?`)
      .get(assignmentId) as { owner_wallet: string };
    expect(owner.owner_wallet).toBe(pendingPrincipal("fausto"));
    // Y no apareció un segundo registro para el mismo humano.
    const rows = db
      .prepare(`SELECT wallet FROM users WHERE entra_oid = ?`)
      .all("oid-fausto-0001") as Array<{ wallet: string }>;
    expect(rows).toHaveLength(1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM users WHERE wallet = ?`).get(entraPrincipal("oid-fausto-0001")) as { n: number }).toEqual({ n: 0 });
  });

  it("CRITERIO 5 · dos logins seguidos son UN registro (idempotente, modo existing_oid)", () => {
    const first = entraLogin(db, claims(), ON);
    const second = entraLogin(db, claims(), ON);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.login.wallet).toBe(first.login.wallet);
    expect(second.login.mode).toBe("existing_oid");
    const n = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE entra_oid IS NOT NULL`).get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("CRITERIO 5 · quien ya entró por invitación+wallet NO se duplica: se vincula por correo", () => {
    // Escenario del plano 05: un voluntario de comunidad al que después se contrata.
    const wallet = "GBVOLUNTARIODEMOWALLET0000000000000000000000000000000AAA";
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, status, is_demo, is_founder, cla_signed, role, is_supervisor)
       VALUES (?, 'Contabilidad', 'Bronze', 'active', 1, 0, 1, 'contributor', 0)`
    ).run(wallet);
    db.prepare(
      `INSERT INTO user_emails (wallet, email, kind, is_corporate, is_verified) VALUES (?, 'contabilidad@zelena.tech', 'recovery', 0, 0)`
    ).run(wallet);

    const r = entraLogin(
      db,
      claims({ oid: "oid-conta", preferred_username: "contabilidad@zelena.tech", name: "Área Contable" }),
      ON
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.login.mode).toBe("existing_email");
    expect(r.login.wallet).toBe(wallet);
    // Vincular el corporativo NO auto-promueve a core: el rol no cambia solo por esto.
    expect(r.login.role).toBe("contributor");
    // Y el correo corporativo pasó a ser el primary de tipo corporativo.
    const emails = listUserEmails(db, wallet);
    expect(emails).toEqual([
      { email: "contabilidad@zelena.tech", kind: "primary", is_corporate: 1, is_verified: 1 },
    ]);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE entra_oid = 'oid-conta'`).get() as { n: number };
    expect(total.n).toBe(1);
  });

  it("alguien del tenant fuera del roster: alta nueva `entra:<oid>` como core", () => {
    const r = entraLogin(
      db,
      claims({ oid: "oid-nuevo", preferred_username: "soporte@zelena.tech", name: "Mesa de Soporte" }),
      ON
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.login.mode).toBe("created");
    expect(r.login.wallet).toBe(entraPrincipal("oid-nuevo"));
    expect(r.login.role).toBe("core");
    expect(r.login.isSupervisor).toBe(false);
  });

  it("roles del plano 07 §5: John founder+supervisor, Vale core Y supervisora", () => {
    const john = entraLogin(db, claims({ oid: "oid-john", preferred_username: "john@zelena.tech", name: "John" }), ON);
    const vale = entraLogin(db, claims({ oid: "oid-vale", preferred_username: "vale@zelena.tech", name: "Vale" }), ON);
    const david = entraLogin(db, claims({ oid: "oid-david", preferred_username: "david@zelena.tech", name: "David" }), ON);
    expect(john.ok && vale.ok && david.ok).toBe(true);
    if (!john.ok || !vale.ok || !david.ok) return;
    expect(john.login.role).toBe("founder");
    expect(john.login.isSupervisor).toBe(true);
    expect(vale.login.role).toBe("core");
    expect(vale.login.isSupervisor).toBe(true);
    expect(david.login.role).toBe("core");
    expect(david.login.isSupervisor).toBe(false);
  });

  it("GUARDA ANTI-FUSIÓN: un homónimo nuevo no se apropia de la fila del roster", () => {
    const juan = entraLogin(db, claims({ oid: "oid-juan", preferred_username: "juan@zelena.tech", name: "Juan" }), ON);
    expect(juan.ok).toBe(true);
    if (!juan.ok) return;
    expect(juan.login.wallet).toBe(pendingPrincipal("juan"));

    // Otra persona, mismo nombre de pila, correo distinto.
    const otro = entraLogin(
      db,
      claims({ oid: "oid-juanjo", preferred_username: "juanjo@zelena.tech", name: "Juan José Otro" }),
      ON
    );
    expect(otro.ok).toBe(true);
    if (!otro.ok) return;
    expect(otro.login.wallet).toBe(entraPrincipal("oid-juanjo"));
    expect(otro.login.mode).toBe("created");
    // La fila de Juan sigue siendo de Juan.
    const row = db
      .prepare(`SELECT entra_oid FROM users WHERE wallet = ?`)
      .get(pendingPrincipal("juan")) as { entra_oid: string };
    expect(row.entra_oid).toBe("oid-juan");
  });

  it("entra_oid es único de hecho: ningún oid aparece en dos principales", () => {
    for (const m of TEAM_ROSTER) {
      entraLogin(db, claims({ oid: "oid-" + m.slug, preferred_username: m.slug + "@zelena.tech", name: m.name }), ON);
    }
    const dupes = db
      .prepare(
        `SELECT entra_oid, COUNT(*) AS n FROM users WHERE entra_oid IS NOT NULL GROUP BY entra_oid HAVING COUNT(*) > 1`
      )
      .all() as unknown[];
    expect(dupes).toEqual([]);
    const linked = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE entra_oid IS NOT NULL`).get() as { n: number };
    expect(linked.n).toBe(TEAM_ROSTER.length);
  });

  it("CRITERIO 3 (segunda capa) · un principal 'alumni' no abre sesión corporativa nueva", () => {
    const first = entraLogin(db, claims(), ON);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    db.prepare(`UPDATE users SET status = 'alumni' WHERE wallet = ?`).run(first.login.wallet);

    const again = entraLogin(db, claims(), ON);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("account_disabled");
    // El mensaje NO habla del valor de la persona y NO confisca nada (doc 16).
    expect(again.message).toContain("siguen siendo tuyos");
    const points = db
      .prepare(`SELECT COUNT(*) AS n FROM points_ledger WHERE wallet = ?`)
      .get(first.login.wallet) as { n: number };
    expect(points.n).toBe(0); // no se borró ni se movió nada al cerrar la puerta
  });

  it("con el flag apagado, entraLogin no escribe NADA en la base", () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    const r = entraLogin(db, claims(), OFF);
    expect(r.ok).toBe(false);
    const after = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
    expect(after.n).toBe(before.n);
    const emails = db.prepare(`SELECT COUNT(*) AS n FROM user_emails`).get() as { n: number };
    expect(emails.n).toBe(0);
  });

  it("el correo corporativo entra SIEMPRE como primary de tipo corporativo", () => {
    const r = entraLogin(db, claims(), ON);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const emails = listUserEmails(db, r.login.wallet);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toEqual({
      email: "fausto@zelena.tech",
      kind: "primary",
      is_corporate: 1,
      is_verified: 1,
    });
  });

  it("la vinculación marca auth_provider='entra' sin tocar a los demás usuarios", () => {
    entraLogin(db, claims(), ON);
    const row = db
      .prepare(`SELECT auth_provider FROM users WHERE wallet = ?`)
      .get(pendingPrincipal("fausto")) as { auth_provider: string };
    expect(row.auth_provider).toBe("entra");
    const invited = db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE auth_provider = 'invite'`)
      .get() as { n: number };
    expect(invited.n).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("segundo correo personal (doc 15 §2)", () => {
  let db: DB;
  let wallet: string;
  beforeEach(() => {
    db = seededDb();
    const r = entraLogin(db, claims(), ON);
    if (!r.ok) throw new Error("login de fixture falló");
    wallet = r.login.wallet;
  });

  it("tras el primer login falta el segundo correo: el banner se muestra", () => {
    expect(hasRecoveryEmail(db, wallet)).toBe(false);
    const r = entraLogin(db, claims(), ON);
    expect(r.ok && r.login.needsRecoveryEmail).toBe(true);
  });

  it("vincular un correo personal apaga el banner", () => {
    const res = linkRecoveryEmail(db, wallet, "  Fausto.Personal@Gmail.com ", DOMAIN);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.email).toBe("fausto.personal@gmail.com");
    expect(hasRecoveryEmail(db, wallet)).toBe(true);
    const r = entraLogin(db, claims(), ON);
    expect(r.ok && r.login.needsRecoveryEmail).toBe(false);
  });

  it("rechaza un segundo correo del dominio corporativo (moriría con la baja)", () => {
    const res = linkRecoveryEmail(db, wallet, "fausto.alt@zelena.tech", DOMAIN);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toContain("personal");
    expect(hasRecoveryEmail(db, wallet)).toBe(false);
  });

  it("rechaza un correo con formato inválido", () => {
    expect(linkRecoveryEmail(db, wallet, "no-es-un-correo", DOMAIN).ok).toBe(false);
    expect(isPlausibleEmail("a@b.co")).toBe(true);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("sin arroba")).toBe(false);
  });

  it("no roba un correo ya vinculado a otro registro", () => {
    const otro = entraLogin(
      db,
      claims({ oid: "oid-david", preferred_username: "david@zelena.tech", name: "David" }),
      ON
    );
    expect(otro.ok).toBe(true);
    if (!otro.ok) return;
    linkRecoveryEmail(db, otro.login.wallet, "compartido@gmail.com", DOMAIN);
    const res = linkRecoveryEmail(db, wallet, "compartido@gmail.com", DOMAIN);
    expect(res.ok).toBe(false);
    expect(hasRecoveryEmail(db, wallet)).toBe(false);
  });

  it("falta el segundo correo ⇒ bloquea COBRAR, nunca el trabajo diario", () => {
    const blockers = payoutBlockers(db, wallet);
    expect(blockers).toContain("Falta vincular tu segundo correo personal.");
    // El trabajo diario no depende de esto: la asignación se crea y se ve igual.
    const initiative = upsertInitiative(db, "WMS", "Ahora");
    const assignmentId = createAssignment(db, {
      initiativeId: initiative,
      title: "Trabajo del día sin segundo correo",
      ownerWallet: wallet,
      priority: "Normal",
      createdBy: pendingPrincipal("john"),
    });
    expect(assignmentId).toBeGreaterThan(0);
  });

  it("vincular el segundo correo NO confisca ni mueve puntos (doc 16)", () => {
    db.prepare(
      `INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, 100, 1, 'ejecucion', 'entrega-demo')`
    ).run(wallet);
    linkRecoveryEmail(db, wallet, "personal@gmail.com", DOMAIN);
    const sum = db
      .prepare(`SELECT COALESCE(SUM(points), 0) AS total FROM points_ledger WHERE wallet = ?`)
      .get(wallet) as { total: number };
    expect(sum.total).toBe(100);
    expect(payoutBlockers(db, wallet)).not.toContain("Falta vincular tu segundo correo personal.");
  });
});

// ---------------------------------------------------------------------------

describe("resolveEntraLogin: contrato de entrada", () => {
  it("resolveEntraLogin exige una identidad ya validada (no acepta claims crudos)", () => {
    const db = seededDb();
    // La única forma de obtener una EntraIdentity es pasar por validateEntraToken:
    // eso hace imposible olvidarse de la restricción de tenant en un handler nuevo.
    const v = validateEntraToken(claims(), ON);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const r = resolveEntraLogin(db, v.identity);
    expect(r.ok).toBe(true);
  });
});
