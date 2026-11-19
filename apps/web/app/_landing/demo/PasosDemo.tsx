import s from "../landing.module.css";
import d from "./demo.module.css";
import { SecondaryCta } from "../Ctas";
import { PASOS_DEMO, type TextosPasosDemo } from "../copy-demo";

/**
 * Qué pasa después de enviar, en bloque de tinta: tres pasos sin plazos inventados y, para
 * quien todavía no quiere escribir, la puerta a "how it works" de la home. Por defecto, en
 * inglés; el contacto en español pasa sus textos.
 */
export default function PasosDemo({ textos = PASOS_DEMO }: { textos?: TextosPasosDemo }) {
  return (
    <section
      className={`${d.pasosBloque} ${s.superficieOscura}`}
      aria-labelledby="demo-pasos-titulo"
      data-reveal="seccion"
    >
      <h2 id="demo-pasos-titulo" className={`${s.titulo2} ${d.pasosTitulo}`}>
        {textos.titulo}
      </h2>
      <ol className={d.pasos}>
        {textos.pasos.map((p) => (
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
        <SecondaryCta href={textos.enlace.href} nombre={textos.enlace.nombre} sobreOscuro />
      </div>
    </section>
  );
}
