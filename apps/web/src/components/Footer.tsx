import Link from "next/link";
import { AVISO_LEGAL, FOOTER_GRUPOS, esEnlaceExterno } from "@/lib/menu";
import { Logo } from "./ui";

// Pie de todas las páginas: lo que no cabe en el menú, lo legal (acuerdo,
// privacidad y licencia) y el aviso de la red de pruebas. Los enlaces viven en
// lib/menu.ts para que un test pueda comprobarlos sin pintar nada.
export default function Footer() {
  return (
    <footer className="mt-24 border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs space-y-3">
          <Logo />
          <p className="font-serif text-lg normal-case leading-snug text-paper">
            Lo que entregas decide <em className="italic text-primary">lo que recibes.</em>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-8 text-sm sm:grid-cols-3">
          {FOOTER_GRUPOS.map((g) => (
            <div key={g.titulo} className="space-y-0.5">
              <div className="label">{g.titulo}</div>
              {g.enlaces.map((e) =>
                esEnlaceExterno(e.href) ? (
                  <a
                    key={e.href}
                    href={e.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-1.5 text-muted hover:text-primary"
                  >
                    {e.label} <span aria-hidden>↗</span>
                  </a>
                ) : (
                  <Link key={e.href} href={e.href} className="block py-1.5 text-muted hover:text-primary">
                    {e.label}
                  </Link>
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-line/40 px-4 py-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 text-xs leading-5 text-faint md:flex-row md:items-baseline md:justify-between md:gap-8">
          <p className="max-w-3xl">{AVISO_LEGAL}</p>
          <p className="shrink-0">© 2026 Zelena</p>
        </div>
      </div>
    </footer>
  );
}
