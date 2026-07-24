/**
 * Auditoría de funciones latentes — Doc 16 salvaguarda 1 (Merton). Se pregunta,
 * por mecánica: "¿qué produce esto que no buscábamos?" y "¿funcional para quién?".
 * La disfunción detectada puede convertirse en propuesta de mutación (WP08).
 *
 * NO automatiza la detección (es juicio humano): solo estructura y registra.
 */
import type { DB } from "./db";

export const AUDIT_MECHANISMS = [
  "invitaciones",
  "academia",
  "rankings",
  "scoring",
  "ritos",
  "gobernanza",
] as const;

export const AUDIT_ACTIONS = ["none", "mutation_proposed", "mechanism_change"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface LatentAuditInput {
  mechanism: string;
  period: string;
  manifestFunction: string;
  latentObserved: string;
  functionalFor: string;
  dysfunctionalFor: string;
  action?: AuditAction;
  decisionLogId?: number | null;
}

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditError";
  }
}

function required(value: string, field: string): string {
  if (!value || value.trim().length < 3) throw new AuditError(`Campo obligatorio: ${field}.`);
  return value.trim();
}

export function createLatentAudit(db: DB, input: LatentAuditInput): number {
  const action: AuditAction = input.action ?? "none";
  if (!(AUDIT_ACTIONS as readonly string[]).includes(action)) throw new AuditError("Acción inválida.");
  const info = db
    .prepare(
      `INSERT INTO latent_audits
        (mechanism, period, manifest_function, latent_observed, functional_for, dysfunctional_for, action, decision_log_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      required(input.mechanism, "mecánica"),
      required(input.period, "periodo"),
      required(input.manifestFunction, "función manifiesta"),
      required(input.latentObserved, "función latente observada"),
      required(input.functionalFor, "funcional para"),
      required(input.dysfunctionalFor, "disfuncional para"),
      action,
      input.decisionLogId ?? null
    );
  return info.lastInsertRowid as number;
}

export interface LatentAudit {
  id: number;
  mechanism: string;
  period: string;
  manifestFunction: string;
  latentObserved: string;
  functionalFor: string;
  dysfunctionalFor: string;
  action: AuditAction;
  decisionLogId: number | null;
  decisionTitle: string | null; // título de la entrada del decision log enlazada
  createdAt: string;
}

export function listLatentAudits(db: DB): LatentAudit[] {
  const rows = db
    .prepare(
      `SELECT la.id, la.mechanism, la.period, la.manifest_function, la.latent_observed,
              la.functional_for, la.dysfunctional_for, la.action, la.decision_log_id, la.created_at,
              dl.title AS decision_title
       FROM latent_audits la
       LEFT JOIN decision_log dl ON dl.id = la.decision_log_id
       ORDER BY la.id DESC`
    )
    .all() as Array<{
    id: number;
    mechanism: string;
    period: string;
    manifest_function: string;
    latent_observed: string;
    functional_for: string;
    dysfunctional_for: string;
    action: string;
    decision_log_id: number | null;
    created_at: string;
    decision_title: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    mechanism: r.mechanism,
    period: r.period,
    manifestFunction: r.manifest_function,
    latentObserved: r.latent_observed,
    functionalFor: r.functional_for,
    dysfunctionalFor: r.dysfunctional_for,
    action: r.action as AuditAction,
    decisionLogId: r.decision_log_id,
    decisionTitle: r.decision_title,
    createdAt: r.created_at,
  }));
}
