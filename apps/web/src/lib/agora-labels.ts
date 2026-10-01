/**
 * Etiquetas del Ágora (WP31-E1). ÚNICO archivo de la app que escribe los valores
 * internos del tipo de proyecto. En la base el tipo sigue siendo el mismo valor
 * de siempre (no se migra nada); lo que cambia es lo que ve la gente: un proyecto
 * es "para un cliente" o "para la comunidad".
 *
 * Puro y apto para cliente: sin base, sin crypto, sin `node:`.
 */

/** Valor interno del tipo de proyecto, tal cual vive en `projects.type`. */
export type TipoProyecto = "SAS" | "DAO";

const TIPO_CLIENTE: TipoProyecto = "SAS";
const TIPO_COMUNIDAD: TipoProyecto = "DAO";

/** Lo que se pinta en la etiqueta de cada proyecto. */
export const TIPO_PROYECTO_LABEL: Record<TipoProyecto, string> = {
  SAS: "Cliente",
  DAO: "Comunidad",
};

/** Estados de un proyecto del Ágora, en español. La clave es el valor de la base. */
export const ESTADO_PROYECTO_LABEL: Record<string, string> = {
  Open: "Abierto",
  Assigned: "Asignado",
  Delivered: "Entregado",
  Scored: "Evaluado",
  Distributed: "Recompensas repartidas",
};

/** Etiqueta visible del tipo; un valor desconocido se muestra tal cual. */
export function etiquetaTipo(tipo: string): string {
  return (TIPO_PROYECTO_LABEL as Record<string, string>)[tipo] ?? tipo;
}

/** Etiqueta visible del estado; un valor desconocido se muestra tal cual. */
export function etiquetaEstado(estado: string): string {
  return ESTADO_PROYECTO_LABEL[estado] ?? estado;
}

/** ¿Es un proyecto de cliente? (decide solo el color de la etiqueta). */
export function esTipoCliente(tipo: string): boolean {
  return tipo === TIPO_CLIENTE;
}

/**
 * Tipo pedido por la URL del Ágora. Acepta `cliente | comunidad` (la forma nueva,
 * `?tipo=`) y el valor heredado de los enlaces viejos (`?type=`), sin distinguir
 * mayúsculas. Cualquier otra cosa → sin filtro.
 */
export function tipoDesdeQuery(v: string | undefined): TipoProyecto | undefined {
  if (!v) return undefined;
  const limpio = v.trim().toLowerCase();
  if (limpio === "cliente" || limpio === "clientes" || limpio === TIPO_CLIENTE.toLowerCase()) return TIPO_CLIENTE;
  if (limpio === "comunidad" || limpio === TIPO_COMUNIDAD.toLowerCase()) return TIPO_COMUNIDAD;
  return undefined;
}

/** Valor de la URL para un tipo interno (lo inverso de `tipoDesdeQuery`). */
export function queryDesdeTipo(t: TipoProyecto): "cliente" | "comunidad" {
  return t === TIPO_CLIENTE ? "cliente" : "comunidad";
}

/** Tipo interno a partir de la etiqueta elegida en un formulario (puente al Ágora). */
export function tipoDesdeEtiqueta(t: "cliente" | "comunidad"): TipoProyecto {
  return t === "cliente" ? TIPO_CLIENTE : TIPO_COMUNIDAD;
}

/** Título de la decisión que reemplaza a la de las etiquetas viejas (S2). */
export const REEMPLAZO_DECISION = "Las etiquetas de proyecto pasan a Cliente y Comunidad";

/**
 * ¿Es la decisión histórica del 2026-07-01, la que nombraba las etiquetas viejas?
 * Se conserva tal cual (con su huella) y se marca "Reemplazada por…".
 */
export function esDecisionReemplazada(reason: string): boolean {
  return reason.includes(`etiquetadas ${TIPO_CLIENTE}`);
}

/** Las actas de cierre de un rito ("Rito …") no se listan entre las decisiones. */
export function esActaDeRito(title: string): boolean {
  return title.startsWith("Rito ");
}

/** Huella corta de una decisión, para mostrarla sin ocupar media pantalla. */
export function huellaCorta(d: { hash: string }, largo = 16): string {
  return d.hash.length > largo ? `${d.hash.slice(0, largo)}…` : d.hash;
}
