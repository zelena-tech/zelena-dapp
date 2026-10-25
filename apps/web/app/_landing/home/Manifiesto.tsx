import Link from "next/link";
import s from "../landing.module.css";
import m from "./manifiesto.module.css";
import { SecondaryCta } from "../Ctas";
import { IconoFlechaDerecha } from "../Iconos";
import { ENLACES } from "../copy-comun";
import { MANIFIESTO } from "../copy-home";

/**
 * El manifiesto en tres pilares (copy exacto del diseño), con el enlace al manifiesto
 * completo y la puerta a la comunidad que tenía la landing anterior.
 */
export default function Manifiesto() {
  return (
    <section className={m.bloque} aria-labelledby="manifiesto-titulo" data-reveal="seccion">
      <p className={s.eyebrow} aria-hidden="true">
        {MANIFIESTO.eyebrow}
      </p>
      <h2 id="manifiesto-titulo" className={`${s.titulo2} ${m.titulo}`}>
        {MANIFIESTO.h2.linea1}{" "}
        <br />
        {MANIFIESTO.h2.antes}
        <span className={m.verde}>{MANIFIESTO.h2.resaltado}</span>
      </h2>
      <ol className={m.pilares}>
        {MANIFIESTO.pilares.map((p) => (
          <li key={p.n} className={`${m.pilar} ${s.elevable}`}>
            <p className={m.pilarNumero}>{p.n}</p>
            <h3 className={m.pilarTitulo}>{p.titulo}</h3>
            <p className={m.pilarTexto}>{p.texto}</p>
          </li>
        ))}
      </ol>
      <div className={m.enlaces}>
        <SecondaryCta
          href={ENLACES.manifiesto}
          hrefLang="es"
          nombre={MANIFIESTO.cta.nombre}
        />
        <Link href={ENLACES.comunidad} className={m.enlaceComunidad}>
          {MANIFIESTO.comunidad}
          <IconoFlechaDerecha tamano={16} />
        </Link>
      </div>
    </section>
  );
}
