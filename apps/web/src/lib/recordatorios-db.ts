/**
 * Corrida del motor de recordatorios (WP31 §5.C.2): carga las piezas, resuelve a quién
 * va cada recordatorio, deja el aviso en la bandeja y, si hay transporte, lo manda por
 * Telegram. La lógica de QUÉ recordar vive en `recordatorios.ts` (puro).
 *
 * Reglas que este archivo hace cumplir:
 *  - La flag `SLA_REMINDERS_ENABLED` gobierna TODO: apagada no escribe ni envía nada.
 *    Fuera del horario hábil, silencio. La simulación (`simular`) no escribe ni envía.
 *  - Idempotencia: una fila de `reminders_sent` por (clave, persona). Lo ya procesado
 *    se salta; un choque con el UNIQUE cuenta como "ya procesado", no como error.
 *  - Nunca `await` dentro de `db.transaction`: la reserva (aviso + fila) es síncrona y
 *    el envío por Telegram va después, fuera de toda transacción. Si Telegram falla, la
 *    fila sigue con `is_telegram = 0` y se reintenta en la corrida siguiente.
 *  - Destinatario válido = activo, no demo y no un `pending:` sin vincular (salvo el
 *    principal del founder), deduplicado por `identidadesDe` y, en los escalamientos,
 *    nunca el dueño ni sus identidades. Quien no ve la pieza no recibe su aviso.
 *  - Candado en proceso (`globalThis.__zelenaRecordatorios`): producción es una sola
 *    instancia; una segunda corrida mientras otra sigue viva responde `en_curso`.
 *  - El resultado son CONTEOS: nunca wallets ni nombres.
 *  - SQL portable: sin `INSERT OR IGNORE` ni `ON CONFLICT` (SELECT + INSERT).
 *
 * Solo servidor: importa `telegram.ts` (comparación en tiempo constante con `node:crypto`).
 */
import type { DB } from "./db";
import { appBaseUrl, isSlaRemindersEnabled, telegramBotToken } from "./config";
import { getActiveGenome } from "./genome";
import { identidadesDe, principalFounder } from "./identidades";
import { PENDING_PREFIX, effectiveRole, isPendingPrincipal, type TeamActor } from "./roles";
import { cargarPiezasAbiertas } from "./sla-db";
import { diasHabilesAntes, esHorarioHabil } from "./sla";
import { piezasVisiblesPara } from "./team";
import { constantTimeEquals, createTelegramTransport, sendMessage, type TelegramTransport } from "./telegram";
import { diaLocal, horaLocal, instanteDb, parseInstanteDb } from "./zona-horaria";
import { crearAviso } from "./avisos";
import {
  configRecordatoriosDesdeGenoma,
  planificarRecordatorios,
  renderDigest,
  renderInmediatos,
  type ConfigRecordatorios,
  type Destino,
  type PiezaRecordable,
  type Recordatorio,
  type TipoRecordatorio,
} from "./recordatorios";

export interface ResultadoCorrida {
  enabled: boolean;
  omitido?: "flag_apagada" | "fuera_de_horario" | "en_curso";
  simulado: boolean;
  evaluadas: number;
  avisosCreados: number;
  inmediatosEnviados: number;
  digestEnviados: number;
  errores: number;
  porTipo: Partial<Record<TipoRecordatorio, number>>;
  destinatarios: number; // conteos, nunca wallets ni nombres
  /** Solo al simular: cuántos saldrían al momento (ya con el tope por persona). */
  inmediatos?: number;
}

export interface OpcionesCorrida {
  ahora?: Date;
  transport?: TelegramTransport | null;
  appUrl?: string;
  enabled?: boolean;
  cfg?: ConfigRecordatorios;
  simular?: boolean;
}

/** Cuánto puede durar una corrida antes de considerar su candado abandonado. */
const CANDADO_MAX_MS = 5 * 60_000;
// SQL Server admite hasta 2100 parámetros por consulta: se consulta por tandas.
const TANDA = 400;

const g = globalThis as unknown as { __zelenaRecordatorios?: { desde: number } | null };

