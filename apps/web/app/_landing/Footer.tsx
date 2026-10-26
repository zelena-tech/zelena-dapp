import Link from "next/link";
import s from "./landing.module.css";
import { PIE, type EnlacePie } from "./copy-comun";
import { esRutaLanding } from "@/lib/menu";

function Enlace({ e }: { e: EnlacePie }) {
  if (e.externo) {
    return (
      <a href={e.href} target="_blank" rel="noopener noreferrer" className={s.pieEnlace}>
        {e.label}
        <span className={s.srOnly}> (opens in a new tab)</span>
      </a>
    );
  }
  // Las páginas del sitio enlazadas desde aquí están en español, salvo las de la landing.
  return (
    <Link href={e.href} hrefLang={esRutaLanding(e.href) ? undefined : PIE.idiomaDestino} className={s.pieEnlace}>
      {e.label}
    </Link>
  );
}

/**
 * Pie de la landing: la línea de marca y los enlaces del sitio, en una sola fila. La fila
 * del aviso legal y del grupo Legal salió por pedido del founder (2026-10-26); el aviso de
 * privacidad sigue enlazado donde se piden datos (la casilla del formulario de la demo).
 */
export default function Footer() {
  return (
    <footer className={s.pie}>
      <div className={s.pieFila}>
        <p>{PIE.linea}</p>
        <nav aria-label={PIE.navAria}>
          <ul className={s.pieEnlaces}>
            {PIE.enlaces.map((e) => (
              <li key={e.href}>
                <Enlace e={e} />
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
