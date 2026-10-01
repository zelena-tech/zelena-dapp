import {
  EXPLORADOR_CONTRATO,
  EXPLORADOR_TX,
  PRUEBAS_TESTNET,
  contenidoTarjeta,
  type PruebasTestnet,
} from "@/lib/pruebas-testnet";
import { fechaLarga } from "@/lib/encuentros";

function fecha(f: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? fechaLarga(f) : f;
}

/**
 * Tarjeta única "Compruébalo tú mismo" (WP31-E1).
 *
 * Muestra la última transacción verificable de `src/data/pruebas-testnet.json` y
 * sus contratos, con enlace al explorador público de la red de pruebas. Si el JSON
 * no trae ninguna, cae a la última firma del acuerdo anclada de verdad
 * (`respaldo`). Si no hay nada que comprobar, no se pinta.
 */
export default function PruebaTestnet({
  respaldo = null,
  pruebas = PRUEBAS_TESTNET,
}: {
  respaldo?: { tx: string; fecha: string } | null;
  pruebas?: PruebasTestnet;
}) {
  const contenido = contenidoTarjeta(pruebas, respaldo);
  if (!contenido) return null;
  const { tx, contratos } = contenido;

  return (
    <section className="card flex flex-col gap-6 border-primary/30 p-8 md:p-10" aria-labelledby="compruebalo">
      <div className="space-y-3">
        <p className="label">Red de pruebas de Stellar</p>
        <h2
          id="compruebalo"
          className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-3xl"
        >
          Compruébalo <em className="font-normal italic text-primary">tú mismo.</em>
        </h2>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Cada pago de prueba deja una huella pública. Ábrela en el explorador de la red de pruebas de Stellar.
        </p>
      </div>

      {tx ? (
        <div className="flex flex-col gap-2 border-t border-primary pt-5">
          <span className="text-base text-paper">{tx.etiqueta}</span>
          <span className="text-xs text-faint">{fecha(tx.fecha)}</span>
          <a
            href={EXPLORADOR_TX + tx.tx}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] w-fit items-center gap-2 text-sm text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
          >
            Ver la transacción <span aria-hidden>↗</span>
          </a>
          <span className="break-all font-mono text-[11px] text-faint">{tx.tx}</span>
        </div>
      ) : null}

      {contratos.length > 0 ? (
        <div className="flex flex-col gap-1 border-t border-line pt-5">
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted">Contratos</span>
          <ul className="flex flex-col">
            {contratos.map((c) => (
              <li key={c.id}>
                <a
                  href={EXPLORADOR_CONTRATO + c.id}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted transition-colors hover:text-primary"
                >
                  {c.etiqueta} <span aria-hidden>↗</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
