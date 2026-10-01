import Link from "next/link";
import { Logo } from "./ui";

export default function Footer() {
  return (
    <footer className="mt-24 border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs space-y-2">
          <Logo />
          <p className="text-sm text-faint">Real Work, Real Rewards.</p>
        </div>
        <div className="flex gap-12 text-sm">
          <div className="space-y-0.5">
            <div className="label">Recursos</div>
            <Link href="/whitepaper" className="block py-1.5 text-muted hover:text-primary">Whitepaper</Link>
            <Link href="/gobernanza" className="block py-1.5 text-muted hover:text-primary">Decision log</Link>
            <Link href="/agora" className="block py-1.5 text-muted hover:text-primary">Ágora</Link>
          </div>
          <div className="space-y-0.5">
            <div className="label">Empresas</div>
            <Link href="/empresas" className="block py-1.5 text-muted hover:text-primary">Para empresas</Link>
            <Link href="/empresas/servicios" className="block py-1.5 text-muted hover:text-primary">Servicios</Link>
          </div>
          <div className="space-y-0.5">
            <div className="label">Comunidad</div>
            <Link href="/manifiesto" className="block py-1.5 text-muted hover:text-primary">Manifiesto</Link>
            <Link href="/encuentros" className="block py-1.5 text-muted hover:text-primary">Encuentros</Link>
            <Link href="/academia" className="block py-1.5 text-muted hover:text-primary">Academia</Link>
            <Link href="/entrar" className="block py-1.5 text-muted hover:text-primary">Entrar</Link>
            <Link href="/perfil" className="block py-1.5 text-muted hover:text-primary">Mi perfil</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-line/40 px-4 py-4 text-center text-xs text-faint">
        © 2026 Zelena · Comunidad gobernada sobre Stellar
      </div>
    </footer>
  );
}
