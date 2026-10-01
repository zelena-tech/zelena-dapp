/**
 * Puente al Ágora (WP31-C2, spec §4.A.11 y §5.C.4): una entrega del tablero se
 * publica como proyecto abierto del Ágora, con sus hitos y sus pagos.
 *
 * Reglas que este archivo hace cumplir:
 *  - Solo el founder o un supervisor publican (`puedeVerTodoElEquipo`, leído de la
 *    base por la puerta de la ruta). Una pieza de un proyecto de cliente que la
 *    persona no ve no existe para ella (404).
 *  - Solo se publica trabajo en `Backlog` y SIN responsable, y una sola vez: así nadie
 *    cobra dos veces la misma pieza (por la aprobación interna y por los hitos).
 *  - NADA INTERNO SE COPIA SIN CONFIRMACIÓN. `projects` se escribe solo con lo que
 *    llega en el formulario (`campana`, `titulo`, `resumen`, `descripcionPublica`,
 *    `criterioPublico`). Las `notes` del proyecto, la descripción interna y el nombre
 *    de la iniciativa nunca se leen aquí: si llegan a `projects` es porque alguien los
 *    dejó tal cual en el formulario, después de ver la vista previa.
 *  - La campaña se prellena con "Zelena", nunca con el nombre de la iniciativa (que
 *    puede ser de un cliente).
 *  - El reparto por hitos sale del genoma (`AGORA_HITOS_DEFAULT`) y es editable: de 4 a
 *    10 hitos, enteros de 1 a 25 %, que suman 100. Los montos suman exactamente el
 *    presupuesto (el último absorbe el redondeo).
 *  - Desde que se publica, la pieza se paga por sus hitos (`emitirPorAprobacion`
 *    devuelve `publicada_en_agora`). Nunca toca dinero real: es la red de pruebas.
 *
 * Puro respecto al servidor: solo importa tipos de db.ts, así que el formulario de
 * cliente puede usar `validarHitos` y `montosDeHitos` sin arrastrar la base.
 * Los valores internos del tipo de proyecto viven solo en agora-labels.ts.
 */
import { z } from "zod";
import type { DB } from "./db";
import { getActiveGenome } from "./genome.ts";
import { tipoDesdeEtiqueta } from "./agora-labels.ts";
import { puedeVerTodoElEquipo, type TeamActor } from "./roles.ts";
import { TeamError, getAssignment, piezasVisiblesPara, type AssignmentRow } from "./team.ts";
import { diaLocal, instanteDb } from "./zona-horaria.ts";

// ---------------------------------------------------------------------------
// Vocabulario y límites
// ---------------------------------------------------------------------------

export interface HitoPublicar {
  nombre: string;
  semana: string;
  pct: number;
}

export type ParaQuien = "cliente" | "comunidad";

/** Campaña con la que se prellena el formulario. Nunca el nombre de la iniciativa. */
export const CAMPANA_POR_DEFECTO = "Zelena";

export const LIMITES_PUBLICAR = {
  presupuestoMin: 1,
  presupuestoMax: 1_000_000,
  semanasMin: 1,
  semanasMax: 52,
  campanaMin: 2,
  campanaMax: 60,
  tituloMin: 4,
  tituloMax: 120,
  resumenMin: 10,
  resumenMax: 400,
  textoMin: 10,
  textoMax: 2000,
  hitosMin: 4,
  hitosMax: 10,
  pctMin: 1,
  pctMax: 25,
  hitoNombreMax: 60,
  hitoSemanaMax: 20,
} as const;

/** Copy del puente (spec §8.5). Lo comparten la ruta, la página y el formulario. */
export const COPY_PUBLICAR = {
  sinPermiso: "Publicar en el Ágora es del founder o de un supervisor.",
  noEncontrada: "No encuentro esa entrega.",
  soloSinResponsable: "Solo se publica trabajo que aún no tiene responsable.",
  yaPublicada: "Esta pieza ya está publicada.",
  hitosCantidad: "Van de 4 a 10 hitos.",
  hitoNombre: "Cada hito necesita un nombre y una semana.",
  hitoPct: "Cada hito va de 1 % a 25 %, en números enteros.",
  presupuestoCorto: "El presupuesto no alcanza para un pago en cada hito.",
} as const;

