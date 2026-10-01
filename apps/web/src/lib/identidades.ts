/**
 * Identidades de una persona (WP31 §5.0): qué wallets son la misma persona.
 *
 * Por qué existe: una persona del roster tiene su fila de equipo `pending:<slug>`
 * hasta que se vincula (`roster_links`) con la cuenta con la que entra. El founder
 * además entra con la wallet de su sesión, que es otra fila con `role='founder'`.
 * Para los cuatro ojos (quien entrega no aprueba lo suyo), para "Tu progreso", los
 * avisos y la asistencia, esas filas cuentan como UNA persona.
 *
 * Reglas:
 *  - El founder se reconoce por su rol en la base y por el roster, NUNCA comparando
 *    con `FOUNDER_WALLET` (test `sin-gates-por-persona`).
 *  - Solo lee: ningún UPDATE ni DELETE.
 *  - Sin `node:` ni valores de db.ts (solo su tipo): queda en la cadena de `team.ts`,
 *    que llega a un componente de cliente y al CLI de Node (imports de valor con
 *    sufijo `.ts`, sintaxis borrable).
 */
import type { DB } from "./db";
import { PENDING_PREFIX, TEAM_ROSTER, isPendingPrincipal, pendingPrincipal } from "./roles.ts";

/** Slugs del roster con rol founder (hoy, uno). Dato del roster, no una wallet. */
function slugsFounder(): string[] {
  return TEAM_ROSTER.filter((m) => m.role === "founder").map((m) => m.slug);
}

function walletVinculada(db: DB, slug: string): string | null {
  const r = db.prepare(`SELECT wallet FROM roster_links WHERE slug = ?`).get(slug) as { wallet: string } | undefined;
  return r?.wallet ?? null;
}

function slugVinculado(db: DB, wallet: string): string | null {
  const r = db.prepare(`SELECT slug FROM roster_links WHERE wallet = ?`).get(wallet) as { slug: string } | undefined;
  return r?.slug ?? null;
}

function existeUsuario(db: DB, wallet: string): boolean {
  return !!db.prepare(`SELECT 1 AS x FROM users WHERE wallet = ?`).get(wallet);
}

function esFounderEnBase(db: DB, wallet: string): boolean {
  const r = db.prepare(`SELECT role FROM users WHERE wallet = ?`).get(wallet) as { role: string | null } | undefined;
  return r?.role === "founder";
}

/**
 * Principal de equipo del founder: la wallet vinculada a su slug del roster
 * (`roster_links`) o `pending:<slug>` si aún existe; null si no hay ninguno.
 */
export function principalFounder(db: DB): string | null {
  for (const slug of slugsFounder()) {
    const vinculada = walletVinculada(db, slug);
    if (vinculada) return vinculada;
    const pendiente = pendingPrincipal(slug);
    if (existeUsuario(db, pendiente)) return pendiente;
  }
  return null;
}

/**
 * Wallets que son la misma persona: ella misma; su `pending:<slug>` o la wallet
 * vinculada a ese slug (`roster_links`); y, si es founder (rol en la base) o es
 * `principalFounder`, todas las filas activas con `role='founder'` más
 * `principalFounder`. Sin duplicados, ordenadas.
 */
export function identidadesDe(db: DB, wallet: string): string[] {
  const out = new Set<string>();
  if (typeof wallet !== "string" || wallet === "") return [];
  out.add(wallet);

  // Par del roster: pending:<slug> ↔ wallet vinculada.
  if (isPendingPrincipal(wallet)) {
    const vinculada = walletVinculada(db, wallet.slice(PENDING_PREFIX.length));
    if (vinculada) out.add(vinculada);
  } else {
    const slug = slugVinculado(db, wallet);
    if (slug) out.add(pendingPrincipal(slug));
  }

  // El founder: todas sus filas cuentan como una (sesión, demo con rol founder y
  // principal de equipo). Se reconoce por rol y por roster.
  const principal = principalFounder(db);
  const esFounder = [...out].some((w) => w === principal || esFounderEnBase(db, w));
  if (esFounder) {
    const founders = db
      .prepare(`SELECT wallet FROM users WHERE role = 'founder' AND status = 'active'`)
      .all() as Array<{ wallet: string }>;
    for (const f of founders) out.add(f.wallet);
    if (principal) out.add(principal);
  }

  return [...out].sort();
}

/** ¿Son `a` y `b` la misma persona? (simétrico: basta que una incluya a la otra). */
export function mismaPersona(db: DB, a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a === "" || b === "") return false;
  if (a === b) return true;
  return identidadesDe(db, a).includes(b) || identidadesDe(db, b).includes(a);
}

function invitadoPor(db: DB, wallet: string): string | null {
  const r = db.prepare(`SELECT invited_by FROM users WHERE wallet = ?`).get(wallet) as
    | { invited_by: string | null }
    | undefined;
  return r?.invited_by ?? null;
}

/** ¿Alguna identidad de `de` entró con la invitación de alguna identidad de `por`? */
function entroInvitadaPor(db: DB, de: readonly string[], por: readonly string[]): boolean {
  return de.some((w) => {
    const i = invitadoPor(db, w);
    return !!i && por.includes(i);
  });
}

/**
 * B8, la regla ÚNICA de los cuatro ojos por invitación (WP31 §4.A.4): quien invitó al
 * dueño de una entrega no la evalúa, ni el invitado evalúa la entrega de quien lo invitó.
 *  - Simétrica y sobre TODAS las identidades de cada una: el `invited_by` de cualquiera
 *    de sus filas (cuenta de sesión, `pending:<slug>`, cuenta vinculada) cuenta.
 *  - `founderExento`: alguna de las dos es el founder (por su rol en la base o por ser
 *    `principalFounder`, nunca por `FOUNDER_WALLET`). Queda exento en las DOS
 *    direcciones, como quien revisa y como dueño: invitó a casi todo el equipo, y si la
 *    regla lo atara nadie revisaría sus entregas, o ninguna le daría lo suyo.
 *  - `vinculoInvitacion`: nadie está exento y una de las dos entró invitada por la otra.
 *
 * La usan la puerta (`flagsDeTransicion` → `puedeTransicionar`) y la defensa de
 * `emitirPorAprobacion`, con las mismas identidades: si la puerta deja aprobar, la
 * emisión no la frena por B8, y ninguna entrega queda Hecha (estado final) sin lo suyo.
 */
export function reglaB8(db: DB, a: string, b: string): { founderExento: boolean; vinculoInvitacion: boolean } {
  if (typeof a !== "string" || typeof b !== "string" || a === "" || b === "") {
    return { founderExento: false, vinculoInvitacion: false };
  }
  const deA = identidadesDe(db, a);
  const deB = identidadesDe(db, b);
  const principal = principalFounder(db);
  const esFounder = (ids: readonly string[]) => ids.some((w) => w === principal || esFounderEnBase(db, w));
  if (esFounder(deA) || esFounder(deB)) return { founderExento: true, vinculoInvitacion: false };
  return { founderExento: false, vinculoInvitacion: entroInvitadaPor(db, deB, deA) || entroInvitadaPor(db, deA, deB) };
}
