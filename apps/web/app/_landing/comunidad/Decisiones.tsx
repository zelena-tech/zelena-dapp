import Link from "next/link";
import s from "../landing.module.css";
import c from "./comunidad.module.css";
import { IconoFlechaDerecha } from "../Iconos";
import { ENLACES } from "../copy-comun";
import { DECISIONES } from "../copy-comunidad";
import type { VotacionAbierta } from "@/lib/landing-datos";

/**
 * Decisiones (lo que el prototipo llamaba "Agora": en el sitio el Ágora son los
 * proyectos, y las votaciones viven en /gobernanza). Solo lectura: cada votación abierta
 * con su recuento real (sin cuentas de prueba) y su umbral, y un enlace para votar en
 * /gobernanza, donde se vota con sesión y el acuerdo firmado. Nada de votos de mentira
 * ni de fechas de cierre que no existen. Sin votaciones: el cero y el registro completo.
 */
export default function Decisiones({ votaciones, decisiones }: { votaciones: VotacionAbierta[]; decisiones: number }) {
  return (
    <section
      className={`${c.decisiones} ${s.superficieOscura}`}
      aria-labelledby="decisiones-titulo"
      data-reveal="seccion"
    >
      <div className={c.cabecera}>
        <div>
          <h2 id="decisiones-titulo" className={`${s.titulo2} ${c.tituloCompacto}`}>
            {DECISIONES.titulo}
          </h2>
        </div>
        <p className={c.introSeccion}>{DECISIONES.intro}</p>
      </div>

      {votaciones.length > 0 ? (
        <ul className={c.decLista}>
          {votaciones.map((v) => (
            <li key={v.id} className={c.dec}>
              <div>
                <div className={c.decMeta}>{DECISIONES.meta(v.id)}</div>
                <h3 className={c.decTitulo} lang="es">
                  {v.titulo}
                </h3>
                <div className={c.decBarra} aria-hidden="true">
                  <div className={c.decRelleno} style={{ width: `${v.pctFavor}%` }} />
                </div>
                <p className={c.decCuenta}>
                  {v.total > 0 ? DECISIONES.conVotos(v.pctFavor, v.total, v.umbral) : DECISIONES.sinVotos(v.umbral)}
                </p>
              </div>
              <Link href={v.href} hrefLang="es" className={c.decVotar}>
                {DECISIONES.votar}
                <span className={s.srOnly}>{DECISIONES.votarEn(v.id)}</span>
                <IconoFlechaDerecha tamano={16} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={c.decVacio}>{DECISIONES.vacio}</p>
      )}

      <div className={c.decPie}>
        <p>
          {DECISIONES.publicadas(decisiones)}
          {votaciones.length > 0 ? ` ${DECISIONES.nota}` : null}
        </p>
        <Link href={ENLACES.gobernanza} hrefLang="es" className={c.enlace}>
          {DECISIONES.leerTodas}
          <IconoFlechaDerecha tamano={14} />
        </Link>
      </div>
    </section>
  );
}
