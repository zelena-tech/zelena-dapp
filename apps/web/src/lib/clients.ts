/**
 * WP17 · Entornos por cliente. La participación define el permiso.
 *
 * REGLA INVIOLABLE: esta capa jamás almacena secretos. El inventario guarda
 * DÓNDE vive la credencial y QUIÉN responde por ella, nunca su valor.
 * `auditSchemaForSecretColumns()` convierte esa promesa en un test, para que
 * la verificación del PR no dependa de que alguien se acuerde de mirar.
 */
import type { DB } from "./db";

export const ACCESS_LEVELS = ["lead", "colaborador", "lectura"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const CLIENT_STATUSES = ["activo", "pausado", "prospecto"] as const;
export const CREDENTIAL_TYPES = ["nube", "servidor", "api", "db", "otro"] as const;
export const BRAND_KINDS = ["logo", "color", "tipografia", "guia"] as const;

/** Jerarquía de permisos. Mayor número = puede más. */
const RANK: Record<AccessLevel, number> = { lectura: 1, colaborador: 2, lead: 3 };

export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientError";
  }
}

/**
 * Se lanza cuando quien pide no tiene derecho. La vista la traduce a 404,
 * NUNCA a 403: revelar que un cliente existe ya es filtrar información.
 */
export class ClientAccessError extends Error {
  constructor(message = "No autorizado.") {
    super(message);
    this.name = "ClientAccessError";
  }
}

export interface Actor {
  wallet: string;
  isFounder: boolean;
}

export interface ClientRow {
  id: number;
  slug: string;
  name: string;
  status: string;
  industry: string | null;
  notes: string | null;
  createdAt: string;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function req(value: string | undefined | null, field: string): string {
  const v = (value ?? "").trim();
  if (v.length < 2) throw new ClientError(`Campo obligatorio: ${field}.`);
  return v;
}

// ─── Clientes ────────────────────────────────────────────────────────────

export function createClient(
  db: DB,
  input: { name: string; slug?: string; status?: string; industry?: string; notes?: string }
): number {
  const name = req(input.name, "nombre");
  const slug = slugify(input.slug ?? name);
  if (!slug) throw new ClientError("Slug inválido.");
  const status = input.status ?? "prospecto";
  if (!(CLIENT_STATUSES as readonly string[]).includes(status)) {
    throw new ClientError(`Estado inválido: ${status}.`);
  }
  const info = db
    .prepare(`INSERT INTO clients (slug, name, status, industry, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(slug, name, status, input.industry ?? null, input.notes ?? null);
  return info.lastInsertRowid as number;
}

function mapClient(r: Record<string, unknown>): ClientRow {
  return {
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    status: r.status as string,
    industry: (r.industry as string) ?? null,
    notes: (r.notes as string) ?? null,
    createdAt: r.created_at as string,
  };
}

/** Solo los clientes donde el actor participa. `founder` ve todos. */
export function listClientsFor(db: DB, actor: Actor): ClientRow[] {
  const rows = actor.isFounder
    ? (db.prepare(`SELECT * FROM clients ORDER BY name`).all() as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT c.* FROM clients c
             JOIN client_members m ON m.client_id = c.id
            WHERE m.wallet = ?
            ORDER BY c.name`
        )
        .all(actor.wallet) as Array<Record<string, unknown>>);
  return rows.map(mapClient);
}

/** Nivel de acceso efectivo, o null si no participa. `founder` es lead siempre. */
export function accessLevelFor(db: DB, clientId: number, actor: Actor): AccessLevel | null {
  if (actor.isFounder) return "lead";
  const r = db
    .prepare(`SELECT access_level FROM client_members WHERE client_id = ? AND wallet = ?`)
    .get(clientId, actor.wallet) as { access_level: AccessLevel } | undefined;
  return r?.access_level ?? null;
}

export function hasAtLeast(level: AccessLevel | null, required: AccessLevel): boolean {
  return level !== null && RANK[level] >= RANK[required];
}

/**
 * Cliente por slug SOLO si el actor participa. Devuelve null cuando no —
 * la vista responde 404 y el cliente no se revela.
 */
export function getClientForActor(db: DB, slug: string, actor: Actor): ClientRow | null {
  const row = db.prepare(`SELECT * FROM clients WHERE slug = ?`).get(slug) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const client = mapClient(row);
  if (accessLevelFor(db, client.id, actor) === null) return null;
  return client;
}

// ─── Miembros ────────────────────────────────────────────────────────────

