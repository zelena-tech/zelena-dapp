import Link from "next/link";
import s from "../landing.module.css";
import p from "./pagos.module.css";
import FlujoPagos from "./FlujoPagos";
import { ENLACES } from "../copy-comun";
import { PAGOS } from "../copy-home";

/**
 * Pagos, sobre tinta: del puntaje a la billetera en segundos. El flujo (isla de cliente)
 * muestra importes de ejemplo; el paso del reparto automático va rotulado como red de
 * pruebas, y el cobro en el banco en moneda local, como lo que viene. La nota final dice
 * qué es real hoy y enlaza las pruebas públicas en la red de pruebas.
 */
export default function Pagos() {
  const { antes, despues } = PAGOS.comparacion;
  return (
    <section
      className={`${p.bloque} ${s.superficieOscura}`}
      aria-labelledby="pagos-titulo"
      data-reveal="seccion"
    >
      <h2 id="pagos-titulo" className={`${s.display} ${p.titulo}`}>
        {PAGOS.h2.linea1}{" "}
        <br />
        <span className={p.lima}>{PAGOS.h2.linea2}</span>
      </h2>
      <p className={p.intro}>{PAGOS.intro}</p>

      <FlujoPagos textos={PAGOS.flujo} />

      <p className={p.siguiente}>
        <span className={p.siguienteEtiqueta}>{PAGOS.siguiente.etiqueta}</span>
        <span>{PAGOS.siguiente.texto}</span>
      </p>

      <div className={p.comparacion}>
        <div className={p.antes}>
          <h3 className={p.compTitulo}>{antes.titulo}</h3>
          <ul className={p.datos}>
            {antes.datos.map((d) => (
              <li key={d.valor}>
                <s className={`${s.display} ${p.datoValor}`}>{d.valor}</s>
                <span className={p.datoTexto}>{d.texto}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={p.despues}>
          <h3 className={p.compTitulo}>{despues.titulo}</h3>
          <ul className={p.datos}>
            {despues.datos.map((d) => (
              <li key={d.valor}>
                <span className={`${s.display} ${p.datoValor}`}>{d.valor}</span>
                <span className={p.datoTexto}>{d.texto}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className={p.nota}>
        {PAGOS.nota}{" "}
        <Link href={ENLACES.metodoPruebas} hrefLang="es" className={p.notaEnlace}>
          {PAGOS.notaEnlace}
        </Link>
      </p>
    </section>
  );
}
