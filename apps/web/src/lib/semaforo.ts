/**
 * Texto del semáforo de plazos (WP31-I2, spec §8.5): "A tiempo · vence jue 14:00",
 * "Por vencer · quedan 3 h hábiles", "Vencida · desde ayer 18:00" y "Sin plazo".
 *
 * Habla de la ENTREGA, nunca de la persona: dice cuándo vence una pieza de trabajo,
 * no quién va tarde. Los plazos y el horario hábil salen del genoma a través de
 * `SlaConfig` (`sla-db.ts#slaConfig`); aquí no hay ningún número de negocio.
 *
 * Puro y apto para cliente: solo importa de `sla.ts` (que a su vez solo usa
 * `zona-horaria.ts`). Nada de base, `crypto.ts`, `session.ts` ni `node:`. Lo usa
 * `SlaBadge.tsx`.
 */
import { SLA_LABEL, formatoVence, type SlaConfig, type SlaEstado, type SlaFase, type SlaResultado } from "./sla.ts";

/** Qué plazo corre en cada fase (para el `title` del badge). */
export const FASE_LABEL: Record<SlaFase, string> = {
  respuesta: "Plazo de primera respuesta",
  entrega: "Plazo de entrega",
  revision: "Plazo de revisión",
  bloqueo: "Plazo para destrabarla",
};

export interface Semaforo {
  estado: SlaEstado;
  /** "A tiempo" · "Por vencer" · "Vencida" · "Sin plazo". */
  etiqueta: string;
  /** "vence jue 14:00" · "quedan 3 h hábiles" · "desde ayer 18:00"; null sin plazo. */
  detalle: string | null;
  /** Etiqueta y detalle juntos, tal como se pintan. */
  texto: string;
  /** Qué plazo corre ("Plazo de revisión"…); null sin plazo. */
  fase: string | null;
}

/** "quedan 3 h hábiles" · "queda 1 h hábil" · "quedan 40 min hábiles". Nunca exagera lo que queda. */
export function textoQuedan(horas: number): string {
  const h = Number.isFinite(horas) && horas > 0 ? horas : 0;
  if (h >= 1) {
    const n = Math.floor(h);
    return n === 1 ? "queda 1 h hábil" : `quedan ${n} h hábiles`;
  }
  const min = Math.max(1, Math.round(h * 60));
  return min === 1 ? "queda 1 min hábil" : `quedan ${min} min hábiles`;
}

const SIN_PLAZO: Semaforo = {
  estado: "sin_plazo",
  etiqueta: SLA_LABEL.sin_plazo,
  detalle: null,
  texto: SLA_LABEL.sin_plazo,
  fase: null,
};

/** El semáforo de una pieza listo para pintar. Sin resultado (o sin vencimiento) → "Sin plazo". */
export function semaforo(r: SlaResultado | null | undefined, ahora: Date, c: SlaConfig): Semaforo {
  if (!r || r.estado === "sin_plazo" || !r.vence || Number.isNaN(r.vence.getTime())) return SIN_PLAZO;
  const etiqueta = SLA_LABEL[r.estado];
  const cuando = formatoVence(r.vence, ahora, c);
  let detalle: string | null;
  switch (r.estado) {
    case "a_tiempo":
      detalle = cuando ? `vence ${cuando}` : null;
      break;
    case "por_vencer":
      detalle = r.horasRestantes === null ? (cuando ? `vence ${cuando}` : null) : textoQuedan(r.horasRestantes);
      break;
    case "vencida":
      detalle = cuando ? `desde ${cuando}` : null;
      break;
    default:
      detalle = null;
  }
  return {
    estado: r.estado,
    etiqueta,
    detalle,
    texto: detalle ? `${etiqueta} · ${detalle}` : etiqueta,
    fase: r.fase ? FASE_LABEL[r.fase] : null,
  };
}
