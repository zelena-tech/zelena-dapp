/**
 * WP19 — identidad, borradores, notas y log.
 *
 * Criterios que cubre:
 *  - Alta con código de UN SOLO USO: se consume, vence y se guarda hasheado.
 *  - v1 = solo John: una única vinculación con permiso de escritura.
 *  - Cero secretos en la base: ni el código en claro, ni tokens, ni API keys.
 *  - La wallet (PK de `users`) nunca muta: se vincula, no se reescribe (WP13).
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { openDb, type DB } from "./db";
import { pendingPrincipal } from "./roles";
import { seedTeam } from "./team";
import {
  BotStoreError,
  LINK_CODE_PREFIX,
  authorizedLinkCount,
  canAuthorizeWrite,
  consumeLinkCode,
  createDraft,
  draftPayload,
  founderTeamWallet,
  getDraft,
  hashLinkCode,
  issueLinkCode,
  linkForTelegramUser,
  linkForWallet,
  listBotActions,
  listNotes,
  logBotAction,
  pendingDrafts,
  resolveDraft,
  saveNote,
  unlinkTelegram,
} from "./bot-store";

const JOHN = pendingPrincipal("john");
const VALE = pendingPrincipal("vale");
const DAVID = pendingPrincipal("david");

const AHORA = new Date(2026, 6, 30, 9, 0, 0);

function freshDb(): DB {
  const db = openDb(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  seedTeam(db);
  return db;
}

describe("alta con código de un solo uso", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("emite un código legible y guarda solo su hash (cero secretos en la base)", () => {
    const emitido = issueLinkCode(db, JOHN, AHORA);
    expect(emitido.code.startsWith(LINK_CODE_PREFIX)).toBe(true);

    const fila = linkForWallet(db, JOHN)!;
    expect(fila.link_code_hash).toBe(hashLinkCode(emitido.code));
    expect(fila.link_code_hash).not.toContain(emitido.code.replace(LINK_CODE_PREFIX, ""));
    expect(fila.telegram_user_id).toBeNull();
    expect(fila.linked_at).toBeNull();

    // Ninguna columna de la tabla guarda el código en claro.
    const volcado = JSON.stringify(db.prepare(`SELECT * FROM telegram_links`).all());
    expect(volcado).not.toContain(emitido.code);
  });

  it("el código se consume una sola vez y vincula el telegram_user_id", () => {
    const { code } = issueLinkCode(db, JOHN, AHORA);
    const primero = consumeLinkCode(db, code, "42", AHORA);
    expect(primero.ok).toBe(true);

    const fila = linkForTelegramUser(db, "42")!;
    expect(fila.wallet).toBe(JOHN);
    expect(fila.link_code_hash).toBeNull(); // gastado
    expect(fila.linked_at).not.toBeNull();

    // El mismo código con otro id ya no sirve.
    const segundo = consumeLinkCode(db, code, "99", AHORA);
    expect(segundo).toEqual({ ok: false, reason: "codigo_invalido" });
    expect(linkForTelegramUser(db, "99")).toBeUndefined();
  });

  it("acepta el código con espacios y en minúsculas (lo que escribe una persona)", () => {
    const { code } = issueLinkCode(db, JOHN, AHORA);
    const res = consumeLinkCode(db, `  ${code.toLowerCase()} `, "42", AHORA);
    expect(res.ok).toBe(true);
  });

  it("un código vencido no vincula", () => {
    const { code } = issueLinkCode(db, JOHN, AHORA);
    const tarde = new Date(AHORA.getTime() + 61 * 60_000);
    expect(consumeLinkCode(db, code, "42", tarde)).toEqual({ ok: false, reason: "codigo_vencido" });
    expect(linkForTelegramUser(db, "42")).toBeUndefined();
  });

  it("emitir de nuevo invalida el código anterior", () => {
    const viejo = issueLinkCode(db, JOHN, AHORA).code;
    const nuevo = issueLinkCode(db, JOHN, AHORA).code;
    expect(consumeLinkCode(db, viejo, "42", AHORA)).toEqual({ ok: false, reason: "codigo_invalido" });
    expect(consumeLinkCode(db, nuevo, "42", AHORA).ok).toBe(true);
  });

  it("un telegram_user_id ya vinculado no se puede reasignar a otra wallet", () => {
    consumeLinkCode(db, issueLinkCode(db, JOHN, AHORA).code, "42", AHORA);
    const deVale = issueLinkCode(db, VALE, AHORA).code;
    expect(consumeLinkCode(db, deVale, "42", AHORA)).toEqual({ ok: false, reason: "telegram_ya_vinculado" });
    expect(linkForTelegramUser(db, "42")!.wallet).toBe(JOHN);
  });

  it("no emite código para una cuenta ya vinculada ni para una que no existe", () => {
    consumeLinkCode(db, issueLinkCode(db, JOHN, AHORA).code, "42", AHORA);
    expect(() => issueLinkCode(db, JOHN, AHORA)).toThrow(BotStoreError);
    expect(() => issueLinkCode(db, "GNOEXISTE0001", AHORA)).toThrow(BotStoreError);
  });

  it("la wallet NUNCA muta: desvincular deja intacta la PK de users", () => {
    consumeLinkCode(db, issueLinkCode(db, JOHN, AHORA).code, "42", AHORA);
    unlinkTelegram(db, JOHN);
    expect(linkForTelegramUser(db, "42")).toBeUndefined();
    expect(linkForWallet(db, JOHN)!.wallet).toBe(JOHN);
    expect(db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(JOHN)).toEqual({ wallet: JOHN });
  });
});

describe("v1 = solo John escribe", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("solo el founder puede quedar autorizado a escribir", () => {
    expect(canAuthorizeWrite(db, JOHN)).toBe(true);
    expect(canAuthorizeWrite(db, VALE)).toBe(false); // core Y supervisora, pero no es John
    expect(canAuthorizeWrite(db, DAVID)).toBe(false);
  });

  it("una segunda persona se vincula pero SIN permiso de escritura", () => {
    consumeLinkCode(db, issueLinkCode(db, JOHN, AHORA).code, "42", AHORA);
    const vale = issueLinkCode(db, VALE, AHORA);
    expect(vale.willAuthorizeWrite).toBe(false);
    consumeLinkCode(db, vale.code, "77", AHORA);

    expect(linkForTelegramUser(db, "42")!.is_authorized).toBe(1);
    expect(linkForTelegramUser(db, "77")!.is_authorized).toBe(0);
    expect(authorizedLinkCount(db)).toBe(1);
  });

  it("nunca hay más de una vinculación autorizada", () => {
    issueLinkCode(db, JOHN, AHORA);
    issueLinkCode(db, VALE, AHORA);
    issueLinkCode(db, DAVID, AHORA);
    expect(authorizedLinkCount(db)).toBe(1);
  });
});

describe("el bot se cuelga de la identidad de equipo del founder", () => {
  it("resuelve la fila del roster, que es donde vive su trabajo (WP14/WP13)", () => {
    const db = freshDb();
    // La sesión de la puerta de invitación trae otra wallet; el vínculo va al roster.
    expect(founderTeamWallet(db, "GA7ZELENAFOUNDERDEMO")).toBe(JOHN);
  });

  it("sin fila de roster cae a la wallet de la sesión: no inventa identidades", () => {
    const db = openDb(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
    expect(founderTeamWallet(db, "GA7ZELENAFOUNDERDEMO")).toBe("GA7ZELENAFOUNDERDEMO");
  });
});

describe("borradores: el candado del «nada sin confirmación»", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("guarda la pieza estructurada y queda pendiente", () => {
    const id = createDraft(db, JOHN, "crear_asignacion", { titulo: "Dashboard de bloqueos" });
    const row = getDraft(db, id)!;
    expect(row.status).toBe("pendiente");
    expect(draftPayload<{ titulo: string }>(row).titulo).toBe("Dashboard de bloqueos");
    expect(pendingDrafts(db, JOHN)).toHaveLength(1);
  });

  it("se resuelve una sola vez (un doble clic no ejecuta dos veces)", () => {
    const id = createDraft(db, JOHN, "crear_asignacion", { titulo: "X" });
    expect(resolveDraft(db, id, "confirmado", AHORA)).toBe(true);
    expect(resolveDraft(db, id, "confirmado", AHORA)).toBe(false);
    expect(resolveDraft(db, id, "descartado", AHORA)).toBe(false);
    expect(getDraft(db, id)!.status).toBe("confirmado");
  });

  it("un borrador no escribe nada en el tablero por existir", () => {
    createDraft(db, JOHN, "crear_asignacion", { titulo: "Fantasma" });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM assignments`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM checkins`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM notes`).get()).toEqual({ n: 0 });
  });
});

describe("notas y log", () => {
  let db: DB;
  beforeEach(() => {
    db = freshDb();
  });

  it("guarda la nota resultante con su referencia de reunión", () => {
    const nota = saveNote(db, { author: JOHN, text: "Acordamos revisar la propuesta", meetingRef: "Hogar Center" });
    expect(nota.id).toBeGreaterThan(0);
    expect(nota.meeting_ref).toBe("Hogar Center");
    expect(listNotes(db, JOHN)).toHaveLength(1);
    expect(() => saveNote(db, { author: JOHN, text: "   " })).toThrow(BotStoreError);
  });

  it("el log registra la acción sin guardar el mensaje del usuario", () => {
    logBotAction(db, { wallet: JOHN, action: "crear_asignacion", outcome: "ok", target: "borrador:1", detail: "Dashboard" });
    logBotAction(db, { senderRef: "999", action: "mensaje", outcome: "ignorado", detail: "telegram_user_id no registrado" });
    const filas = listBotActions(db);
    expect(filas).toHaveLength(2);
    expect(filas[0].outcome).toBe("ignorado");
    expect(filas[0].wallet).toBeNull();
    expect(filas[1].wallet).toBe(JOHN);
    // El log tiene columnas para qué se hizo, no para el texto recibido.
    const columnas = (db.prepare(`PRAGMA table_info(bot_actions)`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(columnas).not.toContain("message");
    expect(columnas).not.toContain("raw_text");
    expect(columnas).not.toContain("audio");
  });
});

describe("cero secretos y cero telemetría en el esquema del bot", () => {
  it("ninguna tabla del bot tiene columnas de token, credencial, horas o ubicación", () => {
    const db = freshDb();
    const prohibidas = [
      "token",
      "bot_token",
      "api_key",
      "apikey",
      "secret",
      "password",
      "credential",
      "hours",
      "horas",
      "location",
      "ubicacion",
      "last_seen",
      "online",
      "presence",
    ];
    for (const tabla of ["telegram_links", "notes", "bot_drafts", "bot_actions"]) {
      const columnas = (db.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((c) =>
        c.name.toLowerCase()
      );
      expect(columnas.length).toBeGreaterThan(0);
      for (const p of prohibidas) {
        expect(columnas, `${tabla}.${p}`).not.toContain(p);
      }
    }
  });
});
