// Las mismas fuentes que la landing (ver LandingShell): estas páginas llevan su diseño.
// Auto-hospedadas: la CSP es font-src 'self'.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/caveat/600.css";
import type { ReactNode } from "react";
import Link from "next/link";
import s from "../landing.module.css";
import Wordmark from "../Wordmark";
import Reveal from "../Reveal";
import { CABECERA_EMPRESAS, ENLACES_EMPRESAS, PIE_EMPRESAS, type PaginaEmpresas } from "../copy-empresas";

/**
 * El cromo claro de la landing, en español, para el portafolio y los incentivos (pedido
 * del founder, 2026-11-17: el diseño de zelena.tech). Misma hoja y mismas piezas que
 * LandingShell: raíz `data-landing` (el documento pasa a claro por globals.css), enlace
 * para saltar al contenido, cabecera pegajosa, el único `main` (id "main"), pie y el
 * efecto de aparición. Cambia el idioma (`lang="es"`), las pestañas (Portafolio |
 * Incentivos) y la píldora, que aquí lleva a hablar con nosotros y no a la sesión.
 * La página NO pinta otro `main`, ni cabecera, ni pie.
 */
export default function MarcoEmpresas({ pagina, children }: { pagina: PaginaEmpresas; children: ReactNode }) {
  return (
    <div data-landing="" lang="es" className={s.raiz}>
      <a href="#main" className={s.saltar}>
        {CABECERA_EMPRESAS.saltar}
      </a>
      <div className={s.interior}>
        <header className={s.cabecera}>
          <Link href={ENLACES_EMPRESAS.inicio} hrefLang="en" className={s.logo} aria-label={CABECERA_EMPRESAS.logoAria}>
            <Wordmark />
          </Link>
          <nav aria-label={CABECERA_EMPRESAS.navAria} className={s.navPrincipal}>
            <ul className={s.segmentos}>
              {CABECERA_EMPRESAS.pestanas.map((t) => (
                <li key={t.href}>
                  <Link href={t.href} className={s.segmento} aria-current={t.pagina === pagina ? "page" : undefined}>
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Link href={ENLACES_EMPRESAS.contacto} className={s.cuenta}>
            {CABECERA_EMPRESAS.hablemos}
          </Link>
        </header>
        <main id="main" tabIndex={-1} className={s.principal}>
          {children}
        </main>
        <footer className={s.pie}>
          <div className={s.pieFila}>
            <p>{PIE_EMPRESAS.linea}</p>
            <nav aria-label={PIE_EMPRESAS.navAria}>
              <ul className={s.pieEnlaces}>
                {PIE_EMPRESAS.enlaces.map((e) => (
                  <li key={e.href}>
                    <Link href={e.href} hrefLang={e.enIngles ? "en" : undefined} className={s.pieEnlace}>
                      {e.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </footer>
      </div>
      <Reveal />
    </div>
  );
}
