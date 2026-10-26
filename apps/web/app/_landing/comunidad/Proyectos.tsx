import s from "../landing.module.css";
import c from "./comunidad.module.css";
import { SecondaryCta } from "../Ctas";
import { ANCLA_PROYECTOS, ENLACES } from "../copy-comun";
import { PROYECTOS } from "../copy-comunidad";
import type { ClaveTipoProyecto, ProyectoAbierto } from "@/lib/landing-datos";
import FiltroProyectos, { type FiltroTipo } from "./FiltroProyectos";

const ORDEN_TIPOS: readonly ClaveTipoProyecto[] = ["client", "community", "other"];

/** Los tipos presentes en la lista, en orden fijo, con la etiqueta que trae el dato. */
function filtrosDe(proyectos: ProyectoAbierto[]): FiltroTipo[] {
  return ORDEN_TIPOS.flatMap((clave) => {
    const p = proyectos.find((x) => x.tipo === clave);
    return p ? [{ clave, etiqueta: p.etiquetaTipo }] : [];
  });
}

/**
 * Proyectos abiertos del Ágora (#open-projects): los publicados de verdad, lo más nuevo
 * primero, con su tipo (Client / Community), presupuesto con la marca "Testnet" y
 * semanas; cada tarjeta lleva a su ficha. Nunca la campaña ni el valor interno del tipo.
 * Sin proyectos: el cero dicho en una frase y el camino al Ágora.
 */
export default function Proyectos({ proyectos }: { proyectos: ProyectoAbierto[] }) {
  const idTitulo = "proyectos-titulo";
  const filtros = filtrosDe(proyectos);
  const cabecera = (
    <div>
      <h2 id={idTitulo} className={`${s.titulo2} ${c.tituloSeccion}`}>
        {PROYECTOS.titulo}
      </h2>
    </div>
  );
  return (
    <section id={ANCLA_PROYECTOS} className={`${s.seccion} ${s.ancla}`} aria-labelledby={idTitulo}>
      {proyectos.length > 0 ? (
        <>
          <FiltroProyectos cabecera={cabecera} proyectos={proyectos} filtros={filtros} />
          <div className={c.proyPie}>
            <SecondaryCta
              href={ENLACES.agora}
              hrefLang="es"
              nombre={PROYECTOS.verTodos.nombre}
            />
          </div>
        </>
      ) : (
        <>
          <div className={c.cabecera} data-reveal="titulo">
            {cabecera}
          </div>
          <div className={c.proyVacio} data-reveal="">
            <p className={c.proyVacioTexto}>
              <span className={`${s.display} ${c.proyVacioCero}`} aria-hidden="true">
                0
              </span>
              {PROYECTOS.vacio.texto}
            </p>
            <SecondaryCta
              href={ENLACES.agora}
              hrefLang="es"
              nombre={PROYECTOS.vacio.nombre}
            />
          </div>
        </>
      )}
    </section>
  );
}
