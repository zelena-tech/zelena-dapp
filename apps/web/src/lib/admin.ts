/** Operaciones de administración (solo founder). Mutan estado con guardas. */
import { getDb } from "./db";
import { transition, nextAction, type ProjectState } from "./state-machine";
import { violatesB8, withinEpochBudget } from "./rules";
import { EPOCH_BUDGET, FOUNDER_WALLET } from "./config";

export function approveApplication(appId: number): void {
  const db = getDb();
  const app = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(appId) as
    | { id: number; project_id: number; wallet: string; status: string }
    | undefined;
  if (!app) throw new Error("Aplicación no encontrada.");
  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(app.project_id) as
    | { id: number; state: ProjectState }
    | undefined;
  if (!project) throw new Error("Proyecto no encontrado.");
  const tx = db.transaction(() => {
    db.prepare(`UPDATE applications SET status = 'approved' WHERE id = ?`).run(appId);
    // Asigna el proyecto: Open → Assigned
    if (project.state === "Open") {
      const to = transition(project.state, "assign");
      db.prepare(`UPDATE projects SET state = ?, assignee_wallet = ? WHERE id = ?`).run(
        to,
        app.wallet,
        project.id
      );
    } else {
      db.prepare(`UPDATE projects SET assignee_wallet = ? WHERE id = ?`).run(app.wallet, project.id);
    }
  });
  tx();
}

export function rejectApplication(appId: number): void {
  getDb().prepare(`UPDATE applications SET status = 'rejected' WHERE id = ?`).run(appId);
}

export function advanceState(projectId: number): ProjectState {
  const db = getDb();
  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId) as
    | { id: number; state: ProjectState }
    | undefined;
  if (!project) throw new Error("Proyecto no encontrado.");
  const action = nextAction(project.state);
  if (!action) throw new Error("El proyecto ya está en su estado final.");
  const to = transition(project.state, action);
  db.prepare(`UPDATE projects SET state = ? WHERE id = ?`).run(to, projectId);
  return to;
}

/**
 * Aprueba un hito: emite puntos (1 USD = 1 punto) al ejecutor dentro del
 * presupuesto de época, con reputación en el eje Ejecución.
 * Aplica la regla B8 salvo excepción Stage 0 (founder como único supervisor).
 */
export function approveMilestone(milestoneId: number): { points: number; wallet: string } {
  const db = getDb();
  const ms = db.prepare(`SELECT * FROM milestones WHERE id = ?`).get(milestoneId) as
    | { id: number; project_id: number; amount_usd: number; approved: number; name: string }
    | undefined;
  if (!ms) throw new Error("Hito no encontrado.");
  if (ms.approved) throw new Error("El hito ya fue aprobado.");
  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(ms.project_id) as {
    id: number;
    supervisor_wallet: string;
    assignee_wallet: string | null;
    title: string;
  };
  const wallet = project.assignee_wallet;
  if (!wallet) throw new Error("El proyecto no tiene ejecutor asignado.");

  const assignee = db.prepare(`SELECT invited_by FROM users WHERE wallet = ?`).get(wallet) as
    | { invited_by: string | null }
    | undefined;
  // B8 con excepción Stage 0: el founder es el único supervisor seed.
  if (
    project.supervisor_wallet !== FOUNDER_WALLET &&
    violatesB8(project.supervisor_wallet, assignee?.invited_by ?? null)
  ) {
    throw new Error("Regla B8: un supervisor no puede evaluar a su invitado directo.");
  }

  const points = ms.amount_usd; // 1 USD = 1 punto ZWORK (fase Génesis)
  const currentTotal = (
    db.prepare(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger`).get() as { n: number }
  ).n;
  if (!withinEpochBudget(currentTotal, points, EPOCH_BUDGET)) {
    throw new Error("Emisión rechazada: excede el presupuesto de época.");
  }

  const tx = db.transaction(() => {
    db.prepare(`UPDATE milestones SET approved = 1 WHERE id = ?`).run(milestoneId);
    db.prepare(
      `INSERT INTO points_ledger (wallet, points, period_id, bucket, ref) VALUES (?, ?, 1, 'ejecucion', ?)`
    ).run(wallet, points, `${project.title} · ${ms.name}`);
    db.prepare(
      `INSERT INTO reputation_events (wallet, axis, delta, ref) VALUES (?, 'ejecucion', ?, ?)`
    ).run(wallet, Math.max(1, Math.round(points / 10)), `Hito aprobado: ${ms.name}`);
  });
  tx();
  return { points, wallet };
}

export function toggleContent(contentId: number): void {
  getDb()
    .prepare(`UPDATE academia_content SET enabled = CASE enabled WHEN 1 THEN 0 ELSE 1 END WHERE id = ?`)
    .run(contentId);
}
