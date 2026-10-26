/**
 * Salir y la llave de la wallet del navegador (revisión del release, 2026-10-21).
 *
 * "Salir y borrar mi wallet de este equipo" solo tiene sentido para una cuenta de
 * DEMOSTRACIÓN: en un equipo compartido, dejar su llave es dejar la identidad puesta. A una
 * cuenta REAL creada con la wallet del navegador, esa llave es su única copia: borrarla es
 * perder el acceso para siempre (ver AvisoLlaveNavegador).
 *
 * Qué es demo lo dice la BASE (`users.is_demo`), nunca la cookie: la migración del arranque
 * (`cuentas-reales.ts`) pasa cuentas a reales y la cookie conserva `isDemo` hasta 24 h.
 *  - Nav (servidor) solo ofrece el botón si `esDemoSegunBase`.
 *  - `/api/logout` vuelve a leer la base al salir y responde `{ ok, esDemo, wallet }`.
 *  - `SalirButton` solo borra si `puedeBorrarLlave` con esa respuesta: el servidor confirma
 *    que la cuenta es de demostración Y la llave guardada aquí es la de esa misma cuenta.
 *
 * Este módulo lo importa un componente de cliente: nada de servidor en runtime.
 */
import type { DB } from "./db"; // solo tipo

/** ¿La cuenta es de demostración según la base? Sin fila (o sin wallet), no. */
export function esDemoSegunBase(db: DB, wallet: string): boolean {
  if (!wallet) return false;
  const fila = db.prepare(`SELECT is_demo FROM users WHERE wallet = ?`).get(wallet) as
    | { is_demo: number | bigint | null }
    | undefined;
  return !!fila && Number(fila.is_demo) === 1;
}

/** Wallet pública de la llave que /entrar guardó en este navegador, o `null`. */
export function walletDeLlaveGuardada(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { public?: unknown } | null;
    return typeof p?.public === "string" && p.public ? p.public : null;
  } catch {
    return null; // dato corrupto
  }
}

/** Lo que responde `POST /api/logout`. */
export interface RespuestaSalir {
  ok: boolean;
  /** Leído de la base en el momento de salir. */
  esDemo: boolean;
  /** La wallet de la sesión que se cerró (o `null` si no había sesión). */
  wallet: string | null;
}

/**
 * ¿Se puede borrar la llave guardada en este navegador? Solo si la respuesta del servidor
 * dice, sin ambigüedad, que la cuenta que salió es de demostración, y la llave guardada es
 * la de esa cuenta (no la de otra persona que usó este navegador). Ante cualquier duda
 * (sin red, respuesta de otra versión, otra llave): no se borra.
 */
export function puedeBorrarLlave(respuesta: unknown, llaveGuardada: string | null): boolean {
  if (!respuesta || typeof respuesta !== "object") return false;
  const r = respuesta as Partial<Record<keyof RespuestaSalir, unknown>>;
  if (r.ok !== true || r.esDemo !== true || typeof r.wallet !== "string" || !r.wallet) return false;
  return walletDeLlaveGuardada(llaveGuardada) === r.wallet;
}
