import type { ReactNode } from "react";
import Link from "next/link";
import s from "../landing.module.css";
import c from "./comunidad.module.css";
import Chip from "../Chip";
import { IconoCheck, IconoFlechaDerecha, IconoPunto } from "../Iconos";
import { ENLACES } from "../copy-comun";
import { ENCUENTROS } from "../copy-comunidad";
import type { CitaComunidad } from "@/lib/landing-datos";

/** Colores de los carteles, en rotación (lima, tinta, blanco), como en el diseño. */
const CARTELES = [c.cartelLima, c.cartelTinta, c.cartelBlanco];
const ICONOS = [
  <IconoFlechaDerecha key="flecha" tamano={14} trazo={2.75} />,
  <IconoPunto key="punto" tamano={10} />,
  <IconoCheck key="check" tamano={14} trazo={2.75} />,
];

function Cartel({ i, lugar, children }: { i: number; lugar: string; children: ReactNode }) {
  return (
    <>
      <span className={`${c.cartel} ${CARTELES[i % CARTELES.length]}`} aria-hidden="true">
        <span className={c.cartelArriba}>
          <span className={c.cartelIcono}>{ICONOS[i % ICONOS.length]}</span>
        </span>
        <span className={`${s.display} ${c.cartelLugar}`}>{lugar}</span>
      </span>
      <span className={c.citaCuerpo}>{children}</span>
    </>
  );
}

/**
 * Encuentros y ritos: carteles tipográficos con lo que de verdad está en el calendario
 * (encuentros publicados y ritos de comunidad ya preparados, con fecha y lugar). Nunca
 * una fecha inventada. Sin nada en el calendario: un solo cartel, "No dates yet", que
 * lleva al formulario para dejar el correo. El cartel es decorativo; el texto de debajo
 * dice lo mismo.
 */
export default function Encuentros({ citas }: { citas: CitaComunidad[] }) {
  const E = ENCUENTROS;
  return (
    <section className={c.seccionEncuentros} aria-labelledby="encuentros-titulo">
      <div data-reveal="titulo">
        <h2 id="encuentros-titulo" className={`${s.titulo2} ${c.tituloCompacto}`}>
          {E.titulo}
        </h2>
      </div>
      <ul className={c.citasGrid} data-reveal="escalonado">
        {citas.length > 0 ? (
          citas.map((cita, i) => {
            const detalle = [cita.lugar, cita.hora].filter(Boolean).join(" · ") || E.sinDetalles;
            return (
              <li key={cita.clave}>
                <Link href={cita.href} hrefLang="es" className={`${c.cita} ${s.elevable}`}>
                  <Cartel i={i} lugar={cita.lugar ?? E.sinLugar[cita.tipo]}>
                    <span className={c.citaFila}>
                      <span className={`${s.display} ${c.citaDia}`}>
                        <time dateTime={cita.fecha}>{cita.diaCorto}</time>
                      </span>
                      <Chip tono="blanco" tamano="sm" className={c.mayusculas}>
                        {E.tipo[cita.tipo]}
                      </Chip>
                    </span>
                    <h3 className={c.citaTitulo} lang={cita.idiomaTitulo}>
                      {cita.titulo}
                    </h3>
                    <span className={c.citaDetalle}>{detalle}</span>
                  </Cartel>
                </Link>
              </li>
            );
          })
        ) : (
          <li>
            <Link href={ENLACES.avisoEncuentros} hrefLang="es" className={`${c.cita} ${s.elevable}`}>
              <Cartel i={0} lugar={E.vacio.lugar}>
                <span className={c.citaFila}>
                  <span className={`${s.display} ${c.citaDia}`}>0</span>
                  <Chip tono="blanco" tamano="sm" className={c.mayusculas}>
                    {E.vacio.tipo}
                  </Chip>
                </span>
                <h3 className={c.citaTitulo}>{E.vacio.titulo}</h3>
                <span className={c.citaDetalle}>{E.vacio.texto}</span>
              </Cartel>
            </Link>
          </li>
        )}
      </ul>
      <div className={c.citasPie}>
        <Link href={E.ritos.href} hrefLang="es" className={c.enlace}>
          {E.ritos.texto}
          <IconoFlechaDerecha tamano={14} />
        </Link>
      </div>
    </section>
  );
}
