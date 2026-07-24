/** Reglas puras de integridad. */

/**
 * Regla B8: un supervisor no puede evaluar a un contribuidor que él mismo invitó.
 * Devuelve true si la evaluación VIOLARÍA la regla.
 */
export function violatesB8(supervisorWallet: string, evaluatedInvitedBy: string | null): boolean {
  if (!evaluatedInvitedBy) return false;
  return supervisorWallet === evaluatedInvitedBy;
}

/** El presupuesto de época no puede excederse al emitir puntos. */
export function withinEpochBudget(currentTotal: number, delta: number, budget: number): boolean {
  return currentTotal + delta <= budget;
}
