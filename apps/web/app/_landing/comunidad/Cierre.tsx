import s from "../landing.module.css";
import c from "./comunidad.module.css";
import { PrimaryCta, SecondaryCta } from "../Ctas";
import { ENLACES } from "../copy-comun";
import { CIERRE } from "../copy-comunidad";
import type { LlamadaLanding } from "@/lib/landing-datos";
import VentanaCodigo from "./VentanaCodigo";

/**
 * Cierre en lima: "Real work. Real rewards.", los proyectos abiertos y la llamada a
 * participar (el encuentro publicado, el próximo rito preparado o el aviso por correo),
 * y la ventana de código que se teclea sola. El aviso legal de la página lo pinta el pie.
 */
export default function Cierre({ llamada }: { llamada: LlamadaLanding }) {
  return (
    <section className={c.cierre} aria-labelledby="cierre-titulo" data-reveal="seccion">
      <div className={c.cierreTexto}>
        <p className={c.cierreEyebrow} aria-hidden="true">
          {CIERRE.eyebrow}
        </p>
        <h2 id="cierre-titulo" className={`${s.display} ${c.cierreTitulo}`}>
          {CIERRE.titulo[0]} <br />
          {CIERRE.titulo[1]}
        </h2>
        <p className={c.cierreParrafo}>{CIERRE.texto}</p>
        <div className={c.cierreBotones}>
          <PrimaryCta href={ENLACES.proyectosAbiertos} nombre={CIERRE.cta.nombre} />
          <SecondaryCta href={llamada.href} hrefLang="es" nombre={llamada.texto} />
        </div>
      </div>
      <VentanaCodigo
        archivo={CIERRE.archivo}
        lineas={CIERRE.codigo}
        aviso={CIERRE.aviso.texto}
        muestra={CIERRE.aviso.muestra}
      />
    </section>
  );
}
