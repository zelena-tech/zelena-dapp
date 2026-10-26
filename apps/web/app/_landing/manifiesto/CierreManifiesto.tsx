import s from "../landing.module.css";
import m from "./manifiesto.module.css";
import { PrimaryCta, SecondaryCta } from "../Ctas";
import { INVITACION } from "../copy-manifiesto";

/**
 * Cierre del manifiesto, sobre lima: la invitación, con los proyectos abiertos de
 * /comunidad y los encuentros (página en español). El aviso legal lo pinta el pie.
 */
export default function CierreManifiesto() {
  const i = INVITACION;
  return (
    <section className={m.cierre} aria-labelledby="invitacion-titulo" data-reveal="seccion">
      <h2 id="invitacion-titulo" className={`${s.display} ${m.cierreTitulo}`}>
        {i.titulo.linea1}{" "}
        <br />
        {i.titulo.linea2}
      </h2>
      <div className={m.cierreTextos}>
        {i.textos.map((t) => (
          <p key={t.slice(0, 24)}>{t}</p>
        ))}
        <p className={m.cierreFuerte}>{i.cierre}</p>
      </div>
      <div className={m.cierreAcciones}>
        <PrimaryCta href={i.proyectos.href} nombre={i.proyectos.nombre} />
        <SecondaryCta href={i.encuentros.href} hrefLang="es" nombre={i.encuentros.nombre} />
      </div>
    </section>
  );
}
