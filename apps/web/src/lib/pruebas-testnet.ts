/**
 * Pruebas públicas de la red de pruebas de Stellar (WP31-E1): la tarjeta única
 * "Compruébalo tú mismo".
 *
 * Los datos viven en `src/data/pruebas-testnet.json` y se IMPORTAN (no se leen con
 * `fs`), así viajan dentro del paquete. Solo hashes de transacción y contratos
 * públicos: nada de cuentas ni secretos. Lo que no tiene la forma esperada no se
 * muestra: un enlace roto al explorador es peor que no tener enlace.
 *
 * Puro y apto para cliente.
 */
import datos from "../data/pruebas-testnet.json";

export interface PruebasTestnet {
  actualizado: string | null;
  transacciones: Array<{ etiqueta: string; tipo: "contrato" | "pago" | "anclaje"; tx: string; fecha: string }>;
  contratos: Array<{ etiqueta: string; id: string }>;
}

export type TransaccionPrueba = PruebasTestnet["transacciones"][number];

export const EXPLORADOR_TX = "https://stellar.expert/explorer/testnet/tx/";
export const EXPLORADOR_CONTRATO = "https://stellar.expert/explorer/testnet/contract/";

const TIPOS_TX: ReadonlyArray<TransaccionPrueba["tipo"]> = ["contrato", "pago", "anclaje"];

/** Hash de transacción de Stellar: 64 hexadecimales en minúscula. */
export function txVerificable(tx: string): boolean {
  return typeof tx === "string" && /^[0-9a-f]{64}$/.test(tx);
}

/** Id de contrato de Soroban: "C" + 55 caracteres de base32 (56 en total). */
export function contratoVerificable(id: string): boolean {
  return typeof id === "string" && /^C[A-Z2-7]{55}$/.test(id);
}

/** Deja solo lo verificable: transacciones de 64 hex con tipo conocido y contratos bien formados. */
export function pruebasVisibles(p: PruebasTestnet): PruebasTestnet {
  return {
    actualizado: p.actualizado ?? null,
    transacciones: (p.transacciones ?? []).filter(
      (t) => !!t && typeof t.etiqueta === "string" && TIPOS_TX.includes(t.tipo) && txVerificable(t.tx)
    ),
    contratos: (p.contratos ?? []).filter((c) => !!c && typeof c.etiqueta === "string" && contratoVerificable(c.id)),
  };
}

/** El JSON tal cual viene del archivo (sin confiar en su forma: se filtra al usarlo). */
export const PRUEBAS_TESTNET: PruebasTestnet = datos as unknown as PruebasTestnet;

/**
 * Qué pinta la tarjeta "Compruébalo tú mismo":
 *  - la ÚLTIMA transacción verificable del JSON y sus contratos;
 *  - si el JSON no trae ninguna transacción, la última firma del acuerdo anclada de
 *    verdad (`respaldo`), si existe y es verificable;
 *  - si no hay ni transacción ni contratos, `null`: la tarjeta no se pinta.
 */
export function contenidoTarjeta(
  p: PruebasTestnet,
  respaldo: { tx: string; fecha: string } | null
): { tx: TransaccionPrueba | null; contratos: PruebasTestnet["contratos"] } | null {
  const visibles = pruebasVisibles(p);
  const ultima = visibles.transacciones[visibles.transacciones.length - 1] ?? null;
  const tx =
    ultima ??
    (respaldo && txVerificable(respaldo.tx)
      ? { etiqueta: "La última firma del acuerdo de contribución", tipo: "anclaje" as const, tx: respaldo.tx, fecha: respaldo.fecha }
      : null);
  if (!tx && visibles.contratos.length === 0) return null;
  return { tx, contratos: visibles.contratos };
}
