import Link from "next/link";
import { claimsPuedenAdministrar } from "@/lib/authz";
import { esEquipoInterno } from "@/lib/roles";
import type { SessionData } from "@/lib/jwt";
import { Logo, shortWallet } from "./ui";
import SalirButton from "./SalirButton";
import NavContextual from "./NavContextual";

// La sesión se resuelve aquí, en el servidor. Qué enlaces y qué botón se
// muestran depende de la ruta, que solo se conoce en el cliente: eso lo decide
// NavContextual.
export default function Nav({ session }: { session: SessionData | null }) {
  // Por ROL, no por la wallet de una persona. Aquí basta con los claims de la
  // cookie: esto solo decide si se DIBUJA el enlace; el gate real vive en
  // /admin, /equipo y /clientes, que resuelven el rol contra la base.
  const isFounder = claimsPuedenAdministrar(session ?? {});
  // Los enlaces del trabajo interno (Mi día, Proyectos, Clientes) solo se dibujan
  // con sesión de equipo interno: la web pública no los muestra.
  const esEquipo = !!session && esEquipoInterno(session);

  const accesoDao = session ? (
    <Link href="/perfil" className="btn btn-ghost py-1.5" title={session.wallet}>
      <span className="h-2 w-2 rounded-full bg-primary" />
      {session.name || shortWallet(session.wallet)}
    </Link>
  ) : (
    <Link href="/entrar" className="btn btn-primary py-1.5">
      Entrar
    </Link>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="shrink-0" aria-label="Inicio">
          <Logo />
        </Link>
        <NavContextual
          isFounder={isFounder}
          esEquipo={esEquipo}
          accesoDao={accesoDao}
          salir={session ? <SalirButton esDemo={session.isDemo} /> : null}
        />
      </nav>
    </header>
  );
}
