/**
 * Talento (WP31-A2, spec §5.A.5 y §5.A.7): directorio de personas, rol y
 * supervisión, y el roster como DATO.
 *
 * Reglas que este archivo hace cumplir:
 *  - Las personas y sus roles son datos de la base: se cambian desde
 *    `/equipo/talento`, nunca en código. `seedTeamRoster` solo inserta lo que falta
 *    y respeta `roster_links`, así que un cambio hecho aquí sobrevive al reinicio.
 *  - Solo el founder cambia roles, supervisión y vínculos; nunca sobre sí mismo
 *    (`mismaPersona`, sus dos identidades cuentan como una) ni sobre otro founder.
 *    El founder se reconoce por su rol en la base y por el roster, NUNCA comparando
 *    con `FOUNDER_WALLET`.
 *  - `abiertas` es carga para repartir trabajo (R3), nunca una medida de calidad. El
 *    directorio va por orden alfabético: no hay posiciones ni rankings de personas.
 *  - `vincularPrincipal` es la única operación autorizada a reescribir wallets en
 *    tablas históricas (spec §3.1). No toca historia sellada (épocas no `Open`, ritos
 *    `Closed`) y nunca borra lo ganado: los ledgers se MUEVEN a la cuenta real.
 *  - Cada cambio deja una fila en `talent_events` que describe el cambio, nunca a
 *    la persona.
 *
 * Cadena del CLI (`team-import.ts` → aquí): imports de valor con sufijo `.ts`,
 * sintaxis borrable y nada de `db.ts` salvo su tipo.
 */
import { z } from "zod";
import type { DB } from "./db";
import {
  PENDING_PREFIX,
  TEAM_ROSTER,
  effectiveRole,
  isPendingPrincipal,
  isRole,
  pendingPrincipal,
  rosterByPrincipal,
  type Role,
  type RosterMember,
  type TeamActor,
} from "./roles.ts";
import { mismaPersona } from "./identidades.ts";
import { TeamError } from "./team.ts";

// ---------------------------------------------------------------------------
// Vocabulario de proyecto
// ---------------------------------------------------------------------------

/**
 * Mismo vocabulario que `ROLES_PROYECTO` / `RolProyecto` de `roles.ts` (WP31-A,
 * spec §5.A.1). Se declara aquí, con la forma exacta del spec, para no depender
 * de un paquete aún sin fusionar; es estructuralmente idéntico al de A.
 */
const ORDEN_ROLES_PROYECTO = ["estructura", "ejecuta", "revisa", "vende"] as const;
type RolProyecto = (typeof ORDEN_ROLES_PROYECTO)[number];

function rangoRolProyecto(r: string): number {
  const i = (ORDEN_ROLES_PROYECTO as readonly string[]).indexOf(r);
  return i === -1 ? ORDEN_ROLES_PROYECTO.length : i;
}

/** Jerarquía de `role` para quedarse con el más alto al vincular. */
const RANGO_ROL: Record<Role, number> = { contributor: 0, core: 1, founder: 2 };

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

interface FilaUsuario {
  wallet: string;
  display_name: string;
  role: string;
  is_supervisor: number;
  is_founder: number;
  is_demo: number;
  cla_signed: number;
  status: string;
}

function usuario(db: DB, wallet: string): FilaUsuario | undefined {
  return db
    .prepare(
      `SELECT wallet, display_name, role, is_supervisor, is_founder, is_demo, cla_signed, status
         FROM users WHERE wallet = ?`
    )
    .get(wallet) as FilaUsuario | undefined;
}

/** Rol leído de la base; un valor corrupto cae a lo que diga `is_founder`. */
function rolDe(u: Pick<FilaUsuario, "role" | "is_founder">): Role {
  return isRole(u.role) ? u.role : effectiveRole({ isFounder: !!u.is_founder });
}

