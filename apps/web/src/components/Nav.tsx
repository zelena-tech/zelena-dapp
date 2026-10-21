import Link from "next/link";
import { getDb } from "@/lib/db";
import { accesoEquipo as tieneAccesoEquipo, claimsPuedenAdministrar, clientActor } from "@/lib/authz";
import { listClientsFor } from "@/lib/clients";
import { esEquipoInterno, puedeVerTodoElEquipo } from "@/lib/roles";
import type { SessionData } from "@/lib/jwt";
import { Logo, shortWallet } from "./ui";
import SalirButton from "./SalirButton";
import NavContextual from "./NavContextual";

// La sesión se resuelve aquí, en el servidor. Qué enlaces y qué botón se
// muestran depende de la ruta, que solo se conoce en el cliente: eso lo decide
// NavContextual con `menuPara` (lib/menu.ts).

/**
 * ¿Entra al trabajo (Mi día, Proyectos)? Se resuelve contra la base con la misma regla
 * que la puerta de `/equipo` (`equipoActor`): el equipo interno y quien trabaja por
 * proyecto (contributor con el acuerdo firmado y al menos una membresía). Si la base no
 * responde, el enlace no se dibuja: la página tampoco abriría.
 */
function accesoAlTrabajo(session: SessionData | null): boolean {
  if (!session) return false;
  try {
    return tieneAccesoEquipo(session, getDb());
  } catch (e) {
    console.error("[nav] acceso al trabajo", e);
    return false;
  }
}

/**
 * ¿Hay algún cliente que esta sesión pueda ver? Mientras no haya clientes (y hoy no se
 * pueden crear desde la web), "Clientes" llevaría a una página vacía: no se dibuja. La
 * regla es la de la propia página (`clientActor` + `listClientsFor`): el founder ve todos,
 * el resto los clientes donde participa. Si la base no responde, no se dibuja.
 */
function hayClientes(session: SessionData | null): boolean {
  if (!session) return false;
  try {
    const db = getDb();
    const actor = clientActor(session, db);
    return !!actor && listClientsFor(db, actor).length > 0;
  } catch (e) {
    console.error("[nav] clientes", e);
    return false;
  }
}

export default function Nav({ session }: { session: SessionData | null }) {
  // Por ROL, no por la wallet de una persona. Aquí basta con los claims de la
  // cookie: esto solo decide si se DIBUJA un enlace; la puerta real vive en cada
  // página de /admin, /equipo y /clientes, que resuelven el rol contra la base.
  const isFounder = claimsPuedenAdministrar(session ?? {});
  const esInterno = !!session && esEquipoInterno(session);
  // Acceso al trabajo (Mi día, Proyectos): por la base, no por la cookie (WP31).
  const accesoEquipo = accesoAlTrabajo(session);
  const puedeVerTodo = !!session && puedeVerTodoElEquipo(session);
  const conClientes = esInterno && hayClientes(session);

  // Botón de perfil en una sola línea y con el nombre recortado: con el menú completo del
  // founder (Seguimiento y Clientes incluidos) se partía en dos a 1280 px. El nombre
  // entero va en el title.
  const accesoDao = session ? (
    <Link
      href="/perfil"
      className="btn btn-ghost whitespace-nowrap px-3 py-1.5"
      title={session.name ? `${session.name} · ${session.wallet}` : session.wallet}
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
      <span className="max-w-[7rem] truncate">{session.name || shortWallet(session.wallet)}</span>
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
          conSesion={!!session}
          accesoEquipo={accesoEquipo}
          esInterno={esInterno}
          puedeVerTodo={puedeVerTodo}
          conClientes={conClientes}
          accesoDao={accesoDao}
          salir={session ? <SalirButton esDemo={session.isDemo} /> : null}
        />
      </nav>
    </header>
  );
}
