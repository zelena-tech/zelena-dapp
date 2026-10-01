/**
 * Ritos (WP31-D): sesiones, asistencia y reconocimiento de comunidad. SOLO SERVIDOR.
 *
 * Qué guarda la base: la cadencia vive en el genoma (`RITES_CADENCE`) y las próximas
 * ocurrencias se calculan (`ritos-labels.ts`). Solo existe una fila en
 * `rite_sessions` cuando alguien prepara una ocurrencia concreta. La asistencia
 * (`rite_attendance`, capa 1 = código rotativo) se registra una vez por persona.
 *
 * Reglas duras:
 *  - Estar es lo normal y faltar no resta nada: ningún delta negativo, ningún
 *    UPDATE ni DELETE de `reputation_events`/`points_ledger` (test estático).
 *  - Reconocimiento de comunidad por asistir, presentar (anfitrión) o relatar,
 *    idempotente por `ref` (spec §3.4) y con `period_id = currentEpoch(db)`
 *    explícito, para no caer en una época ya cerrada.
 *  - Nada de horas, presencia ni rankings: el anfitrión y la administración ven
 *    SOLO el conteo; la lista nominal existe únicamente dentro de la huella del
 *    cierre, y cada persona ve la suya (`asistenciaPropia`).
 *  - Cuentas demo, principales `pending:` y personas sin acuerdo firmado no
 *    registran asistencia ni presentan.
 *  - Parámetros solo del genoma; fechas con `zona-horaria.ts`.
 *  - SQL portable: SELECT + INSERT en transacción (nada de inserciones que ignoren el
 *    conflicto), y nada asíncrono dentro de una transacción.
 */
import type { DB } from "./db";
import { sha256Hex } from "./crypto";
import { currentEpoch, getActiveGenome, GENOME_DEFAULTS, type Genome, type RiteKind } from "./genome";
import { identidadesDe, mismaPersona } from "./identidades";
import { effectiveRole, isPendingPrincipal, isRole, puedeVerTodoElEquipo, type TeamActor } from "./roles";
import { equipoInternoActor } from "./authz";
import { esActaDeRito, esDecisionReemplazada } from "./agora-labels";
import { txVerificable } from "./pruebas-testnet";
import { diaLocal, instanteDb, parseInstanteDb } from "./zona-horaria";
import {
  RITE_LABEL,
  dentroDeVentana,
  esOcurrenciaValida,
  fechaLargaRito,
  isRiteKind,
  margenTexto,
  normalizarCodigo,
  proximasOcurrencias,
  ventanaRito,
  type OcurrenciaRito,
} from "./ritos-labels";
import { bucketDe, codigoRito, expiraEnS, hashCierre, ritesSecret, verificarCodigo } from "./ritos-codigo";

// ---------------------------------------------------------------------------
// Tipos y errores
// ---------------------------------------------------------------------------

export interface RiteSessionRow {
  id: number;
  kind: RiteKind;
  scheduled_for: string;
  duration_min: number;
  state: "Planned" | "Open" | "Closed";
  host_wallet: string | null;
  recorder_wallet: string | null;
  lugar: string | null;
  join_url: string | null;
  summary: string | null;
  notes_url: string | null;
  opened_at: string | null;
  closed_at: string | null;
  hash: string | null;
  decision_log_id: number | null;
  created_by: string | null;
  created_at: string;
}

/** Por qué no se pudo registrar una asistencia (lo usa la ruta para contar fallos). */
export type MotivoRito =
  | "sin_cuenta"
  | "pendiente"
  | "inactiva"
  | "demo"
  | "sin_acuerdo"
  | "no_existe"
  | "no_abierto"
  | "audiencia"
  | "codigo";

export class RitoError extends Error {
  status: number;
  motivo?: MotivoRito;
  constructor(status: number, message: string, motivo?: MotivoRito) {
    super(message);
    this.name = "RitoError";
    this.status = status;
    this.motivo = motivo;
  }
}

/** Copy de asistencia (§8.4). La ruta y la página dicen exactamente esto. */
export const COPY_ASISTENCIA = {
  pide: "Escribe el código que ves en pantalla.",
  exito: "Listo. Quedó registrada tu asistencia.",
  codigo: "Ese código ya cambió. Pide el actual a quien presenta.",
  noAbierto: "Este rito no está abierto ahora.",
  yaEstaba: "Ya estabas registrado.",
  sinSesion: "Entra para registrar tu asistencia.",
  sinAcuerdo: "Para registrar asistencia primero firma el acuerdo de contribución.",
  demasiados: "Demasiados intentos con este rito. Pide ayuda a quien presenta.",
} as const;

// ---------------------------------------------------------------------------
// Parámetros (solo del genoma)
// ---------------------------------------------------------------------------

interface ParamsRitos {
  tz: string;
  cadencia: Genome["RITES_CADENCE"];
  margenMin: number;
  rotacionS: number;
  repAsistir: number;
  repAnfitrion: number;
  repRelator: number;
}

function entero(v: unknown, porDefecto: number, minimo: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= minimo ? Math.floor(v) : porDefecto;
}

