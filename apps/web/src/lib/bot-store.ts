/**
 * Persistencia del asistente de Telegram (WP19): identidad, borradores, notas y log.
 *
 * Reglas que este archivo hace cumplir:
 *  - IDENTIDAD POR VINCULACIÓN. La PK de `users` (`wallet`) nunca muta (regla
 *    heredada de WP13): `telegram_links` apunta a ese principal, no lo reescribe.
 *  - El código de alta es de UN SOLO USO y se guarda HASHEADO. La dapp muestra el
 *    texto plano una vez; la base solo conserva con qué comparar. Cero secretos.
 *  - v1 = SOLO JOHN escribe. La autorización de escritura es una sola fila
 *    (`is_authorized = 1`) y se concede únicamente al founder; cualquier otra
 *    persona vinculada queda en solo lectura. `authorizeWrite` es el punto único.
 *  - NADA SE CREA SIN CONFIRMACIÓN. La pieza propuesta vive en `bot_drafts` hasta
 *    que John confirma; este módulo no escribe en `assignments` ni en `checkins`.
 *  - Minimización: los borradores guardan la pieza YA ESTRUCTURADA y el log guarda
 *    qué se hizo. El mensaje crudo y el audio no se persisten en ningún campo.
 *
 * Todas las funciones reciben la `DB` explícitamente (mismo patrón que lib/team.ts).
 */
import { randomBytes } from "node:crypto";
import type { DB } from "./db";
import { sha256Hex } from "./crypto.ts";
import { TEAM_ROSTER, pendingPrincipal } from "./roles.ts";

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export interface TelegramLinkRow {
  id: number;
  wallet: string;
  telegram_user_id: string | null;
  link_code_hash: string | null;
  code_expires_at: string | null;
  is_authorized: number;
  linked_at: string | null;
  created_at: string;
}

export interface NoteRow {
  id: number;
  author: string;
  text: string;
  meeting_ref: string | null;
  created_at: string;
}

export type DraftStatus = "pendiente" | "confirmado" | "descartado";

export interface BotDraftRow {
  id: number;
  wallet: string;
  tool: string;
  payload_json: string;
  status: DraftStatus;
  created_at: string;
  resolved_at: string | null;
}

export type BotOutcome = "ok" | "rechazado" | "ignorado" | "no_entendido" | "error";

export interface BotActionRow {
  id: number;
  wallet: string | null;
  sender_ref: string | null;
  action: string;
  outcome: BotOutcome;
  target: string | null;
  detail: string | null;
  created_at: string;
}

export class BotStoreError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BotStoreError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Código de alta
// ---------------------------------------------------------------------------

/**
 * Minutos que vive el código de alta. Es un detalle operativo de seguridad —como
 * `CLA_VERSION`—, no un parámetro evolutivo del sistema: no va al genoma. El
 * genoma versiona los números que mutan por época.
 */
export const LINK_CODE_TTL_MINUTES = 30;

export const LINK_CODE_PREFIX = "ZBOT-";

export function generateLinkCode(): string {
  return LINK_CODE_PREFIX + randomBytes(5).toString("hex").toUpperCase();
}

/** Normaliza lo que escribe una persona: mayúsculas, sin espacios sobrantes. */
export function normalizeLinkCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function hashLinkCode(code: string): string {
  return sha256Hex(normalizeLinkCode(code));
}

