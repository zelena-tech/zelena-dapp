/**
 * WP13 · Puerta corporativa: Microsoft Entra ID.
 *
 * Este módulo es el NÚCLEO de la puerta corporativa y no sabe nada de HTTP, de
 * cookies ni de NextAuth: recibe los claims que ya vienen verificados por el
 * proveedor y decide (a) si esa persona puede entrar y (b) a qué fila del registro
 * de contribuidor corresponde. Los handlers de `app/api/auth/**` solo lo invocan
 * (misma regla que lib/onboard.ts y lib/state-machine.ts en CLAUDE.md).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DECISIÓN QUE SOSTIENE LA INTEGRIDAD REFERENCIAL: la PK de `users` NUNCA muta.
 * ─────────────────────────────────────────────────────────────────────────────
 * `users.wallet` es el principal y lo referencian `assignments.owner_wallet`,
 * `assignment_events.actor_wallet`, `checkins.wallet`, `points_ledger.wallet`,
 * `reputation_events.wallet`… Los 6 del roster ya existen con principal
 * `pending:<slug>` (WP14) y ya tienen trabajo colgando de él.
 *
 * Por eso al entrar por Entra NO se crea una fila nueva ni se reescribe la PK: se
 * VINCULA la identidad corporativa a la fila que ya existe (se escriben `entra_oid`,
 * `auth_provider`, `role`, `is_supervisor` y el correo en `user_emails`). El
 * principal sigue siendo `pending:fausto` — un identificador estable y opaco, no un
 * dato personal. Renombrar la PK a `entra:<oid>` rompería en silencio todas esas
 * referencias: eso es exactamente lo que este módulo existe para evitar, y es lo
 * que hace verdadero el criterio 5 ("un mismo humano = UN registro, no dos").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOBRE LA BAJA EN ENTRA (criterio 3) — y por qué no hay Microsoft Graph.
 * ─────────────────────────────────────────────────────────────────────────────
 * En v1 la baja se refleja porque Entra deja de emitir token: sin `id_token` válido
 * no hay claims, y sin claims `validateEntraToken` rechaza (`no_token`). NO hay
 * sincronización de bajas por Graph — está en el NO-ALCANCE de WP13 (fase
 * "automatizar"). Como segunda capa, un principal marcado `status='alumni'` en la
 * base tampoco puede abrir sesión NUEVA por la puerta corporativa; conserva su
 * progreso y su puerta de comunidad (plano 05: "pierde la puerta corporativa, no su
 * progreso"). La sesión ya emitida caduca a 24 h por el TTL de lib/jwt.ts.
 */
import type { DB } from "./db";
import {
  findRosterMember,
  isRole,
  pendingPrincipal,
  type Role,
} from "./roles";

/**
 * Id del provider en NextAuth. Fija la URL de callback
 * `/api/auth/callback/microsoft-entra-id`, que es LITERALMENTE la Redirect URI del
 * paso A1 de docs/DESPLIEGUE-V1.md. No cambiarlo sin actualizar el app registration.
 */
export const ENTRA_PROVIDER_ID = "microsoft-entra-id";

/** Prefijo del principal de quien entra por Entra y NO está en el roster. */
export const ENTRA_PREFIX = "entra:";

export function entraPrincipal(oid: string): string {
  return ENTRA_PREFIX + oid;
}

// ---------------------------------------------------------------------------
// 1. Validación de claims (PURA: sin DB, sin red, sin env)
// ---------------------------------------------------------------------------

/** Claims del `id_token` de Entra que nos importan. Todo opcional: el token es input no confiable. */
export interface EntraTokenClaims {
  /** Tenant id. La restricción de tenant se juega aquí. */
  tid?: unknown;
  /** Object id: identificador estable del usuario DENTRO del tenant. */
  oid?: unknown;
  /** Suele traer el correo corporativo (UPN). */
  preferred_username?: unknown;
  email?: unknown;
  upn?: unknown;
  name?: unknown;
  sub?: unknown;
}

export type EntraRejectionReason =
  | "flag_disabled"
  | "not_configured"
  | "no_token"
  | "foreign_tenant"
  | "guest_account"
  | "foreign_domain"
  | "missing_oid"
  | "missing_email"
  | "account_disabled";

