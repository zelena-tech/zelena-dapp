import s from "../landing.module.css";
import m from "./manifiesto.module.css";
import { CREENCIA, GRUPOS } from "../copy-manifiesto";

/**
 * La creencia en bloque de tinta y los nueve principios en tres bloques grises con
 * tarjetas blancas (el mismo lenguaje que el manifiesto de la home). Un efecto de aparición
 * por bloque; las tarjetas no llevan el suyo (no se anidan).
 */
export default function Principios() {
  const c = CREENCIA;
  return (
    <>
      <section
        className={`${m.creencia} ${s.superficieOscura}`}
        aria-labelledby="creencia-titulo"
        data-reveal="seccion"
      >
        <h2 id="creencia-titulo" className={m.etiquetaOscura}>
          {c.etiqueta}
        </h2>
        <p className={`${s.display} ${m.frase}`}>
          {c.frase} <span className={m.lima}>{c.enfasis}</span>
        </p>
        <p className={m.nota}>{c.nota}</p>
      </section>

      {GRUPOS.map((g) => (
        <section key={g.num} className={m.grupo} aria-labelledby={`grupo-${g.num}`} data-reveal="seccion">
          <p className={m.etiqueta}>
            {g.num} · {g.nombre}
          </p>
          <h2 id={`grupo-${g.num}`} className={`${s.titulo2} ${m.grupoTitulo}`}>
            {g.titulo} <span className={m.verde}>{g.enfasis}</span>
          </h2>
          <p className={`${s.cuerpo} ${m.grupoIntro}`}>{g.intro}</p>
          <ol className={m.principios}>
            {g.principios.map((p) => (
              <li key={p.n} className={`${m.principio} ${s.elevable}`}>
                <span className={`${s.display} ${m.principioNumero}`} aria-hidden="true">
                  {p.n}
                </span>
                <h3 className={m.principioTitulo}>{p.t}</h3>
                <p className={m.principioTexto}>{p.d}</p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
