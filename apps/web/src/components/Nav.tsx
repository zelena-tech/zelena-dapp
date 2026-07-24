import Link from "next/link";
import { FOUNDER_WALLET } from "@/lib/config";
import type { SessionData } from "@/lib/jwt";
import { Logo, shortWallet } from "./ui";

const LINKS = [
  { href: "/agora", label: "Ágora" },
  { href: "/academia", label: "Academia" },
  { href: "/gobernanza", label: "Gobernanza" },
  { href: "/whitepaper", label: "Whitepaper" },
];

export default function Nav({ session }: { session: SessionData | null }) {
  const isFounder = session?.wallet === FOUNDER_WALLET;
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="shrink-0" aria-label="Inicio">
          <Logo />
        </Link>
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
              Tengo una invitación
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
