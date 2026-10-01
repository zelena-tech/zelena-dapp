import type { Metadata } from "next";
import Link from "next/link";
import { PASOS_METODO } from "@/lib/metodo";

export const metadata: Metadata = {
  title: "Método", // el layout le añade "· Zelena"
  description:
    "Cómo una necesidad se convierte en una entrega que se paga: ocho pasos, las mismas reglas para todos y un historial que queda a tu nombre.",
};

const TITULAR_H2 =
  "font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl sm:leading-[1.15] lg:text-[52px]";

// Reemplaza a /ecosistema (redirección 308 en next.config.mjs). Una idea por
// bloque: los ocho pasos, cómo se reparte el pago y lo que sí prometemos.
export default function Metodo() {
  return (
    <div className="space-y-24 md:space-y-32">
      {/* ===== APERTURA ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-14">
        <p className="label">Método</p>
        <h1 className="max-w-5xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[76px] lg:leading-[1.08]">
          De una necesidad a una entrega <em className="font-normal italic text-primary">que se paga.</em>
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted lg:text-lg">
          Ocho pasos, las mismas reglas para todos y todo a la vista. Así funciona cada proyecto, sea de un
          cliente o de la comunidad.
        </p>
      </section>

      {/* ===== LOS OCHO PASOS ===== */}
      <section aria-label="Los ocho pasos">
        <ol className="flex flex-col">
          {PASOS_METODO.map((p, i) => (
            <li
              key={p.n}
              className={`grid gap-3 py-7 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,2fr)] md:items-baseline md:gap-10 ${
                i === 0 ? "border-t border-primary" : "border-t border-line"
              } ${i === PASOS_METODO.length - 1 ? "border-b border-line" : ""}`}
            >
              <span className="text-[13px] text-primary">{p.n}</span>
              <h2 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper">
                {p.titulo}
              </h2>
              <p className="max-w-xl text-base leading-7 text-muted">{p.texto}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ===== EL PAGO ===== */}
      <section className="space-y-10">
        <div className="space-y-5">
          <p className="label">Pago por hitos</p>
          <h2 className={TITULAR_H2}>
            Nadie trabaja <em className="font-normal italic text-primary">por una promesa.</em>
          </h2>
          <p className="max-w-xl text-base leading-7 text-muted">
            Una parte al empezar, la mayor parte contra entregas aprobadas y un cierre cuando se confirma la
            calidad.
          </p>
        </div>
        <div>
          <div className="flex h-12 w-full overflow-hidden border border-line">
            <div className="flex w-[20%] items-center justify-center bg-primary-dim text-[11px] font-bold text-black">20 %</div>
            <div className="flex w-[70%] items-center justify-center bg-primary text-xs font-bold text-black">70 %</div>
            <div className="flex w-[10%] items-center justify-center bg-line-strong text-[11px] font-bold text-muted">10 %</div>
          </div>
          <div className="mt-2 flex justify-between text-[11px] uppercase tracking-wide text-faint">
            <span>Al empezar</span>
            <span>Entregas aprobadas</span>
            <span>Cierre</span>
          </div>
        </div>
      </section>

      {/* ===== LO QUE SÍ PROMETEMOS ===== */}
      <section className="border-t border-primary pt-10 md:pt-14">
        <p className="max-w-4xl font-serif text-3xl font-normal normal-case leading-[1.2] tracking-normal text-paper sm:text-4xl lg:text-[48px]">
          No se promete precio. <em className="font-normal italic text-primary">Se promete memoria.</em>
        </p>
        <p className="mt-8 max-w-2xl text-base leading-7 text-muted">
          Lo que aportes desde el primer día cuenta. Si te alejas, tu historial sigue siendo tuyo cuando vuelvas.
        </p>
      </section>

      {/* ===== SIGUIENTE PASO ===== */}
      <section>
        <div className="card flex flex-col items-start gap-8 border-primary/30 p-8 md:p-12">
          <h2 className="max-w-2xl font-serif text-3xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-4xl">
            Mira lo que está <em className="font-normal italic text-primary">abierto hoy.</em>
          </h2>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/agora" className="btn btn-primary normal-case tracking-normal">
              Ver los proyectos abiertos
            </Link>
            <Link
              href="/whitepaper"
              className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted transition-colors hover:text-primary"
            >
              Leer el whitepaper <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
