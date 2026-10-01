/**
 * Autorización de administración: por ROL, no por PERSONA.
 *
 * Antes el gate de /admin comparaba `session.wallet !== FOUNDER_WALLET`, es decir
 * la wallet concreta de una persona metida en una variable de entorno. Eso tenía
 * dos problemas:
 *
 *  1. **Rompía al encender WP13.** Quien entra por la puerta corporativa llega con
 *     el principal de su fila del roster (`pending:john`), que NUNCA es igual a
 *     `FOUNDER_WALLET` (la wallet demo del seed). El founder perdía su propio panel.
 *  2. **Un segundo administrador era imposible sin deploy**, porque el permiso no
 *     era un dato del registro sino una constante del entorno.
 *
 * La autoridad es la tabla `users` (`role`), no la cookie: `actorFromSession`
 * resuelve el rol contra la base y solo cae a los claims si la fila no existe. Así
 * una cookie vieja o manipulada que se declare `founder` no concede administración.
 *
 * `FOUNDER_WALLET` sigue existiendo, pero como lo que siempre debió ser: un DATO.
 * El seed crea con ella la fila del founder y cada arranque promueve esa fila a
 * `founder` (`backfillFounder` en db.ts, solo promueve). Ningún gate la compara:
 * la decisión sale siempre de `users.role`.
 */
import { getDb, type DB } from "./db";
import { effectiveRole, esEquipoInterno, isRole, type Role, type RoleClaims, type TeamActor } from "./roles";

/** Claims mínimos que necesita el gate (subconjunto de SessionData). */
export interface AdminSession extends RoleClaims {
  wallet: string;
  name?: string;
}

/**
 * Regla PURA de administración. Hoy: solo el rol `founder` administra.
 *
 * Los supervisores NO administran: supervisar es ver el trabajo de todo el equipo
 * para destrabarlo (`puedeVerTodoElEquipo`), no cerrar épocas ni mutar el genoma.
 * Si algún día hay un rol `admin` distinto de `founder`, este es el único sitio
 * que cambia.
 */
export function rolPuedeAdministrar(role: Role): boolean {
  return role === "founder";
}

/** Variante sobre claims sueltos, para UI que no toca la base (p. ej. el nav). */
export function claimsPuedenAdministrar(claims: RoleClaims): boolean {
  return rolPuedeAdministrar(effectiveRole(claims));
}

/**
 * Actor ESTRICTO: exige que exista la fila en `users` y lee el rol de ahí.
 *
 * A diferencia de `actorFromSession` (lib/team.ts), NO cae a los claims de la cookie
 * cuando la fila no existe. Esa caída es razonable para pintar un nombre en la UI,
 * pero en una decisión de autorización significaría que una sesión sin registro se
 * autoasigna el rol que quiera. Aquí, quien no está en el registro no es nadie.
 */
function actorEstricto(session: AdminSession, db: DB): TeamActor | null {
  const row = db
    .prepare(`SELECT display_name, role, is_supervisor, is_founder FROM users WHERE wallet = ?`)
    .get(session.wallet) as
    | { display_name: string; role: string; is_supervisor: number; is_founder: number }
    | undefined;
  if (!row) return null;
  return {
    wallet: session.wallet,
    name: row.display_name,
    // `isRole` descarta un valor corrupto en la columna; el fallback deriva de
    // is_founder, igual que `effectiveRole`, nunca de lo que diga la cookie.
    role: isRole(row.role) ? row.role : effectiveRole({ isFounder: !!row.is_founder }),
    isSupervisor: !!row.is_supervisor,
  };
}

/**
 * Gate real de servidor: devuelve el actor si puede administrar, o `null` si no.
 * Devolver el actor (y no un booleano) evita que cada llamador vuelva a consultar
 * la fila para saber quién es.
 */
export function adminActor(session: AdminSession | null, db: DB = getDb()): TeamActor | null {
  if (!session) return null;
  const actor = actorEstricto(session, db);
  return actor && rolPuedeAdministrar(actor.role) ? actor : null;
}

/**
 * Gate del módulo `/equipo`: devuelve el actor si es del equipo interno, o `null`.
 * Un `contributor` de la comunidad no pasa: el backlog interno no es su espacio.
 */
export function equipoInternoActor(session: AdminSession | null, db: DB = getDb()): TeamActor | null {
  if (!session) return null;
  const actor = actorEstricto(session, db);
  return actor && esEquipoInterno({ role: actor.role, isSupervisor: actor.isSupervisor }) ? actor : null;
}

/**
 * Actor de los entornos por cliente (WP17/WP20), con la forma que esperan
 * `lib/clients.ts` y `lib/client-graph.ts` (`{ wallet, isFounder }`).
 *
 * Doble puerta, por dato de la base y nunca por la wallet de una persona:
 *  1. hay que ser del EQUIPO INTERNO (WP17: "solo equipo interno accede");
 *  2. `isFounder` sale del rol (`rolPuedeAdministrar`), y es lo único que deja
 *     ver un cliente sin ser miembro. Para el resto manda `client_members`, que
 *     aplica `lib/clients.ts` (404 si no participa).
 *
 * Devuelve `null` si la sesión no es del equipo interno.
 */
export function clientActor(
  session: AdminSession | null,
  db: DB = getDb()
): { wallet: string; isFounder: boolean } | null {
  const actor = equipoInternoActor(session, db);
  if (!actor) return null;
  return { wallet: actor.wallet, isFounder: rolPuedeAdministrar(actor.role) };
}
