/**
 * Datos legales del aviso de privacidad (WP31-E1).
 *
 * El nombre legal del responsable y su correo los decide el founder y viven en la
 * configuración del despliegue, nunca en el repositorio. Mientras no estén, el
 * aviso dice "Zelena" y el canal es el formulario de contacto.
 */
export function responsableTratamiento(env: NodeJS.ProcessEnv = process.env): {
  nombre: string;
  contacto: string | null;
} {
  const nombre = (env.ZELENA_LEGAL_NAME ?? "").trim() || "Zelena";
  const correo = (env.ZELENA_PRIVACY_EMAIL ?? "").trim();
  return { nombre, contacto: correo || null };
}
