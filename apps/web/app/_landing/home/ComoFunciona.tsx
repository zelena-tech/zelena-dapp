import type { CSSProperties } from "react";
import s from "../landing.module.css";
import c from "./comoFunciona.module.css";
import { IconoFlechaArriba } from "../Iconos";
import { COMO_FUNCIONA } from "../copy-home";

// Inclinación de cada tarjeta: la del diseño en el zig-zag (desde 640px) y una más suave
// cuando se apilan en el teléfono.
const GIROS: ReadonlyArray<{ ancho: string; movil: string }> = [
  { ancho: "-6deg", movil: "-2deg" },
  { ancho: "5deg", movil: "2deg" },
  { ancho: "-4deg", movil: "-1deg" },
  { ancho: "6deg", movil: "2deg" },
];

/**
 * Cómo funciona (#how-it-works): cuatro tarjetas clavadas sobre un tablero cuadriculado.
 * Desde 640px van en zig-zag, solapadas y unidas por un camino discontinuo; debajo de
 * 640px se apilan en una columna (sin scroll horizontal). La última, lima, es el pago.
 */
export default function ComoFunciona() {
  const ultimo = COMO_FUNCIONA.pasos.length - 1;
  return (
    <section
      id={COMO_FUNCIONA.ancla}
      className={`${s.seccion} ${s.ancla} ${c.seccion}`}
      aria-labelledby="como-funciona-titulo"
    >
      <p className={c.etiqueta} data-reveal="">
        {COMO_FUNCIONA.etiqueta}
      </p>
      <div className={c.cabeza}>
        <h2 id="como-funciona-titulo" className={s.titulo2} data-reveal="titulo">
          {COMO_FUNCIONA.h2.linea1}{" "}
          <br />
          {COMO_FUNCIONA.h2.linea2}
        </h2>
        <p className={c.intro} data-reveal="">
          {COMO_FUNCIONA.intro}
        </p>
      </div>

      <div className={c.tablero}>
        <svg className={c.ruta} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path vectorEffect="non-scaling-stroke" d="M38 16 C50 16,56 26,62 36 S50 54,38 62 S52 76,62 84" />
        </svg>
        <ol className={c.pasos} data-reveal="escalonado">
          {COMO_FUNCIONA.pasos.map((p, i) => (
            <li key={p.n} className={c.paso}>
              <article
                className={i === ultimo ? `${c.tarjeta} ${c.tarjetaLima}` : c.tarjeta}
                style={{ "--giro": GIROS[i]?.ancho ?? "0deg", "--giro-movil": GIROS[i]?.movil ?? "0deg" } as CSSProperties}
              >
                <span className={c.clavo} aria-hidden="true" />
                <p className={c.numero} aria-hidden="true">
                  {p.n}
                </p>
                <h3 className={`${s.display} ${c.tarjetaTitulo}`}>{p.titulo}</h3>
                <p className={c.tarjetaTexto}>{p.texto}</p>
              </article>
            </li>
          ))}
        </ol>
        {/* Nota manuscrita: adorno, el paso 04 ya lo dice. */}
        <p className={`${s.manuscrita} ${c.nota}`} aria-hidden="true">
          {COMO_FUNCIONA.nota}
          <IconoFlechaArriba tamano={26} trazo={2.5} />
        </p>
      </div>
    </section>
  );
}