/** "Suman {s} %; deben sumar 100 y ninguno pasar de 25." (spec §8.5). */
export function copySumaHitos(suma: number): string {
  return `Suman ${suma} %; deben sumar 100 y ninguno pasar de 25.`;
}

// ---------------------------------------------------------------------------
// Hitos
// ---------------------------------------------------------------------------

/** Reparto por defecto: el del genoma vigente (`AGORA_HITOS_DEFAULT`), en copias. */
export function hitosPorDefecto(db: DB): HitoPublicar[] {
  return getActiveGenome(db).AGORA_HITOS_DEFAULT.map((h) => ({
    nombre: String(h.nombre),
    semana: String(h.semana),
    pct: Number(h.pct),
  }));
}

/** De 4 a 10 hitos, cada uno con nombre y semana, enteros de 1 a 25 %, que suman 100. */
export function validarHitos(hitos: HitoPublicar[]): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(hitos) || hitos.length < LIMITES_PUBLICAR.hitosMin || hitos.length > LIMITES_PUBLICAR.hitosMax) {
    return { ok: false, error: COPY_PUBLICAR.hitosCantidad };
  }
  for (const h of hitos) {
    if (!h || typeof h.nombre !== "string" || !h.nombre.trim() || typeof h.semana !== "string" || !h.semana.trim()) {
      return { ok: false, error: COPY_PUBLICAR.hitoNombre };
    }
    if (!Number.isInteger(h.pct) || h.pct < LIMITES_PUBLICAR.pctMin || h.pct > LIMITES_PUBLICAR.pctMax) {
      return { ok: false, error: COPY_PUBLICAR.hitoPct };
    }
  }
  const suma = sumaPct(hitos);
  if (suma !== 100) return { ok: false, error: copySumaHitos(suma) };
  return { ok: true };
}

export function sumaPct(hitos: ReadonlyArray<{ pct: number }>): number {
  return hitos.reduce((t, h) => t + (Number.isFinite(h.pct) ? h.pct : 0), 0);
}

/**
 * Monto de cada hito: `floor(presupuesto × pct / 100)` y el último absorbe el
 * redondeo, así la suma es EXACTAMENTE el presupuesto. Puro.
 */
export function montosDeHitos(presupuesto: number, pcts: number[]): number[] {
  if (pcts.length === 0) return [];
  const montos = pcts.map((p) => Math.floor((presupuesto * p) / 100));
  const resto = presupuesto - montos.slice(0, -1).reduce((t, m) => t + m, 0);
  montos[montos.length - 1] = resto;
  return montos;
}

// ---------------------------------------------------------------------------
// Entrada validada
// ---------------------------------------------------------------------------

const L = LIMITES_PUBLICAR;

const texto = (min: number, max: number, mensaje: string) =>
  z.string({ required_error: mensaje, invalid_type_error: mensaje }).trim().min(min, mensaje).max(max, mensaje);

export const hitoPublicarSchema = z.object({
  nombre: texto(1, L.hitoNombreMax, COPY_PUBLICAR.hitoNombre),
  semana: texto(1, L.hitoSemanaMax, COPY_PUBLICAR.hitoNombre),
  pct: z
    .number({ required_error: COPY_PUBLICAR.hitoPct, invalid_type_error: COPY_PUBLICAR.hitoPct })
    .int(COPY_PUBLICAR.hitoPct)
    .min(L.pctMin, COPY_PUBLICAR.hitoPct)
    .max(L.pctMax, COPY_PUBLICAR.hitoPct),
});