function exigirFounder(actor: TeamActor, que: string): void {
  if (actor.role !== "founder") throw new TeamError(403, `Solo el founder ${que}.`);
}

function slugsFounder(): string[] {
  return TEAM_ROSTER.filter((m) => m.role === "founder").map((m) => m.slug);
}

function slugVinculado(db: DB, slug: string): string | null {
  const r = db.prepare(`SELECT wallet FROM roster_links WHERE slug = ?`).get(slug) as { wallet: string } | undefined;
  return r?.wallet ?? null;
}

function registrarEvento(
  db: DB,
  e: { actor: string; target: string | null; action: string; detail: unknown; initiativeId?: number | null }
): void {
  db.prepare(
    `INSERT INTO talent_events (actor_wallet, target_wallet, initiative_id, action, detail) VALUES (?, ?, ?, ?, ?)`
  ).run(e.actor, e.target, e.initiativeId ?? null, e.action, JSON.stringify(e.detail));
}

/**
 * ¿Existe la columna? `PRAGMA table_info` en SQLite. En Azure SQL el PRAGMA es un
 * no-op que devuelve vacío para TODA tabla: si ni siquiera `users` (que siempre
 * existe) responde, se asume el esquema completo de `schema.sql`.
 */
function columnaExiste(db: DB, tabla: string, columna: string): boolean {
  const cols = (t: string): string[] => {
    try {
      return (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    } catch {
      return [];
    }
  };
  const lista = cols(tabla);
  if (lista.length > 0) return lista.includes(columna);
  return cols("users").length === 0;
}

// ---------------------------------------------------------------------------
// Roster como dato
// ---------------------------------------------------------------------------

/** Wallet de un slug del roster: la vinculada (`roster_links`) o `pending:<slug>` si existe; si no, null. */
export function walletDeRoster(db: DB, slug: string): string | null {
  const vinculada = slugVinculado(db, slug);
  if (vinculada) return vinculada;
  const pendiente = pendingPrincipal(slug);
  return db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(pendiente) ? pendiente : null;
}

/** Miembro del roster de una wallet: por su principal `pending:<slug>` o por `roster_links`. */
export function rosterMemberFor(db: DB, wallet: string): RosterMember | undefined {
  if (isPendingPrincipal(wallet)) return rosterByPrincipal(wallet);
  const r = db.prepare(`SELECT slug FROM roster_links WHERE wallet = ?`).get(wallet) as { slug: string } | undefined;
  return r ? TEAM_ROSTER.find((m) => m.slug === r.slug) : undefined;
}

// ---------------------------------------------------------------------------
// Directorio
// ---------------------------------------------------------------------------

export interface PersonaDirectorio {
  wallet: string;
  nombre: string;
  role: Role;
  isSupervisor: boolean;
  status: string;
  /** Principal `pending:<slug>` sin vincular. */
  pendiente: boolean;
  tieneCla: boolean;
  /** Derivado de sus membresías (null = sin proyectos). */
  vinculo: "interno" | "externo" | "mixto" | null;
  /** Piezas abiertas a su nombre: carga para repartir (R3), nunca calidad. */
  abiertas: number;
  membresias: Array<{ initiativeId: number; slug: string; nombre: string; roles: RolProyecto[] }>;
}

/**
 * Personas del registro (sin cuentas demo), por orden de nombre.
 *
 * Filtro Interno · Externo: con proyectos manda el vínculo de sus membresías (una
 * persona `mixto` aparece en los dos); sin proyectos, el vínculo por defecto del
 * spec §4.A.2: `externo` si es contributor, si no `interno`.
 */
export function directorioTalento(db: DB, filtro?: { vinculo?: "interno" | "externo" }): PersonaDirectorio[] {
  const filas = db
    .prepare(
      `SELECT wallet, display_name, role, is_supervisor, is_founder, is_demo, cla_signed, status
         FROM users WHERE is_demo = 0`
    )
    .all() as FilaUsuario[];

  const vinculados = new Set(
    (db.prepare(`SELECT slug FROM roster_links`).all() as Array<{ slug: string }>).map((r) => r.slug)
  );

  const abiertasPor = new Map<string, number>();
  for (const r of db
    .prepare(
      `SELECT owner_wallet AS w, COUNT(*) AS n FROM assignments
        WHERE owner_wallet IS NOT NULL AND status <> 'Hecha' GROUP BY owner_wallet`
    )
    .all() as Array<{ w: string; n: number }>) {
    abiertasPor.set(r.w, Number(r.n));
  }

  type Mem = { initiativeId: number; slug: string; nombre: string; roles: RolProyecto[]; vinculos: Set<string> };
  const membresiasPor = new Map<string, Map<number, Mem>>();
  for (const m of db
    .prepare(
      `SELECT pm.wallet, pm.initiative_id, pm.rol_proyecto, pm.vinculo, i.slug, i.name
         FROM project_members pm JOIN initiatives i ON i.id = pm.initiative_id
        ORDER BY i.name, pm.id`
    )
    .all() as Array<{
    wallet: string;
    initiative_id: number;
    rol_proyecto: string;
    vinculo: string;
    slug: string;
    name: string;
  }>) {
    let porProyecto = membresiasPor.get(m.wallet);
    if (!porProyecto) {
      porProyecto = new Map();
      membresiasPor.set(m.wallet, porProyecto);
    }
    let mem = porProyecto.get(m.initiative_id);
    if (!mem) {
      mem = { initiativeId: m.initiative_id, slug: m.slug, nombre: m.name, roles: [], vinculos: new Set() };
      porProyecto.set(m.initiative_id, mem);
    }
    if ((ORDEN_ROLES_PROYECTO as readonly string[]).includes(m.rol_proyecto) && !mem.roles.includes(m.rol_proyecto as RolProyecto)) {
      mem.roles.push(m.rol_proyecto as RolProyecto);
    }
    mem.vinculos.add(m.vinculo === "externo" ? "externo" : "interno");
  }

  const personas: PersonaDirectorio[] = filas.map((u) => {
    const mems = [...(membresiasPor.get(u.wallet)?.values() ?? [])];
    const vinculos = new Set<string>();
    for (const m of mems) for (const v of m.vinculos) vinculos.add(v);
    const vinculo: PersonaDirectorio["vinculo"] =
      vinculos.size === 0 ? null : vinculos.size > 1 ? "mixto" : vinculos.has("externo") ? "externo" : "interno";
    const pendiente = isPendingPrincipal(u.wallet) && !vinculados.has(u.wallet.slice(PENDING_PREFIX.length));
    return {
      wallet: u.wallet,
      nombre: u.display_name,
      role: rolDe(u),
      isSupervisor: !!u.is_supervisor,
      status: u.status,
      pendiente,
      tieneCla: !!u.cla_signed,
      vinculo,
      abiertas: abiertasPor.get(u.wallet) ?? 0,
      membresias: mems.map((m) => ({
        initiativeId: m.initiativeId,
        slug: m.slug,
        nombre: m.nombre,
        roles: [...m.roles].sort((a, b) => rangoRolProyecto(a) - rangoRolProyecto(b)),
      })),
    };
  });

  const quiere = filtro?.vinculo;
  const filtradas = quiere
    ? personas.filter((p) => {
        if (p.vinculo === null) return quiere === (p.role === "contributor" ? "externo" : "interno");
        return p.vinculo === "mixto" || p.vinculo === quiere;
      })
    : personas;

  return filtradas.sort(
    (a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }) || a.wallet.localeCompare(b.wallet)
  );
}

