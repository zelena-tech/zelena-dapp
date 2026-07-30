/**
 * Roles del registro de contribuidor y roster real del equipo (WP14, plano 07 §5).
 *
 * DOS EJES INDEPENDIENTES, a propósito:
 *  - `role` (founder | core | contributor) = posición en el registro. Los valores
 *    son los de WP13 para que el login Entra no tenga que inventar nada.
 *  - `is_supervisor` = flag SEPARADO. Supervisor NO puede ser un valor de `role`
 *    porque el plano 07 §5 dice: John `founder`; Vale, Juan, David, Fausto y Angela
 *    `core`; supervisores del dashboard = John + Vale. Vale es `core` Y supervisora.
 *
 * Módulo PURO: sin DB, sin cookies, sin HTTP. WP15 (dashboard) y WP19 (bot) deben
 * consumir `puedeVerTodoElEquipo` y no reimplementar la regla de visibilidad.
 */

export const ROLES = ["founder", "core", "contributor"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/**
 * Principal placeholder del roster. Los 6 del equipo aún NO tienen wallet Stellar
 * ni login Entra (eso es WP13), pero su trabajo ya tiene que existir en la dapp.
 * `pending:<slug>` es determinista: el mismo CSV importado dos veces resuelve al
 * mismo principal, y WP13 solo tiene que vincular la identidad real a esta fila.
 * NUNCA contiene correo ni ningún dato personal.
 */
export const PENDING_PREFIX = "pending:";

export function pendingPrincipal(slug: string): string {
  return PENDING_PREFIX + slug;
}

export function isPendingPrincipal(principal: string | null | undefined): boolean {
  return !!principal && principal.startsWith(PENDING_PREFIX);
}

export interface RosterMember {
  slug: string;
  /** Nombre visible. Sin apellidos ni correos: cero datos personales en el seed. */
  name: string;
  role: Role;
  isSupervisor: boolean;
  /** Dominio del que es dueño de punta a punta (plano 07 §2). */
  domain: string;
  /** Cómo aparece esta persona en la columna Assignee de los CSV de John. */
  aliases: string[];
}

/** Roster del equipo vertical (plano 07 §2 y §5). Orden estable. */
export const TEAM_ROSTER: readonly RosterMember[] = [
  {
    slug: "john",
    name: "John",
    role: "founder",
    isSupervisor: true,
    domain: "Visión, clientes, portafolio y gates de inversión",
    aliases: ["John"],
  },
  {
    slug: "vale",
    name: "Vale",
    role: "core",
    isSupervisor: true,
    domain: "Sistema operativo: procesos, calidad de specs, ritos y épocas",
    aliases: ["Vale", "Valentina"],
  },
  {
    slug: "juan",
    name: "Juan",
    role: "core",
    isSupervisor: false,
    domain: "FinOps: control financiero, contratos y pagos",
    aliases: ["Juan"],
  },
  {
    slug: "david",
    name: "David",
    role: "core",
    isSupervisor: false,
    domain: "BI, front-end y experiencia de uso",
    aliases: ["David"],
  },
  {
    slug: "fausto",
    name: "Fausto",
    role: "core",
    isSupervisor: false,
    domain: "DevOps, backend, arquitectura e integraciones",
    aliases: ["Fausto"],
  },
  {
    slug: "angela",
    name: "Angela",
    role: "core",
    isSupervisor: false,
    domain: "Contenido y comunicación",
    aliases: ["Angela", "Ángela"],
  },
] as const;

/** Normaliza para comparar nombres del CSV: sin acentos, sin caso, sin espacios extra. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Resuelve un nombre del CSV (John, Vale, Ángela…) a su miembro del roster. */
export function findRosterMember(name: string): RosterMember | undefined {
  const n = normalizeName(name);
  if (!n) return undefined;
  return TEAM_ROSTER.find(
    (m) => m.slug === n || m.aliases.some((a) => normalizeName(a) === n)
  );
}

/** Miembro del roster a partir de su principal (`pending:<slug>`). */
export function rosterByPrincipal(principal: string | null | undefined): RosterMember | undefined {
  if (!isPendingPrincipal(principal)) return undefined;
  const slug = principal!.slice(PENDING_PREFIX.length);
  return TEAM_ROSTER.find((m) => m.slug === slug);
}

/**
 * Quien ejecuta una acción del módulo equipo. `wallet` es la PK real de `users`
 * (o el principal `pending:<slug>` mientras no haya wallet).
 */
export interface TeamActor {
  wallet: string;
  name: string;
  role: Role;
  isSupervisor: boolean;
}

/** Claims mínimos que puede traer una sesión (cookies previas a WP14 no traen role). */
export interface RoleClaims {
  role?: string | null;
  isSupervisor?: boolean | null;
  isFounder?: boolean | null;
}

/**
 * Rol efectivo con fallback retrocompatible: una cookie firmada ANTES de WP14 no
 * trae `role`, así que se deriva de `isFounder` (founder o contributor). Nunca
 * inventa `core`: ese rol lo otorga el alta por Entra (WP13) o el seed del roster.
 */
export function effectiveRole(claims: RoleClaims): Role {
  if (isRole(claims.role)) return claims.role;
  return claims.isFounder ? "founder" : "contributor";
}

/** Flag de supervisión con fallback: el founder supervisa por definición. */
export function effectiveIsSupervisor(claims: RoleClaims): boolean {
  if (typeof claims.isSupervisor === "boolean") return claims.isSupervisor;
  return !!claims.isFounder;
}

/**
 * ÚNICA regla de visibilidad del módulo equipo (criterio 2 de WP14):
 * founder y supervisores ven el trabajo de todo el equipo; cualquier otro rol ve
 * SOLO sus propias asignaciones. WP15 y WP19 deben llamar a esta función.
 *
 * Ojo: esto NO es un permiso para juzgar a nadie. Ver todo el equipo sirve para
 * destrabar entregas y repartir carga (doc 16: carga visible, no punitiva).
 */
export function puedeVerTodoElEquipo(claims: RoleClaims): boolean {
  return effectiveRole(claims) === "founder" || effectiveIsSupervisor(claims);
}

/** Etiqueta humana del rol para la UI. */
export const ROLE_LABEL: Record<Role, string> = {
  founder: "Founder",
  core: "Core",
  contributor: "Contribuidor",
};
