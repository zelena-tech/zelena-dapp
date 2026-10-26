import s from "../landing.module.css";
import p from "./productos.module.css";
import Chip from "../Chip";
import { IconoCheck, IconoFlechaDerecha } from "../Iconos";
import { PRODUCTOS, type PuntoProducto } from "../copy-home";

function Puntos({ puntos }: { puntos: readonly PuntoProducto[] }) {
  return (
    <ul className={p.puntos}>
      {puntos.map((pt) => (
        <li key={pt.texto} className={p.punto}>
          {/* Lo que ya funciona lleva ✓; lo que viene, una flecha y un trazo discontinuo. */}
          <span className={pt.siguiente ? `${p.vinieta} ${p.vinietaSiguiente}` : p.vinieta} aria-hidden="true">
            {pt.siguiente ? <IconoFlechaDerecha tamano={11} trazo={3} /> : <IconoCheck tamano={11} trazo={3.25} />}
          </span>
          <span>{pt.texto}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Productos: el WMS que mide (en producción) y Harmony que paga el bono (en la red
 * principal de Stellar). Lo que todavía no está, el cobro en el banco, se dice como lo que
 * viene.
 */
export default function Productos() {
  const { medir, pagar } = PRODUCTOS;
  return (
    <section className={`${s.seccion} ${p.seccion}`} aria-labelledby="productos-titulo">
      <h2 id="productos-titulo" className={`${s.titulo2} ${p.titulo}`} data-reveal="titulo">
        {PRODUCTOS.h2.linea1}{" "}
        <br />
        {PRODUCTOS.h2.linea2}
      </h2>
      <p className={`${s.cuerpo} ${p.intro}`} data-reveal="">
        {PRODUCTOS.intro}
      </p>
      <ul className={p.tarjetas} data-reveal="escalonado">
        <li className={`${p.tarjeta} ${p.tarjetaPanel} ${s.elevable}`}>
          <div className={p.tarjetaCabeza}>
            <span className={`${s.display} ${p.numero}`} aria-hidden="true">
              {medir.n}
            </span>
            <Chip tono="tinta" tamano="sm" punto className={p.mayus}>
              {medir.estado}
            </Chip>
          </div>
          <h3 className={p.tarjetaTitulo}>{medir.titulo}</h3>
          <Puntos puntos={medir.puntos} />
        </li>
        <li className={`${p.tarjeta} ${p.tarjetaLima} ${s.elevable}`}>
          <div className={p.tarjetaCabeza}>
            <span className={`${s.display} ${p.numero}`} aria-hidden="true">
              {pagar.n}
            </span>
            <Chip tono="verde" tamano="sm" punto className={p.mayus}>
              {pagar.estado}
            </Chip>
          </div>
          <h3 className={p.tarjetaTitulo}>{pagar.titulo}</h3>
          <Puntos puntos={pagar.puntos} />
        </li>
      </ul>
    </section>
  );
}