export const publicarSchema = z
  .object({
    assignmentId: z.number().int().positive(),
    tipo: z.enum(["cliente", "comunidad"], { errorMap: () => ({ message: "Elige para quién es: un cliente o la comunidad." }) }),
    presupuestoUsd: z
      .number({ invalid_type_error: "El presupuesto va en USD enteros, de 1 a 1.000.000." })
      .int("El presupuesto va en USD enteros, de 1 a 1.000.000.")
      .min(L.presupuestoMin, "El presupuesto va en USD enteros, de 1 a 1.000.000.")
      .max(L.presupuestoMax, "El presupuesto va en USD enteros, de 1 a 1.000.000."),
    semanas: z
      .number({ invalid_type_error: "Las semanas van de 1 a 52." })
      .int("Las semanas van de 1 a 52.")
      .min(L.semanasMin, "Las semanas van de 1 a 52.")
      .max(L.semanasMax, "Las semanas van de 1 a 52."),
    campana: texto(L.campanaMin, L.campanaMax, "La campaña va de 2 a 60 caracteres.").default(CAMPANA_POR_DEFECTO),
    titulo: texto(L.tituloMin, L.tituloMax, "El título va de 4 a 120 caracteres."),
    resumen: texto(L.resumenMin, L.resumenMax, "El resumen va de 10 a 400 caracteres."),
    descripcionPublica: texto(L.textoMin, L.textoMax, "Di qué hay que entregar (de 10 a 2000 caracteres)."),
    criterioPublico: texto(L.textoMin, L.textoMax, "Di cómo se va a evaluar la entrega (de 10 a 2000 caracteres)."),
    hitos: z.array(hitoPublicarSchema).min(L.hitosMin, COPY_PUBLICAR.hitosCantidad).max(L.hitosMax, COPY_PUBLICAR.hitosCantidad),
  })
  .superRefine((v, ctx) => {
    const r = validarHitos(v.hitos);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hitos"], message: r.error });
  });

export type PublicarInput = z.infer<typeof publicarSchema>;

// ---------------------------------------------------------------------------
// Estado de una pieza frente al Ágora
// ---------------------------------------------------------------------------

/** Motivo por el que una pieza no se puede publicar, o `null` si se puede. */
export function motivoNoPublicable(row: Pick<AssignmentRow, "status" | "owner_wallet" | "published_as_project_id">): string | null {
  if (row.published_as_project_id != null) return COPY_PUBLICAR.yaPublicada;
  if (row.status !== "Backlog" || row.owner_wallet) return COPY_PUBLICAR.soloSinResponsable;
  return null;
}

/** ¿Puede esta persona publicar en el Ágora? Founder o supervisor. */
export function puedePublicar(actor: TeamActor): boolean {
  return puedeVerTodoElEquipo({ role: actor.role, isSupervisor: actor.isSupervisor });
}

/** La pieza, si existe y el actor la ve (un proyecto de cliente ajeno no existe para él). */
export function piezaParaPublicar(db: DB, actor: TeamActor, assignmentId: number): AssignmentRow | undefined {
  const row = getAssignment(db, assignmentId);
  if (!row) return undefined;
  return piezasVisiblesPara(db, actor, [row]).length === 1 ? row : undefined;
}

export interface BorradorPublicacion {
  assignmentId: number;
  tipo: ParaQuien;
  presupuestoUsd: number | null;
  semanas: number;
  campana: string;
  titulo: string;
  resumen: string;
  descripcionPublica: string;
  criterioPublico: string;
  hitos: HitoPublicar[];
}

/**
 * Valores con los que se abre el formulario. Prellena título, qué hay que entregar y
 * cómo se evalúa DESDE LA TAREA (editables, con vista previa antes de confirmar), y la
 * campaña con "Zelena". No lee las `notes` ni el nombre de la iniciativa. El resumen y
 * el presupuesto quedan vacíos: los escribe quien publica.
 */
export function borradorPublicacion(db: DB, row: AssignmentRow): BorradorPublicacion {
  const hitos = hitosPorDefecto(db);
  const ultimaSemana = Number.parseInt(hitos.at(-1)?.semana ?? "", 10);
  const semanas = Number.isInteger(ultimaSemana)
    ? Math.min(L.semanasMax, Math.max(L.semanasMin, ultimaSemana))
    : 8;
  return {
    assignmentId: row.id,
    tipo: esDeCliente(db, row) ? "cliente" : "comunidad",
    presupuestoUsd: null,
    semanas,
    campana: CAMPANA_POR_DEFECTO,
    titulo: row.title.slice(0, L.tituloMax),
    resumen: "",
    descripcionPublica: row.description.slice(0, L.textoMax),
    criterioPublico: row.acceptance_criteria.slice(0, L.textoMax),
    hitos,
  };
}

