import Link from "next/link";
import s from "../landing.module.css";
import c from "./comunidad.module.css";
import { IconoCheck, IconoFlechaDerecha } from "../Iconos";
import { TECNOLOGIA } from "../copy-comunidad";
import type { CifrasComunidad, VotacionAbierta } from "@/lib/landing-datos";

const T = TECNOLOGIA;

/** Maqueta 01: un registro de entregas de ejemplo (rotulado), cada una con su huella. */
function Registro() {
  const v = T.registro.visual;
  return (
    <div className={c.registro} aria-hidden="true">
      <div className={c.registroCabeza}>
        <span>{v.cabecera}</span>
        <span className={c.muestra}>{v.muestra}</span>
      </div>
      {v.filas.map((f) => (
        <div key={f.n} className={c.registroFila}>
          <span className={c.registroCheck}>
            <IconoCheck tamano={10} trazo={3} />
          </span>
          <span className={c.registroNombre}>{f.n}</span>
          <span className={c.registroHuella}>{f.huella}</span>
        </div>
      ))}
    </div>
  );
}

/** Maqueta 02: dos avisos de pago por hito, de ejemplo (sin clientes ni tiempos). */
function Avisos() {
  const v = T.pago.visual;
  return (
    <div className={c.avisos} aria-hidden="true">
      {v.avisos.map((a) => (
        <div key={a.detalle} className={c.avisoPago}>
          <span className={c.avisoIcono}>$</span>
          <div>
            <div className={c.avisoMonto}>{a.monto}</div>
            <div className={c.avisoDetalle}>{a.detalle}</div>
          </div>
          <span className={c.muestra}>{v.muestra}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Maqueta 03: la votación abierta con su barra real (la misma que /gobernanza), o, sin
 * votación, una barra neutra con las decisiones publicadas. Nada de contratos que
 * "ejecutan" lo votado: los votos se registran y las decisiones se publican.
 */
function Votacion({ votacion, decisiones }: { votacion: VotacionAbierta | null; decisiones: number }) {
  const v = T.decisiones.visual;
  if (!votacion) {
    return (
      <div className={c.voto} aria-hidden="true">
        <div className={c.votoFila}>
          <span>{v.sinVotacion}</span>
          <span className={c.votoLima}>{v.publicadas(decisiones)}</span>
        </div>
        <div className={c.votoBarra} />
        <div className={c.votoPie}>
          <IconoFlechaDerecha tamano={11} />
          {v.pie}
        </div>
      </div>
    );
  }
  return (
    <div className={c.voto} aria-hidden="true">
      <div className={c.votoFila}>
        <span>{v.votacion(votacion.id)}</span>
        <span className={c.votoLima}>{votacion.total > 0 ? v.favor(votacion.pctFavor) : v.sinVotos}</span>
      </div>
      <div className={c.votoBarra}>
        <div className={c.votoRelleno} style={{ width: `${votacion.pctFavor}%` }} />
      </div>
      <div className={c.votoPie}>
        <IconoFlechaDerecha tamano={11} />
        <span className={c.votoLima}>{v.umbral(votacion.umbral)}</span>
      </div>
    </div>
  );
}

/**
 * "Technology you don't notice" (principio 08 del manifiesto): tres tarjetas con una
 * maqueta cada una. Las maquetas son decorativas (`aria-hidden`): el título y el texto de
 * cada tarjeta ya dicen lo mismo. Lo que es ejemplo lleva su rótulo.
 */
export default function Tecnologia({
  cifras,
  votacion,
}: {
  cifras: CifrasComunidad;
  votacion: VotacionAbierta | null;
}) {
  return (
    <section className={s.seccion} aria-labelledby="tecnologia-titulo">
      <div className={c.cabecera} data-reveal="titulo">
        <div>
          <p className={s.eyebrow} aria-hidden="true">
            {T.eyebrow}
          </p>
          <h2 id="tecnologia-titulo" className={`${s.titulo2} ${c.tituloSeccion}`}>
            {T.titulo[0]} <br />
            {T.titulo[1]}
          </h2>
        </div>
        <div className={c.introCaja}>
          <p className={c.introSeccion}>{T.intro}</p>
          <Link href={T.enlace.href} hrefLang="es" className={`${c.enlace} ${c.enlaceVerde}`}>
            {T.enlace.texto}
            <IconoFlechaDerecha tamano={14} />
          </Link>
        </div>
      </div>
      <ul className={c.tecGrid} data-reveal="escalonado">
        <li>
          <article className={`${c.tec} ${c.tecLima} ${s.elevable}`}>
            <div className={c.tecCabeza}>
              <span className={c.tecEtiqueta}>{T.registro.etiqueta}</span>
              <span className={`${s.display} ${c.tecNumero}`} aria-hidden="true">
                {T.registro.numero}
              </span>
            </div>
            <Registro />
            <h3 className={c.tecTitulo}>{T.registro.titulo}</h3>
            <p className={c.tecTexto}>{T.registro.texto}</p>
          </article>
        </li>
        <li>
          <article className={`${c.tec} ${c.tecVerde} ${s.elevable}`}>
            <div className={c.tecCabeza}>
              <span className={c.tecEtiqueta}>{T.pago.etiqueta}</span>
              <span className={`${s.display} ${c.tecNumero}`} aria-hidden="true">
                {T.pago.numero}
              </span>
            </div>
            <Avisos />
            <h3 className={c.tecTitulo}>{T.pago.titulo}</h3>
            <p className={c.tecTexto}>{T.pago.texto}</p>
          </article>
        </li>
        <li>
          <article className={`${c.tec} ${c.tecTinta} ${s.elevable} ${s.superficieOscura}`}>
            <div className={c.tecCabeza}>
              <span className={c.tecEtiqueta}>{T.decisiones.etiqueta}</span>
              <span className={`${s.display} ${c.tecNumero}`} aria-hidden="true">
                {T.decisiones.numero}
              </span>
            </div>
            <Votacion votacion={votacion} decisiones={cifras.decisiones} />
            <h3 className={c.tecTitulo}>{T.decisiones.titulo}</h3>
            <p className={c.tecTexto}>{T.decisiones.texto}</p>
          </article>
        </li>
      </ul>
    </section>
  );
}
