"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { esRutaEmpresas, menuPara } from "@/lib/menu";

// El menú cambia según a quién le habla la página (lib/menu.ts):
//  - sin sesión, el sitio público: cuatro puertas y "Entrar";
//  - en /empresas, a quien llega como empresa: su menú y "Agenda una demo";
//  - con sesión, el trabajo (solo si tiene acceso) y la comunidad.
//
// Las herramientas internas NO son web pública: solo se dibujan con sesión. La
// puerta real vive en el servidor (middleware y la autorización de cada página).
// El botón de perfil (`accesoDao`) y "Admin" (solo founder, por rol) se conservan
// aquí, fuera de `menuPara`.

const ENLACE =
  "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors duration-150 hover:bg-glow hover:text-primary";
const ENLACE_MOVIL =
  "block whitespace-nowrap px-3 py-3 text-sm text-muted transition-colors hover:bg-glow hover:text-primary";

export default function NavContextual({
  isFounder,
  conSesion,
  accesoEquipo,
  esInterno,
  puedeVerTodo,
  accesoDao,
  salir,
}: {
  /** Rol founder (claims): dibuja el enlace "Admin". */
  isFounder: boolean;
  conSesion: boolean;
  /** Puede entrar al trabajo (Mi día, Proyectos). */
  accesoEquipo: boolean;
  /** Equipo interno (founder, core o supervisor): ve Clientes. */
  esInterno: boolean;
  /** Founder o supervisor: ve Talento. */
  puedeVerTodo: boolean;
  /** Botón de sesión (Entrar o el perfil), renderizado en el servidor. */
  accesoDao: ReactNode;
  /** Botón de salir, solo si hay sesión. */
  salir: ReactNode;
}) {
  const ruta = usePathname() ?? "/";
  const enEmpresas = esRutaEmpresas(ruta);
  const enlaces = menuPara({ ruta, conSesion, accesoEquipo, esInterno, puedeVerTodo });
  const conAdmin = isFounder && !enEmpresas;

  // Cuatro enlaces caben desde 1024 px; con la sesión del equipo (hasta siete y
  // "Admin") hace falta más ancho para que ninguno se parta en dos líneas.
  const muchos = enlaces.length + (conAdmin ? 1 : 0) > 5;
  const escritorio = muchos ? "hidden items-center gap-1 xl:flex" : "hidden items-center gap-1 lg:flex";
  const movil = muchos ? "relative xl:hidden" : "relative lg:hidden";

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
        {conAdmin ? (
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
            {conAdmin ? (
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
