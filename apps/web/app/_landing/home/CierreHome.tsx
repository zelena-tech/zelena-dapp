import s from "../landing.module.css";
import c from "./cierre.module.css";
import { PrimaryCta } from "../Ctas";
import { ENLACES } from "../copy-comun";
import { CIERRE, CTA_DEMO } from "../copy-home";

/**
 * Cierre de la home, sobre lima: la invitación a la demo. El aviso legal de la página no
 * se repite aquí: lo pinta el pie (AVISOS_LEGALES.home).
 */
export default function CierreHome() {
  return (
    <section className={c.bloque} aria-labelledby="cierre-titulo" data-reveal="seccion">
      <p className={`${s.eyebrow} ${c.eyebrow}`} aria-hidden="true">
        {CIERRE.eyebrow}
      </p>
      <h2 id="cierre-titulo" className={`${s.display} ${c.titulo}`}>
        {CIERRE.h2}
      </h2>
      <p className={c.texto}>{CIERRE.texto}</p>
      <PrimaryCta
        href={ENLACES.reservarDemo}
        hrefLang="es"
        nombre={CTA_DEMO.nombre}
        className={c.accion}
      />
    </section>
  );
}
