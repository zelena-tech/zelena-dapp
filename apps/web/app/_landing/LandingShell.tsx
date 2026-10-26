// Fuentes de la landing, solo aquí: las páginas en español no las descargan. Archivo va
// con el eje de anchura (wdth.css: familia 'Archivo Variable', font-stretch 62–125%); su
// index.css no lo trae y el condensado al 65% no se aplicaría. Auto-hospedadas: la CSP es
// font-src 'self'.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/caveat/600.css";
import type { ReactNode } from "react";
import { getDb } from "@/lib/db";
import { accesoEquipo } from "@/lib/authz";
import { getSession } from "@/lib/session";
import s from "./landing.module.css";
import Header, { type EnlaceCuenta } from "./Header";
import Footer from "./Footer";
import Reveal from "./Reveal";
import { CABECERA, ENLACES, type PaginaLanding } from "./copy-comun";

/**
 * A dónde lleva la píldora de cuenta: sin sesión, a /entrar; con sesión, a su trabajo
 * (Mi día, si tiene acceso al equipo, con la misma regla que el menú en español) o a su
 * perfil. Si la base no responde, al perfil: nunca se rompe la cabecera.
 */
async function enlaceDeCuenta(): Promise<EnlaceCuenta> {
  const session = await getSession();
  if (!session) return { href: ENLACES.entrar, etiqueta: CABECERA.entrar };
  try {
    if (accesoEquipo(session, getDb())) return { href: ENLACES.miDia, etiqueta: CABECERA.miDia };
  } catch (e) {
    console.error("[landing] acceso al equipo", e);
  }
  return { href: ENLACES.perfil, etiqueta: CABECERA.miPerfil };
}

/**
 * El cromo de la landing en inglés: raíz `data-landing` con `lang="en"` (el documento
 * pasa a claro por globals.css), enlace para saltar al contenido, cabecera pegajosa, el
 * único `main` (id "main") con la página, pie con el aviso legal de la página, y el efecto
 * de aparición (Reveal). La página NO pinta otro `main`, ni cabecera, ni pie.
 */
export default async function LandingShell({ pagina, children }: { pagina: PaginaLanding; children: ReactNode }) {
  const cuenta = await enlaceDeCuenta();
  return (
    <div data-landing="" lang="en" className={s.raiz}>
      <a href="#main" className={s.saltar}>
        {CABECERA.saltar}
      </a>
      <div className={s.interior}>
        <Header activa={pagina} cuenta={cuenta} />
        <main id="main" tabIndex={-1} className={s.principal}>
          {children}
        </main>
        <Footer />
      </div>
      <Reveal />
    </div>
  );
}
