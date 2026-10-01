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
import type { TeamAction } from "./team-state-machine.ts";

export const ROLES =["founder", "core", "contributor"] as const;
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

/**
 * ¿Es del EQUIPO INTERNO? El módulo `/equipo` (WP14/WP15) es el trabajo interno de
 * Zelena: backlog, cargas, bloqueos y check-ins.
 *
 * Esto NO es lo mismo que `puedeVerTodoElEquipo`: un `core` es del equipo interno
 * (ve el tablero de proyectos) pero no supervisa (no ve el dashboard de John). Y un
 * `contributor` de la comunidad no es equipo interno: entra por la puerta de
 * invitación al Ágora, la Academia y la gobernanza, que son sus espacios. Desde
 * WP31 entra también a `/equipo`, pero SOLO a los proyectos donde es miembro
 * (`permisosEnProyecto` más abajo y `equipoActor` en lib/authz.ts).
 *
 * Sin esta regla, cualquier sesión —incluida la de cualquier contribuidor de la
 * cohorte Génesis— podía leer el backlog interno completo en `/equipo/proyectos`.
 */
export function esEquipoInterno(claims: RoleClaims): boolean {
  const role = effectiveRole(claims);
  return role === "founder" || role === "core" || effectiveIsSupervisor(claims);
}

/** Etiqueta humana del rol para la UI. */
export const ROLE_LABEL: Record<Role, string> = {
  founder: "Founder",
  core: "Core",
  contributor: "Contribuidor",
};

// ---------------------------------------------------------------------------
// WP31 · Roles POR PROYECTO (iniciativa = proyecto)
// ---------------------------------------------------------------------------
//
// Un tercer eje, independiente de los dos de arriba: qué hace una persona DENTRO de
// un proyecto. La membresía (`project_members`) define qué ve y qué puede hacer cada
// quien en ese proyecto; el rol global (`role`, `is_supervisor`) sigue mandando para
// todo lo demás. Son roles, no personas: nada aquí nombra a nadie.
//
// Cuatro ojos: la revisión de una entrega es siempre de OTRA persona. Lo garantiza
// `puedeTransicionar` con los flags que calcula lib/team.ts (identidades, quien la
// envió a revisión y la relación de invitación).

export const ROLES_PROYECTO = ["estructura", "ejecuta", "revisa", "vende"] as const;
export type RolProyecto = (typeof ROLES_PROYECTO)[number];

export const ROL_PROYECTO_LABEL: Record<RolProyecto, string> = {
  estructura: "Estructura",
  ejecuta: "Ejecuta",
  revisa: "Revisa",
  vende: "Vende",
};

export const VINCULOS = ["interno", "externo"] as const;
export type Vinculo = (typeof VINCULOS)[number];

export function isRolProyecto(v: unknown): v is RolProyecto {
  return typeof v === "string" && (ROLES_PROYECTO as readonly string[]).includes(v);
}

export function isVinculo(v: unknown): v is Vinculo {
  return typeof v === "string" && (VINCULOS as readonly string[]).includes(v);
}

export interface PermisosProyecto {
  /** Ver el proyecto y su tablero. */
  ver: boolean;
  /** Crear entregas en el proyecto (para sí o sin dueño). */
  crear: boolean;
  /** Título, criterio, prioridad, tamaño, horizonte, fecha, responsable; mover piezas ajenas. */
  planificar: boolean;
  /** Aprobar o devolver entregas AJENAS. */
  revisar: boolean;
  /** Tomar una pieza sin dueño (acción `asignar` para sí). */
  tomar: boolean;
}

/** Ningún permiso: lo que recibe quien no ve el proyecto. */
export const SIN_PERMISOS: Readonly<PermisosProyecto> = Object.freeze({
  ver: false,
  crear: false,
  planificar: false,
  revisar: false,
  tomar: false,
});

const TODOS_LOS_PERMISOS: Readonly<PermisosProyecto> = Object.freeze({
  ver: true,
  crear: true,
  planificar: true,
  revisar: true,
  tomar: true,
});