export function addMember(db: DB, clientId: number, wallet: string, level: AccessLevel): void {
  if (!(ACCESS_LEVELS as readonly string[]).includes(level)) {
    throw new ClientError(`Nivel de acceso inválido: ${level}.`);
  }
  db.prepare(
    `INSERT INTO client_members (client_id, wallet, access_level) VALUES (?, ?, ?)
     ON CONFLICT (client_id, wallet) DO UPDATE SET access_level = excluded.access_level`
  ).run(clientId, wallet, level);
}

export function removeMember(db: DB, clientId: number, wallet: string): void {
  db.prepare(`DELETE FROM client_members WHERE client_id = ? AND wallet = ?`).run(clientId, wallet);
}

export interface MemberRow {
  wallet: string;
  displayName: string;
  accessLevel: AccessLevel;
}

export function listMembers(db: DB, clientId: number): MemberRow[] {
  const rows = db
    .prepare(
      `SELECT m.wallet, m.access_level, u.display_name
         FROM client_members m
         LEFT JOIN users u ON u.wallet = m.wallet
        WHERE m.client_id = ?
        ORDER BY m.access_level, u.display_name`
    )
    .all(clientId) as Array<{ wallet: string; access_level: AccessLevel; display_name: string | null }>;
  return rows.map((r) => ({
    wallet: r.wallet,
    displayName: r.display_name ?? r.wallet,
    accessLevel: r.access_level,
  }));
}

// ─── Marca ───────────────────────────────────────────────────────────────

export interface BrandAsset {
  id: number;
  kind: string;
  label: string;
  value: string | null;
  fileUrl: string | null;
  notes: string | null;
}

export function addBrandAsset(
  db: DB,
  clientId: number,
  input: { kind: string; label: string; value?: string; fileUrl?: string; notes?: string; ord?: number }
): number {
  if (!(BRAND_KINDS as readonly string[]).includes(input.kind)) {
    throw new ClientError(`Tipo de activo de marca inválido: ${input.kind}.`);
  }
  const info = db
    .prepare(
      `INSERT INTO brand_assets (client_id, kind, label, value, file_url, notes, ord)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      clientId,
      input.kind,
      req(input.label, "etiqueta"),
      input.value ?? null,
      input.fileUrl ?? null,
      input.notes ?? null,
      input.ord ?? 0
    );
  return info.lastInsertRowid as number;
}

/** La marca la ve cualquier miembro, incluida `lectura`. */
export function listBrandAssets(db: DB, clientId: number, actor: Actor): BrandAsset[] {
  if (accessLevelFor(db, clientId, actor) === null) throw new ClientAccessError();
  const rows = db
    .prepare(`SELECT id, kind, label, value, file_url, notes FROM brand_assets WHERE client_id = ? ORDER BY ord, id`)
    .all(clientId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    kind: r.kind as string,
    label: r.label as string,
    value: (r.value as string) ?? null,
    fileUrl: (r.file_url as string) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

// ─── Inventario de credenciales ──────────────────────────────────────────

/** Patrones que delatan un secreto guardado por error en un campo de texto. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9]{20,}/, "clave de API tipo OpenAI"],
  [/\bshp(at|ss)_[a-f0-9]{32}/, "token de Shopify"],
  [/\bghp_[A-Za-z0-9]{36}/, "token de GitHub"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "token de Slack"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "llave privada"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
  [/:\/\/[^/\s:@]+:[^/\s:@]{6,}@/, "credencial embebida en una URL"],
];

export function findSecretLike(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [re, label] of SECRET_PATTERNS) if (re.test(text)) return label;
  return null;
}

export interface CredentialInput {
  name: string;
  type: string;
  location: string;
  ownerWallet?: string;
  scope?: string;
  rotatedAt?: string;
  expiresAt?: string;
  notes?: string;
}

/**
 * Registra DÓNDE vive una credencial. Si alguien intenta pegar el secreto en
 * cualquier campo de texto, se rechaza la escritura. Prevención, no confianza.
 */
export function addCredential(db: DB, clientId: number, input: CredentialInput, actor: Actor): number {
  const level = accessLevelFor(db, clientId, actor);
  if (!hasAtLeast(level, "lead")) throw new ClientAccessError("Solo un lead gestiona el inventario.");
  if (!(CREDENTIAL_TYPES as readonly string[]).includes(input.type)) {
    throw new ClientError(`Tipo de credencial inválido: ${input.type}.`);
  }
  for (const [field, value] of Object.entries({
    location: input.location,
    scope: input.scope,
    notes: input.notes,
    name: input.name,
  })) {
    const hit = findSecretLike(value);
    if (hit) {
      throw new ClientError(
        `El campo '${field}' parece contener un secreto (${hit}). ` +
          `El inventario guarda dónde vive la credencial, jamás su valor.`
      );
    }
  }
  const info = db
    .prepare(
      `INSERT INTO credential_inventory
        (client_id, name, type, location, owner_wallet, scope, rotated_at, expires_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      clientId,
      req(input.name, "nombre"),
      input.type,
      req(input.location, "ubicación"),
      input.ownerWallet ?? null,
      input.scope ?? null,
      input.rotatedAt ?? null,
      input.expiresAt ?? null,
      input.notes ?? null
    );
  return info.lastInsertRowid as number;
}

export interface CredentialRow {
  id: number;
  name: string;
  type: string;
  location: string;
  ownerWallet: string | null;
  scope: string | null;
  rotatedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
}

/**
 * Inventario. `lectura` NO puede verlo: saber dónde está una credencial ya es
 * información sensible. Toda consulta queda registrada.
 */
export function listCredentials(db: DB, clientId: number, actor: Actor): CredentialRow[] {
  const level = accessLevelFor(db, clientId, actor);
  if (level === null) throw new ClientAccessError();
  if (!hasAtLeast(level, "colaborador")) {
    throw new ClientAccessError("El nivel 'lectura' no accede al inventario de credenciales.");
  }
  db.prepare(
    `INSERT INTO credential_access_log (client_id, credential_id, wallet, action) VALUES (?, NULL, ?, 'list')`
  ).run(clientId, actor.wallet);
  const rows = db
    .prepare(
      `SELECT id, name, type, location, owner_wallet, scope, rotated_at, expires_at, notes
         FROM credential_inventory WHERE client_id = ? ORDER BY type, name`
    )
    .all(clientId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    type: r.type as string,
    location: r.location as string,
    ownerWallet: (r.owner_wallet as string) ?? null,
    scope: (r.scope as string) ?? null,
    rotatedAt: (r.rotated_at as string) ?? null,
    expiresAt: (r.expires_at as string) ?? null,
    notes: (r.notes as string) ?? null,
  }));
}