export interface EntraIdentity {
  /** `oid` del token. Identificador opaco, estable ante cambios de correo o nombre. */
  oid: string;
  /** Correo corporativo normalizado a minúsculas. */
  email: string;
  /** Parte local del correo (antes de la @). Se usa para resolver el roster. */
  localPart: string;
  /** Dominio del correo (ya validado contra el corporativo). */
  domain: string;
  /** Nombre visible que trae el token (puede venir vacío). */
  displayName: string;
  tenantId: string;
}

export interface EntraRejection {
  ok: false;
  reason: EntraRejectionReason;
  /** Mensaje para mostrarle a la persona. Explícito y sin jerga. */
  message: string;
}

export type EntraValidation = { ok: true; identity: EntraIdentity } | EntraRejection;

export interface EntraValidationOptions {
  /** Flag `AUTH_ENTRA_ENABLED`. Apagado ⇒ la puerta corporativa no existe. */
  enabled: boolean;
  /** Tenant de Zelena (`AZURE_AD_TENANT_ID`). Vacío ⇒ `not_configured`. */
  tenantId: string;
  /** Dominio corporativo aceptado (`zelena.tech`). */
  corporateDomain: string;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Toma el primer claim no vacío que pueda contener el correo. */
function emailFromClaims(claims: EntraTokenClaims): string {
  return (
    str(claims.preferred_username) || str(claims.email) || str(claims.upn)
  ).toLowerCase();
}

/**
 * Decide si estos claims abren la puerta corporativa. PURA y determinista.
 *
 * El orden de los rechazos no es casual: primero lo que no depende de la persona
 * (flag, configuración, token ausente) y solo después lo que sí, para que el
 * mensaje que ve alguien de otro tenant sea el correcto y no "falta configuración".
 */
export function validateEntraToken(
  claims: EntraTokenClaims | null | undefined,
  opts: EntraValidationOptions
): EntraValidation {
  if (!opts.enabled) {
    return {
      ok: false,
      reason: "flag_disabled",
      message:
        "El acceso con Microsoft todavía no está activo. Entra con tu código de invitación.",
    };
  }
  const tenantId = opts.tenantId.trim();
  if (!tenantId) {
    return {
      ok: false,
      reason: "not_configured",
      message:
        "El acceso con Microsoft no está configurado en este entorno (falta el tenant de Zelena).",
    };
  }
  if (!claims) {
    // Criterio 3: sin token no hay sesión. Es lo que ocurre cuando Entra desactiva
    // la cuenta: deja de emitir token y este camino es el único posible.
    return {
      ok: false,
      reason: "no_token",
      message:
        "Microsoft no entregó una sesión válida. Si tu cuenta fue desactivada, habla con John.",
    };
  }

  const tid = str(claims.tid);
  if (tid !== tenantId) {
    // RESTRICCIÓN DE TENANT (criterio 2). Se compara el `tid` del token, no el
    // dominio del correo: el dominio se puede falsificar en un claim de texto, el
    // `tid` lo firma el emisor del tenant.
    return {
      ok: false,
      reason: "foreign_tenant",
      message:
        "Esa cuenta de Microsoft no pertenece a la organización de Zelena. " +
        "Usa tu correo corporativo @" +
        opts.corporateDomain +
        ", o entra por la puerta de comunidad con un código de invitación.",
    };
  }

  const oid = str(claims.oid) || str(claims.sub);
  if (!oid) {
    return {
      ok: false,
      reason: "missing_oid",
      message: "El token de Microsoft no trae identificador de usuario (oid). No se puede vincular tu cuenta.",
    };
  }

  const email = emailFromClaims(claims);
  if (!email) {
    return {
      ok: false,
      reason: "missing_email",
      message: "El token de Microsoft no trae un correo. Pídele a John que revise el app registration.",
    };
  }
  if (email.includes("#ext#")) {
    // Invitado (B2B) dentro del tenant: su `tid` es el nuestro, pero su identidad
    // vive en otro directorio. La puerta corporativa es para el equipo interno.
    return {
      ok: false,
      reason: "guest_account",
      message:
        "Tu cuenta es invitada en el directorio de Zelena, no una cuenta corporativa. " +
        "Entra por la puerta de comunidad con un código de invitación.",
    };
  }

  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : "";
  const localPart = at >= 0 ? email.slice(0, at) : "";
  const expected = opts.corporateDomain.trim().toLowerCase();
  if (!domain || !localPart || (expected && domain !== expected)) {
    return {
      ok: false,
      reason: "foreign_domain",
      message:
        `El correo ${email} no es del dominio corporativo @${expected}. ` +
        "Entra por la puerta de comunidad con un código de invitación.",
    };
  }

  return {
    ok: true,
    identity: { oid, email, localPart, domain, displayName: str(claims.name), tenantId: tid },
  };
}

// ---------------------------------------------------------------------------
// 2. Resolución de identidad contra el registro (necesita DB)
// ---------------------------------------------------------------------------

export class EntraLinkError extends Error {
  reason: EntraRejectionReason | "oid_conflict" | "email_conflict";
  constructor(reason: EntraLinkError["reason"], message: string) {
    super(message);
    this.name = "EntraLinkError";
    this.reason = reason;
  }
}

/** Cómo se resolvió la identidad. Sirve para el log y para los tests. */
export type EntraLinkMode =
  /** Ya estaba vinculada: se encontró por `entra_oid`. */
  | "existing_oid"
  /** El correo ya estaba en `user_emails` de un principal existente (comunidad → corporativo). */
  | "existing_email"
  /** Persona del roster: se vinculó a su fila `pending:<slug>` sin tocar la PK. */
  | "roster"
  /** Del tenant pero fuera del roster: alta nueva `entra:<oid>` como `core`. */
  | "created";

export interface EntraLogin {
  /** Principal de `users`. Es lo que va en la cookie de sesión. */
  wallet: string;
  name: string;
  tier: string;
  role: Role;
  isSupervisor: boolean;
  claSigned: boolean;
  isDemo: boolean;
  mode: EntraLinkMode;
  /**
   * Falta el segundo correo personal (doc 15 §2). NO bloquea el trabajo diario;
   * la UI muestra un banner persistente y bloquea recibir puntos/pagos.
   */
  needsRecoveryEmail: boolean;
}

export type EntraLoginResult = { ok: true; login: EntraLogin } | EntraRejection;

interface UserRow {
  wallet: string;
  display_name: string;
  tier: string;
  status: string;
  role: string;
  is_supervisor: number;
  is_founder: number;
  cla_signed: number;
  is_demo: number;
  entra_oid: string | null;
}

const USER_COLS = `wallet, display_name, tier, status, role, is_supervisor, is_founder, cla_signed, is_demo, entra_oid`;

function userByWallet(db: DB, wallet: string): UserRow | undefined {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE wallet = ?`).get(wallet) as
    | UserRow
    | undefined;
}

function userByOid(db: DB, oid: string): UserRow | undefined {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE entra_oid = ?`).get(oid) as
    | UserRow
    | undefined;
}