/** Lo que da cada rol de proyecto (spec WP31 §5.A.1). */
const PERMISOS_POR_ROL: Record<RolProyecto, PermisosProyecto> = {
  estructura: { ver: true, crear: true, planificar: true, revisar: true, tomar: true },
  ejecuta: { ver: true, crear: true, planificar: false, revisar: false, tomar: true },
  revisa: { ver: true, crear: false, planificar: false, revisar: true, tomar: false },
  vende: { ver: true, crear: false, planificar: false, revisar: false, tomar: false },
};

/** Lo que da ser `core` aunque no tenga roles en el proyecto. */
const PERMISOS_CORE: PermisosProyecto = { ver: true, crear: true, planificar: false, revisar: false, tomar: true };

function unir(a: PermisosProyecto, b: PermisosProyecto): PermisosProyecto {
  return {
    ver: a.ver || b.ver,
    crear: a.crear || b.crear,
    planificar: a.planificar || b.planificar,
    revisar: a.revisar || b.revisar,
    tomar: a.tomar || b.tomar,
  };
}

/** ¿Founder o supervisor? Ven y planifican todo el equipo (misma regla de visibilidad). */
export function esGlobalProyecto(actor: { role: Role; isSupervisor: boolean }): boolean {
  return actor.role === "founder" || !!actor.isSupervisor;
}

/**
 * Permisos de una persona en un proyecto: el OR de lo que da cada fila que aplica.
 *
 * | Quién                           | ver | crear | planificar | revisar | tomar |
 * | founder o supervisor            |  ✓  |   ✓   |     ✓      |    ✓    |   ✓   |
 * | core (sin roles en el proyecto) |  ✓  |   ✓   |     –      |    –    |   ✓   |
 * | contributor sin roles           |  –  |   –   |     –      |    –    |   –   |
 * | rol estructura                  |  ✓  |   ✓   |     ✓      |    ✓    |   ✓   |
 * | rol ejecuta                     |  ✓  |   ✓   |     –      |    –    |   ✓   |
 * | rol revisa                      |  ✓  |   –   |     –      |    ✓    |   –   |
 * | rol vende                       |  ✓  |   –   |     –      |    –    |   –   |
 *
 * Puro: si el proyecto no es visible para la persona (p. ej. un proyecto de cliente
 * sin participación), lo resuelve `permisosDe` en lib/team.ts devolviendo todo en falso.
 */
export function permisosEnProyecto(
  actor: { role: Role; isSupervisor: boolean },
  roles: readonly RolProyecto[]
): PermisosProyecto {
  if (esGlobalProyecto(actor)) return { ...TODOS_LOS_PERMISOS };
  let p: PermisosProyecto = { ...SIN_PERMISOS };
  if (actor.role === "core") p = unir(p, PERMISOS_CORE);
  for (const r of roles) {
    if (isRolProyecto(r)) p = unir(p, PERMISOS_POR_ROL[r]);
  }
  return p;
}

/** Motivos de rechazo de `puedeTransicionar`: hablan de la entrega, nunca de la persona. */
export const MOTIVO_TRANSICION = {
  dueno: "Quien entrega no aprueba su propia entrega.",
  envio: "Quien la envió a revisión no la aprueba: la revisa otra persona.",
  invitacion: "Esta entrega la revisa otra persona: quien invita no evalúa a su invitado, ni al revés.",
  asignacion:
    "Esta entrega la aprueba otra persona: quien la asignó, o sumó al proyecto a quien la entrega, no la aprueba (sí puede pedir ajustes).",
  pendiente:
    "Esta entrega es de alguien del equipo que aún no vincula su cuenta: la revisa el founder o un supervisor.",
  revision: "La revisión es de quien revisa o estructura el proyecto.",
  conDueno: "Esta pieza ya tiene responsable.",
  tomar: "No puedes tomar trabajo en este proyecto.",
  mover: "Solo quien la tiene a cargo (o quien planifica el proyecto) puede moverla.",
} as const;

