import s from "../landing.module.css";
import m from "./manifiesto.module.css";
import Chip from "../Chip";
import { APERTURA } from "../copy-manifiesto";

/**
 * Apertura del manifiesto: chip, H1 en dos líneas (el mismo titular que el bloque de
 * /comunidad) y, al lado, de dónde venimos. Sin aparición al hacer scroll: es el hero.
 */
export default function HeroManifiesto() {
  const a = APERTURA;
  return (
    <section className={m.hero} aria-labelledby="manifiesto-titulo">
      <Chip tono="panel" punto className={m.mayus}>
        {a.chip}
      </Chip>
      <h1 id="manifiesto-titulo" className={`${s.titulo1} ${m.h1}`}>
        {a.h1.linea1}{" "}
        <br />
        {a.h1.antes}
        <span className={s.resaltado}>{a.h1.resaltado}</span>
      </h1>
      <div className={m.origen}>
        <h2 className={m.etiqueta}>{a.origenTitulo}</h2>
        <div className={m.origenTextos}>
          {a.origen.map((p) => (
            <p key={p.slice(0, 24)} className={m.origenParrafo}>
              {p}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
