import Link from "next/link";
import s from "./landing.module.css";
import { PIE, type EnlacePie } from "./copy-comun";

function Enlace({ e }: { e: EnlacePie }) {
  if (e.externo) {
    return (
      <a href={e.href} target="_blank" rel="noopener noreferrer" className={s.pieEnlace}>
        {e.label}
        <span className={s.srOnly}> (opens in a new tab)</span>
      </a>
    );
  }
  // Las páginas del sitio enlazadas desde aquí están en español.
  return (
    <Link href={e.href} hrefLang={PIE.idiomaDestino} className={s.pieEnlace}>
      {e.label}
    </Link>
  );
}

/**
 * Pie de la landing: la línea de marca y los enlaces del sitio; debajo, el aviso legal de
 * la página y el grupo Legal (acuerdo, privacidad y licencia), obligatorio en todas las
 * páginas. Ni la entidad legal ni el documento retirado.
 */
export default function Footer({ aviso }: { aviso: string }) {
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
      <div className={s.pieFila}>
        <p className={s.pieAviso}>{aviso}</p>
        <nav aria-label={PIE.legalAria}>
          <ul className={s.pieEnlaces}>
            {PIE.legal.map((e) => (
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