function walletByEmail(db: DB, email: string): string | undefined {
  const row = db.prepare(`SELECT wallet FROM user_emails WHERE email = ?`).get(email) as
    | { wallet: string }
    | undefined;
  return row?.wallet;
}

/**
 * Resuelve a qué miembro del roster corresponde este correo corporativo.
 *
 * Dos vías, en este orden: la parte local del correo (`fausto@zelena.tech`) y el
 * nombre del token (incluido su primer token, porque `name` suele venir con
 * apellidos: "Fausto Pérez" → "Fausto"). `findRosterMember` ya normaliza acentos y
 * caso y conoce los alias del CSV (Ángela/Angela, Vale/Valentina).
 *
 * Ojo: solo se comparan nombres/alias del roster contra datos que la propia persona
 * acaba de autenticar. No se deduce identidad de nadie más.
 */
export function rosterMemberForIdentity(identity: EntraIdentity) {
  const byLocal = findRosterMember(identity.localPart);
  if (byLocal) return byLocal;
  // `juan.perez@zelena.tech` → prueba también con la primera partícula.
  const localHead = identity.localPart.split(/[._-]/)[0] ?? "";
  const byLocalHead = localHead ? findRosterMember(localHead) : undefined;
  if (byLocalHead) return byLocalHead;
  const name = identity.displayName;
  if (!name) return undefined;
  const byName = findRosterMember(name);
  if (byName) return byName;
  const first = name.split(/\s+/)[0] ?? "";
  return first ? findRosterMember(first) : undefined;
}

