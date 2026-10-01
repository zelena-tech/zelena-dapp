/**
 * Semáforo de plazo de una entrega (WP31-I2, spec §4.C.3 y §8.5): A tiempo · Por
 * vencer · Vencida · Sin plazo, en horas hábiles de la zona del genoma.
 *
 * Califica la ENTREGA (cuándo vence la pieza), nunca a la persona: no dice quién va
 * tarde ni compara a nadie. El cálculo es de `sla.ts` (`evaluarSla`, `formatoVence`)
 * y llega aquí ya hecho, con `slaDeAsignaciones` de `sla-db.ts` en el servidor.
 *
 * Sin estado ni interacción. Solo importa de `semaforo.ts` y `sla.ts`, que son puros:
 * lo puede usar una página de servidor o, si algún día hace falta, un componente de
 * cliente (nada de base, `crypto.ts`, `session.ts` ni `node:` en la cadena).
 */
import { semaforo } from "@/lib/semaforo";
import type { SlaConfig, SlaEstado, SlaResultado } from "@/lib/sla";

const ESTILO: Record<SlaEstado, string> = {
  a_tiempo: "text-emerald-300 border-emerald-700/40 bg-emerald-950/20",
  por_vencer: "text-amber-300 border-amber-700/40 bg-amber-950/20",
  vencida: "text-red-300 border-red-800/50 bg-red-950/20",
  sin_plazo: "text-faint border-line",
};

export default function SlaBadge({
  sla,
  ahora,
  config,
  ocultarSinPlazo = false,
}: {
  /** Resultado de `evaluarSla` para la pieza (o nada: se pinta "Sin plazo"). */
  sla: SlaResultado | null | undefined;
  /** El mismo instante con el que se evaluó el SLA. */
  ahora: Date;
  /** Configuración de SLA del genoma (`slaConfig(db)`). */
  config: SlaConfig;
  /** En listas donde "Sin plazo" no aporta (p. ej. lo ya hecho), no pinta nada. */
  ocultarSinPlazo?: boolean;
}) {
  const s = semaforo(sla, ahora, config);
  if (ocultarSinPlazo && s.estado === "sin_plazo") return null;
  return (
    <span
      className={`tag normal-case tracking-normal ${ESTILO[s.estado]}`}
      title={s.fase ?? undefined}
      data-sla={s.estado}
    >
      <span aria-hidden className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {s.texto}
    </span>
  );
}
