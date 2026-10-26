import s from "../landing.module.css";
import h from "./heroBento.module.css";
import Chip from "../Chip";
import Imagen from "../Imagen";
import { IMG } from "../assets";
import { PrimaryCta } from "../Ctas";
import { ENLACES } from "../copy-comun";
import { BLOQUE_CLIENTES, CLIENTES, CTA_DEMO, HERO } from "../copy-home";
import { IconoCheck, IconoFlechaArriba, IconoFlechaDiagonal } from "../Iconos";

/**
 * Hero de la home: chip, H1 en dos líneas, párrafo, CTA con una prueba verificable y, debajo,
 * el bloque de clientes: "2 years impacting companies" y un círculo por cliente, como foto de
 * perfil, sin rótulos. Al pasar el ratón el círculo sube un poco; el clic abre su Instagram
 * en otra pestaña (el nombre lo dicen el aria-label y el title). Todo en el servidor; sin
 * aparición al hacer scroll: es el hero.
 */
export default function HeroBento() {
  const a = BLOQUE_CLIENTES;
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
          <PrimaryCta href={ENLACES.reservarDemo} nombre={CTA_DEMO.nombre} />
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

      <div className={h.clientes}>
        <div className={h.clientesTexto}>
          <Chip tono="blanco" tamano="sm" punto className={h.mayus}>
            {a.etiqueta}
          </Chip>
          <p className={`${s.display} ${h.anosCifra}`}>{a.cifra}</p>
          <p className={h.anosTexto}>{a.texto}</p>
        </div>
        <ul className={h.circulos} aria-label={a.logosAria}>
          {CLIENTES.map((cl) => (
            <li key={cl.nombre} className={h.circuloCelda}>
              <a
                href={`https://www.instagram.com/${cl.instagram}/`}
                target="_blank"
                rel="noopener noreferrer"
                className={h.cliente}
                aria-label={`${cl.nombre} ${a.enInstagram}`}
                title={`${cl.nombre} ${a.enInstagram}`}
              >
                <Imagen img={IMG[cl.logo]} perezosa={false} className={h.circulo} />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
