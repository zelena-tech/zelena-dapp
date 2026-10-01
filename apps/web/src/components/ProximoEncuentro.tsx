import Link from "next/link";
import { fechaLarga, proximosEncuentros } from "@/lib/encuentros";
import { RUTA_COMUNIDAD } from "@/lib/menu";

/**
 * Lo próximo en el calendario de la comunidad, en una línea (landing).
 *
 * Hoy: el próximo encuentro publicado (lib/encuentros.ts). La próxima demo o retro
 * de comunidad la añade el paquete de ritos en este mismo componente (solo ritos
 * con audiencia "comunidad"; el sync es del equipo). Si no hay nada, se dice dónde
 * se publican las fechas, sin inventar ninguna.
 */
export default function ProximoEncuentro() {
  const encuentro = proximosEncuentros()[0] ?? null;

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-7" aria-label="Lo próximo">
      <p className="label">Lo próximo</p>
      {encuentro ? (
        <Link href="/encuentros#proximos" className="group flex flex-col gap-2">
          <span className="font-serif text-2xl font-normal normal-case leading-snug text-paper sm:text-3xl">
            Próximo encuentro: <em className="italic text-primary">{encuentro.titulo}</em>
          </span>
          <span className="text-sm text-muted">
            {encuentro.ciudad} · {fechaLarga(encuentro.fecha)}
            <span aria-hidden className="ml-2 inline-block transition-transform duration-150 group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </Link>
      ) : (
        <p className="text-base leading-7 text-muted">
          Las próximas fechas se publican en{" "}
          <Link href={RUTA_COMUNIDAD} className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
            Comunidad
          </Link>
          .
        </p>
      )}
    </section>
  );
}
