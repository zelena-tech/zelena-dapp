/**
 * Prueba de la autorización de datos personales (Ley 1581) — hallazgo A3.
 *
 * Los formularios públicos de /empresas/contacto y /encuentros piden marcar la casilla
 * del aviso de privacidad. Antes, la casilla solo existía en el navegador: la API no la
 * recibía y no quedaba prueba, aunque /privacidad promete que se puede pedir. Ahora:
 *
 *  - la API exige `acepto: true` (400 con un texto claro si no llega) — `validation.ts`;
 *  - la solicitud y su prueba se guardan JUNTAS, en una transacción: la fila de `leads`
 *    y una fila de `lead_consents` con la versión del aviso, su huella (sha256 del texto
 *    canónico vigente, ver `aviso-privacidad.ts`) y la fecha en UTC;
 *  - `lead_consents` es de SOLO INSERCIÓN: nada en el código la actualiza ni la borra
 *    (lo vigila `consentimiento.test.ts`), y no guarda la IP ni datos del navegador.
 *
 * Fechas con `zona-horaria.ts#instanteDb` (UTC, mismo formato que los defaults).
 */
import type { DB } from "./db";
import { sha256Hex } from "./crypto";
import { responsableTratamiento } from "./legal";
import { AVISO_PRIVACIDAD_VERSION, textoCanonicoAviso } from "./aviso-privacidad";

export { MENSAJE_AVISO_CAMBIO, MENSAJE_SIN_AUTORIZACION } from "./aviso-privacidad";
import { instanteDb } from "./zona-horaria";

/** Formularios que guardan una solicitud con autorización. */
export const FORMULARIOS_CON_AUTORIZACION = ["empresas/contacto", "encuentros"] as const;
export type FormularioConAutorizacion = (typeof FORMULARIOS_CON_AUTORIZACION)[number];

export interface AvisoVigente {
  version: string;
  /** sha256 del texto canónico vigente (bloques + versión + responsable). */
  huella: string;
}

/** Versión y huella del aviso que se está mostrando hoy en /privacidad. */
export function avisoVigente(env: NodeJS.ProcessEnv = process.env): AvisoVigente {
  return {
    version: AVISO_PRIVACIDAD_VERSION,
    huella: sha256Hex(textoCanonicoAviso(responsableTratamiento(env))),
  };
}

/**
 * ¿La versión que envió el formulario es la vigente? Si el formulario no la envía
 * (cliente viejo o llamada directa), se toma la vigente: es la que enlaza la casilla.
 */
export function versionAceptadaEsVigente(versionEnviada: string | undefined | null): boolean {
  return versionEnviada == null || versionEnviada === "" || versionEnviada === AVISO_PRIVACIDAD_VERSION;
}

export interface Solicitud {
  nombre: string;
  email: string;
  empresa: string | null;
  interes: string;
  mensaje: string | null;
}

export interface SolicitudGuardada {
  leadId: number;
  consentId: number;
  version: string;
  huella: string;
  /** Instante de la aceptación en UTC (`AAAA-MM-DD HH:MM:SS`). */
  aceptadoEn: string;
}

/**
 * Guarda la solicitud y la prueba de su autorización en UNA transacción: si una de
 * las dos falla, no queda ninguna. Solo inserta.
 */
export function guardarSolicitudConAutorizacion(
  db: DB,
  solicitud: Solicitud,
  formulario: FormularioConAutorizacion,
  opts: { ahora?: Date; env?: NodeJS.ProcessEnv } = {}
): SolicitudGuardada {
  if (!(FORMULARIOS_CON_AUTORIZACION as readonly string[]).includes(formulario)) {
    throw new Error(`Formulario desconocido: ${formulario}`);
  }
  const { version, huella } = avisoVigente(opts.env);
  const aceptadoEn = instanteDb(opts.ahora ?? new Date());
  const insLead = db.prepare(
    `INSERT INTO leads (nombre, email, empresa, interes, mensaje, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insConsent = db.prepare(
    `INSERT INTO lead_consents (lead_id, formulario, aviso_version, aviso_sha256, accepted_at) VALUES (?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    const lead = insLead.run(
      solicitud.nombre,
      solicitud.email,
      solicitud.empresa,
      solicitud.interes,
      solicitud.mensaje,
      aceptadoEn
    );
    const leadId = Number(lead.lastInsertRowid);
    const consent = insConsent.run(leadId, formulario, version, huella, aceptadoEn);
    return { leadId, consentId: Number(consent.lastInsertRowid) };
  });
  const { leadId, consentId } = tx();
  return { leadId, consentId, version, huella, aceptadoEn };
}

export interface PruebaDeAutorizacion {
  formulario: string;
  aviso_version: string;
  aviso_sha256: string;
  accepted_at: string;
}

/** La prueba de autorización de una solicitud (para responder a quien la pida). */
export function pruebaDeAutorizacion(db: DB, leadId: number): PruebaDeAutorizacion | undefined {
  return db
    .prepare(
      `SELECT formulario, aviso_version, aviso_sha256, accepted_at FROM lead_consents WHERE lead_id = ? ORDER BY id`
    )
    .get(leadId) as PruebaDeAutorizacion | undefined;
}
