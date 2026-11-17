import s from "../landing.module.css";
import m from "../manifiesto/manifiesto.module.css";
import e from "./empresas.module.css";
import Chip from "../Chip";
import { PrimaryCta, SecondaryCta } from "../Ctas";

// Piezas que comparten el portafolio y los incentivos: el hero, el titular de sección y
// el cierre en lima. Server components: solo pintan el copy que reciben.

interface Accion {
  href: string;
  nombre: string;
}

/** Hero: chip, el único H1 de la página (con una parte resaltada en lima), lead y acciones. */
export function HeroEmpresas({
  id,
  chip,
  h1,
  lead,
  primario,
  secundario,
}: {
  id: string;
  chip: string;
  h1: { antes: string; resaltado: string; despues: string };
  lead: string;
  primario: Accion;
  secundario: Accion;
}) {
  return (
    <section className={e.hero} aria-labelledby={id}>
      <Chip tono="panel" punto className={e.mayus}>
        {chip}
      </Chip>
      <h1 id={id} className={`${s.titulo1} ${e.h1}`}>
        {h1.antes}
        <span className={s.resaltado}>{h1.resaltado}</span>
        {h1.despues}
      </h1>
      <p className={`${s.lead} ${e.heroLead}`}>{lead}</p>
      <div className={e.acciones}>
        <PrimaryCta href={primario.href} nombre={primario.nombre} />
        <SecondaryCta href={secundario.href} nombre={secundario.nombre} />
      </div>
    </section>
  );
}

/**
 * Etiqueta mono, H2 en dos líneas (la última parte en verde) e introducción opcional.
 * `enBloque`: el titular va dentro de un bloque que ya aparece entero (data-reveal
 * "seccion"), así que no lleva sus propias marcas (no se anidan, ver Reveal.tsx).
 */
export function Titular({
  id,
  etiqueta,
  h2,
  intro,
  enBloque = false,
}: {
  id: string;
  etiqueta: string;
  h2: { linea1: string; antes: string; enfasis: string };
  intro?: string;
  enBloque?: boolean;
}) {
  const marca = (valor: string) => (enBloque ? {} : { "data-reveal": valor });
  return (
    <div className={e.titular}>
      <p className={m.etiqueta} {...marca("")}>
        {etiqueta}
      </p>
      <h2 id={id} className={`${s.titulo2} ${e.h2}`} {...marca("titulo")}>
        {h2.linea1}{" "}
        <br />
        {h2.antes}
        <span className={m.verde}>{h2.enfasis}</span>
      </h2>
      {intro ? (
        <p className={`${s.cuerpo} ${e.intro}`} {...marca("")}>
          {intro}
        </p>
      ) : null}
    </div>
  );
}

/** Cierre sobre lima, como el de la home y el del manifiesto: titular, texto y dos acciones. */
export function CierreEmpresas({
  id,
  titulo,
  texto,
  primario,
  secundario,
}: {
  id: string;
  titulo: { linea1: string; linea2: string };
  texto: string;
  primario: Accion;
  secundario: Accion;
}) {
  return (
    <section className={m.cierre} aria-labelledby={id} data-reveal="seccion">
      <h2 id={id} className={`${s.display} ${m.cierreTitulo}`}>
        {titulo.linea1}{" "}
        <br />
        {titulo.linea2}
      </h2>
      <div className={m.cierreTextos}>
        <p>{texto}</p>
      </div>
      <div className={m.cierreAcciones}>
        <PrimaryCta href={primario.href} nombre={primario.nombre} />
        <SecondaryCta href={secundario.href} nombre={secundario.nombre} />
      </div>
    </section>
  );
}
