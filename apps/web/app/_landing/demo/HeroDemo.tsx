import s from "../landing.module.css";
import d from "./demo.module.css";
import Chip from "../Chip";
import { IconoCheck } from "../Iconos";
import FormularioDemo from "./FormularioDemo";
import { FORMULARIO_DEMO, HERO_DEMO } from "../copy-demo";

/**
 * Hero de la demo: a la izquierda, el H1, qué se ve en la demo y el hecho verificable de la
 * home; a la derecha, el formulario sobre panel gris (isla de cliente). En el teléfono, el
 * texto va primero. Sin aparición al hacer scroll: es el hero.
 */
export default function HeroDemo({ interesInicial }: { interesInicial: string }) {
  const h = HERO_DEMO;
  return (
    <section className={d.hero} aria-labelledby="demo-titulo">
      <div className={d.texto}>
        <Chip tono="panel" punto className={d.mayus}>
          {h.chip}
        </Chip>
        <h1 id="demo-titulo" className={`${s.titulo1} ${d.h1}`}>
          {h.h1.linea1}{" "}
          <br />
          {h.h1.antes}
          <span className={s.resaltado}>{h.h1.resaltado}</span>
          {h.h1.despues}
        </h1>
        <p className={`${s.lead} ${d.parrafo}`}>{h.parrafo}</p>

        <div className={d.agenda}>
          <h2 className={d.agendaTitulo}>{h.agendaTitulo}</h2>
          <ul className={d.agendaLista}>
            {h.agenda.map((t) => (
              <li key={t} className={d.agendaPunto}>
                <span className={d.vinieta} aria-hidden="true">
                  <IconoCheck tamano={11} trazo={3.25} />
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <Chip tono="tinta" tamano="sm" punto className={d.prueba}>
          {h.prueba}
        </Chip>
      </div>

      <div className={d.tarjeta}>
        <FormularioDemo textos={FORMULARIO_DEMO} interesInicial={interesInicial} />
      </div>
    </section>
  );
}
