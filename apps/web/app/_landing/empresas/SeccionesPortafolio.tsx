import Link from "next/link";
import s from "../landing.module.css";
import m from "../manifiesto/manifiesto.module.css";
import e from "./empresas.module.css";
import Chip from "../Chip";
import { IconoFlechaDerecha } from "../Iconos";
import { Titular } from "./Comunes";
import { SecondaryCta } from "../Ctas";
import { ALIADO, CICLO, COLABORAR, CUATRO_LINEAS, PASOS_CICLO, POR_QUE, SECTORES } from "../copy-portafolio";

const TONO_LINEA = { panel: e.lineaPanel, lima: e.lineaLima, tinta: e.lineaTinta } as const;

/**
 * "Zelena en cuatro líneas": lo primero que lee quien llega con el enlace y no nos conoce.
 * Cuatro tarjetas, cada una enlace a su parte: los servicios y el producto en gris, los
 * incentivos en lima y la comunidad (colaborar) en tinta.
 */
export function CuatroLineas() {
  return (
    <section className={s.seccion} aria-labelledby="lineas-titulo">
      <h2 id="lineas-titulo" className={m.etiqueta} data-reveal="">
        {CUATRO_LINEAS.etiqueta}
      </h2>
      <ul className={e.tres} data-reveal="escalonado">
        {CUATRO_LINEAS.lineas.map((l) => (
          <li key={l.verbo} className={e.tresItem}>
            <Link
              href={l.href}
              hrefLang={l.enIngles ? "en" : undefined}
              className={`${e.linea} ${TONO_LINEA[l.tono]} ${s.elevable}`}
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
        {CUATRO_LINEAS.cifras.map((c) => (
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
      <ol className={`${m.principios} ${e.cuatro}`}>
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
      <p className={`${s.display} ${m.frase} ${e.fraseAliado}`}>
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

/**
 * Colaborar: Zelena también es una comunidad. Bloque gris con tres puertas (traer una
 * necesidad, construir, conocer el método) y, debajo, la comunidad y el manifiesto, que
 * son páginas de la landing en inglés.
 */
export function Colaborar() {
  return (
    <section
      id={COLABORAR.ancla}
      className={`${m.grupo} ${e.bloque} ${e.pegado} ${s.ancla}`}
      aria-labelledby="colaborar-titulo"
      data-reveal="seccion"
    >
      <Titular id="colaborar-titulo" etiqueta={COLABORAR.etiqueta} h2={COLABORAR.h2} intro={COLABORAR.intro} enBloque />
      <ol className={m.principios}>
        {COLABORAR.puertas.map((p) => (
          <li key={p.n} className={`${m.principio} ${s.elevable}`}>
            <span className={`${s.display} ${m.principioNumero}`} aria-hidden="true">
              {p.n}
            </span>
            <h3 className={m.principioTitulo}>{p.t}</h3>
            <p className={m.principioTexto}>{p.d}</p>
            <Link href={p.href} hrefLang={p.enIngles ? "en" : undefined} className={e.puertaEnlace}>
              {p.enlace}
              <IconoFlechaDerecha tamano={14} trazo={2.5} />
            </Link>
          </li>
        ))}
      </ol>
      <div className={e.colaborarAcciones}>
        <SecondaryCta href={COLABORAR.comunidad.href} hrefLang="en" nombre={COLABORAR.comunidad.nombre} />
        <SecondaryCta href={COLABORAR.manifiesto.href} hrefLang="en" nombre={COLABORAR.manifiesto.nombre} />
      </div>
    </section>
  );
}
