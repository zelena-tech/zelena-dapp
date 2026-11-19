import Link from "next/link";
import s from "../landing.module.css";
import m from "../manifiesto/manifiesto.module.css";
import e from "./empresas.module.css";
import Chip from "../Chip";
import Imagen from "../Imagen";
import { IMG } from "../assets";
import { IconoFlechaDerecha } from "../Iconos";
import { PrimaryCta, SecondaryCta } from "../Ctas";
import { Titular } from "./Comunes";
import { CLIENTES } from "../copy-home";
import { CICLO, COLABORAR, HERO_PORTAFOLIO, IMPACTO, PASOS_CICLO, SECTORES } from "../copy-portafolio";

// Las secciones de la inicio, en el orden de la historia: la frase de gancho, a quiénes
// hemos impactado, (los servicios, en Explorador), cómo trabajamos y colaborar. Sin efecto
// de aparición al hacer scroll: el único movimiento de la página es el tachado del titular
// (y el que provoca quien tacha lo que le pasa, en los servicios).

/**
 * Titular: "Tecnología para ~complicarte~ mejorar tu negocio." Al cargar, una línea tacha
 * "complicarte" y el lima marca "mejorar tu negocio". El tachado es decorativo: el lector
 * de pantalla oye "Tecnología para mejorar tu negocio."
 */
export function HeroPortafolio() {
  const h = HERO_PORTAFOLIO;
  return (
    <section className={e.hero} aria-labelledby="portafolio-titulo">
      <Chip tono="panel" punto className={e.mayus}>
        {h.chip}
      </Chip>
      <h1 id="portafolio-titulo" className={`${s.titulo1} ${e.h1}`}>
        {h.h1.linea1}{" "}
        <br />
        <span className={e.tachado} aria-hidden="true">
          {h.h1.tachado}
        </span>{" "}
        <span className={`${s.resaltado} ${e.marcado}`}>{h.h1.resaltado}</span>
      </h1>
      <p className={`${s.lead} ${e.heroLead}`}>{h.lead}</p>
      <div className={e.acciones}>
        <PrimaryCta href={h.primario.href} nombre={h.primario.nombre} />
        <SecondaryCta href={h.secundario.href} nombre={h.secundario.nombre} />
      </div>
    </section>
  );
}

/**
 * A quiénes hemos impactado, sobre tinta: dos años con operaciones reales y algunas de las
 * empresas con las que trabajamos (las de la home, autorizadas). Cada logo abre el
 * Instagram de la empresa en otra pestaña.
 */
export function Impacto() {
  const i = IMPACTO;
  return (
    <section
      id={i.ancla}
      className={`${m.creencia} ${e.bloque} ${e.bloquePrimero} ${s.superficieOscura} ${s.ancla}`}
      aria-labelledby="impacto-titulo"
    >
      <h2 id="impacto-titulo" className={`${s.display} ${m.frase} ${e.impactoFrase}`}>
        {i.titulo}
      </h2>
      <div className={e.impactoCuerpo}>
        <p className={e.impactoHistoria}>{i.historia}</p>
        <div className={e.impactoClientes}>
          <h3 className={e.impactoClientesTitulo}>{i.clientes}</h3>
          <ul className={e.logos}>
            {CLIENTES.map((c) => (
              <li key={c.nombre}>
                <a
                  href={`https://www.instagram.com/${c.instagram}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={e.logo}
                >
                  <Imagen img={IMG[c.logo]} className={e.logoImagen} />
                  <span className={e.logoTexto}>
                    <span className={e.logoNombre}>{c.nombre}</span>
                    <span className={e.logoCuenta}>
                      @{c.instagram}
                      <span className={s.srOnly}>
                        {" "}
                        {i.enInstagram} {i.otraPestana}
                      </span>
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className={e.impactoPie}>
        <p className={e.impactoParaQuien}>{i.paraQuien}</p>
        <ul className={e.sectores}>
          {SECTORES.map((x) => (
            <li key={x}>
              <Chip tono="blanco">{x}</Chip>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Cómo trabajamos: los cuatro pasos del ciclo (una secuencia: por eso van numerados). */
export function CicloDeTrabajo() {
  return (
    <section id={CICLO.ancla} className={`${m.grupo} ${e.bloque} ${e.bloquePrimero} ${s.ancla}`} aria-labelledby="ciclo-titulo">
      <Titular id="ciclo-titulo" h2={CICLO.h2} intro={CICLO.intro} sinAparicion />
      <ol className={`${m.principios} ${e.cuatro}`}>
        {PASOS_CICLO.map((p) => (
          <li key={p.n} className={`${m.principio} ${s.elevable}`}>
            <span className={`${s.display} ${m.principioNumero}`} aria-hidden="true">
              {p.n}
            </span>
            <h3 className={m.principioTitulo}>{p.titulo}</h3>
            <p className={m.principioTexto}>{p.detalle}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Colaborar: abrir la tecnología también es abrir el trabajo. Bloque gris con tres
 * puertas: traer una necesidad (el formulario), construir con nosotros (la comunidad) y
 * leer el manifiesto. Las dos últimas son páginas de la landing en inglés (hrefLang).
 */
export function Colaborar() {
  return (
    <section
      id={COLABORAR.ancla}
      className={`${m.grupo} ${e.bloque} ${e.pegado} ${s.ancla}`}
      aria-labelledby="colaborar-titulo"
    >
      <Titular id="colaborar-titulo" h2={COLABORAR.h2} intro={COLABORAR.intro} sinAparicion />
      <ul className={m.principios}>
        {COLABORAR.puertas.map((p) => (
          <li key={p.t} className={`${m.principio} ${s.elevable}`}>
            <h3 className={m.principioTitulo}>{p.t}</h3>
            <p className={m.principioTexto}>{p.d}</p>
            <Link href={p.href} hrefLang={p.enIngles ? "en" : undefined} className={e.puertaEnlace}>
              {p.enlace}
              <IconoFlechaDerecha tamano={14} trazo={2.5} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
