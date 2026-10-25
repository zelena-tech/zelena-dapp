import type { CSSProperties } from "react";
import s from "../landing.module.css";
import h from "./heroBento.module.css";
import Chip from "../Chip";
import Imagen from "../Imagen";
import { IMG } from "../assets";
import { PrimaryCta } from "../Ctas";
import { ENLACES } from "../copy-comun";
import { BENTO, CTA_DEMO, HERO } from "../copy-home";
import { IconoCheck, IconoFlechaArriba, IconoFlechaDiagonal } from "../Iconos";
import { ONDAS } from "./ondas";

// Inclinación de cada píldora de la tarjeta D, en el orden del copy (como en el diseño).
const GIROS_PASTILLAS = ["-8deg", "6deg", "-4deg", "9deg", "-5deg", "5deg"];

// Fondo de la ficha de cada fila de la tabla de ejemplo: lima, lima claro, tinte.
const FICHAS = [h.fichaLima, h.fichaLimaClaro, h.fichaTinte];

/** Silueta neutra de operador (en lugar de iniciales: la tabla es un ejemplo). */
function Operador() {
  return (
    <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="8" r="4.5" />
      <path d="M3.5 21c0-4.4 3.8-7.5 8.5-7.5s8.5 3.1 8.5 7.5z" />
    </svg>
  );
}

/**
 * Hero de la home (diseño "Bento"): chip, H1 en dos líneas, párrafo, CTA con una prueba
 * verificable y la rejilla A/B/C/D. Todo en el servidor; el movimiento es CSS (flotar y
 * mecerse, solo sin "menos movimiento"). Sin aparición al hacer scroll: es el hero.
 *
 * La rejilla cambia con CSS, nunca con JS: una columna en el teléfono, dos en tableta (A y
 * D a lo ancho) y la de tres columnas desde 980px.
 */
export default function HeroBento() {
  const { a, b, c, d } = BENTO;
  return (
    <section className={h.hero} aria-labelledby="inicio-titulo">
      <div className={h.encabezado}>
        <Chip tono="panel" punto className={h.mayus}>
          {HERO.chip}
        </Chip>
        <h1 id="inicio-titulo" className={`${s.titulo1} ${h.h1}`}>
          {HERO.h1.linea1}{" "}
          <br />
          {HERO.h1.antes}
          <span className={s.resaltado}>{HERO.h1.resaltado}</span>
          {HERO.h1.despues}
        </h1>
        <p className={`${s.lead} ${h.parrafo}`}>{HERO.parrafo}</p>
        <div className={h.fila}>
          <PrimaryCta href={ENLACES.reservarDemo} hrefLang="es" comando={CTA_DEMO.comando} nombre={CTA_DEMO.nombre} />
          <p className={h.prueba}>
            <span className={h.pruebaIconos} aria-hidden="true">
              <span className={`${h.pruebaIcono} ${h.pruebaLima}`}>
                <IconoCheck tamano={14} trazo={2.75} />
              </span>
              <span className={`${h.pruebaIcono} ${h.pruebaTinta}`}>
                <IconoFlechaDiagonal tamano={14} trazo={2.75} />
              </span>
              <span className={`${h.pruebaIcono} ${h.pruebaVerde}`}>
                <IconoFlechaArriba tamano={14} trazo={2.75} />
              </span>
            </span>
            <span>{HERO.prueba}</span>
          </p>
        </div>
      </div>

      <div className={h.bento}>
        {/* A · el avatar en el piso (maqueta: se lee como una sola frase). */}
        <div className={h.celdaA} role="img" aria-label={a.aria}>
          <div className={h.brillo} />
          <div className={h.sombraSuelo} />
          <div className={h.avatarCaja}>
            <div className={h.avatarVaiven}>
              <Imagen img={IMG.avatarDePie} perezosa={false} className={h.avatar} />
            </div>
          </div>
          <div className={`${h.chipPuntaje} ${s.flota}`}>
            <div className={h.chipPuntajeCaja}>
              <span className={h.puntajeCifra}>{a.puntaje}</span>
              <span className={h.puntajeTextos}>
                <span className={h.puntajeTitulo}>{a.puntajeTitulo}</span>
                <span className={h.puntajeDetalle}>{a.puntajeDetalle}</span>
              </span>
            </div>
          </div>
          <Chip tono="blanco" tamano="sm" className={`${h.mayus} ${h.muestraA}`}>
            {a.muestra}
          </Chip>
          <div className={`${s.vidrio} ${h.barraPago}`}>
            <span className={h.check}>
              <IconoCheck tamano={16} trazo={3} />
            </span>
            <span className={h.pagoTextos}>
              <span className={h.pagoTitulo}>{a.pagoTitulo}</span>
              <span className={h.pagoDetalle}>{a.pagoDetalle}</span>
            </span>
          </div>
        </div>

        {/* B · tabla semanal de ejemplo. */}
        <div className={h.celdaB} role="img" aria-label={b.aria}>
          <div className={h.tablaCabeza}>
            <span className={h.tablaTitulo}>{b.titulo}</span>
            <Chip tono="tinta" tamano="sm" className={h.mayus}>
              {b.muestra}
            </Chip>
          </div>
          {b.filas.map((f, i) => (
            <div key={f.nombre} className={i === 0 ? `${h.filaTabla} ${h.filaPrimera}` : h.filaTabla}>
              <span className={`${h.ficha} ${FICHAS[i % FICHAS.length]}`}>
                <Operador />
              </span>
              <span className={h.filaNombre}>{f.nombre}</span>
              <span className={h.filaPuntaje}>{f.puntaje}</span>
              <span className={h.filaBono}>{f.bono}</span>
            </div>
          ))}
        </div>

        {/* C · el lema, sobre lima. */}
        <div className={h.celdaC}>
          <Imagen img={IMG.stickerTeclaZ} perezosa={false} className={h.sticker} />
          <p className={h.lema}>
            {c.linea1}{" "}
            <br />
            {c.linea2}
          </p>
        </div>

        {/* D · la cifra de años y las píldoras inclinadas, sobre tinta. */}
        <div className={`${h.celdaD} ${s.superficieOscura}`}>
          <svg className={h.ondas} viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {ONDAS.map((dd, i) => (
              <path key={i} d={dd} />
            ))}
          </svg>
          <span className={h.flechaArriba} aria-hidden="true">
            <IconoFlechaArriba tamano={20} trazo={2.75} />
          </span>
          <p className={`${s.display} ${h.anos}`}>{d.cifra}</p>
          <p className={h.anosTexto}>{d.texto}</p>
          <ul className={h.pastillas} aria-label={d.pastillasAria}>
            {d.pastillas.map((p, i) => (
              <li
                key={p}
                className={h.pastilla}
                style={{ "--giro": GIROS_PASTILLAS[i % GIROS_PASTILLAS.length] } as CSSProperties}
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
