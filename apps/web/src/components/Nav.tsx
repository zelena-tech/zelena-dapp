import Link from "next/link";
import { FOUNDER_WALLET } from "@/lib/config";
import type { SessionData } from "@/lib/jwt";
import { Logo, shortWallet } from "./ui";
import SalirButton from "./SalirButton";

const LINKS = [
  { href: "/ecosistema", label: "Ecosistema" },
  { href: "/equipo/hoy", label: "Mi día" },
  { href: "/equipo/proyectos", label: "Proyectos" },
  { href: "/clientes", label: "Clientes" },
  { href: "/agora", label: "Ágora" },
  { href: "/academia", label: "Academia" },
  { href: "/gobernanza", label: "Gobernanza" },
  { href: "/whitepaper", label: "Whitepaper" },
];

export default function Nav({ session }: { session: SessionData | null }) {
  const isFounder = session?.wallet === FOUNDER_WALLET;
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
        <Link href="/" className="shrink-0" aria-label="Inicio">
          <Logo />
        </Link>

        {/* Escritorio */}
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors duration-150 hover:bg-glow hover:text-primary"
            >
              {l.label}
            </Link>
          ))}
          {isFounder ? (
            <Link href="/admin" className="rounded-md px-3 py-1.5 text-sm text-amber-300 transition-colors hover:bg-amber-950/30">
              Admin
            </Link>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {session ? (
            <Link href="/perfil" className="btn btn-ghost py-1.5" title={session.wallet}>
              <span className="h-2 w-2 rounded-full bg-primary" />
              {session.name || shortWallet(session.wallet)}
            </Link>
          ) : (
            <Link href="/entrar" className="btn btn-primary py-1.5">
              Entrar
            </Link>
          )}

          {/* Móvil: menú desplegable sin JavaScript. Antes los enlaces
              simplemente desaparecían por debajo de 768 px y la app quedaba
              sin navegación en el teléfono, que es donde entra la cohorte. */}
          <details className="relative md:hidden">
            <summary
              className="btn btn-ghost cursor-pointer py-1.5 marker:content-none [&::-webkit-details-marker]:hidden"
              aria-label="Abrir el menú"
            >
              Menú
            </summary>
            <div className="absolute right-0 z-40 mt-2 w-60 border border-line-strong bg-surface p-2 shadow-glow">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="block px-3 py-2.5 text-sm text-muted transition-colors hover:bg-glow hover:text-primary"
                >
                  {l.label}
                </Link>
              ))}
              {isFounder ? (
                <Link href="/admin" className="block px-3 py-2.5 text-sm text-amber-300 hover:bg-amber-950/30">
                  Admin
                </Link>
              ) : null}
              {session ? (
                <div className="mt-2 border-t border-line pt-2">
                  <SalirButton esDemo={session.isDemo} />
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