function marcas(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

// ---------------------------------------------------------------------------
// Autorización del cron
// ---------------------------------------------------------------------------

/**
 * Cabecera `x-cron-secret` contra el secreto esperado, en tiempo constante.
 * Sin secreto configurado (o vacío) → `sin_configurar` (la ruta responde 503): un
 * endpoint que escribe no se abre sin secreto. Distinto o de otro largo → `rechazado`.
 */
export function autorizarCron(header: string | null, esperado: string | null): "ok" | "sin_configurar" | "rechazado" {
  const secreto = typeof esperado === "string" ? esperado.trim() : "";
  if (!secreto) return "sin_configurar";
  const dado = typeof header === "string" ? header.trim() : "";
  if (!dado) {
    constantTimeEquals(secreto, secreto); // mismo trabajo con o sin cabecera
    return "rechazado";
  }
  return constantTimeEquals(dado, secreto) ? "ok" : "rechazado";
}

// ---------------------------------------------------------------------------
// Carga de piezas y guarda de arranque
// ---------------------------------------------------------------------------

interface FilaExtra {
  id: number;
  title: string;
  owner_wallet: string | null;
  initiative_id: number | null;
  client_id: number | null;
  blocked_reason: string | null;
  initiative_slug: string | null;
  initiative_name: string | null;
}

/** Las piezas abiertas (no `Hecha`) con lo que el motor necesita para el texto y el destino. */
export function cargarPiezasRecordables(db: DB): PiezaRecordable[] {
  const piezas = cargarPiezasAbiertas(db);
  if (piezas.length === 0) return [];
  const extra = db
    .prepare(
      `SELECT a.id, a.title, a.owner_wallet, a.initiative_id, a.client_id, a.blocked_reason,
              i.slug AS initiative_slug, i.name AS initiative_name
         FROM assignments a
         LEFT JOIN initiatives i ON i.id = a.initiative_id
        WHERE a.status <> 'Hecha'
        ORDER BY a.id`
    )
    .all() as FilaExtra[];
  const porId = new Map<number, FilaExtra>(extra.map((e) => [Number(e.id), e]));
  const out: PiezaRecordable[] = [];
  for (const p of piezas) {
    const e = porId.get(p.id);
    if (!e) continue;
    out.push({
      ...p,
      title: String(e.title ?? ""),
      owner_wallet: e.owner_wallet ?? null,
      initiative_id: e.initiative_id == null ? null : Number(e.initiative_id),
      initiative_slug: e.initiative_slug ?? null,
      initiative_name: e.initiative_name ?? null,
      blocked_reason: e.blocked_reason ?? null,
      client_id: e.client_id == null ? null : Number(e.client_id),
    });
  }
  return out;
}

/**
 * Guarda de arranque: el primer instante en que el motor dejó algo (`MIN(created_at)`
 * de `reminders_sent`); null si nunca corrió. No es un parámetro del genoma: es un hecho.
 */
export function activadoDesde(db: DB): Date | null {
  const r = db.prepare(`SELECT MIN(created_at) AS desde FROM reminders_sent`).get() as
    | { desde: string | null }
    | undefined;
  if (!r || !r.desde) return null;
  const d = parseInstanteDb(String(r.desde));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Destinatarios
// ---------------------------------------------------------------------------

interface FilaUsuario {
  wallet: string;
  display_name: string;
  role: string;
  is_supervisor: number;
  is_founder: number;
  status: string;
  is_demo: number;
}

/** Memoria de una corrida: `identidadesDe` y las filas de `users` se consultan una vez. */
interface Cache {
  principal: string | null | undefined;
  ids: Map<string, string[]>;
  usuarios: Map<string, FilaUsuario | null>;
  vinculos: Map<string, string | null>;
}

function nuevaCache(): Cache {
  return { principal: undefined, ids: new Map(), usuarios: new Map(), vinculos: new Map() };
}

function principalDe(db: DB, c: Cache): string | null {
  if (c.principal === undefined) c.principal = principalFounder(db);
  return c.principal;
}

function idsDe(db: DB, c: Cache, wallet: string): string[] {
  let v = c.ids.get(wallet);
  if (!v) {
    v = identidadesDe(db, wallet);
    c.ids.set(wallet, v);
  }
  return v;
}

function usuarioDe(db: DB, c: Cache, wallet: string): FilaUsuario | null {
  if (!c.usuarios.has(wallet)) {
    const r = db
      .prepare(
        `SELECT wallet, display_name, role, is_supervisor, is_founder, status, is_demo FROM users WHERE wallet = ?`
      )
      .get(wallet) as FilaUsuario | undefined;
    c.usuarios.set(wallet, r ?? null);
  }
  return c.usuarios.get(wallet) ?? null;
}

function vinculadaDe(db: DB, c: Cache, slug: string): string | null {
  if (!c.vinculos.has(slug)) {
    const r = db.prepare(`SELECT wallet FROM roster_links WHERE slug = ?`).get(slug) as { wallet: string } | undefined;
    c.vinculos.set(slug, r?.wallet ?? null);
  }
  return c.vinculos.get(slug) ?? null;
}

/**
 * La wallet a la que se le escribe a esta persona: el principal del founder si es él
 * (así su bandeja y su Telegram de equipo son uno), la cuenta vinculada si es una fila
 * `pending:` ya absorbida, o ella misma.
 */
function canonica(db: DB, c: Cache, wallet: string): string {
  const principal = principalDe(db, c);
  if (principal && idsDe(db, c, wallet).includes(principal)) return principal;
  if (isPendingPrincipal(wallet)) {
    const vinculada = vinculadaDe(db, c, wallet.slice(PENDING_PREFIX.length));
    if (vinculada) return vinculada;
  }
  return wallet;
}

/** Activa, no demo y no un `pending:` sin vincular (salvo el principal del founder). */
function esValida(db: DB, c: Cache, wallet: string): boolean {
  const u = usuarioDe(db, c, wallet);
  if (!u || u.status !== "active" || Number(u.is_demo) === 1) return false;
  if (isPendingPrincipal(wallet) && wallet !== principalDe(db, c)) return false;
  return true;
}

function actorDe(u: FilaUsuario): TeamActor {
  return {
    wallet: u.wallet,
    name: u.display_name,
    role: effectiveRole({ role: u.role, isFounder: !!u.is_founder }),
    isSupervisor: !!u.is_supervisor,
  };
}

/** ¿Puede esta persona ver la pieza? (la regla de las listas del equipo, `piezasVisiblesPara`). */
function veLaPieza(
  db: DB,
  c: Cache,
  wallet: string,
  pieza: { initiative_id: number | null; client_id: number | null } | undefined
): boolean {
  if (!pieza) return true;
  const u = usuarioDe(db, c, wallet);
  if (!u) return false;
  return piezasVisiblesPara(db, actorDe(u), [pieza]).length === 1;
}

function supervisoresGlobales(db: DB): string[] {
  return (
    db
      .prepare(`SELECT wallet FROM users WHERE is_supervisor = 1 AND status = 'active' AND is_demo = 0 ORDER BY wallet`)
      .all() as Array<{ wallet: string }>
  ).map((r) => r.wallet);
}

function foundersDeBase(db: DB): string[] {
  return (
    db
      .prepare(`SELECT wallet FROM users WHERE role = 'founder' AND status = 'active' AND is_demo = 0 ORDER BY wallet`)
      .all() as Array<{ wallet: string }>
  ).map((r) => r.wallet);
}

function miembrosConRol(db: DB, initiativeId: number, roles: string[]): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT wallet FROM project_members
          WHERE initiative_id = ? AND rol_proyecto IN (${marcas(roles.length)})
          ORDER BY wallet`
      )
      .all(initiativeId, ...roles) as Array<{ wallet: string }>
  ).map((r) => r.wallet);
}

function resolver(
  db: DB,
  c: Cache,
  d: Destino,
  dueno: string | null,
  pieza?: { initiative_id: number | null; client_id: number | null }
): string[] {
  const idsDueno = dueno ? new Set(idsDe(db, c, dueno)) : new Set<string>();
  const elegidas: string[] = [];
  const cubiertas = new Set<string>(); // identidades de quien ya está elegido

  /** Filtra, canoniza y deduplica una lista de candidatos. */
  const filtrar = (candidatos: string[], excluirDueno: boolean, comprobarVista: boolean): string[] => {
    const out: string[] = [];
    for (const raw of candidatos) {
      if (!raw) continue;
      const w = canonica(db, c, raw);
      const ids = idsDe(db, c, w);
      if (excluirDueno && ids.some((x) => idsDueno.has(x))) continue;
      if (ids.some((x) => cubiertas.has(x))) continue;
      if (!esValida(db, c, w)) continue;
      if (comprobarVista && !veLaPieza(db, c, w, pieza)) continue;
      for (const x of ids) cubiertas.add(x);
      out.push(w);
    }
    return out;
  };

  const founders = (): string[] => {
    const principal = principalDe(db, c);
    return filtrar(principal ? [principal] : foundersDeBase(db), true, false);
  };

  if (d.tipo === "persona") {
    if (!d.wallet) return [];
    return filtrar([d.wallet], false, false);
  }
  if (d.tipo === "founder") {
    elegidas.push(...founders());
    return elegidas;
  }

  // supervision: quien estructura (y revisa) el proyecto → supervisores globales → founder.
  if (d.initiativeId != null) {
    const roles = d.incluyeRevisa ? ["estructura", "revisa"] : ["estructura"];
    elegidas.push(...filtrar(miembrosConRol(db, d.initiativeId, roles), true, true));
  }
  if (elegidas.length === 0) elegidas.push(...filtrar(supervisoresGlobales(db), true, true));
  if (elegidas.length === 0) elegidas.push(...founders());
  return elegidas;
}

/**
 * Wallets que reciben un destino (§5.C.2). `pieza` (opcional) deja fuera a quien no
 * podría verla (p. ej. un supervisor que no participa en ese cliente).
 */
export function resolverDestinatarios(
  db: DB,
  d: Destino,
  dueno: string | null,
  pieza?: { initiative_id: number | null; client_id: number | null }
): string[] {
  return resolver(db, nuevaCache(), d, dueno, pieza);
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/** El chat de Telegram de esta persona (en cualquiera de sus identidades), o null. */
function chatDe(db: DB, c: Cache, wallet: string): number | null {
  const ids = idsDe(db, c, wallet);
  if (ids.length === 0) return null;
  const rows = db
    .prepare(
      `SELECT wallet, telegram_user_id FROM telegram_links
        WHERE wallet IN (${marcas(ids.length)}) AND telegram_user_id IS NOT NULL
        ORDER BY id`
    )
    .all(...ids) as Array<{ wallet: string; telegram_user_id: string }>;
  // Primero el vínculo de la propia wallet; si no, el de otra identidad.
  const fila = rows.find((r) => r.wallet === wallet) ?? rows[0];
  if (!fila) return null;
  const chat = Number(fila.telegram_user_id); // en chats 1:1, chat.id = from.id
  return Number.isSafeInteger(chat) && chat !== 0 ? chat : null;
}

function transportePorDefecto(): TelegramTransport | null {
  const token = telegramBotToken();
  if (!token) return null;
  try {
    return createTelegramTransport(token);
  } catch {
    return null;
  }
}

interface FilaEnviado {
  id: number;
  clave: string;
  wallet: string;
  dia: string;
  is_inmediato: number;
  is_telegram: number;
}

function marcarTelegram(db: DB, ids: number[]): void {
  for (let i = 0; i < ids.length; i += TANDA) {
    const tanda = ids.slice(i, i + TANDA);
    db.prepare(`UPDATE reminders_sent SET is_telegram = 1 WHERE id IN (${marcas(tanda.length)})`).run(...tanda);
  }
}

// ---------------------------------------------------------------------------
// La corrida
// ---------------------------------------------------------------------------

function resultadoVacio(enabled: boolean, simulado: boolean): ResultadoCorrida {
  return {
    enabled,
    simulado,
    evaluadas: 0,
    avisosCreados: 0,
    inmediatosEnviados: 0,
    digestEnviados: 0,
    errores: 0,
    porTipo: {},
    destinatarios: 0,
  };
}

function esChoqueUnico(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /UNIQUE|duplicate key|unique constraint|2627|2601/i.test(m);
}

interface Entrega {
  r: Recordatorio;
  wallet: string;
  inmediato: boolean;
}

/**
 * Una corrida del motor (§5.C.2). La llama el cron (`POST /api/cron/recordatorios`)
 * cada 15 minutos en horario hábil; es idempotente: correrla dos veces con el mismo
 * `ahora` no crea ni envía nada la segunda vez.
 */
export async function correrRecordatorios(db: DB, opts: OpcionesCorrida = {}): Promise<ResultadoCorrida> {
  const simular = opts.simular === true;
  const enabled = opts.enabled ?? isSlaRemindersEnabled();

  // 0. Candado en proceso (la simulación no escribe: ni lo toma ni lo respeta).
  const ahoraMs = Date.now();
  const vivo = g.__zelenaRecordatorios;
  if (!simular && vivo && ahoraMs - vivo.desde < CANDADO_MAX_MS) {
    return { ...resultadoVacio(enabled, false), omitido: "en_curso" };
  }
  const candado = { desde: ahoraMs };
  if (!simular) g.__zelenaRecordatorios = candado;

  try {
    return await corrida(db, opts, simular, enabled);
  } finally {
    if (!simular && g.__zelenaRecordatorios === candado) g.__zelenaRecordatorios = null;
  }
}

async function corrida(db: DB, opts: OpcionesCorrida, simular: boolean, enabled: boolean): Promise<ResultadoCorrida> {
  const ahora = opts.ahora ?? new Date();
  const res = resultadoVacio(enabled, simular);

  // 1. Flag apagada → nada (salvo simular, que no escribe).
  if (!enabled && !simular) return { ...res, omitido: "flag_apagada" };

  const base = opts.cfg ?? configRecordatoriosDesdeGenoma(getActiveGenome(db));
  // 2. Fuera de horario hábil, silencio (salvo simular).
  if (!simular && !esHorarioHabil(ahora, base)) return { ...res, omitido: "fuera_de_horario" };

  // 3. Plan de la corrida, con la guarda de arranque.
  const cfg: ConfigRecordatorios = { ...base, activadoDesde: base.activadoDesde ?? activadoDesde(db) ?? ahora };
  const piezas = cargarPiezasRecordables(db);
  res.evaluadas = piezas.length;
  const plan = planificarRecordatorios(piezas, cfg, ahora);
  const hoy = diaLocal(ahora, cfg.tz);
  const conResumen = simular || horaLocal(ahora, cfg.tz) >= cfg.digestHora;

  const cache = nuevaCache();
  const porPieza = new Map<number, PiezaRecordable>(piezas.map((p) => [p.id, p]));
  const yaProcesada = db.prepare(`SELECT 1 AS x FROM reminders_sent WHERE clave = ? AND wallet = ?`);

  // (clave, wallet) presentes en el plan, procesadas o no: sirven para el reintento.
  const enPlan = new Map<string, Recordatorio>();
  // Candidatas nuevas, por persona, en el orden del plan.
  const nuevasPorPersona = new Map<string, Entrega[]>();

  for (const r of plan) {
    const p = porPieza.get(r.assignmentId);
    const pieza = p ? { initiative_id: p.initiative_id, client_id: p.client_id ?? null } : undefined;
    const destinatarios = resolver(db, cache, r.destino, p?.owner_wallet ?? null, pieza);
    for (const w of destinatarios) {
      const k = `${r.clave}|${w}`;
      if (enPlan.has(k)) continue;
      enPlan.set(k, r);
      if (yaProcesada.get(r.clave, w)) continue;
      const lista = nuevasPorPersona.get(w) ?? [];
      lista.push({ r, wallet: w, inmediato: r.inmediato });
      nuevasPorPersona.set(w, lista);
    }
  }

  // Tope de inmediatos por persona y corrida: el resto va al resumen.
  const aProcesar: Entrega[] = [];
  for (const lista of nuevasPorPersona.values()) {
    let inmediatos = 0;
    for (const e of lista) {
      if (e.inmediato) {
        if (inmediatos < cfg.maxInmediatos) inmediatos++;
        else e.inmediato = false;
      }
      // Lo que no es urgente solo se procesa a partir de la hora del resumen.
      if (e.inmediato || conResumen) aProcesar.push(e);
    }
  }

  const destinatarios = new Set<string>();
  for (const e of aProcesar) {
    res.porTipo[e.r.tipo] = (res.porTipo[e.r.tipo] ?? 0) + 1;
    destinatarios.add(e.wallet);
  }
  res.destinatarios = destinatarios.size;

  // 4. Simulación: solo conteos, sin escribir ni enviar.
  if (simular) {
    res.inmediatos = aProcesar.filter((e) => e.inmediato).length;
    return res;
  }

  // 5. Reserva: aviso + fila de reminders_sent, en una transacción síncrona por entrega.
  const creadoEn = instanteDb(ahora);
  const reservar = db.transaction((e: Entrega): boolean => {
    if (yaProcesada.get(e.r.clave, e.wallet)) return false;
    const creado = crearAviso(
      db,
      { wallet: e.wallet, clave: e.r.clave, tipo: e.r.tipo, assignmentId: e.r.assignmentId, texto: e.r.texto },
      ahora
    );
    db.prepare(
      `INSERT INTO reminders_sent (clave, wallet, dia, is_inmediato, is_telegram, created_at) VALUES (?, ?, ?, ?, 0, ?)`
    ).run(e.r.clave, e.wallet, hoy, e.inmediato ? 1 : 0, creadoEn);
    return creado;
  });
  for (const e of aProcesar) {
    try {
      if (reservar(e)) res.avisosCreados++;
    } catch (err) {
      if (!esChoqueUnico(err)) res.errores++; // un UNIQUE es "ya procesado", no un error
    }
  }

  // 6. Telegram, fuera de toda transacción.
  const transport = opts.transport !== undefined ? opts.transport : transportePorDefecto();
  if (!transport) return res;
  const appUrl = opts.appUrl ?? appBaseUrl();
  const diaAnterior = diasHabilesAntes(hoy, 1, cfg);
  const personas = new Set<string>([...enPlan.keys()].map((k) => k.slice(k.indexOf("|") + 1)));
  const filasDe = db.prepare(
    `SELECT id, clave, wallet, dia, is_inmediato, is_telegram FROM reminders_sent
      WHERE wallet = ? AND is_telegram = 0 AND dia >= ?
      ORDER BY id`
  );
  const digestEnviado = db.prepare(`SELECT id, is_telegram FROM reminders_sent WHERE clave = ? AND wallet = ?`);
  const claveDigest = `digest:${hoy}`;

  for (const w of personas) {
    const chat = chatDe(db, cache, w);
    if (chat === null) continue;
    const filas = (filasDe.all(w, diaAnterior) as FilaEnviado[]).filter((f) => enPlan.has(`${f.clave}|${w}`));

    // Inmediatos de hoy: un solo mensaje con todos.
    const inmediatas = filas.filter((f) => Number(f.is_inmediato) === 1 && f.dia === hoy);
    if (inmediatas.length > 0) {
      const items = inmediatas.map((f) => enPlan.get(`${f.clave}|${w}`) as Recordatorio);
      try {
        await sendMessage(transport, chat, { text: renderInmediatos(items, appUrl) });
        marcarTelegram(db, inmediatas.map((f) => Number(f.id)));
        res.inmediatosEnviados++;
      } catch {
        res.errores++; // siguen en is_telegram = 0: se reintentan en la corrida siguiente
      }
    }

    // Resumen del día: uno por persona y día.
    if (horaLocal(ahora, cfg.tz) < cfg.digestHora) continue;
    const marca = digestEnviado.get(claveDigest, w) as { id: number; is_telegram: number } | undefined;
    if (marca && Number(marca.is_telegram) === 1) continue;
    const resumen = filas.filter((f) => Number(f.is_inmediato) === 0);
    if (resumen.length === 0) continue;
    const items = resumen.map((f) => enPlan.get(`${f.clave}|${w}`) as Recordatorio);
    try {
      await sendMessage(transport, chat, { text: renderDigest(items, appUrl) });
      db.transaction(() => {
        if (marca) {
          db.prepare(`UPDATE reminders_sent SET is_telegram = 1 WHERE id = ?`).run(marca.id);
        } else {
          db.prepare(
            `INSERT INTO reminders_sent (clave, wallet, dia, is_inmediato, is_telegram, created_at) VALUES (?, ?, ?, 0, 1, ?)`
          ).run(claveDigest, w, hoy, creadoEn);
        }
        marcarTelegram(db, resumen.map((f) => Number(f.id)));
      })();
      res.digestEnviados++;
    } catch {
      res.errores++;
    }
  }
  return res;
}