function isoPlusMinutes(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Autorización de escritura (v1: solo John)
// ---------------------------------------------------------------------------

/**
 * ¿Esta wallet puede tener permiso de ESCRITURA por Telegram en v1?
 *
 * Solo el founder, y solo si no hay ya otra vinculación autorizada. Es
 * deliberadamente más estrecho que `puedeVerTodoElEquipo`: Vale es supervisora y
 * ve todo el tablero en la web, pero el bot de v1 es el asistente personal de John
 * (que el equipo cree tareas por bot es fase v2 y NO-alcance aquí).
 */
export function canAuthorizeWrite(db: DB, wallet: string): boolean {
  const user = db.prepare(`SELECT role, is_founder FROM users WHERE wallet = ?`).get(wallet) as
    | { role: string | null; is_founder: number }
    | undefined;
  if (!user) return false;
  const esFounder = user.role === "founder" || user.is_founder === 1;
  if (!esFounder) return false;
  const otra = db
    .prepare(`SELECT COUNT(*) AS n FROM telegram_links WHERE is_authorized = 1 AND wallet <> ?`)
    .get(wallet) as { n: number };
  return otra.n === 0;
}

/**
 * Identidad de EQUIPO del founder, que es a la que se vincula el bot.
 *
 * Por qué no basta la wallet de la sesión: el trabajo de John vive bajo su fila del
 * roster (`pending:john`, WP14) y ahí lo dejará también el login de Entra (WP13
 * vincula la identidad a esa fila SIN mutar la PK). La sesión de la puerta de
 * invitación, en cambio, trae la wallet demo del founder. Si el bot se colgara de
 * esa, `/pendientes` saldría vacío aunque el tablero esté lleno.
 *
 * El founder sale del roster (lib/roles.ts), no de un literal. Si esa fila no
 * existiera, se cae a la wallet de la sesión: nunca se inventa una identidad.
 */
export function founderTeamWallet(db: DB, sessionWallet: string): string {
  const founder = TEAM_ROSTER.find((m) => m.role === "founder");
  if (!founder) return sessionWallet;
  const principal = pendingPrincipal(founder.slug);
  const row = db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(principal) as
    | { wallet: string }
    | undefined;
  return row ? row.wallet : sessionWallet;
}

export function authorizedLinkCount(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM telegram_links WHERE is_authorized = 1`).get() as { n: number }).n;
}

// ---------------------------------------------------------------------------
// Alta y vinculación
// ---------------------------------------------------------------------------

export interface IssuedLinkCode {
  /** Texto plano. Se muestra UNA vez en la dapp; la base solo guarda su hash. */
  code: string;
  expiresAt: string;
  /** Si al consumirse quedará con permiso de escritura (v1: solo John). */
  willAuthorizeWrite: boolean;
}

/**
 * Emite un código de un solo uso para una wallet. Idempotente por wallet: emitir
 * de nuevo reemplaza el código pendiente anterior (el viejo deja de servir).
 *
 * Si la wallet ya está vinculada, lanza: primero hay que desvincular. Nunca se
 * pisa un `telegram_user_id` existente.
 */
export function issueLinkCode(db: DB, wallet: string, now: Date = new Date()): IssuedLinkCode {
  const user = db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(wallet) as { wallet: string } | undefined;
  if (!user) throw new BotStoreError(404, "Esa cuenta no existe en la dapp.");

  const existing = linkForWallet(db, wallet);
  if (existing && existing.telegram_user_id) {
    throw new BotStoreError(409, "Esa cuenta ya tiene Telegram vinculado.");
  }

  const code = generateLinkCode();
  const expiresAt = isoPlusMinutes(now, LINK_CODE_TTL_MINUTES);
  const willAuthorize = canAuthorizeWrite(db, wallet);

  if (existing) {
    db.prepare(
      `UPDATE telegram_links SET link_code_hash = ?, code_expires_at = ?, is_authorized = ? WHERE id = ?`
    ).run(hashLinkCode(code), expiresAt, willAuthorize ? 1 : 0, existing.id);
  } else {
    db.prepare(
      `INSERT INTO telegram_links (wallet, telegram_user_id, link_code_hash, code_expires_at, is_authorized, linked_at)
       VALUES (?, NULL, ?, ?, ?, NULL)`
    ).run(wallet, hashLinkCode(code), expiresAt, willAuthorize ? 1 : 0);
  }
  return { code, expiresAt, willAuthorizeWrite: willAuthorize };
}

export function linkForWallet(db: DB, wallet: string): TelegramLinkRow | undefined {
  return db.prepare(`SELECT * FROM telegram_links WHERE wallet = ?`).get(wallet) as TelegramLinkRow | undefined;
}

export function linkForTelegramUser(db: DB, telegramUserId: string): TelegramLinkRow | undefined {
  return db.prepare(`SELECT * FROM telegram_links WHERE telegram_user_id = ?`).get(telegramUserId) as
    | TelegramLinkRow
    | undefined;
}

export type ConsumeRejection = "codigo_invalido" | "codigo_vencido" | "telegram_ya_vinculado";

export type ConsumeResult = { ok: true; link: TelegramLinkRow } | { ok: false; reason: ConsumeRejection };

/**
 * Consume el código: completa el vínculo y BORRA el hash (un solo uso).
 * No dice nunca a qué cuenta pertenecía un código que no cuadra.
 */
export function consumeLinkCode(
  db: DB,
  code: string,
  telegramUserId: string,
  now: Date = new Date()
): ConsumeResult {
  if (linkForTelegramUser(db, telegramUserId)) return { ok: false, reason: "telegram_ya_vinculado" };

  const row = db.prepare(`SELECT * FROM telegram_links WHERE link_code_hash = ?`).get(hashLinkCode(code)) as
    | TelegramLinkRow
    | undefined;
  if (!row || row.telegram_user_id) return { ok: false, reason: "codigo_invalido" };
  if (!row.code_expires_at || row.code_expires_at <= now.toISOString()) {
    return { ok: false, reason: "codigo_vencido" };
  }

  db.prepare(
    `UPDATE telegram_links SET telegram_user_id = ?, link_code_hash = NULL, code_expires_at = NULL, linked_at = ? WHERE id = ?`
  ).run(telegramUserId, now.toISOString(), row.id);

  return { ok: true, link: db.prepare(`SELECT * FROM telegram_links WHERE id = ?`).get(row.id) as TelegramLinkRow };
}

/** Desvincula sin borrar la fila de `users`: la wallet sigue siendo la misma. */
export function unlinkTelegram(db: DB, wallet: string): void {
  db.prepare(
    `UPDATE telegram_links SET telegram_user_id = NULL, link_code_hash = NULL, code_expires_at = NULL, linked_at = NULL WHERE wallet = ?`
  ).run(wallet);
}

// ---------------------------------------------------------------------------
// Borradores (el candado del "nada sin confirmación")
// ---------------------------------------------------------------------------

export function createDraft(db: DB, wallet: string, tool: string, payload: unknown): number {
  const info = db
    .prepare(`INSERT INTO bot_drafts (wallet, tool, payload_json, status) VALUES (?, ?, ?, 'pendiente')`)
    .run(wallet, tool, JSON.stringify(payload ?? {}));
  return Number(info.lastInsertRowid);
}

export function getDraft(db: DB, id: number): BotDraftRow | undefined {
  return db.prepare(`SELECT * FROM bot_drafts WHERE id = ?`).get(id) as BotDraftRow | undefined;
}

export function draftPayload<T>(row: BotDraftRow): T {
  return JSON.parse(row.payload_json) as T;
}

export function pendingDrafts(db: DB, wallet: string): BotDraftRow[] {
  return db
    .prepare(`SELECT * FROM bot_drafts WHERE wallet = ? AND status = 'pendiente' ORDER BY id`)
    .all(wallet) as BotDraftRow[];
}

/** Marca el borrador como resuelto. Devuelve false si ya lo estaba (idempotencia). */
export function resolveDraft(db: DB, id: number, status: Exclude<DraftStatus, "pendiente">, now: Date = new Date()): boolean {
  const info = db
    .prepare(`UPDATE bot_drafts SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pendiente'`)
    .run(status, now.toISOString(), id);
  return Number(info.changes) > 0;
}

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------

export interface SaveNoteInput {
  author: string;
  text: string;
  meetingRef?: string | null;
}

export function saveNote(db: DB, input: SaveNoteInput): NoteRow {
  const text = input.text.trim();
  if (!text) throw new BotStoreError(400, "La nota necesita texto.");
  const info = db
    .prepare(`INSERT INTO notes (author, text, meeting_ref) VALUES (?, ?, ?)`)
    .run(input.author, text, input.meetingRef?.trim() || null);
  return db.prepare(`SELECT * FROM notes WHERE id = ?`).get(Number(info.lastInsertRowid)) as NoteRow;
}

export function listNotes(db: DB, author: string, limit = 20): NoteRow[] {
  return db
    .prepare(`SELECT * FROM notes WHERE author = ? ORDER BY id DESC LIMIT ?`)
    .all(author, limit) as NoteRow[];
}

// ---------------------------------------------------------------------------
// Log (visible en admin)
// ---------------------------------------------------------------------------

export interface LogEntry {
  wallet?: string | null;
  /** Solo para remitentes NO registrados: el mínimo para diagnosticar. Sin contenido. */
  senderRef?: string | null;
  action: string;
  outcome: BotOutcome;
  target?: string | null;
  detail?: string | null;
}

export function logBotAction(db: DB, entry: LogEntry): void {
  db.prepare(
    `INSERT INTO bot_actions (wallet, sender_ref, action, outcome, target, detail) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    entry.wallet ?? null,
    entry.senderRef ?? null,
    entry.action,
    entry.outcome,
    entry.target ?? null,
    entry.detail ?? null
  );
}

export function listBotActions(db: DB, limit = 50): BotActionRow[] {
  return db.prepare(`SELECT * FROM bot_actions ORDER BY id DESC LIMIT ?`).all(limit) as BotActionRow[];
}

export function countBotActions(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM bot_actions`).get() as { n: number }).n;
}