/**
 * Cuentas reales con las que se puede vincular una fila del roster: no `pending:`,
 * con acuerdo firmado y sin `roster_links`. Sin cuentas demo, salvo la excepción del
 * founder (§5.A.7): una demo con `role='founder'`. Con `slug`, esa excepción solo
 * aplica si el slug es el del founder en el roster.
 */
export function candidatosAVincular(db: DB, slug?: string): Array<{ wallet: string; nombre: string }> {
  const excepcionPosible = slug === undefined || slugsFounder().includes(slug);
  const filas = db
    .prepare(
      `SELECT u.wallet, u.display_name, u.is_demo, u.role FROM users u
        WHERE u.cla_signed = 1
          AND NOT EXISTS (SELECT 1 FROM roster_links r WHERE r.wallet = u.wallet)`
    )
    .all() as Array<{ wallet: string; display_name: string; is_demo: number; role: string }>;
  return filas
    .filter((u) => !isPendingPrincipal(u.wallet))
    .filter((u) => !u.is_demo || (excepcionPosible && u.role === "founder"))
    .map((u) => ({ wallet: u.wallet, nombre: u.display_name }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }) || a.wallet.localeCompare(b.wallet));
}

// ---------------------------------------------------------------------------
// Rol y supervisión (solo founder)
// ---------------------------------------------------------------------------

