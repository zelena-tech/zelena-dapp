import s from "../landing.module.css";
import d from "./demo.module.css";
import Chip from "../Chip";
import { IconoCheck } from "../Iconos";
import FormularioDemo from "./FormularioDemo";
import { FORMULARIO_DEMO, HERO_DEMO, type TextosFormularioDemo, type TextosHeroDemo } from "../copy-demo";

/**
 * Hero de la demo: a la izquierda, el H1, qué se ve en la demo y el hecho verificable de la
 * home; a la derecha, el formulario sobre panel gris (isla de cliente). En el teléfono, el
 * texto va primero. Sin aparición al hacer scroll: es el hero. Por defecto, en inglés
 * (/book-a-demo); el contacto en español pasa sus textos.
 */
export default function HeroDemo({
  interesInicial,
  hero = HERO_DEMO,
  formulario = FORMULARIO_DEMO,
}: {
  interesInicial: string;
  hero?: TextosHeroDemo;
  formulario?: TextosFormularioDemo;
}) {
  const h = hero;
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

        {h.prueba ? (
          <Chip tono="tinta" tamano="sm" punto className={d.prueba}>
            {h.prueba}
          </Chip>
        ) : null}
      </div>

      <div className={d.tarjeta}>
        <FormularioDemo textos={formulario} interesInicial={interesInicial} />
      </div>
    </section>
  );
}