/** ¿Este principal tiene ya un segundo correo personal vinculado? */
export function hasRecoveryEmail(db: DB, wallet: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM user_emails WHERE wallet = ? AND kind = 'recovery'`)
    .get(wallet) as { n: number };
  return row.n > 0;
}

export interface UserEmailRow {
  email: string;
  kind: "primary" | "recovery";
  is_corporate: number;
  is_verified: number;
}

export function listUserEmails(db: DB, wallet: string): UserEmailRow[] {
  return db
    .prepare(
      `SELECT email, kind, is_corporate, is_verified FROM user_emails WHERE wallet = ? ORDER BY kind, email`
    )
    .all(wallet) as UserEmailRow[];
}

/**
 * Escribe (o repara) el correo corporativo como `primary` del principal.
 * Idempotente: si el correo ya está en la fila correcta no hace nada.
 */
function upsertCorporateEmail(db: DB, wallet: string, email: string): void {
  const owner = walletByEmail(db, email);
  if (owner === wallet) {
    db.prepare(
      `UPDATE user_emails SET kind = 'primary', is_corporate = 1, is_verified = 1 WHERE email = ?`
    ).run(email);
    return;
  }
  if (owner) {
    // El correo pertenece a OTRO principal. Nunca se le quita a su dueño: eso
    // fusionaría dos humanos en silencio. Se falla fuerte y lo resuelve una persona.
    throw new EntraLinkError(
      "email_conflict",
      `El correo ${email} ya está vinculado a otro registro. Habla con John para unificarlos.`
    );
  }
  db.prepare(
    `INSERT INTO user_emails (wallet, email, kind, is_corporate, is_verified) VALUES (?, ?, 'primary', 1, 1)`
  ).run(wallet, email);
}

/**
 * Vincula la identidad corporativa a un principal EXISTENTE sin tocar su PK.
 *
 * Aquí vive la garantía de unicidad de `entra_oid` que el esquema no puede dar
 * (ver la nota en schema.sql: un UNIQUE sobre una columna nullable solo admitiría
 * un NULL en SQL Server). Se comprueba dentro de la misma transacción que hace el
 * UPDATE, así que el chequeo y la escritura no se pueden separar.
 */
function linkEntraIdentity(
  db: DB,
  wallet: string,
  identity: EntraIdentity,
  desired: { role: Role; isSupervisor: boolean } | null
): void {
  const tx = db.transaction(() => {
    const other = userByOid(db, identity.oid);
    if (other && other.wallet !== wallet) {
      throw new EntraLinkError(
        "oid_conflict",
        "Esa cuenta de Microsoft ya está vinculada a otro registro. Habla con John."
      );
    }
    if (desired) {
      db.prepare(
        `UPDATE users SET entra_oid = ?, auth_provider = 'entra', role = ?, is_supervisor = ? WHERE wallet = ?`
      ).run(identity.oid, desired.role, desired.isSupervisor ? 1 : 0, wallet);
    } else {
      // Sin `desired` NO se toca role/is_supervisor: un contribuidor de comunidad
      // que vincula su corporativo no se auto-promueve a `core` por hacerlo.
      db.prepare(
        `UPDATE users SET entra_oid = ?, auth_provider = 'entra' WHERE wallet = ?`
      ).run(identity.oid, wallet);
    }
    upsertCorporateEmail(db, wallet, identity.email);
  });
  tx();
}

/** Alta de alguien del tenant que NO está en el roster: `core`, sin invitación y sin wallet. */
function createEntraUser(db: DB, identity: EntraIdentity): string {
  const wallet = entraPrincipal(identity.oid);
  const tx = db.transaction(() => {
    const other = userByOid(db, identity.oid);
    if (other && other.wallet !== wallet) {
      throw new EntraLinkError(
        "oid_conflict",
        "Esa cuenta de Microsoft ya está vinculada a otro registro. Habla con John."
      );
    }
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor, entra_oid, auth_provider)
       VALUES (?, ?, 'Bronze', NULL, 'active', 0, 0, 0, 'core', 0, ?, 'entra')`
    ).run(wallet, identity.displayName || identity.localPart, identity.oid);
    upsertCorporateEmail(db, wallet, identity.email);
  });
  tx();
  return wallet;
}

