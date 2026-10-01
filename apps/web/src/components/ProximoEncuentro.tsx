import Link from "next/link";
import { getDb } from "@/lib/db";
import { fechaLarga, proximosEncuentros } from "@/lib/encuentros";
import { RUTA_COMUNIDAD } from "@/lib/menu";
import { proximoRitoDeComunidad, zonaRitos, type RitoProximo } from "@/lib/ritos";
import { elegirProximo, proximoRitoTexto, zonaTexto } from "@/lib/ritos-labels";

/**
 * Lo próximo en el calendario de la comunidad, en una línea (landing, §8.1).
 *
 * Anuncia lo que llegue antes: el próximo encuentro publicado (lib/encuentros.ts) o
 * la próxima demo o retro (solo ritos con audiencia "comunidad"; el sync es del
 * equipo), calculada desde la cadencia del genoma. Si no hay nada, se dice dónde se
 * publican las fechas, sin inventar ninguna. Sin nombres ni enlace de conexión.
 */
export default function ProximoEncuentro() {
  const encuentro = proximosEncuentros()[0] ?? null;
  let rito: RitoProximo | null = null;
  let tz = "";
  try {
    const db = getDb();
    tz = zonaRitos(db);
    rito = proximoRitoDeComunidad(db);
  } catch (e) {
    // La landing no se cae por el calendario: sin rito, se anuncia lo demás.
    console.error("[landing] próximo rito", e);
  }
  const lo = elegirProximo(encuentro?.fecha ?? null, rito?.inicio ?? null, tz);
  const textoRito = lo === "rito" && rito ? proximoRitoTexto(rito.kind, rito.inicio, tz) : null;

  return (
    <section className="flex flex-col gap-3 border-t border-line pt-7" aria-label="Lo próximo">
      <p className="label">Lo próximo</p>
      {lo === "encuentro" && encuentro ? (
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
      ) : textoRito && rito ? (
        <Link
          href={rito.sessionId ? `/comunidad/ritos/${rito.sessionId}` : `${RUTA_COMUNIDAD}#proximos`}
          className="group flex flex-col gap-2"
        >
          <span className="font-serif text-2xl font-normal normal-case leading-snug text-paper sm:text-3xl">
            {textoRito.titulo}: <em className="italic text-primary">{textoRito.cuando}</em>
          </span>
          <span className="text-sm text-muted">
            {textoRito.fecha} · {zonaTexto(tz)}
            {rito.lugar ? ` · ${rito.lugar}` : ""}
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