function zonaValida(tz: unknown): string {
  if (typeof tz === "string" && tz) {
    try {
      diaLocal(new Date(0), tz);
      return tz;
    } catch {
      /* zona ilegible en el genoma: rige la de los defaults */
    }
  }
  return GENOME_DEFAULTS.BUSINESS_TZ;
}

function paramsRitos(db: DB): ParamsRitos {
  const g = getActiveGenome(db);
  const d = GENOME_DEFAULTS;
  return {
    tz: zonaValida(g.BUSINESS_TZ),
    cadencia: g.RITES_CADENCE,
    margenMin: entero(g.RITE_WINDOW_MIN, d.RITE_WINDOW_MIN, 0),
    rotacionS: entero(g.RITE_CODE_ROTATION_S, d.RITE_CODE_ROTATION_S, 1),
    // Nunca negativos: un valor raro en el genoma se lee como el default.
    repAsistir: entero(g.RITE_ATTEND_REP, d.RITE_ATTEND_REP, 0),
    repAnfitrion: entero(g.RITE_HOST_REP, d.RITE_HOST_REP, 0),
    repRelator: entero(g.RITE_RECORDER_REP, d.RITE_RECORDER_REP, 0),
  };
}

/** Rotación del código (segundos) del genoma vigente; la página la muestra. */
export function rotacionCodigoS(db: DB): number {
  return paramsRitos(db).rotacionS;
}

/** Margen de la ventana (minutos) del genoma vigente. */
export function margenVentanaMin(db: DB): number {
  return paramsRitos(db).margenMin;
}

/** Zona del genoma vigente (validada). */
export function zonaRitos(db: DB): string {
  return paramsRitos(db).tz;
}

// ---------------------------------------------------------------------------
// Lecturas base
// ---------------------------------------------------------------------------

interface FilaUsuario {
  wallet: string;
  display_name: string;
  role: string;
  is_supervisor: number;
  is_founder: number;
  status: string;
  is_demo: number;
  cla_signed: number;
}

function usuario(db: DB, wallet: string): FilaUsuario | undefined {
  return db
    .prepare(
      `SELECT wallet, display_name, role, is_supervisor, is_founder, status, is_demo, cla_signed FROM users WHERE wallet = ?`
    )
    .get(wallet) as FilaUsuario | undefined;
}

function filaRito(db: DB, id: number): RiteSessionRow | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare(`SELECT * FROM rite_sessions WHERE id = ?`).get(id) as RiteSessionRow | undefined;
}

