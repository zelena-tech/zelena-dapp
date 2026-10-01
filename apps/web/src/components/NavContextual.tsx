"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// El menú cambia según a quién le habla la página. En /empresas el visitante es
// un empresario: ver "Mi día" o "Gobernanza" no le dice nada, y el botón
// principal tiene que ser la demo, no "Entrar". En el resto del sitio sigue el
// menú de la DAO.
//
// Los enlaces del trabajo interno (Mi día, Proyectos, Clientes) NO son web
// pública: solo se dibujan con sesión de equipo interno (`esEquipo`). El gate
// real vive en el servidor (middleware + layouts con `equipoInternoActor`).

const INTERNO = [
  { href: "/equipo/hoy", label: "Mi día" },
  { href: "/equipo/proyectos", label: "Proyectos" },
  { href: "/clientes", label: "Clientes" },
];

const DAO = [
  { href: "/ecosistema", label: "Ecosistema" },
  { href: "/agora", label: "Ágora" },
  { href: "/academia", label: "Academia" },
  { href: "/gobernanza", label: "Gobernanza" },
  { href: "/whitepaper", label: "Whitepaper" },
  { href: "/empresas", label: "Empresas" },
];

const EMPRESAS = [
  { href: "/empresas#productos", label: "Productos" },
  { href: "/empresas#como-funciona", label: "Cómo funciona" },
  { href: "/empresas/servicios", label: "Servicios" },
  { href: "/", label: "La DAO" },
];

const ENLACE =
  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors duration-150 hover:bg-glow hover:text-primary";
const ENLACE_MOVIL =
  "block whitespace-nowrap px-3 py-3 text-sm text-muted transition-colors hover:bg-glow hover:text-primary";

export default function NavContextual({
  isFounder,
  esEquipo,
  accesoDao,
  salir,
}: {
  isFounder: boolean;
  /** Sesión de equipo interno (founder, core o supervisor): ve los enlaces internos. */
  esEquipo: boolean;
  /** Botón de sesión de la DAO (Entrar o el perfil), renderizado en el servidor. */
  accesoDao: ReactNode;
  /** Botón de salir, solo si hay sesión. */
  salir: ReactNode;
}) {
  const ruta = usePathname() ?? "/";
  const enEmpresas = ruta === "/empresas" || ruta.startsWith("/empresas/");
  const enlaces = enEmpresas ? EMPRESAS : esEquipo ? [DAO[0], ...INTERNO, ...DAO.slice(1)] : DAO;

  // Nueve enlaces de la DAO en Space Mono no caben antes de ~1280 px sin que
  // "Mi día" se parta en dos líneas; los cuatro comerciales caben desde 1024.
  const escritorio = enEmpresas ? "hidden items-center gap-1 lg:flex" : "hidden items-center gap-1 xl:flex";
  const movil = enEmpresas ? "relative lg:hidden" : "relative xl:hidden";

  const cta = enEmpresas ? (
    <Link href="/empresas/contacto" className="btn btn-primary py-1.5 normal-case tracking-normal">
      Agenda una demo
    </Link>
  ) : (
    accesoDao
  );

  return (
    <>
      <div className={escritorio}>
        {enlaces.map((l) => (
          <Link key={l.href} href={l.href} className={ENLACE}>
            {l.label}
          </Link>
        ))}
        {isFounder && !enEmpresas ? (
          <Link
            href="/admin"
            className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-amber-300 transition-colors hover:bg-amber-950/30"
          >
            Admin
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        {cta}

        {/* Móvil: menú desplegable sin JavaScript propio. */}
        <details className={movil}>
          <summary
            className="btn btn-ghost cursor-pointer py-1.5 marker:content-none [&::-webkit-details-marker]:hidden"
            aria-label="Abrir el menú"
          >
            Menú
          </summary>
          <div className="absolute right-0 z-40 mt-2 w-64 border border-line-strong bg-surface p-2 shadow-glow">
            {enlaces.map((l) => (
              <Link key={l.href} href={l.href} className={ENLACE_MOVIL}>
                {l.label}
              </Link>
            ))}
            {isFounder && !enEmpresas ? (
              <Link href="/admin" className="block px-3 py-3 text-sm text-amber-300 hover:bg-amber-950/30">
                Admin
              </Link>
            ) : null}
            {!enEmpresas && salir ? <div className="mt-2 border-t border-line pt-2">{salir}</div> : null}
          </div>
        </details>
      </div>
    </>
  );
}
