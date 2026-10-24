/**
 * Texto del aviso de privacidad (/privacidad) y su versión — hallazgo A3 (Ley 1581).
 *
 * Por qué vive aquí y no en la página: cada solicitud de los formularios de contacto
 * y de encuentros guarda la prueba de la autorización (`lead_consents`): la versión
 * de ESTE texto, su huella (sha256 del texto canónico, ver `consentimiento.ts`) y la
 * fecha en UTC. La página pinta exactamente estos textos, así que la huella guardada
 * corresponde a lo que la persona tuvo delante.
 *
 * Si cambias una sola letra de este archivo: sube `AVISO_PRIVACIDAD_VERSION` y
 * actualiza la huella fijada en `consentimiento.test.ts` (el test lo exige).
 *
 * `{marcas}` entre llaves: la página las cambia por enlaces o por el responsable y su
 * canal (que salen de la configuración del despliegue y entran también en la huella).
 *
 * Módulo PURO y apto para cliente (los formularios importan la versión): sin imports.
 */

/** Versión vigente del aviso. Es lo que envían los formularios y lo que se guarda. */
export const AVISO_PRIVACIDAD_VERSION = "2026-10-21";

/** Mensaje de la API (400) cuando la casilla de autorización no llega marcada. */
export const MENSAJE_SIN_AUTORIZACION =
  "Para enviar, marca la casilla y acepta el tratamiento de tus datos según el aviso de privacidad.";

/** Mensaje (409) cuando el formulario se cargó con otra versión del aviso (la página quedó vieja). */
export const MENSAJE_AVISO_CAMBIO =
  "El aviso de privacidad cambió desde que abriste esta página. Recárgala, revísalo y vuelve a enviar.";

export interface AvisoPrivacidad {
  intro: string;
  quienResponde: string;
  queDatos: readonly string[];
  paraQue: readonly string[];
  noHacemos: readonly string[];
  derechos: readonly string[];
  autorizacion: readonly string[];
}

export const AVISO_PRIVACIDAD: AvisoPrivacidad = {
  intro:
    "Este aviso explica qué datos tuyos tratamos, para qué y cómo decides sobre ellos, según la ley colombiana de protección de datos personales (Ley 1581 de 2012).",
  quienResponde:
    "El responsable del tratamiento es {responsable}. Para cualquier pregunta sobre tus datos, {canal}.",
  queDatos: [
    "Lo que escribes en los formularios: tu nombre, tu correo, tu empresa y tu mensaje (contacto comercial y avisos de encuentros).",
    "La prueba de tu autorización en esos formularios: la versión de este aviso que aceptaste, su huella y la fecha y hora (UTC) en que lo aceptaste.",
    "La dirección pública de tu cuenta en Stellar y el nombre visible que eliges al entrar.",
    "Los correos que vincules a tu cuenta.",
    "El identificador de tu chat de Telegram, solo si decides vincularlo.",
  ],
  paraQue: [
    "Responderte cuando nos escribes.",
    "Avisarte de los encuentros, si nos lo pediste.",
    "Poder mostrarte, si la pides, la prueba de que nos autorizaste.",
    "Operar tu cuenta: tu acuerdo firmado, tus entregas, tu reputación y tus avisos.",
  ],
  noHacemos: [
    "No vendemos ni alquilamos tus datos.",
    "No guardamos tu dirección IP con tus solicitudes ni con la prueba de tu autorización.",
    "No medimos tus horas de trabajo, tu ubicación ni cuándo te conectas. Lo único que contamos es el tiempo de lectura de cada contenido de la Academia, porque de él dependen sus puntos.",
    "En la red de pruebas de Stellar solo queda la huella del acuerdo que firmaste y una referencia a tu cuenta pública; nunca tu nombre ni tu correo.",
  ],
  derechos: [
    "Puedes conocer, actualizar, rectificar y suprimir tus datos, y revocar en cualquier momento la autorización que nos diste. También puedes pedir prueba de esa autorización, saber qué uso les hemos dado y presentar una queja ante la Superintendencia de Industria y Comercio.",
    "Para ejercerlos, {canal} con tu solicitud. Te respondemos por el mismo medio. Lo que ya quedó en un registro público, como la huella de un acuerdo firmado, no se puede borrar de ese registro.",
  ],
  autorizacion: [
    "Los formularios de {contacto} y de {encuentros} te piden marcar una casilla antes de enviar. Sin ella no se envía nada, y si llega una solicitud sin la casilla, el servidor la rechaza y no guarda nada.",
    "Cuando la marcas y envías, guardamos junto a tu solicitud la prueba de tu autorización: la versión de este aviso que aceptaste, su huella (un código que identifica este texto exacto) y la fecha y hora en que lo aceptaste, en UTC. Nada más: ni tu dirección IP ni datos de tu navegador.",
    "Si este aviso cambia, cambia su versión: cada solicitud conserva la versión que se aceptó.",
  ],
};

/** Responsable y canal tal como se pintan (salen de la configuración, ver `legal.ts`). */
export interface ResponsableAviso {
  nombre: string;
  contacto: string | null;
}

/**
 * Texto canónico del aviso vigente: versión + bloques + responsable. Es lo que se
 * resume en la huella (`consentimiento.ts#avisoVigente`). JSON con claves en orden fijo.
 */
export function textoCanonicoAviso(responsable: ResponsableAviso): string {
  return JSON.stringify({
    version: AVISO_PRIVACIDAD_VERSION,
    aviso: AVISO_PRIVACIDAD,
    responsable: { nombre: responsable.nombre, contacto: responsable.contacto },
  });
}

/** Solo el texto fijo (sin responsable): lo que fija el test para obligar a subir la versión. */
export function textoFijoAviso(): string {
  return JSON.stringify({ version: AVISO_PRIVACIDAD_VERSION, aviso: AVISO_PRIVACIDAD });
}