function conteoAsistentes(db: DB, sessionId: number): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM rite_attendance WHERE session_id = ? AND layer = 1`)
    .get(sessionId) as { n: number };
  return Number(r.n);
}

function ventanaDe(row: Pick<RiteSessionRow, "scheduled_for" | "duration_min">, margenMin: number) {
  return ventanaRito(parseInstanteDb(row.scheduled_for), row.duration_min, margenMin);
}

/**
 * Actor de los ritos leído de la BASE (nunca de la cookie): la fila tiene que
 * existir y estar activa. Un anfitrión puede ser cualquier persona con cuenta
 * (también de la comunidad), por eso no es `equipoInternoActor`.
 */
export function actorDeRitos(db: DB, wallet: string | null | undefined): TeamActor | null {
  if (typeof wallet !== "string" || !wallet) return null;
  const u = usuario(db, wallet);
  if (!u || u.status !== "active") return null;
  return {
    wallet: u.wallet,
    name: u.display_name,
    role: isRole(u.role) ? u.role : effectiveRole({ isFounder: !!u.is_founder }),
    isSupervisor: !!u.is_supervisor,
  };
}

/** Founder o supervisor: preparan ritos y asignan quién presenta y quién relata. */
function gestiona(actor: TeamActor): boolean {
  return puedeVerTodoElEquipo({ role: actor.role, isSupervisor: actor.isSupervisor });
}

function presenta(db: DB, actor: TeamActor, row: RiteSessionRow): boolean {
  if (gestiona(actor)) return true;
  return !!row.host_wallet && mismaPersona(db, actor.wallet, row.host_wallet);
}

/** ¿El actor puede abrir, cerrar y ver el código de esta sesión? (vista del anfitrión). */
export function puedePresentarRito(db: DB, actor: TeamActor, sessionId: number): boolean {
  const row = filaRito(db, sessionId);
  return !!row && presenta(db, actor, row);
}

// ---------------------------------------------------------------------------
// Validación de entradas
// ---------------------------------------------------------------------------

function textoOpcional(v: unknown, max: number, campo: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new RitoError(400, `${campo} no es válido.`);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw new RitoError(400, `${campo} admite hasta ${max} caracteres.`);
  return t;
}

function urlHttpsOpcional(v: unknown, campo: string): string | null {
  const t = textoOpcional(v, 500, campo);
  if (!t) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new RitoError(400, `${campo} tiene que ser un enlace https.`);
  }
  if (u.protocol !== "https:") throw new RitoError(400, `${campo} tiene que ser un enlace https.`);
  return u.toString();
}

/**
 * ¿Esta persona puede registrar asistencia o presentar? Cuenta propia, activa, no
 * demo, no `pending:` y con el acuerdo de contribución firmado.
 */
function comprobarPersona(db: DB, wallet: string): void {
  if (isPendingPrincipal(wallet)) {
    throw new RitoError(403, "Esta fila del equipo aún no tiene cuenta: entra con la tuya.", "pendiente");
  }
  const u = usuario(db, wallet);
  if (!u) throw new RitoError(401, COPY_ASISTENCIA.sinSesion, "sin_cuenta");
  if (u.status !== "active") throw new RitoError(403, "Esta cuenta no está activa.", "inactiva");
  if (u.is_demo) throw new RitoError(403, "Las cuentas de prueba no registran asistencia.", "demo");
  if (!u.cla_signed) throw new RitoError(403, COPY_ASISTENCIA.sinAcuerdo, "sin_acuerdo");
}

function presentadorValido(db: DB, wallet: string, papel: string): string {
  try {
    comprobarPersona(db, wallet);
  } catch {
    throw new RitoError(400, `Esa persona no puede ser ${papel}: necesita una cuenta activa con el acuerdo firmado.`);
  }
  return wallet;
}

// ---------------------------------------------------------------------------
// Reconocimiento de comunidad (idempotente por ref, nunca negativo)
// ---------------------------------------------------------------------------

export type PapelRito = "asistencia" | "anfitrion" | "relator";

/** `rito:<sessionId>:<papel>` (spec §3.4). */
export function refRito(sessionId: number, papel: PapelRito): string {
  return `rito:${sessionId}:${papel}`;
}

/**
 * ¿Ya se emitió este `ref`? Se mira en las DOS tablas de ledger. Para anfitrión y
 * relator (una persona por ref) sin filtrar wallet, para que sobreviva a una
 * vinculación. Para la asistencia, el ref es del rito y lo comparten quienes
 * asistieron: se filtra por TODAS las identidades de la persona.
 */
function yaEmitido(db: DB, ref: string, identidades?: string[]): boolean {
  if (identidades && identidades.length > 0) {
    const marcas = identidades.map(() => "?").join(", ");
    return (
      !!db.prepare(`SELECT 1 AS x FROM reputation_events WHERE ref = ? AND wallet IN (${marcas})`).get(ref, ...identidades) ||
      !!db.prepare(`SELECT 1 AS x FROM points_ledger WHERE ref = ? AND wallet IN (${marcas})`).get(ref, ...identidades)
    );
  }
  return (
    !!db.prepare(`SELECT 1 AS x FROM reputation_events WHERE ref = ?`).get(ref) ||
    !!db.prepare(`SELECT 1 AS x FROM points_ledger WHERE ref = ?`).get(ref)
  );
}

/** Inserta reputación de comunidad si corresponde. Devuelve lo emitido (0 si nada). */
function emitirComunidad(db: DB, wallet: string, delta: number, ref: string, ahora: Date, porPersona: boolean): number {
  const d = Math.floor(delta);
  if (!(d > 0)) return 0; // nunca negativo, y 0 no deja fila
  if (yaEmitido(db, ref, porPersona ? identidadesDe(db, wallet) : undefined)) return 0;
  db.prepare(
    `INSERT INTO reputation_events (wallet, axis, delta, ref, period_id, created_at) VALUES (?, 'comunidad', ?, ?, ?, ?)`
  ).run(wallet, d, ref, currentEpoch(db), instanteDb(ahora));
  return d;
}

/** Emite a anfitrión o relator al cerrar, solo si la persona sigue siendo válida. */
function emitirPresentador(db: DB, wallet: string | null, delta: number, ref: string, ahora: Date): number {
  if (!wallet) return 0;
  try {
    comprobarPersona(db, wallet);
  } catch {
    return 0; // una cuenta que dejó de ser válida no recibe nada (y no se le resta nada)
  }
  return emitirComunidad(db, wallet, delta, ref, ahora, false);
}

// ---------------------------------------------------------------------------
// Gestión de una sesión: preparar, asignar, abrir, cerrar
// ---------------------------------------------------------------------------

/**
 * Prepara (guarda) una ocurrencia de la cadencia. Founder o supervisor. La fecha se
 * normaliza a ISO UTC con Z antes de insertar (el UNIQUE compara texto) y tiene que
 * ser una ocurrencia real de la cadencia del genoma en los próximos 60 días.
 */
export function prepararRito(
  db: DB,
  actor: TeamActor,
  input: { kind: RiteKind; scheduledFor: string; lugar?: string | null; joinUrl?: string | null },
  ahora: Date = new Date()
): RiteSessionRow {
  if (!gestiona(actor)) throw new RitoError(403, "Preparar un rito es del founder o de un supervisor.");
  if (!isRiteKind(input.kind)) throw new RitoError(400, "Ese tipo de rito no existe.");
  const inicio = parseInstanteDb(String(input.scheduledFor ?? ""));
  if (Number.isNaN(inicio.getTime())) throw new RitoError(400, "La fecha del rito no es válida.");
  const p = paramsRitos(db);
  if (!esOcurrenciaValida(p.cadencia, input.kind, inicio, p.tz, ahora)) {
    throw new RitoError(400, "Esa fecha no es de la cadencia de este rito en los próximos 60 días.");
  }
  const scheduledFor = inicio.toISOString();
  const lugar = textoOpcional(input.lugar, 120, "El lugar");
  const joinUrl = urlHttpsOpcional(input.joinUrl, "El enlace para conectarte");
  const duracion = p.cadencia[input.kind].duracion_min;

  return db.transaction(() => {
    const existe = db
      .prepare(`SELECT id FROM rite_sessions WHERE kind = ? AND scheduled_for = ?`)
      .get(input.kind, scheduledFor);
    if (existe) throw new RitoError(409, "Ese rito ya está preparado.");
    const info = db
      .prepare(
        `INSERT INTO rite_sessions (kind, scheduled_for, duration_min, state, lugar, join_url, created_by, created_at)
         VALUES (?, ?, ?, 'Planned', ?, ?, ?, ?)`
      )
      .run(input.kind, scheduledFor, duracion, lugar, joinUrl, actor.wallet, instanteDb(ahora));
    return filaRito(db, Number(info.lastInsertRowid)) as RiteSessionRow;
  })();
}

/**
 * Asigna anfitrión y relator (founder o supervisor). `undefined` = no cambia;
 * `null` = quita. Son dos personas distintas, con cuenta propia y acuerdo firmado.
 */
export function asignarRolesRito(
  db: DB,
  actor: TeamActor,
  input: { sessionId: number; hostWallet?: string | null; recorderWallet?: string | null }
): RiteSessionRow {
  if (!gestiona(actor)) throw new RitoError(403, "Asignar quién presenta y quién relata es del founder o de un supervisor.");
  const row = filaRito(db, input.sessionId);
  if (!row) throw new RitoError(404, "No encuentro ese rito.");
  if (row.state === "Closed") throw new RitoError(409, "Un rito cerrado ya no cambia.");

  let host = row.host_wallet;
  let recorder = row.recorder_wallet;
  if (input.hostWallet !== undefined) host = input.hostWallet ? presentadorValido(db, input.hostWallet, "anfitrión") : null;
  if (input.recorderWallet !== undefined) {
    recorder = input.recorderWallet ? presentadorValido(db, input.recorderWallet, "relator") : null;
  }
  if (host && recorder && mismaPersona(db, host, recorder)) {
    throw new RitoError(409, "Quien presenta y quien relata son dos personas distintas.");
  }
  db.prepare(`UPDATE rite_sessions SET host_wallet = ?, recorder_wallet = ? WHERE id = ?`).run(host, recorder, row.id);
  return filaRito(db, row.id) as RiteSessionRow;
}

/** Abre una sesión `Planned`, solo dentro de su ventana. Founder, supervisor o anfitrión. */
export function abrirRito(db: DB, actor: TeamActor, sessionId: number, ahora: Date = new Date()): RiteSessionRow {
  const row = filaRito(db, sessionId);
  if (!row) throw new RitoError(404, "No encuentro ese rito.");
  if (!presenta(db, actor, row)) {
    throw new RitoError(403, "Abrir o cerrar este rito es de quien lo presenta, del founder o de un supervisor.");
  }
  if (row.state === "Open") throw new RitoError(409, "Este rito ya está abierto.");
  if (row.state === "Closed") throw new RitoError(409, "Este rito ya se cerró.");
  const p = paramsRitos(db);
  const v = ventanaDe(row, p.margenMin);
  if (ahora.getTime() < v.abre.getTime()) {
    throw new RitoError(409, `Este rito todavía no se puede abrir: se abre ${margenTexto(p.margenMin)} antes de empezar.`);
  }
  if (ahora.getTime() > v.cierra.getTime()) {
    throw new RitoError(409, "La ventana de este rito ya pasó: ya no se puede abrir.");
  }
  const r = db
    .prepare(`UPDATE rite_sessions SET state = 'Open', opened_at = ? WHERE id = ? AND state = 'Planned'`)
    .run(instanteDb(ahora), row.id);
  if (Number(r.changes) !== 1) throw new RitoError(409, "Este rito ya está abierto.");
  return filaRito(db, row.id) as RiteSessionRow;
}

/**
 * Cierra una sesión `Open` (no hay cierre automático: pasada la ventana ya no se
 * registra asistencia y queda "pendiente de cerrar"). En UNA transacción: huella
 * determinista → `rite_sessions.hash`; `anchor_queue(kind='rite')`; acta en
 * `decision_log` ("Rito …", fuera de las listas públicas de decisiones); y
 * reconocimiento a anfitrión y relator, una vez por ref.
 */
export function cerrarRito(
  db: DB,
  actor: TeamActor,
  input: { sessionId: number; summary?: string; notesUrl?: string },
  ahora: Date = new Date()
): RiteSessionRow {
  const row0 = filaRito(db, input.sessionId);
  if (!row0) throw new RitoError(404, "No encuentro ese rito.");
  if (!presenta(db, actor, row0)) {
    throw new RitoError(403, "Abrir o cerrar este rito es de quien lo presenta, del founder o de un supervisor.");
  }
  const summary = textoOpcional(input.summary, 1000, "El resumen");
  const notesUrl = urlHttpsOpcional(input.notesUrl, "El enlace al acta");
  const p = paramsRitos(db);

  return db.transaction(() => {
    const row = filaRito(db, input.sessionId) as RiteSessionRow;
    if (row.state === "Closed") throw new RitoError(409, "Este rito ya se cerró.");
    if (row.state !== "Open") throw new RitoError(409, "Solo se cierra un rito abierto.");

    const asistentes = (
      db
        .prepare(`SELECT wallet FROM rite_attendance WHERE session_id = ? AND layer = 1 ORDER BY wallet`)
        .all(row.id) as Array<{ wallet: string }>
    ).map((a) => a.wallet);
    const huella = hashCierre({
      kind: row.kind,
      scheduledFor: row.scheduled_for,
      asistentes,
      host: row.host_wallet,
      recorder: row.recorder_wallet,
      summary,
    });

    const n = asistentes.length;
    const fecha = diaLocal(ahora, p.tz);
    const title = `Rito ${RITE_LABEL[row.kind].nombre.toLowerCase()} del ${fechaLargaRito(
      parseInstanteDb(row.scheduled_for),
      p.tz
    )} cerrado · ${n} ${n === 1 ? "asistente" : "asistentes"}`;
    const reason =
      "Asistencia registrada con código rotativo. Quién asistió no se publica: va dentro de la huella del cierre, " +
      "que se ancla en la red de pruebas de Stellar." +
      (summary ? ` Resumen: ${summary}` : "") +
      ` Huella del cierre: ${huella}.`;
    const dec = db
      .prepare(`INSERT INTO decision_log (date, title, reason, hash) VALUES (?, ?, ?, ?)`)
      .run(fecha, title, reason, sha256Hex(`${fecha}|${title}|${reason}`));

    const upd = db
      .prepare(
        `UPDATE rite_sessions SET state = 'Closed', closed_at = ?, hash = ?, summary = ?, notes_url = ?, decision_log_id = ?
         WHERE id = ? AND state = 'Open'`
      )
      .run(instanteDb(ahora), huella, summary, notesUrl, Number(dec.lastInsertRowid), row.id);
    if (Number(upd.changes) !== 1) throw new RitoError(409, "Este rito ya se cerró.");

    db.prepare(
      `INSERT INTO anchor_queue (kind, ref, data_key, payload_hash, status) VALUES ('rite', ?, ?, ?, 'pending')`
    ).run(String(row.id), `rite:${row.id}`, huella);

    emitirPresentador(db, row.host_wallet, p.repAnfitrion, refRito(row.id, "anfitrion"), ahora);
    // Defensa: si anfitrión y relator fueran la misma persona, el relato no suma dos veces.
    const relatorDistinto =
      !!row.recorder_wallet && !(row.host_wallet && mismaPersona(db, row.host_wallet, row.recorder_wallet));
    if (relatorDistinto) emitirPresentador(db, row.recorder_wallet, p.repRelator, refRito(row.id, "relator"), ahora);

    return filaRito(db, row.id) as RiteSessionRow;
  })();
}

/** Código vigente para quien presenta (founder, supervisor o anfitrión), con el conteo. */
export function codigoActual(
  db: DB,
  actor: TeamActor,
  sessionId: number,
  ahora: Date = new Date()
): { codigo: string; expiraEnS: number; asistentes: number } {
  const row = filaRito(db, sessionId);
  if (!row) throw new RitoError(404, "No encuentro ese rito.");
  if (!presenta(db, actor, row)) throw new RitoError(403, "El código lo ve quien presenta el rito.");
  if (row.state !== "Open") throw new RitoError(409, COPY_ASISTENCIA.noAbierto);
  const p = paramsRitos(db);
  if (ahora.getTime() > ventanaDe(row, p.margenMin).cierra.getTime()) {
    throw new RitoError(409, "La ventana de este rito ya pasó: ya no se registra asistencia. Ciérralo cuando quieras.");
  }
  const t = ahora.getTime();
  return {
    codigo: codigoRito(ritesSecret(), row.id, bucketDe(t, p.rotacionS)),
    expiraEnS: expiraEnS(t, p.rotacionS),
    asistentes: conteoAsistentes(db, row.id),
  };
}

// ---------------------------------------------------------------------------
// Asistencia
// ---------------------------------------------------------------------------

/** ¿Alguna identidad de la persona ya está registrada en la sesión (capa 1)? */
function asistio(db: DB, identidades: string[], sessionId: number): boolean {
  if (identidades.length === 0) return false;
  const marcas = identidades.map(() => "?").join(", ");
  return !!db
    .prepare(`SELECT 1 AS x FROM rite_attendance WHERE session_id = ? AND layer = 1 AND wallet IN (${marcas})`)
    .get(sessionId, ...identidades);
}

/** Todo lo que se exige antes de mirar el código. Lanza `RitoError` con el copy de §8.4. */
function puertaDeAsistencia(db: DB, wallet: string, sessionId: number, ahora: Date): { row: RiteSessionRow; p: ParamsRitos } {
  comprobarPersona(db, wallet);
  const row = filaRito(db, sessionId);
  if (!row) throw new RitoError(404, "No encuentro ese rito.", "no_existe");
  const p = paramsRitos(db);
  if (row.state !== "Open" || !dentroDeVentana(ahora, ventanaDe(row, p.margenMin))) {
    throw new RitoError(409, COPY_ASISTENCIA.noAbierto, "no_abierto");
  }
  // El sync es del equipo y de quien trabaja en un proyecto.
  // PENDIENTE (WP31-A): cambiar a `equipoActor` (contributors con membresía y acuerdo)
  // cuando se fusione `wp31-a1`; hoy solo existe la puerta del equipo interno.
  if (RITE_LABEL[row.kind].audiencia === "equipo" && !equipoInternoActor({ wallet }, db)) {
    throw new RitoError(403, "Este rito es del equipo y de quien trabaja en un proyecto.", "audiencia");
  }
  return { row, p };
}

/**
 * Registra la asistencia con el código rotativo. Solo con la sesión `Open` y dentro
 * de su ventana; una vez por persona (si cualquiera de sus identidades ya está,
 * `yaEstaba`); `+RITE_ATTEND_REP` de comunidad una vez, con `period_id` explícito.
 */
export function registrarAsistencia(
  db: DB,
  wallet: string,
  input: { sessionId: number; codigo: string },
  ahora: Date = new Date()
): { registrada: boolean; yaEstaba: boolean; reputacion: number } {
  const { row, p } = puertaDeAsistencia(db, wallet, input.sessionId, ahora);
  const identidades = identidadesDe(db, wallet);
  if (asistio(db, identidades, row.id)) return { registrada: false, yaEstaba: true, reputacion: 0 };

  const codigo = normalizarCodigo(input.codigo);
  if (!codigo || !verificarCodigo(ritesSecret(), row.id, codigo, ahora.getTime(), p.rotacionS)) {
    throw new RitoError(400, COPY_ASISTENCIA.codigo, "codigo");
  }

  return db.transaction(() => {
    if (asistio(db, identidades, row.id)) return { registrada: false, yaEstaba: true, reputacion: 0 };
    db.prepare(`INSERT INTO rite_attendance (session_id, wallet, layer, created_at) VALUES (?, ?, 1, ?)`).run(
      row.id,
      wallet,
      instanteDb(ahora)
    );
    const reputacion = emitirComunidad(db, wallet, p.repAsistir, refRito(row.id, "asistencia"), ahora, true);
    return { registrada: true, yaEstaba: false, reputacion };
  })();
}

/**
 * Para la página del rito: ¿puede esta persona registrarse ahora, o ya está? No mira
 * el código. `mensaje` es el copy que corresponde si no puede.
 */
export function estadoAsistencia(
  db: DB,
  wallet: string,
  sessionId: number,
  ahora: Date = new Date()
): { puede: boolean; yaEstaba: boolean; mensaje: string | null } {
  if (asistio(db, identidadesDe(db, wallet), sessionId)) return { puede: false, yaEstaba: true, mensaje: COPY_ASISTENCIA.yaEstaba };
  try {
    puertaDeAsistencia(db, wallet, sessionId, ahora);
    return { puede: true, yaEstaba: false, mensaje: null };
  } catch (e) {
    if (e instanceof RitoError) return { puede: false, yaEstaba: false, mensaje: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Límite de fallos por (sesión, persona) — en proceso, como `rate-limit.ts`
// ---------------------------------------------------------------------------

/** Límites de la ruta de asistencia (spec §5.D). Seguridad, no parámetros del producto. */
export const LIMITES_ASISTENCIA = { intentosPorMinuto: 10, fallosPorRito: 20 } as const;

const VIDA_FALLOS_MS = 24 * 60 * 60 * 1000;
type Fallos = Map<string, { n: number; hasta: number }>;
const gf = globalThis as unknown as { __zelenaFallosRitos?: Fallos };
const fallos: Fallos = (gf.__zelenaFallosRitos ??= new Map());

function claveFallos(sessionId: number, wallet: string): string {
  return `${sessionId}:${wallet}`;
}

/** ¿Ya agotó los fallos permitidos en este rito? */
export function demasiadosFallos(sessionId: number, wallet: string, ahoraMs: number = Date.now()): boolean {
  const f = fallos.get(claveFallos(sessionId, wallet));
  return !!f && f.hasta > ahoraMs && f.n >= LIMITES_ASISTENCIA.fallosPorRito;
}

/** Anota un código fallido. Devuelve cuántos lleva en este rito. */
export function anotarFallo(sessionId: number, wallet: string, ahoraMs: number = Date.now()): number {
  if (fallos.size > 5000) {
    for (const [k, v] of fallos) if (v.hasta <= ahoraMs) fallos.delete(k);
  }
  const k = claveFallos(sessionId, wallet);
  const f = fallos.get(k);
  const n = f && f.hasta > ahoraMs ? f.n + 1 : 1;
  fallos.set(k, { n, hasta: f && f.hasta > ahoraMs ? f.hasta : ahoraMs + VIDA_FALLOS_MS });
  return n;
}

// ---------------------------------------------------------------------------
// Lecturas públicas (sin wallets, sin nombres, sin enlace de conexión)
// ---------------------------------------------------------------------------

export interface RitoProximo extends OcurrenciaRito {
  sessionId: number | null;
  state: string | null;
  lugar: string | null;
  /** Hay enlace de conexión (el enlace mismo solo se entrega con sesión, en `detalleRito`). */
  conEnlace: boolean;
}

export interface RitoPasado {
  id: number;
  kind: RiteKind;
  scheduledFor: string;
  asistentes: number;
  summary: string | null;
  notesUrl: string | null;
  /** Huella del cierre (lo que se ancla). */
  huella: string | null;
  /** Transacción de anclaje en la red de pruebas, solo si es verificable. */
  txId: string | null;
}

function txDeAnclaje(db: DB, sessionId: number): string | null {
  const r = db
    .prepare(`SELECT tx_id FROM anchor_queue WHERE kind = 'rite' AND ref = ? AND tx_id IS NOT NULL ORDER BY id DESC LIMIT 1`)
    .get(String(sessionId)) as { tx_id: string | null } | undefined;
  return r?.tx_id && txVerificable(r.tx_id) ? r.tx_id : null;
}

/**
 * Lo que ve cualquiera en /comunidad: los próximos ritos DE COMUNIDAD (el sync es
 * del equipo) y los pasados (cerrados), con su conteo y su huella. Sin wallets,
 * nombres ni enlace de conexión.
 */
export function ritosPublicos(
  db: DB,
  ahora: Date = new Date(),
  n: number = 6
): { proximos: RitoProximo[]; pasados: RitoPasado[] } {
  const p = paramsRitos(db);
  const cuantos = Math.min(Math.max(1, Math.floor(n) || 1), 50);
  const sesion = db.prepare(`SELECT id, state, lugar, join_url, duration_min FROM rite_sessions WHERE kind = ? AND scheduled_for = ?`);

  const proximos: RitoProximo[] = [];
  for (const o of proximasOcurrencias(p.cadencia, ahora, p.tz, cuantos + 3, "comunidad")) {
    const s = sesion.get(o.kind, o.inicio.toISOString()) as
      | { id: number; state: string; lugar: string | null; join_url: string | null; duration_min: number }
      | undefined;
    if (s?.state === "Closed") continue; // ya terminó: va en los pasados
    proximos.push({
      kind: o.kind,
      inicio: o.inicio,
      duracionMin: s ? Number(s.duration_min) : o.duracionMin,
      sessionId: s ? Number(s.id) : null,
      state: s?.state ?? null,
      lugar: s?.lugar ?? null,
      conEnlace: !!s?.join_url,
    });
    if (proximos.length >= cuantos) break;
  }

  const cerradas = db
    .prepare(
      `SELECT id, kind, scheduled_for, summary, notes_url, hash FROM rite_sessions
       WHERE state = 'Closed' ORDER BY scheduled_for DESC, id DESC LIMIT ?`
    )
    .all(cuantos) as Array<Pick<RiteSessionRow, "id" | "kind" | "scheduled_for" | "summary" | "notes_url" | "hash">>;
  const pasados: RitoPasado[] = cerradas.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    scheduledFor: r.scheduled_for,
    asistentes: conteoAsistentes(db, Number(r.id)),
    summary: r.summary,
    notesUrl: r.notes_url,
    huella: r.hash,
    txId: txDeAnclaje(db, Number(r.id)),
  }));

  return { proximos, pasados };
}

export type DetalleRito = RiteSessionRow & {
  asistentes: number;
  conAnfitrion: boolean;
  conRelator: boolean;
  conEnlace: boolean;
};

/** Oculta las wallets de una fila (D6): quién presenta se sabe por los flags. */
function sinWallets(row: RiteSessionRow, asistentes: number): DetalleRito {
  return {
    ...row,
    host_wallet: null,
    recorder_wallet: null,
    created_by: null,
    asistentes,
    conAnfitrion: !!row.host_wallet,
    conRelator: !!row.recorder_wallet,
    conEnlace: !!row.join_url,
  };
}

/** Detalle de una sesión para /comunidad/ritos/[id]. `join_url` solo con sesión; sin wallets. */
export function detalleRito(db: DB, sessionId: number, conSesion: boolean): DetalleRito | undefined {
  const row = filaRito(db, sessionId);
  if (!row) return undefined;
  const d = sinWallets(row, conteoAsistentes(db, row.id));
  return conSesion ? d : { ...d, join_url: null };
}

/** Rango de una época en el tiempo: desde su `created_at` hasta el de la siguiente. */
function rangoDeEpoca(db: DB, epoch: number): { desde: string; hasta: string | null } | null {
  const e = db.prepare(`SELECT created_at FROM periods WHERE id = ?`).get(epoch) as { created_at: string } | undefined;
  if (!e) return null;
  const sig = db.prepare(`SELECT created_at FROM periods WHERE id > ? ORDER BY id LIMIT 1`).get(epoch) as
    | { created_at: string }
    | undefined;
  return { desde: e.created_at, hasta: sig?.created_at ?? null };
}

/** "Has estado en {n} ritos. Esta temporada: {m}." Sumando todas sus identidades. */
export function asistenciaPropia(db: DB, wallet: string, epoch?: number): { total: number; estaEpoca: number } {
  const ids = identidadesDe(db, wallet);
  if (ids.length === 0) return { total: 0, estaEpoca: 0 };
  const marcas = ids.map(() => "?").join(", ");
  const total = Number(
    (
      db
        .prepare(`SELECT COUNT(DISTINCT session_id) AS n FROM rite_attendance WHERE layer = 1 AND wallet IN (${marcas})`)
        .get(...ids) as { n: number }
    ).n
  );
  const rango = rangoDeEpoca(db, epoch ?? currentEpoch(db));
  if (!rango) return { total, estaEpoca: 0 };
  const estaEpoca = Number(
    (
      db
        .prepare(
          `SELECT COUNT(DISTINCT session_id) AS n FROM rite_attendance
           WHERE layer = 1 AND wallet IN (${marcas}) AND created_at >= ? AND (? IS NULL OR created_at < ?)`
        )
        .get(...ids, rango.desde, rango.hasta, rango.hasta) as { n: number }
    ).n
  );
  return { total, estaEpoca };
}

/** ¿Esta persona (cualquiera de sus identidades) ya está registrada en la sesión? */
export function asistioARito(db: DB, wallet: string, sessionId: number): boolean {
  return asistio(db, identidadesDe(db, wallet), sessionId);
}

/**
 * Sesiones para la gestión (/admin, corte 2): `Planned` y `Open` más las últimas 5
 * cerradas, con su conteo. Sin wallets. `pendienteDeCerrar` = abierta y con la
 * ventana ya pasada (no hay cierre automático).
 */
export function sesionesGestionables(
  db: DB,
  ahora: Date = new Date()
): Array<DetalleRito & { pendienteDeCerrar: boolean }> {
  const margen = paramsRitos(db).margenMin;
  const vivas = db
    .prepare(`SELECT * FROM rite_sessions WHERE state IN ('Planned', 'Open') ORDER BY scheduled_for, id`)
    .all() as RiteSessionRow[];
  const cerradas = db
    .prepare(`SELECT * FROM rite_sessions WHERE state = 'Closed' ORDER BY scheduled_for DESC, id DESC LIMIT 5`)
    .all() as RiteSessionRow[];
  return [...vivas, ...cerradas].map((row) => ({
    ...sinWallets(row, conteoAsistentes(db, row.id)),
    pendienteDeCerrar: row.state === "Open" && ahora.getTime() > ventanaDe(row, margen).cierra.getTime(),
  }));
}

/**
 * Las `n` decisiones más recientes para /comunidad: sin las actas de ritos ("Rito …",
 * que se ven en los pasados) ni la decisión reemplazada (la de las etiquetas viejas).
 */
export function decisionesPublicas(
  db: DB,
  n: number = 3
): Array<{ id: number; date: string; title: string; reason: string; hash: string }> {
  const cuantas = Math.max(0, Math.floor(n) || 0);
  if (cuantas === 0) return [];
  const filas = db.prepare(`SELECT id, date, title, reason, hash FROM decision_log ORDER BY id DESC`).all() as Array<{
    id: number;
    date: string;
    title: string;
    reason: string;
    hash: string;
  }>;
  return filas.filter((d) => !esActaDeRito(d.title) && !esDecisionReemplazada(d.reason)).slice(0, cuantas);
}

// ---------------------------------------------------------------------------
// Participación para el fitness de la época (epochs.ts#gatherEpochData)
// ---------------------------------------------------------------------------

/**
 * Señal de participación de la época: asistencias (capa 1) en los ritos CERRADOS
 * durante la época, y la base esperada = personas activas que podrían asistir (no
 * demo, no `pending:`) × ritos cerrados. `null` si no se cerró ningún rito: el
 * fitness lo degrada explícitamente. Como demo y pending no registran asistencia,
 * la participación no pasa del 100 %.
 */
export function participacionRitos(db: DB, epoch: number): { checkins: number; expectedCheckins: number } | null {
  const rango = rangoDeEpoca(db, epoch);
  if (!rango) return null;
  const filtro = `s.state = 'Closed' AND s.closed_at >= ? AND (? IS NULL OR s.closed_at < ?)`;
  const params = [rango.desde, rango.hasta, rango.hasta];
  const sesiones = Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM rite_sessions s WHERE ${filtro}`).get(...params) as { n: number }).n
  );
  if (sesiones === 0) return null;
  const personas = Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'active' AND is_demo = 0 AND wallet NOT LIKE 'pending:%'`)
        .get() as { n: number }
    ).n
  );
  if (personas === 0) return null;
  const checkins = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM rite_attendance a JOIN rite_sessions s ON s.id = a.session_id WHERE a.layer = 1 AND ${filtro}`
        )
        .get(...params) as { n: number }
    ).n
  );
  return { checkins, expectedCheckins: personas * sesiones };
}