/** Persona sobre la que el founder puede actuar: existe, no es demo, no es él mismo ni un founder. */
function personaEditable(db: DB, actor: TeamActor, wallet: string): FilaUsuario {
  const u = usuario(db, wallet);
  if (!u) throw new TeamError(404, "Esa persona no está en el registro.");
  if (u.is_demo) throw new TeamError(400, "Las cuentas de demostración no se editan aquí.");
  if (mismaPersona(db, actor.wallet, wallet)) {
    throw new TeamError(403, "Tus propios roles los cambia otra persona.");
  }
  if (rolDe(u) === "founder") throw new TeamError(403, "El rol de founder no se cambia desde aquí.");
  return u;
}

/** Piezas abiertas de la persona en proyectos donde no es miembro (o sin proyecto). */
function abiertasFueraDeSusProyectos(db: DB, wallet: string): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM assignments a
        WHERE a.owner_wallet = ? AND a.status <> 'Hecha'
          AND (a.initiative_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM project_members pm
                 WHERE pm.initiative_id = a.initiative_id AND pm.wallet = a.owner_wallet))`
    )
    .get(wallet) as { n: number };
  return Number(r.n);
}

function abiertasDe(db: DB, wallet: string): number {
  const r = db
    .prepare(`SELECT COUNT(*) AS n FROM assignments WHERE owner_wallet = ? AND status <> 'Hecha'`)
    .get(wallet) as { n: number };
  return Number(r.n);
}

/**
 * Cambia `core ↔ contributor`. Solo founder; el rol `founder` no se asigna desde la
 * UI. Pasar a `contributor` a alguien con piezas abiertas fuera de sus proyectos
 * → 409 (perdería el acceso a su propio trabajo: un contributor solo ve sus
 * proyectos). Por la misma razón, si tiene piezas abiertas y no firmó el acuerdo
 * (sin acuerdo un contributor no entra a `/equipo`) → 409.
 */
export function cambiarRol(db: DB, actor: TeamActor, input: { wallet: string; role: "core" | "contributor" }): void {
  exigirFounder(actor, "cambia roles");
  if (input.role !== "core" && input.role !== "contributor") {
    throw new TeamError(400, "Ese rol no se asigna desde aquí.");
  }
  const u = personaEditable(db, actor, input.wallet);
  const antes = rolDe(u);
  if (antes === input.role) return;
  if (input.role === "contributor") {
    if (abiertasFueraDeSusProyectos(db, u.wallet) > 0) {
      throw new TeamError(409, "Primero reasigna sus entregas abiertas o súmale a esos proyectos.");
    }
    if (!u.cla_signed && abiertasDe(db, u.wallet) > 0) {
      throw new TeamError(409, "Primero tiene que firmar el acuerdo de contribución.");
    }
  }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET role = ? WHERE wallet = ?`).run(input.role, u.wallet);
    registrarEvento(db, { actor: actor.wallet, target: u.wallet, action: "rol", detail: { de: antes, a: input.role } });
  });
  tx();
}

