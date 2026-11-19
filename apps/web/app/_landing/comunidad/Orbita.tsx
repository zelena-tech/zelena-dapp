import type { ReactNode } from "react";
import c from "./comunidad.module.css";
import Imagen from "../Imagen";
import { IMG } from "../assets";
import { IconoCheck, IconoFlechaArriba } from "../Iconos";
import { ORBITA } from "../copy-comunidad";
import type { CifrasComunidad } from "@/lib/landing-datos";
import OrbitaGiro from "./OrbitaGiro";

type Ficha = "check" | "z" | "flecha";

const FICHA_CLASE: Record<Ficha, string> = { check: c.fichaLima, z: c.fichaTinta, flecha: c.fichaVerde };
const POSICION = [c.pos1, c.pos2, c.pos3, c.pos4, c.pos5, c.pos6];

function Tarjeta({ ficha, titulo, pie, i }: { ficha: Ficha; titulo: string; pie: string; i: number }) {
  let icono: ReactNode = "Z";
  if (ficha === "check") icono = <IconoCheck tamano={20} trazo={2.75} />;
  if (ficha === "flecha") icono = <IconoFlechaArriba tamano={20} trazo={2.75} />;
  return (
    <div data-ring="" className={`${c.tarjetaOrbita} ${POSICION[i]}`}>
      <span className={`${c.fichaIcono} ${FICHA_CLASE[ficha]}`}>{icono}</span>
      <div className={c.fichaTexto}>
        <div className={c.fichaTitulo}>{titulo}</div>
        <div className={c.fichaPie}>{pie}</div>
      </div>
    </div>
  );
}

/**
 * La órbita: el avatar de pie y seis tarjetas que giran a su alrededor. Es decorativa
 * (`aria-hidden`): cada número es el mismo dato real de la tira de cifras o de la sección
 * de decisiones, que sí se leen. Ninguna tarjeta inventa una cifra; "Stellar network"
 * dice un hecho de la red, no un estado en vivo.
 */
export default function Orbita({ cifras }: { cifras: CifrasComunidad }) {
  const tarjetas: Array<{ ficha: Ficha; titulo: string; pie: string }> = [
    { ficha: "check", titulo: ORBITA.firmas.titulo(cifras.firmas), pie: ORBITA.firmas.pie },
    { ficha: "z", titulo: ORBITA.proyectos.titulo, pie: ORBITA.proyectos.pie(cifras.proyectosAbiertos) },
    { ficha: "flecha", titulo: ORBITA.puntos.titulo, pie: ORBITA.puntos.pie(cifras.puntos) },
    { ficha: "check", titulo: ORBITA.entregas.titulo, pie: ORBITA.entregas.pie(cifras.entregasAprobadas) },
    { ficha: "z", titulo: ORBITA.red.titulo, pie: ORBITA.red.pie },
    {
      ficha: "flecha",
      titulo: ORBITA.decisiones.titulo,
      pie:
        cifras.votacionesAbiertas > 0
          ? ORBITA.decisiones.votos(cifras.votacionesAbiertas)
          : ORBITA.decisiones.publicadas(cifras.decisiones),
    },
  ];
  return (
    <section className={c.orbita} aria-hidden="true" data-reveal="seccion">
      <OrbitaGiro className={c.escena}>
        <div className={c.anillo} />
        {tarjetas.map((t, i) => (
          <Tarjeta key={i} i={i} {...t} />
        ))}
        <div className={c.sombra} />
        <Imagen img={IMG.avatarDePie} className={c.avatarDePie} />
      </OrbitaGiro>
    </section>
  );
}
