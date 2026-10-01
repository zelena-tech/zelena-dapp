/**
 * Banner de anuncio de mutación (WP08): visible para toda la cohorte cuando hay una
 * mutación del genoma efectiva la próxima época. "La temporada N usará X; antes Y; por qué."
 *
 * Es público (sale en todas las páginas), así que habla en lenguaje llano: cada
 * parámetro con su nombre humano, nunca la clave interna del genoma.
 */
import Link from "next/link";
import { getDb } from "@/lib/db";
import { pendingMutation } from "@/lib/mutation";

const NOMBRE_PARAMETRO: Record<string, string> = {
  EPOCH_BUDGET: "presupuesto de puntos de la temporada",
  ACADEMIA_BUDGET: "presupuesto de la Academia",
  ACADEMIA_DAILY_CAP: "contenidos de la Academia con puntos por día",
  ACADEMIA_VOTE_WEIGHT: "peso de los puntos de la Academia en las votaciones",
};

function nombre(clave: string): string {
  return NOMBRE_PARAMETRO[clave] ?? "otro parámetro";
}

export default function MutationBanner() {
  let pending: ReturnType<typeof pendingMutation> = null;
  try {
    pending = pendingMutation(getDb());
  } catch {
    pending = null;
  }
  if (!pending || pending.changes.length === 0) return null;

  return (
    <div className="border-b border-primary/30 bg-primary/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2 text-xs">
        <span className="font-bold uppercase tracking-wide text-primary">Cambio anunciado</span>
        <span className="text-white">
          La temporada {pending.targetEpoch} usará:{" "}
          {pending.changes
            .map((c) => `${nombre(c.key)} ${c.to.toLocaleString("es")} (antes ${c.from.toLocaleString("es")})`)
            .join(" · ")}
          .
        </span>
        {pending.reason ? <span className="text-muted">{pending.reason}</span> : null}
        <Link href="/gobernanza" className="text-primary hover:underline">
          Ver las decisiones
        </Link>
      </div>
    </div>
  );
}