/** Da o quita supervisión. Solo founder; nunca sobre sí mismo ni sobre un founder. */
export function cambiarSupervisor(db: DB, actor: TeamActor, input: { wallet: string; isSupervisor: boolean }): void {
  exigirFounder(actor, "da o quita supervisión");
  const u = personaEditable(db, actor, input.wallet);
  const antes = !!u.is_supervisor;
  if (antes === input.isSupervisor) return;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET is_supervisor = ? WHERE wallet = ?`).run(input.isSupervisor ? 1 : 0, u.wallet);
    registrarEvento(db, {
      actor: actor.wallet,
      target: u.wallet,
      action: "supervisor",
      detail: { de: antes, a: input.isSupervisor },
    });
  });
  tx();
}

// ---------------------------------------------------------------------------
// Vinculación de una fila del roster con la cuenta real (§5.A.7)
// ---------------------------------------------------------------------------

/**
 * TODAS las columnas de wallet del esquema que una vinculación mueve. `unicaCon` =
 * columnas que forman UNIQUE con la wallet: antes de mover se descartan las filas
 * del pending que chocarían con una del destino (gana el destino). `[]` = la wallet
 * sola es única (una fila de Telegram por persona: se conserva la del destino).
 *
 * Quedan fuera a propósito: `users.wallet` (la PK; la fila pending se borra),
 * `cla_signatures.wallet` (precondición: el pending no puede tener firmas),
 * `talent_events.*` (historia) y `roster_links.*` (lo escribe la vinculación).
 * El test de introspección de `team-talento.test.ts` recorre `schema.sql` y falla si
 * aparece una columna de wallet que no esté aquí.
 */
export const REFERENCIAS_WALLET: ReadonlyArray<{ tabla: string; columna: string; unicaCon?: readonly string[] }> = [
  { tabla: "assignments", columna: "owner_wallet" },
  { tabla: "assignments", columna: "created_by" },
  { tabla: "assignment_events", columna: "actor_wallet" },
  { tabla: "checkins", columna: "wallet", unicaCon: ["day"] },
  { tabla: "project_members", columna: "wallet", unicaCon: ["initiative_id", "rol_proyecto"] },
  { tabla: "project_members", columna: "added_by" },
  { tabla: "client_members", columna: "wallet", unicaCon: ["client_id"] },
  { tabla: "telegram_links", columna: "wallet", unicaCon: [] },
  { tabla: "user_emails", columna: "wallet" },
  { tabla: "notes", columna: "author" },
  { tabla: "bot_drafts", columna: "wallet" },
  { tabla: "bot_actions", columna: "wallet" },
  { tabla: "points_ledger", columna: "wallet" },
  { tabla: "reputation_events", columna: "wallet" },
  { tabla: "users", columna: "invited_by" },
  { tabla: "invites", columna: "issuer_wallet" },
  { tabla: "invites", columna: "used_by" },
  { tabla: "projects", columna: "supervisor_wallet" },
  { tabla: "projects", columna: "assignee_wallet" },
  { tabla: "applications", columna: "wallet", unicaCon: ["project_id"] },
  { tabla: "votes", columna: "wallet", unicaCon: ["proposal_id"] },
  { tabla: "academia_awards", columna: "wallet", unicaCon: ["content_id"] },
  { tabla: "reading_sessions", columna: "wallet" },
  { tabla: "credential_inventory", columna: "owner_wallet" },
  { tabla: "credential_access_log", columna: "wallet" },
  { tabla: "graph_imports", columna: "imported_by" },
  { tabla: "rite_sessions", columna: "host_wallet" },
  { tabla: "rite_sessions", columna: "recorder_wallet" },
  { tabla: "rite_sessions", columna: "created_by" },
  { tabla: "rite_attendance", columna: "wallet", unicaCon: ["session_id", "layer"] },
  { tabla: "avisos", columna: "wallet", unicaCon: ["clave"] },
  { tabla: "reminders_sent", columna: "wallet", unicaCon: ["clave"] },
];

export const HISTORIA_SELLADA =
  "Esta cuenta tiene historia en una época o un rito ya cerrados: su huella no se puede reescribir.";

/** Centinela interno de la simulación: fuerza el ROLLBACK y se atrapa fuera. */
class SimulacionVinculo extends Error {
  constructor() {
    super("simulación de vinculación");
    this.name = "SimulacionVinculo";
  }
}

function contar(db: DB, sql: string, ...params: unknown[]): number {
  return Number((db.prepare(sql).get(...params) as { n: number } | undefined)?.n ?? 0);
}

/**
 * ¿Tiene la fila historia que ya entró en una raíz anclada o en el hash de un rito
 * cerrado? Puntos o reputación en épocas que no están `Open`, o asistencia,
 * anfitrionía o relatoría en ritos `Closed`. Una fila de ledger cuya época no
 * existe no está sellada (no hay raíz que la contenga).
 */
function tieneHistoriaSellada(db: DB, wallet: string): boolean {
  if (
    contar(
      db,
      `SELECT COUNT(*) AS n FROM points_ledger l JOIN periods p ON p.id = l.period_id
        WHERE l.wallet = ? AND p.state <> 'Open'`,
      wallet
    ) > 0
  ) {
    return true;
  }
  if (
    contar(
      db,
      `SELECT COUNT(*) AS n FROM reputation_events r JOIN periods p ON p.id = r.period_id
        WHERE r.wallet = ? AND p.state <> 'Open'`,
      wallet
    ) > 0
  ) {
    return true;
  }
  if (
    columnaExiste(db, "rite_attendance", "wallet") &&
    contar(
      db,
      `SELECT COUNT(*) AS n FROM rite_attendance a JOIN rite_sessions s ON s.id = a.session_id
        WHERE a.wallet = ? AND s.state = 'Closed'`,
      wallet
    ) > 0
  ) {
    return true;
  }
  if (
    columnaExiste(db, "rite_sessions", "host_wallet") &&
    contar(
      db,
      `SELECT COUNT(*) AS n FROM rite_sessions
        WHERE state = 'Closed' AND (host_wallet = ? OR recorder_wallet = ?)`,
      wallet,
      wallet
    ) > 0
  ) {
    return true;
  }
  return false;
}

export interface ResultadoVinculo {
  movidas: Record<string, number>;
  descartadas: Record<string, number>;
  simulado: boolean;
}

/**
 * Vincula la fila del roster `pending:<slug>` con la cuenta real con la que la
 * persona ya entró: su trabajo, sus puntos y su historial pasan a esa cuenta.
 *
 * Solo founder. Precondiciones: el pending existe y no tiene firmas del acuerdo; la
 * cuenta existe, no es `pending:`, no está vinculada, firmó el acuerdo y no es demo
 * (salvo la excepción del founder: slug del founder en el roster + destino con
 * `role='founder'`, que queda con `is_demo=0`). Sin historia sellada (409).
 *
 * En UNA transacción: por cada `(tabla, columna)` de `REFERENCIAS_WALLET` que exista,
 * descarta los choques de `unicaCon` (gana el destino) y mueve el resto; luego
 * `users(wallet)` toma el rol más alto y la supervisión de los dos (conserva su
 * nombre), se borra `users(pending)`, se inserta `roster_links` y se escribe
 * `talent_events` con los conteos exactos. `simular: true` hace todo lo anterior y
 * revierte: devuelve los mismos conteos sin dejar huella.
 *
 * No llamar dentro de otra transacción: con `node:sqlite` una transacción anidada se
 * une a la externa y la simulación no podría revertirse sola.
 */
export function vincularPrincipal(
  db: DB,
  actor: TeamActor,
  input: { slug: string; wallet: string; simular?: boolean }
): ResultadoVinculo {
  exigirFounder(actor, "vincula filas del equipo");
  const slug = (input.slug ?? "").trim();
  const wallet = (input.wallet ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug)) throw new TeamError(400, "Esa fila del equipo no es válida.");
  if (!wallet) throw new TeamError(400, "Elige la cuenta con la que entró la persona.");

  if (slugVinculado(db, slug)) throw new TeamError(409, "Esa fila del equipo ya está vinculada.");
  const pending = pendingPrincipal(slug);
  const p = usuario(db, pending);
  if (!p) throw new TeamError(404, "Esa fila del equipo no existe.");

  if (isPendingPrincipal(wallet)) {
    throw new TeamError(400, "Vincúlala con la cuenta real de la persona, no con otra fila del equipo.");
  }
  const d = usuario(db, wallet);
  if (!d) throw new TeamError(404, "Esa cuenta no está en el registro.");
  if (db.prepare(`SELECT slug FROM roster_links WHERE wallet = ?`).get(wallet)) {
    throw new TeamError(409, "Esa cuenta ya está vinculada a otra fila del equipo.");
  }
  // Excepción del founder: por rol en la base y por el roster, nunca por FOUNDER_WALLET.
  const excepcionFounder = slugsFounder().includes(slug) && rolDe(d) === "founder";
  if (d.is_demo && !excepcionFounder) throw new TeamError(400, "Las cuentas de demostración no se vinculan.");
  if (!d.cla_signed) throw new TeamError(409, "Primero tiene que firmar el acuerdo de contribución.");
  if (contar(db, `SELECT COUNT(*) AS n FROM cla_signatures WHERE wallet = ?`, pending) > 0) {
    throw new TeamError(409, "Esta fila del equipo ya tiene un acuerdo firmado: no se puede fusionar con otra cuenta.");
  }
  if (tieneHistoriaSellada(db, pending)) throw new TeamError(409, HISTORIA_SELLADA);

  const movidas: Record<string, number> = {};
  const descartadas: Record<string, number> = {};
  const simular = !!input.simular;

  const tx = db.transaction(() => {
    for (const ref of REFERENCIAS_WALLET) {
      if (!columnaExiste(db, ref.tabla, ref.columna)) continue;
      const clave = `${ref.tabla}.${ref.columna}`;
      if (ref.unicaCon) {
        const choque = ref.unicaCon.map((c) => ` AND d.${c} = ${ref.tabla}.${c}`).join("");
        const r = db
          .prepare(
            `DELETE FROM ${ref.tabla} WHERE ${ref.columna} = ?
               AND EXISTS (SELECT 1 FROM ${ref.tabla} d WHERE d.${ref.columna} = ?${choque})`
          )
          .run(pending, wallet);
        const n = Number(r.changes);
        if (n > 0) descartadas[clave] = n;
      }
      const r = db.prepare(`UPDATE ${ref.tabla} SET ${ref.columna} = ? WHERE ${ref.columna} = ?`).run(wallet, pending);
      const n = Number(r.changes);
      if (n > 0) movidas[clave] = n;
    }

    const rolP = rolDe(p);
    const rolD = rolDe(d);
    const rol = RANGO_ROL[rolP] > RANGO_ROL[rolD] ? rolP : rolD;
    const supervisor = p.is_supervisor || d.is_supervisor ? 1 : 0;
    db.prepare(`UPDATE users SET role = ?, is_supervisor = ?, is_demo = ? WHERE wallet = ?`).run(
      rol,
      supervisor,
      excepcionFounder ? 0 : d.is_demo,
      wallet
    );
    db.prepare(`DELETE FROM users WHERE wallet = ?`).run(pending);
    db.prepare(`INSERT INTO roster_links (slug, wallet, linked_by) VALUES (?, ?, ?)`).run(slug, wallet, actor.wallet);
    registrarEvento(db, {
      actor: actor.wallet,
      target: wallet,
      action: "vincular",
      detail: { slug, movidas, descartadas },
    });
    if (simular) throw new SimulacionVinculo();
  });

  try {
    tx();
  } catch (e) {
    if (!(e instanceof SimulacionVinculo)) throw e;
  }
  return { movidas, descartadas, simulado: simular };
}

/** Nombre legible de cada referencia, para la confirmación de la UI (sin datos personales). */
const ETIQUETA_REFERENCIA: Record<string, string> = {
  "assignments.owner_wallet": "entregas a su nombre",
  "assignments.created_by": "entregas que creó",
  "assignment_events.actor_wallet": "movimientos de entregas",
  "checkins.wallet": "check-ins",
  "project_members.wallet": "membresías de proyecto",
  "project_members.added_by": "membresías que dio",
  "client_members.wallet": "accesos a clientes",
  "telegram_links.wallet": "vínculo de Telegram",
  "user_emails.wallet": "correos vinculados",
  "notes.author": "notas",
  "bot_drafts.wallet": "borradores del bot",
  "bot_actions.wallet": "acciones del bot",
  "points_ledger.wallet": "registros de puntos",
  "reputation_events.wallet": "registros de reputación",
  "users.invited_by": "personas invitadas",
  "invites.issuer_wallet": "invitaciones emitidas",
  "invites.used_by": "invitaciones usadas",
  "projects.supervisor_wallet": "proyectos del Ágora que supervisa",
  "projects.assignee_wallet": "proyectos del Ágora a su cargo",
  "applications.wallet": "aplicaciones en el Ágora",
  "votes.wallet": "votos",
  "academia_awards.wallet": "premios de la Academia",
  "reading_sessions.wallet": "lecturas de la Academia",
  "credential_inventory.owner_wallet": "credenciales a su cargo",
  "credential_access_log.wallet": "consultas de credenciales",
  "graph_imports.imported_by": "importaciones del grafo",
  "rite_sessions.host_wallet": "ritos como anfitrión",
  "rite_sessions.recorder_wallet": "ritos como relator",
  "rite_sessions.created_by": "ritos que preparó",
  "rite_attendance.wallet": "asistencias a ritos",
  "avisos.wallet": "avisos",
  "reminders_sent.wallet": "recordatorios",
};

/**
 * Resumen de una vinculación (real o simulada) para la confirmación: total movido y
 * el detalle por tipo de registro ("3 entregas a su nombre, 12 movimientos…").
 */
export function describirVinculo(r: Pick<ResultadoVinculo, "movidas" | "descartadas">): {
  total: number;
  detalle: string;
  descartadas: number;
} {
  const partes = Object.entries(r.movidas)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${ETIQUETA_REFERENCIA[k] ?? k}`);
  return {
    total: Object.values(r.movidas).reduce((s, n) => s + n, 0),
    detalle: partes.join(", ") || "ningún registro",
    descartadas: Object.values(r.descartadas).reduce((s, n) => s + n, 0),
  };
}

// ---------------------------------------------------------------------------
// Validación de entrada (ruta /api/equipo/talento)
// ---------------------------------------------------------------------------

const walletCampo = z.string().trim().min(1, "Falta la persona.").max(120);

export const talentoAccionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rol"), wallet: walletCampo, role: z.enum(["core", "contributor"]) }),
  z.object({ action: z.literal("supervisor"), wallet: walletCampo, isSupervisor: z.boolean() }),
  z.object({
    action: z.literal("vincular"),
    slug: z.string().trim().min(1).max(60),
    wallet: walletCampo,
    simular: z.boolean().optional(),
  }),
]);
export type TalentoAccion = z.infer<typeof talentoAccionSchema>;
