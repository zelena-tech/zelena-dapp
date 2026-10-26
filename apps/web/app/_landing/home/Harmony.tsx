import s from "../landing.module.css";
import m from "./harmony.module.css";
import { IconoFlechaDerecha } from "../Iconos";
import { HARMONY } from "../copy-home";

/**
 * Harmony, sobre verde oscuro: el texto a la izquierda y, a la derecha, el teléfono del
 * operador. El teléfono es una maqueta: se lee como una sola frase (role="img") y lleva
 * debajo el rótulo de que los datos son de ejemplo. Ni nombre de persona ni banco.
 */
export default function Harmony() {
  const t = HARMONY.telefono;
  return (
    <section
      className={`${m.bloque} ${s.superficieOscura}`}
      aria-labelledby="harmony-titulo"
      data-reveal="seccion"
    >
      <div>
        <p className={`${s.eyebrow} ${m.mayus}`}>{HARMONY.eyebrow}</p>
        <h2 id="harmony-titulo" className={`${s.display} ${m.titulo}`}>
          {HARMONY.h2}
        </h2>
        <p className={m.subtitulo}>{HARMONY.subtitulo}</p>
        <p className={m.texto}>{HARMONY.texto}</p>
        <ul className={m.etiquetas} aria-hidden="true">
          {HARMONY.etiquetas.map((e) => (
            <li key={e} className={m.etiqueta}>
              {e}
            </li>
          ))}
        </ul>
      </div>

      <figure className={m.telefonoZona}>
        <div className={m.telefono} role="img" aria-label={t.aria}>
          <div className={m.pantalla}>
            <div className={m.muesca} />
            <div className={m.saludo}>
              <span className={m.saludoTexto}>{t.saludo}</span>
              <span className={m.marca}>{t.marca}</span>
            </div>
            <div className={m.puntaje}>
              <div className={m.anillo}>
                <div className={m.anilloCentro}>{t.puntaje}</div>
              </div>
              <div>
                <div className={m.puntajeTitulo}>{t.puntajeTitulo}</div>
                <div className={m.puntajeDetalle}>{t.puntajeDetalle}</div>
              </div>
            </div>
            <div className={m.bono}>
              <div className={m.bonoTitulo}>{t.bonoTitulo}</div>
              <div className={`${s.display} ${m.bonoValor}`}>
                {t.bonoCifra} <span className={m.bonoUnidad}>{t.bonoUnidad}</span>
              </div>
              <div className={m.bonoDestino}>
                <IconoFlechaDerecha tamano={11} trazo={2.5} />
                {t.bonoDestino}
              </div>
            </div>
            <div className={m.filas}>
              {t.filas.map((f) => (
                <div key={f.clave} className={m.fila}>
                  <span className={m.filaClave}>{f.clave}</span>
                  <span className={m.filaValor}>{f.valor}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <figcaption className={m.pieTelefono}>{HARMONY.pieTelefono}</figcaption>
      </figure>
    </section>
  );
}