function loginFromRow(db: DB, row: UserRow, mode: EntraLinkMode): EntraLogin {
  return {
    wallet: row.wallet,
    name: row.display_name,
    tier: row.tier,
    role: isRole(row.role) ? row.role : row.is_founder ? "founder" : "core",
    isSupervisor: !!row.is_supervisor,
    claSigned: !!row.cla_signed,
    isDemo: !!row.is_demo,
    mode,
    needsRecoveryEmail: !hasRecoveryEmail(db, row.wallet),
  };
}

/**
 * Del token validado a la fila del registro. Cuatro caminos, en orden de certeza
 * decreciente — el primero que acierta manda:
 *
 *  1. `entra_oid` ya vinculado → esa fila. (Login recurrente: el camino normal.)
 *  2. el correo ya está en `user_emails` → ese principal. (La persona ya entró por
 *     la puerta de comunidad: se vincula, no se duplica → criterio 5.)
 *  3. la persona está en el roster → su fila `pending:<slug>` (WP14), con el rol
 *     del plano 07 §5. La PK NO se toca: su trabajo ya cuelga de ese principal.
 *  4. nadie de lo anterior → alta nueva `entra:<oid>` como `core`.
 */
export function resolveEntraLogin(db: DB, identity: EntraIdentity): EntraLoginResult {
  // 1. Ya vinculada.
  const byOid = userByOid(db, identity.oid);
  if (byOid) {
    if (byOid.status !== "active") return alumniRejection();
    // Repara el correo primario si cambió de alias en el tenant.
    upsertCorporateEmail(db, byOid.wallet, identity.email);
    return { ok: true, login: loginFromRow(db, byOid, "existing_oid") };
  }

  // 2. El correo ya pertenece a un principal (puerta de comunidad primero).
  const emailOwner = walletByEmail(db, identity.email);
  if (emailOwner) {
    const row = userByWallet(db, emailOwner);
    if (!row) {
      throw new EntraLinkError(
        "email_conflict",
        `El correo ${identity.email} apunta a un registro que no existe. Habla con John.`
      );
    }
    if (row.status !== "active") return alumniRejection();
    linkEntraIdentity(db, row.wallet, identity, null);
    const fresh = userByWallet(db, row.wallet)!;
    return { ok: true, login: loginFromRow(db, fresh, "existing_email") };
  }

  // 3. Roster: vincular a `pending:<slug>` conservando la PK.
  const member = rosterMemberForIdentity(identity);
  if (member) {
    const principal = pendingPrincipal(member.slug);
    const row = userByWallet(db, principal);
    // GUARDA ANTI-FUSIÓN: si esa fila del roster YA está vinculada a otra cuenta de
    // Microsoft, esta persona no es quien creíamos (p. ej. una "Juana" nueva cuyo
    // nombre empieza igual que el de alguien del roster). Nunca se le roba la
    // identidad a nadie: se cae al camino 4 y se crea un registro propio.
    const alreadyTaken = !!row && !!row.entra_oid && row.entra_oid !== identity.oid;
    if (row && !alreadyTaken) {
      if (row.status !== "active") return alumniRejection();
      // El rol lo manda el plano 07 §5, no el token: John `founder` (+supervisor),
      // Vale `core` Y supervisora, el resto `core`.
      linkEntraIdentity(db, principal, identity, {
        role: member.role,
        isSupervisor: member.isSupervisor,
      });
      const fresh = userByWallet(db, principal)!;
      return { ok: true, login: loginFromRow(db, fresh, "roster") };
    }
    if (!row) {
      // El roster está en lib/roles.ts pero su fila no se sembró todavía: se crea con
      // el principal `pending:<slug>` (NO `entra:<oid>`) para que el importador de CSV
      // de WP14 siga resolviendo al mismo sitio.
      const tx = db.transaction(() => {
        db.prepare(
          `INSERT INTO users (wallet, display_name, tier, invited_by, status, is_demo, is_founder, cla_signed, role, is_supervisor, entra_oid, auth_provider)
           VALUES (?, ?, 'Bronze', NULL, 'active', 0, 0, 0, ?, ?, ?, 'entra')`
        ).run(principal, member.name, member.role, member.isSupervisor ? 1 : 0, identity.oid);
        upsertCorporateEmail(db, principal, identity.email);
      });
      tx();
      const fresh = userByWallet(db, principal)!;
      return { ok: true, login: loginFromRow(db, fresh, "roster") };
    }
  }

  // 4. Del tenant, fuera del roster: alta `core` sin consumir invitación ni wallet.
  const wallet = createEntraUser(db, identity);
  const fresh = userByWallet(db, wallet)!;
  return { ok: true, login: loginFromRow(db, fresh, "created") };
}

