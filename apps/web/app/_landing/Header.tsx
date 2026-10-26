import Link from "next/link";
import s from "./landing.module.css";
import Wordmark from "./Wordmark";
import { CABECERA, ENLACES, type PaginaLanding } from "./copy-comun";

export interface EnlaceCuenta {
  href: string;
  etiqueta: string;
}

/**
 * Cabecera pegajosa de la landing: wordmark, Home | Community (dos rutas reales, la
 * activa con aria-current) y la píldora de cuenta ("Log in", o el acceso de quien ya
 * tiene sesión). Server component: la pestaña activa la dice la página.
 */
export default function Header({ activa, cuenta }: { activa: PaginaLanding; cuenta: EnlaceCuenta }) {
  return (
    <header className={s.cabecera}>
      <Link href={ENLACES.inicio} className={s.logo} aria-label={CABECERA.logoAria}>
        <Wordmark />
      </Link>
      <nav aria-label={CABECERA.navAria} className={s.navPrincipal}>
        <ul className={s.segmentos}>
          {CABECERA.pestanas.map((t) => (
            <li key={t.href}>
              <Link href={t.href} className={s.segmento} aria-current={t.pagina === activa ? "page" : undefined}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Link href={cuenta.href} className={s.cuenta}>
        {cuenta.etiqueta}
      </Link>
    </header>
  );
}
