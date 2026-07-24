/**
 * Banner de anuncio de mutación (WP08): visible para toda la cohorte cuando hay una
 * mutación del genoma efectiva la próxima época. "La época N usará X=Y; antes X=Z; por qué."
 */
import { getDb } from "@/lib/db";
import { pendingMutation } from "@/lib/mutation";

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
        <span className="font-bold uppercase tracking-wide text-primary">Anuncio de gobernanza</span>
        <span className="text-white">
          La época {pending.targetEpoch} usará{" "}
          {pending.changes.map((c) => `${c.key} = ${c.to.toLocaleString("es")} (antes ${c.from.toLocaleString("es")})`).join(" · ")}.
        </span>
        {pending.reason ? <span className="text-muted">{pending.reason}</span> : null}
      </div>
    </div>
  );
}
