/**
 * Cuentas con la wallet del navegador = cuentas REALES (decisión del founder, 2026-10-21).
 *
 * Desde hoy `performOnboard` decide `is_demo` por el código de invitación: solo un código
 * de demostración (`GENESIS-0001..0006`) da una cuenta de demostración. Quien entró con una
 * invitación válida y firmó el acuerdo con la wallet que creó en su navegador tiene una
 * cuenta real: se suma a proyectos y registra asistencia a los ritos.
 *
 * Esta migración lleva a esa regla a las cuentas que ya se registraron así en producción
 * (antes el navegador las declaraba de prueba). Solo PROMUEVE (`is_demo` 1 → 0), nunca al
 * revés, no borra nada y deja una fila en `talent_events` por cuenta (actor `migracion`).
 */
import type { DB } from "./db"; // solo tipo: sin ciclo en runtime
import { esWalletStellar } from "./crypto";
import { DEMO_INVITE_CODES } from "./config";

/** Actor con el que la migración firma su rastro en `talent_events`. */
export const ACTOR_MIGRACION = "migracion";

/**
 * Pasa a reales las cuentas de demostración que en realidad entraron con una invitación
 * válida y la wallet de su navegador. Devuelve las wallets que cambió.
 *
 * Criterio (las cuatro a la vez):
 *  1. `is_demo = 1` y `is_founder = 0`: la fila del founder que crea el seed no se toca.
 *  2. Firmó el acuerdo con esa wallet: tiene una fila en `cla_signatures` cuya firma NO es
 *     de las del seed (`seed-sig-…`, las únicas que escribe `seed()`); `performOnboard` solo
 *     guarda una firma ed25519 que verificó.
 *  3. Su wallet es una llave pública de Stellar VÁLIDA (`esWalletStellar`). Las wallets que
 *     siembra el seed (el founder demo y las tres cuentas de la cohorte de demostración) son
 *     marcadores fijos con la suma de verificación inválida: nunca pasan. Una wallet creada
 *     en el navegador (`Keypair.random()`) siempre pasa.
 *  4. No consumió un código de demostración (`invites.used_by` con uno de
 *     `DEMO_INVITE_CODES`). Esos códigos son de un solo uso, así que si entró con uno queda
 *     su rastro; quien entró con la cohorte o con una invitación personal no lo tiene.
 *
 * Idempotente (la segunda corrida no encuentra nada). La llama `seedIfEmpty` en su propio
 * `try/catch`, como las migraciones de contenido: el arranque no se cae por ella.
 */
export function marcarCuentasDeNavegadorComoReales(db: DB): string[] {
  const marcas = DEMO_INVITE_CODES.map(() => "?").join(", ");
  const candidatas = db
    .prepare(
      `SELECT u.wallet FROM users u
        WHERE u.is_demo = 1 AND u.is_founder = 0
          AND EXISTS (SELECT 1 FROM cla_signatures c WHERE c.wallet = u.wallet AND c.signature NOT LIKE 'seed-sig-%')
          AND NOT EXISTS (SELECT 1 FROM invites i WHERE i.used_by = u.wallet AND i.code IN (${marcas}))
        ORDER BY u.wallet`
    )
    .all(...DEMO_INVITE_CODES) as Array<{ wallet: string }>;
  const reales = candidatas.map((c) => c.wallet).filter((w) => esWalletStellar(w));
  if (reales.length === 0) return [];

  const marcar = db.prepare(`UPDATE users SET is_demo = 0 WHERE wallet = ? AND is_demo = 1`);
  const rastro = db.prepare(
    `INSERT INTO talent_events (actor_wallet, target_wallet, initiative_id, action, detail) VALUES (?, ?, NULL, 'cuenta_real', ?)`
  );
  const cambiadas: string[] = [];
  db.transaction(() => {
    for (const w of reales) {
      if (Number(marcar.run(w).changes) !== 1) continue;
      rastro.run(
        ACTOR_MIGRACION,
        w,
        JSON.stringify({ motivo: "wallet del navegador con invitación válida (decisión del founder, 2026-10-21)" })
      );
      cambiadas.push(w);
    }
  })();
  if (cambiadas.length > 0) {
    console.info(`[seed] cuentas: ${cambiadas.length} cuenta(s) con la wallet del navegador pasan a reales.`);
  }
  return cambiadas;
}
