import s from "../landing.module.css";
import c from "./comunidad.module.css";
import { SecondaryCta } from "../Ctas";
import { ENLACES } from "../copy-comun";
import { MANIFIESTO } from "../copy-comunidad";

/**
 * Manifiesto en bloque oscuro: los tres pilares (fieles a /manifiesto) y el enlace para
 * leerlo entero. Un solo efecto de aparición, el del bloque (no se anidan).
 */
export default function Manifiesto() {
  const M = MANIFIESTO;
  return (
    <section
      className={`${c.manifiesto} ${s.superficieOscura}`}
      aria-labelledby="manifiesto-titulo"
      data-reveal="seccion"
    >
      <p className={s.eyebrow} aria-hidden="true">
        {M.eyebrow}
      </p>
      <h2 id="manifiesto-titulo" className={`${s.titulo2} ${c.tituloSeccion}`}>
        {M.titulo.linea1} <br />
        {M.titulo.linea2} <span className={c.resaltadoLima}>{M.titulo.resaltado}</span>
      </h2>
      <ul className={c.pilares}>
        {M.pilares.map((p) => (
          <li key={p.n} className={c.pilar}>
            <span className={c.pilarNumero}>{p.n}</span>
            <h3 className={c.pilarTitulo}>{p.t}</h3>
            <p className={c.pilarTexto}>{p.d}</p>
          </li>
        ))}
      </ul>
      <div className={c.manifiestoPie}>
        <SecondaryCta
          href={ENLACES.manifiesto}
          hrefLang="es"
          nombre={M.cta.nombre}
          sobreOscuro
        />
      </div>
    </section>
  );
}
