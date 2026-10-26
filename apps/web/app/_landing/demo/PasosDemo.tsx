import s from "../landing.module.css";
import d from "./demo.module.css";
import { SecondaryCta } from "../Ctas";
import { PASOS_DEMO } from "../copy-demo";

/**
 * Qué pasa después de enviar, en bloque de tinta: tres pasos sin plazos inventados y, para
 * quien todavía no quiere escribir, la puerta a "how it works" de la home.
 */
export default function PasosDemo() {
  return (
    <section
      className={`${d.pasosBloque} ${s.superficieOscura}`}
      aria-labelledby="demo-pasos-titulo"
      data-reveal="seccion"
    >
      <h2 id="demo-pasos-titulo" className={`${s.titulo2} ${d.pasosTitulo}`}>
        {PASOS_DEMO.titulo}
      </h2>
      <ol className={d.pasos}>
        {PASOS_DEMO.pasos.map((p) => (
          <li key={p.n} className={d.paso}>
            <span className={`${s.display} ${d.pasoNumero}`} aria-hidden="true">
              {p.n}
            </span>
            <h3 className={d.pasoTitulo}>{p.titulo}</h3>
            <p className={d.pasoTexto}>{p.texto}</p>
          </li>
        ))}
      </ol>
      <div className={d.pasosPie}>
        <SecondaryCta href={PASOS_DEMO.enlace.href} nombre={PASOS_DEMO.enlace.nombre} sobreOscuro />
      </div>
    </section>
  );
}
