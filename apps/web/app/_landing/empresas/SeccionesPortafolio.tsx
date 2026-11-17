import Link from "next/link";
import s from "../landing.module.css";
import m from "../manifiesto/manifiesto.module.css";
import e from "./empresas.module.css";
import Chip from "../Chip";
import { IconoFlechaDerecha } from "../Iconos";
import { Titular } from "./Comunes";
import { ALIADO, CICLO, PASOS_CICLO, POR_QUE, SECTORES, TRES_LINEAS } from "../copy-portafolio";

/**
 * "Zelena en tres líneas": lo primero que lee quien llega con el enlace y no nos conoce.
 * Tres tarjetas (dos grises y la de incentivos en lima), cada una enlace a su parte.
 */
export function TresLineas() {
  const ultimo = TRES_LINEAS.lineas.length - 1;
  return (
    <section className={s.seccion} aria-labelledby="tres-lineas-titulo">
      <h2 id="tres-lineas-titulo" className={m.etiqueta} data-reveal="">
        {TRES_LINEAS.etiqueta}
      </h2>
      <ul className={e.tres} data-reveal="escalonado">
        {TRES_LINEAS.lineas.map((l, i) => (
          <li key={l.verbo} className={e.tresItem}>
            <Link
              href={l.href}
              className={`${e.linea} ${i === ultimo ? e.lineaLima : e.lineaPanel} ${s.elevable}`}
            >
              <span className={`${s.display} ${e.lineaNumero}`} aria-hidden="true">
                {l.n}
              </span>
              <span className={`${s.display} ${e.lineaVerbo}`}>{l.verbo}</span>
              <span className={e.lineaQue}>{l.que}</span>
              <span className={e.lineaComo}>{l.como}</span>
              <span className={e.lineaEnlace}>
                {l.enlace}
                <IconoFlechaDerecha tamano={14} trazo={2.5} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <ul className={e.cifras} data-reveal="">
        {TRES_LINEAS.cifras.map((c) => (
          <li key={c}>
            <Chip tono="panel" punto className={e.mayus}>
              {c}
            </Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Cómo trabajamos: los cuatro pasos del ciclo, en un bloque gris con tarjetas blancas. */
export function CicloDeTrabajo() {
  return (
    <section id={CICLO.ancla} className={`${m.grupo} ${e.bloque} ${e.bloquePrimero} ${s.ancla}`} aria-labelledby="ciclo-titulo" data-reveal="seccion">
      <Titular id="ciclo-titulo" etiqueta={CICLO.etiqueta} h2={CICLO.h2} intro={CICLO.intro} enBloque />
      <ol className={m.principios}>
        {PASOS_CICLO.map((p) => (
          <li key={p.n} className={`${m.principio} ${s.elevable}`}>
            <span className={`${s.display} ${m.principioNumero}`} aria-hidden="true">
              {p.n}
            </span>
            <h3 className={m.principioTitulo}>{p.titulo}</h3>
            <p className={m.principioTexto}>{p.detalle}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Por qué Zelena: bloque de tinta con la frase, las cuatro razones y para quién trabajamos. */
export function PorQue() {
  return (
    <section className={`${m.creencia} ${e.bloque} ${e.pegado} ${s.superficieOscura}`} aria-labelledby="aliado-titulo" data-reveal="seccion">
      <h2 id="aliado-titulo" className={m.etiquetaOscura}>
        {ALIADO.etiqueta}
      </h2>
      <p className={`${s.display} ${m.frase}`}>
        {ALIADO.frase} <span className={m.lima}>{ALIADO.enfasis}</span>
      </p>
      <ul className={e.razones}>
        {POR_QUE.map((r) => (
          <li key={r.n} className={e.razon}>
            <span className={m.etiquetaOscura}>{r.n}</span>
            <h3 className={e.razonTitulo}>{r.titulo}</h3>
            <p className={e.razonTexto}>{r.texto}</p>
          </li>
        ))}
      </ul>
      <div className={e.paraQuien}>
        <h3 className={m.etiquetaOscura}>{ALIADO.paraQuienTitulo}</h3>
        <p className={e.paraQuienTexto}>{ALIADO.paraQuien}</p>
        <ul className={e.sectores}>
          {SECTORES.map((x) => (
            <li key={x}>
              <Chip tono="blanco">{x}</Chip>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
