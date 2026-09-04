import Link from "next/link";
import { getDb } from "@/lib/db";

/**
 * Prueba en vivo: cifras leídas de la base en el momento de pintar la página, y
 * un enlace a la última firma anclada en el explorador de Stellar.
 *
 * Por qué existe: la intro afirma que el trabajo se mide y que el registro es
 * verificable. Sin un dato real y sin un enlace comprobable, eso es solo una
 * promesa bien escrita. Esto lo convierte en algo que cualquiera puede auditar
 * con un clic.
 *
 * No muestra número de contribuidores a propósito: la cifra la mueven las
 * cuentas de prueba y no aporta nada a quien llega.
 */

const EXPLORADOR = "https://stellar.expert/explorer/testnet/tx/";

function Dato({ valor, pie }: { valor: string; pie: string }) {
  return (
    <div className="card p-5">
      <div className="font-head text-3xl font-bold leading-none text-primary glow-text md:text-4xl">{valor}</div>
      <p className="mt-2 text-xs uppercase tracking-wide text-muted">{pie}</p>
    </div>
  );
}

export default function PruebaEnVivo() {
  const db = getDb();

  const abiertos = (
    db.prepare(`SELECT COUNT(*) AS n FROM projects WHERE state = 'Open'`).get() as { n: number }
  ).n;
  const enJuego = (
    db
      .prepare(
        `SELECT COALESCE(SUM(m.amount_usd), 0) AS n
           FROM milestones m JOIN projects p ON p.id = m.project_id
          WHERE m.approved = 0`
      )
      .get() as { n: number }
  ).n;
  const ancladas = (
    db.prepare(`SELECT COUNT(*) AS n FROM cla_signatures WHERE anchor_status = 'anchored'`).get() as { n: number }
  ).n;
  const ultima = db
    .prepare(
      `SELECT tx_id FROM cla_signatures
        WHERE anchor_status = 'anchored' AND tx_id IS NOT NULL
        ORDER BY id DESC LIMIT 1`
    )
    .get() as { tx_id: string } | undefined;

  return (
    <section className="rule pt-8">
      <div className="mb-6 flex items-baseline gap-3">
        <span className="text-xs font-bold text-primary-dim">↳</span>
        <h2 className="font-head text-xl font-bold uppercase tracking-wide text-paper md:text-2xl">
          Esto no es una maqueta
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Dato valor={String(abiertos)} pie="proyectos abiertos ahora" />
        <Dato valor={`USD ${enJuego.toLocaleString("es-CO")}`} pie="en hitos por entregar" />
        <Dato valor={String(ancladas)} pie="firmas ancladas en Stellar" />
      </div>

      {ultima?.tx_id ? (
        <div className="mt-4 border-l-2 border-primary bg-glow p-5">
          <span className="label">Compruébalo tú mismo</span>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">
            La última firma quedó escrita en la red pública de pruebas de Stellar. No hace falta creernos:{" "}
            <Link
              href={EXPLORADOR + ultima.tx_id}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-primary underline decoration-primary/40 hover:decoration-primary"
            >
              ver la transacción
            </Link>
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}
