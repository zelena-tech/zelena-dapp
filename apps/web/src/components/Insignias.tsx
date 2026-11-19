/**
 * Insignias de una persona (WP31-I2, spec §4.B.7, §5.B.4 y §8.5).
 *
 * Reconocimiento, no moneda: cada insignia dice lo que ya está hecho
 * ("Primera entrega · conseguida") o cuánto falta comparado contigo
 * ("Diez entregas · 4 de 10"). Sin rachas ni comparación con otras personas,
 * y una insignia no obtenida nunca se muestra como algo que se perdió.
 *
 * Las metas salen del genoma (`BADGE_GOALS`) y el progreso de `senalesProgreso`; las
 * dos llegan ya calculadas desde la página (`insignias(...)` de `gamificacion.ts`).
 * Sin estado ni interacción.
 */
import { textoInsignia, type Insignia } from "@/lib/gamificacion";
import { ProgressBar } from "./ui";

export const COPY_LO_GANADO = "Lo ganado no se quita.";

export default function Insignias({ insignias, titulo = "Insignias" }: { insignias: Insignia[]; titulo?: string }) {
  const conseguidas = insignias.filter((i) => i.obtenida).length;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-head text-lg font-bold text-white">{titulo}</h3>
        <span className="text-xs text-faint">
          {conseguidas} de {insignias.length} conseguidas · {COPY_LO_GANADO}
        </span>
      </div>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {insignias.map((i) => (
          <li
            key={i.id}
            className={`rounded-md border px-3 py-2 ${i.obtenida ? "border-primary/40 bg-glow/30" : "border-line/60"}`}
          >
            <div className={`text-sm font-semibold ${i.obtenida ? "text-primary" : "text-white"}`}>
              {textoInsignia(i)}
            </div>
            <p className="mt-0.5 text-xs text-muted">{i.descripcion}</p>
            {i.obtenida ? null : (
              <div className="mt-2">
                <ProgressBar value={Math.min(i.actual, i.meta)} max={i.meta} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
