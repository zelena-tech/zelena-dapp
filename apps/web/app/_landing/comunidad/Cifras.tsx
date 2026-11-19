import Link from "next/link";
import s from "../landing.module.css";
import c from "./comunidad.module.css";
import Imagen from "../Imagen";
import { IMG, type ImagenLanding } from "../assets";
import { IconoFlechaDerecha } from "../Iconos";
import { CIFRAS, numero, type LineaCero } from "../copy-comunidad";
import type { CifrasComunidad } from "@/lib/landing-datos";

interface Cifra {
  clave: string;
  valor: number;
  comando: string;
  nombre: string;
  cero: LineaCero;
  sticker: ImagenLanding;
  claseSticker: string;
}

/** La llamada que acompaña a un cero: con su enlace, o solo la explicación. */
function LineaDelCero({ cero }: { cero: LineaCero }) {
  if (!cero.href) return <p className={c.cifraCero}>{cero.texto}</p>;
  return (
    <p className={c.cifraCero}>
      <Link href={cero.href} hrefLang="es" className={c.enlace}>
        {cero.texto}
        <IconoFlechaDerecha tamano={14} />
      </Link>
    </p>
  );
}

/**
 * Tira de cifras en vivo, montada sobre el borde inferior del hero (-80px): firmas del
 * acuerdo, proyectos abiertos y puntos repartidos, de cuentas reales y leídas en cada
 * visita. Con un cero se muestra el cero y su llamada a la acción; nunca un número de
 * relleno. La etiqueta de comando ("clas_signed") se ve y el lector de pantalla oye el
 * nombre llano. Sin aparición progresiva: monta pegada al hero, casi siempre a la vista.
 */
export default function Cifras({ cifras }: { cifras: CifrasComunidad }) {
  const lista: Cifra[] = [
    {
      clave: "firmas",
      valor: cifras.firmas,
      ...CIFRAS.firmas,
      sticker: IMG.stickerFlecha,
      claseSticker: c.stickerFlecha,
    },
    {
      clave: "proyectos",
      valor: cifras.proyectosAbiertos,
      ...CIFRAS.proyectos,
      sticker: IMG.stickerTeclaZRecortado,
      claseSticker: c.stickerTecla,
    },
    {
      clave: "puntos",
      valor: cifras.puntos,
      ...CIFRAS.puntos,
      sticker: IMG.stickerCorazon,
      claseSticker: c.stickerCorazon,
    },
  ];
  return (
    <section className={c.cifras} aria-label={CIFRAS.aria}>
      <ul className={c.cifrasLista}>
        {lista.map((d) => (
          <li key={d.clave} className={c.cifra}>
            <div>
              <span className={`${s.display} ${c.cifraNumero}`}>{numero(d.valor)}</span>
              <span className={c.cifraEtiqueta}>
                <span className={c.punto} aria-hidden="true" />
                <span aria-hidden="true">{d.comando}</span>
                <span className={s.srOnly}>{d.nombre}</span>
              </span>
              {d.valor === 0 ? <LineaDelCero cero={d.cero} /> : null}
            </div>
            <span className={c.sticker} aria-hidden="true">
              <Imagen img={d.sticker} className={d.claseSticker} />
            </span>
          </li>
        ))}
      </ul>
      <p className={c.cifrasNota}>{CIFRAS.nota}</p>
    </section>
  );
}