/** La pieza o su proyecto pertenecen a un cliente (solo decide el valor por defecto). */
function esDeCliente(db: DB, row: AssignmentRow): boolean {
  if (row.client_id != null) return true;
  if (row.initiative_id == null) return false;
  const ini = db.prepare(`SELECT client_id FROM initiatives WHERE id = ?`).get(row.initiative_id) as
    | { client_id: number | null }
    | undefined;
  return ini?.client_id != null;
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

function primerError(issues: Array<{ message: string }>): string {
  return issues[0]?.message ?? "Entrada inválida.";
}

/**
 * Publica la pieza en el Ágora: `projects` (estado `Open`) + `milestones`, enlaza
 * `assignments.published_as_project_id` y deja el evento `publicar` (de su estado al
 * mismo estado, `created_at = instanteDb(now)`). Todo en UNA transacción síncrona.
 *
 * Errores (`TeamError`): 403 sin permiso · 400 entrada inválida · 404 pieza que no
 * existe o que no ve · 409 con responsable, fuera de Backlog o ya publicada.
 */
export function publicarEnAgora(
  db: DB,
  actor: TeamActor,
  input: PublicarInput,
  now: Date = new Date()
): { projectId: number } {
  if (!puedePublicar(actor)) throw new TeamError(403, COPY_PUBLICAR.sinPermiso);

  // Defensa en profundidad: la ruta ya validó, pero esta es la regla, no la ruta.
  const parsed = publicarSchema.safeParse(input);
  if (!parsed.success) throw new TeamError(400, primerError(parsed.error.issues));
  const datos = parsed.data;

  const row = piezaParaPublicar(db, actor, datos.assignmentId);
  if (!row) throw new TeamError(404, COPY_PUBLICAR.noEncontrada);
  const motivo = motivoNoPublicable(row);
  if (motivo) throw new TeamError(409, motivo);

  const montos = montosDeHitos(
    datos.presupuestoUsd,
    datos.hitos.map((h) => h.pct)
  );
  if (montos.some((m) => m < 1)) throw new TeamError(400, COPY_PUBLICAR.presupuestoCorto);

  const tz = getActiveGenome(db).BUSINESS_TZ;
  const iso = now.toISOString();
  let projectId = 0;

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO projects (campaign, title, type, budget_usd, weeks, state, supervisor_wallet, summary, description, acceptance)
         VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?)`
      )
      .run(
        datos.campana,
        datos.titulo,
        tipoDesdeEtiqueta(datos.tipo),
        datos.presupuestoUsd,
        datos.semanas,
        actor.wallet,
        datos.resumen,
        datos.descripcionPublica,
        datos.criterioPublico
      );
    projectId = Number(info.lastInsertRowid);

    const hito = db.prepare(
      `INSERT INTO milestones (project_id, ord, code, name, week, pct, amount_usd) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    datos.hitos.forEach((h, i) => {
      const ord = i + 1;
      hito.run(projectId, ord, `H${ord}`, h.nombre, h.semana, h.pct, montos[i]);
    });

    // Guarda de carrera: solo enlaza si la pieza sigue publicable en este instante.
    const enlace = db
      .prepare(
        `UPDATE assignments SET published_as_project_id = ?, updated_at = ?
          WHERE id = ? AND published_as_project_id IS NULL AND status = 'Backlog' AND owner_wallet IS NULL`
      )
      .run(projectId, iso, row.id);
    if (Number(enlace.changes) !== 1) throw new TeamError(409, COPY_PUBLICAR.yaPublicada);

    db.prepare(
      `INSERT INTO assignment_events (assignment_id, action, from_status, to_status, reason, actor_wallet, day, created_at)
       VALUES (?, 'publicar', ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.status,
      row.status,
      `Publicada en el Ágora como proyecto #${projectId}`,
      actor.wallet,
      diaLocal(now, tz),
      instanteDb(now)
    );
  });
  tx();

  return { projectId };
}