function alumniRejection(): EntraRejection {
  return {
    ok: false,
    reason: "account_disabled",
    message:
      "Tu acceso corporativo está cerrado. Tu historial y tus puntos siguen siendo tuyos: " +
      "entra por la puerta de comunidad con tu correo personal.",
  };
}

/** Validación + resolución en un paso. Es lo que llama el endpoint de intercambio. */
export function entraLogin(
  db: DB,
  claims: EntraTokenClaims | null | undefined,
  opts: EntraValidationOptions
): EntraLoginResult {
  const check = validateEntraToken(claims, opts);
  if (!check.ok) return check;
  return resolveEntraLogin(db, check.identity);
}

// ---------------------------------------------------------------------------
// 3. Segundo correo personal (doc 15 §2)
// ---------------------------------------------------------------------------

/** Forma mínima y conservadora de correo. No valida existencia: eso es otra fase. */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email);
}

export type RecoveryEmailResult =
  | { ok: true; email: string }
  | { ok: false; message: string };

/**
 * Vincula el segundo correo PERSONAL (`recovery`).
 *
 * Se rechaza un correo del dominio corporativo: moriría con la baja y dejaría a la
 * persona sin manera de recuperar su registro — el escenario exacto que este correo
 * existe para evitar (plano 05: "pierde la puerta corporativa, no su progreso").
 */
export function linkRecoveryEmail(
  db: DB,
  wallet: string,
  rawEmail: string,
  corporateDomain: string
): RecoveryEmailResult {
  const email = rawEmail.trim().toLowerCase();
  if (!isPlausibleEmail(email)) {
    return { ok: false, message: "Ese correo no tiene un formato válido." };
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (domain === corporateDomain.trim().toLowerCase()) {
    return {
      ok: false,
      message:
        `El segundo correo tiene que ser personal, no @${corporateDomain}: ` +
        "es el que te deja seguir entrando si algún día sales de la organización.",
    };
  }
  if (!userByWallet(db, wallet)) {
    return { ok: false, message: "No encontramos tu registro." };
  }
  const owner = walletByEmail(db, email);
  if (owner && owner !== wallet) {
    return {
      ok: false,
      message: "Ese correo ya está vinculado a otro registro. Usa otro o habla con John.",
    };
  }
  const tx = db.transaction(() => {
    if (owner === wallet) {
      db.prepare(
        `UPDATE user_emails SET kind = 'recovery', is_corporate = 0 WHERE email = ?`
      ).run(email);
    } else {
      db.prepare(
        `INSERT INTO user_emails (wallet, email, kind, is_corporate, is_verified) VALUES (?, ?, 'recovery', 0, 0)`
      ).run(wallet, email);
    }
  });
  tx();
  return { ok: true, email };
}

/**
 * ¿Puede este principal RECIBIR puntos o pagos?
 *
 * Doc 15 §2: para el core el segundo correo es obligatorio y su ausencia bloquea
 * cobrar — nunca el trabajo diario. Nótese que esto NO confisca nada (doc 16): los
 * puntos ya ganados siguen ahí; lo único que se pospone es acreditar nuevos.
 */
export function payoutBlockers(db: DB, wallet: string): string[] {
  const row = userByWallet(db, wallet);
  if (!row) return ["No encontramos tu registro."];
  const blockers: string[] = [];
  if (!row.cla_signed) blockers.push("Falta firmar el CLA.");
  if (!hasRecoveryEmail(db, wallet)) {
    blockers.push("Falta vincular tu segundo correo personal.");
  }
  return blockers;
}
