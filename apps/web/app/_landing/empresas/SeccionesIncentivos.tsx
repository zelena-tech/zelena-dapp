import s from "../landing.module.css";
import m from "../manifiesto/manifiesto.module.css";
import p from "../home/productos.module.css";
import e from "./empresas.module.css";
import { IconoCheck } from "../Iconos";
import { Titular } from "./Comunes";
import { BENEFICIOS, DOLAR_DIGITAL, PARA_QUIEN, PASOS_INCENTIVOS, REGLAS_CLARAS } from "../copy-incentivos";

/** Qué es un dólar digital: tres tarjetas grises, en lenguaje llano. */
export function DolarDigital() {
  return (
    <section className={s.seccion} aria-labelledby="dolar-titulo">
      <Titular id="dolar-titulo" etiqueta={DOLAR_DIGITAL.etiqueta} h2={DOLAR_DIGITAL.h2} intro={DOLAR_DIGITAL.intro} />
      <ul className={e.pasos} data-reveal="escalonado">
        {DOLAR_DIGITAL.puntos.map((x) => (
          <li key={x.n} className={`${e.paso} ${s.elevable}`}>
            <span className={`${s.display} ${e.pasoNumero}`} aria-hidden="true">
              {x.n}
            </span>
            <h3 className={e.pasoTitulo}>{x.t}</h3>
            <p className={e.pasoTexto}>{x.d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Ahorro, productividad y pertenencia: bloque gris con tres tarjetas blancas. */
export function Beneficios() {
  return (
    <section id="beneficios" className={`${m.grupo} ${e.bloque} ${e.bloquePrimero} ${s.ancla}`} aria-labelledby="beneficios-titulo" data-reveal="seccion">
      <Titular id="beneficios-titulo" etiqueta={BENEFICIOS.etiqueta} h2={BENEFICIOS.h2} intro={BENEFICIOS.intro} sinAparicion />
      <ol className={m.principios}>
        {BENEFICIOS.puntos.map((x) => (
          <li key={x.n} className={`${m.principio} ${s.elevable}`}>
            <span className={`${s.display} ${m.principioNumero}`} aria-hidden="true">
              {x.n}
            </span>
            <h3 className={m.principioTitulo}>{x.t}</h3>
            <p className={m.principioTexto}>{x.d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Cómo funciona: cuatro pasos; el último, en lima, es el pago (como en la home). */
export function PasosIncentivos() {
  const ultimo = PASOS_INCENTIVOS.pasos.length - 1;
  return (
    <section id={PASOS_INCENTIVOS.ancla} className={`${s.seccion} ${s.ancla}`} aria-labelledby="pasos-titulo">
      <Titular id="pasos-titulo" etiqueta={PASOS_INCENTIVOS.etiqueta} h2={PASOS_INCENTIVOS.h2} />
      <ol className={`${e.pasos} ${e.pasosCuatro}`} data-reveal="escalonado">
        {PASOS_INCENTIVOS.pasos.map((x, i) => (
          <li key={x.n} className={`${e.paso} ${i === ultimo ? e.pasoLima : ""} ${s.elevable}`}>
            <span className={`${s.display} ${e.pasoNumero}`} aria-hidden="true">
              {x.n}
            </span>
            <h3 className={e.pasoTitulo}>{x.t}</h3>
            <p className={e.pasoTexto}>{x.d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Puntos({ puntos }: { puntos: readonly string[] }) {
  return (
    <ul className={p.puntos}>
      {puntos.map((t) => (
        <li key={t} className={p.punto}>
          <span className={p.vinieta} aria-hidden="true">
            <IconoCheck tamano={11} trazo={3.25} />
          </span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** Qué gana cada parte: la empresa (gris) y el equipo (lima), como las tarjetas de producto de la home. */
export function ParaQuien() {
  return (
    <section className={s.seccion} aria-labelledby="para-quien-titulo">
      <h2 id="para-quien-titulo" className={m.etiqueta} data-reveal="">
        {PARA_QUIEN.titulo}
      </h2>
      <ul className={`${p.tarjetas} ${e.dosTarjetas}`} data-reveal="escalonado">
        <li className={`${p.tarjeta} ${p.tarjetaPanel} ${s.elevable}`}>
          <h3 className={p.tarjetaTitulo}>{PARA_QUIEN.empresa.titulo}</h3>
          <Puntos puntos={PARA_QUIEN.empresa.puntos} />
        </li>
        <li className={`${p.tarjeta} ${p.tarjetaLima} ${s.elevable}`}>
          <h3 className={p.tarjetaTitulo}>{PARA_QUIEN.equipo.titulo}</h3>
          <Puntos puntos={PARA_QUIEN.equipo.puntos} />
        </li>
      </ul>
    </section>
  );
}

/** Reglas claras: bloque de tinta con lo que hay que saber antes de empezar. */
export function ReglasClaras() {
  return (
    <section className={`${m.creencia} ${s.superficieOscura}`} aria-labelledby="reglas-titulo" data-reveal="seccion">
      <h2 id="reglas-titulo" className={m.etiquetaOscura}>
        {REGLAS_CLARAS.etiqueta}
      </h2>
      <ol className={e.reglas}>
        {REGLAS_CLARAS.reglas.map((r, i) => (
          <li key={r} className={e.regla}>
            <span className={`${s.display} ${e.reglaNumero}`} aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <p className={e.reglaTexto}>{r}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