export interface TransicionInput {
  accion: TeamAction;
  /** identidadesDe(actor) incluye al dueño. */
  esDueno: boolean;
  sinDueno: boolean;
  permisos: PermisosProyecto;
  /** identidadesDe(actor) incluye a quien hizo el último `enviar_a_revision`. */
  esQuienEnvio?: boolean;
  /** B8: el actor invitó al dueño o el dueño al actor (false si el actor o el dueño es founder). */
  vinculoInvitacion?: boolean;
  /** El dueño es un `pending:<slug>` sin vincular. */
  duenoPendiente?: boolean;
  /** Founder o supervisor. */
  esGlobal?: boolean;
  /**
   * El actor sumó al dueño a este proyecto o le dio la pieza (el último crear, asignar o
   * reasignar que fijó su responsable). Solo frena `aprobar`: devolver no emite nada.
   * False si el actor o el dueño es founder (lo calcula lib/team.ts).
   */
  vinculoAsignacion?: boolean;
}

/**
 * ¿Puede esta persona aplicar esta acción sobre esta pieza? (spec WP31 §5.A.1)
 *
 *  - `aprobar` / `devolver`: cuatro ojos de verdad. Nunca quien es dueño (ni el
 *    founder con su otra identidad), nunca quien la envió a revisión, nunca con una
 *    relación de invitación entre dueño y revisor; `aprobar`, además, nunca quien sumó
 *    al dueño al proyecto o le dio la pieza (así nadie acuña puntos para una segunda
 *    cuenta suya); y la de un `pending:` sin vincular solo la revisa el founder o un
 *    supervisor. Los motivos se evalúan en ese orden.
 *  - `asignar`: tomar una pieza sin dueño exige `tomar` o `planificar`. Si la pieza ya
 *    tiene responsable (p. ej. una fila del CSV que llegó a Backlog con su Assignee),
 *    `asignar` solo la pasa a Asignada SIN cambiar de dueño, y eso lo hace el propio
 *    responsable o quien planifica: nadie se queda con la pieza de otra persona.
 *  - `empezar`, `enviar_a_revision`, `bloquear`, `desbloquear`: el dueño o quien planifica.
 */
export function puedeTransicionar(input: TransicionInput): { ok: true } | { ok: false; motivo: string } {
  const { accion, esDueno, sinDueno, permisos } = input;
  const no = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo });

  if (accion === "aprobar" || accion === "devolver") {
    if (esDueno) return no(MOTIVO_TRANSICION.dueno);
    if (input.esQuienEnvio) return no(MOTIVO_TRANSICION.envio);
    if (input.vinculoInvitacion) return no(MOTIVO_TRANSICION.invitacion);
    if (accion === "aprobar" && input.vinculoAsignacion) return no(MOTIVO_TRANSICION.asignacion);
    if (input.duenoPendiente && !input.esGlobal) return no(MOTIVO_TRANSICION.pendiente);
    if (!permisos.revisar) return no(MOTIVO_TRANSICION.revision);
    return { ok: true };
  }

  if (accion === "asignar") {
    if (sinDueno) return permisos.tomar || permisos.planificar ? { ok: true } : no(MOTIVO_TRANSICION.tomar);
    return esDueno || permisos.planificar ? { ok: true } : no(MOTIVO_TRANSICION.conDueno);
  }

  // empezar, enviar_a_revision, bloquear, desbloquear
  return esDueno || permisos.planificar ? { ok: true } : no(MOTIVO_TRANSICION.mover);
}

/**
 * Qué roles de proyecto puede conceder o quitar el actor. Founder/supervisor: los 4.
 * Rol `estructura` (sin ser founder ni supervisor): solo `ejecuta` y `vende`; los
 * roles que dan revisión (`estructura`, `revisa`) los concede el founder o un
 * supervisor. Nunca sobre sí mismo (lo resuelve lib/team.ts con `mismaPersona`).
 */
export function rolesQuePuedeConceder(
  actor: { role: Role; isSupervisor: boolean },
  rolesDelActor: readonly RolProyecto[]
): RolProyecto[] {
  if (esGlobalProyecto(actor)) return [...ROLES_PROYECTO];
  if (rolesDelActor.includes("estructura")) return ["ejecuta", "vende"];
  return [];
}