export function credentialAccessLog(db: DB, clientId: number) {
  return db
    .prepare(
      `SELECT wallet, credential_id, action, created_at
         FROM credential_access_log WHERE client_id = ? ORDER BY id DESC LIMIT 200`
    )
    .all(clientId) as Array<{ wallet: string; credential_id: number | null; action: string; created_at: string }>;
}

// ─── Verificación automatizada de la promesa ─────────────────────────────

/**
 * Excepciones conocidas y justificadas. Se listan una por una, con motivo:
 * una allowlist explícita mantiene el auditor estricto y deja rastro de por
 * qué cada excepción es aceptable. Si alguien añade una columna nueva de
 * secreto, el test falla — que es exactamente lo que queremos.
 */
export const EXCEPCIONES_AUDITORIA: Record<string, string> = {
  // Handle de sesión de lectura de Academia (WP-academia). Lo emite el propio
  // servidor, es efímero, es la PK de su tabla y no es credencial de ningún
  // cliente. Su fuga solo permitiría continuar una sesión de lectura ajena.
  "reading_sessions.token": "handle de sesión interno, efímero, sin valor fuera de la app",
};

/**
 * Recorre el DDL buscando columnas que podrían almacenar un secreto.
 * Convierte el criterio de aceptación "grep del esquema: cero campos que
 * almacenen secretos" en una verificación que corre sola en CI.
 *
 * Devuelve la lista de columnas sospechosas. Vacío = promesa cumplida.
 */
export function auditSchemaForSecretColumns(
  schemaSql: string,
  excepciones: Record<string, string> = EXCEPCIONES_AUDITORIA
): string[] {
  const sospechosas =
    /\b(password|passwd|secret|token|api_?key|private_?key|credential_value|secret_value|access_key|client_secret)\b/i;
  // Palabras que hacen legítimo el nombre (son referencias, no valores).
  const permitidas = /(_ref|_location|_hint|_name|_id|_at|_log|reference)\b/i;

  const hallazgos: string[] = [];
  let tabla = "";
  for (const raw of schemaSql.split("\n")) {
    const line = raw.trim();
    const t = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/i);
    if (t) {
      tabla = t[1];
      continue;
    }
    if (!tabla || line.startsWith("--") || line.startsWith(")")) continue;
    const col = line.match(/^([A-Za-z0-9_]+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)/i);
    if (!col) continue;
    const nombre = col[1];
    const clave = `${tabla}.${nombre}`;
    if (sospechosas.test(nombre) && !permitidas.test(nombre) && !(clave in excepciones)) {
      hallazgos.push(clave);
    }
  }
  return hallazgos;
}
