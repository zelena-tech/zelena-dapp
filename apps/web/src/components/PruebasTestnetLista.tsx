import {
  EXPLORADOR_CONTRATO,
  EXPLORADOR_TX,
  PRUEBAS_TESTNET,
  pruebasVisibles,
  type PruebasTestnet,
  type TransaccionPrueba,
} from "../lib/pruebas-testnet";
// Rutas relativas (no "@/"): así el test la pinta con vitest, que no conoce el alias.
import { fechaLarga } from "../lib/encuentros";

/** Ancla de la sección en /metodo (la tarjeta de la landing enlaza aquí). */
export const ANCLA_PRUEBAS = "compruebalo";

const TIPO: Record<TransaccionPrueba["tipo"], string> = {
  contrato: "Contrato",
  pago: "Pago de prueba",
  anclaje: "Registro",
};

function fecha(f: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(f) ? fechaLarga(f) : f;
}

const ENLACE =
  "inline-flex min-h-[44px] w-fit items-center gap-2 text-sm text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary";

/**
 * "Compruébalo tú mismo" completo, para /metodo (hallazgo de la verificación final: la
 * landing solo mostraba la última de las transacciones y ninguna página listaba las
 * demás). Pinta TODAS las transacciones y TODOS los contratos verificables de
 * `src/data/pruebas-testnet.json`, cada uno enlazado al explorador público de la red de
 * pruebas (stellar.expert/testnet). Lo que no tiene la forma esperada no se muestra
 * (`pruebasVisibles`). Sin nada que comprobar, no se pinta.
 */
export default function PruebasTestnetLista({ pruebas = PRUEBAS_TESTNET }: { pruebas?: PruebasTestnet }) {
  const { transacciones, contratos, actualizado } = pruebasVisibles(pruebas);
  if (transacciones.length === 0 && contratos.length === 0) return null;

  return (
    <section id={ANCLA_PRUEBAS} className="scroll-mt-24 space-y-10" aria-labelledby="compruebalo-titulo">
      <div className="space-y-5">
        <p className="label">Red de pruebas de Stellar</p>
        <h2
          id="compruebalo-titulo"
          className="font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl sm:leading-[1.15] lg:text-[52px]"
        >
          Compruébalo <em className="font-normal italic text-primary">tú mismo.</em>
        </h2>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Los contratos y los pagos del paso 7 ya corren en la red de pruebas de Stellar. Cada uno deja una huella
          pública: ábrela en el explorador y comprueba que pasó, sin pedirnos permiso.
        </p>
      </div>

      {transacciones.length > 0 ? (
        <ol className="flex flex-col" aria-label="Transacciones de prueba">
          {transacciones.map((t, i) => (
            <li
              key={t.tx}
              className={`grid gap-2 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-10 ${
                i === 0 ? "border-t border-primary" : "border-t border-line"
              } ${i === transacciones.length - 1 ? "border-b border-line" : ""}`}
            >
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-[0.18em] text-primary">{TIPO[t.tipo]}</span>
                <span className="text-xs text-faint">{fecha(t.fecha)}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-base text-paper">{t.etiqueta}</span>
                <a href={EXPLORADOR_TX + t.tx} target="_blank" rel="noopener noreferrer" className={ENLACE}>
                  Ver la transacción <span aria-hidden>↗</span>
                </a>
                <span className="break-all font-mono text-[11px] text-faint">{t.tx}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {contratos.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Contratos desplegados</p>
          <ul className="flex flex-col">
            {contratos.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 border-t border-line py-4">
                <a href={EXPLORADOR_CONTRATO + c.id} target="_blank" rel="noopener noreferrer" className={ENLACE}>
                  {c.etiqueta} <span aria-hidden>↗</span>
                </a>
                <span className="break-all font-mono text-[11px] text-faint">{c.id}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {actualizado ? <p className="text-xs text-faint">Actualizado el {fecha(actualizado)}.</p> : null}
    </section>
  );
}
