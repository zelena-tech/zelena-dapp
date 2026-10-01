/**
 * Cifras en vivo de la landing (WP31-E1). Solo servidor: lee la base.
 *
 * Primero lo real: no cuenta cuentas de prueba (`users.is_demo = 1`) ni las firmas
 * sembradas con un `tx_id` que no es un hash de Stellar (las `SEEDTX_…`). Con todo
 * en cero se muestra el cero.
 */
import type { DB } from "./db";
import { txVerificable } from "./pruebas-testnet";

export interface CifrasEnVivo {
  proyectosAbiertos: number;
  entregasAprobadas: number;
  firmasRegistradas: number;
  ultimaFirmaAnclada: { tx: string; fecha: string } | null;
}

function contar(db: DB, sql: string): number {
  const r = db.prepare(sql).get() as { n: number | null } | undefined;
  return Number(r?.n ?? 0);
}

export function cifrasEnVivo(db: DB): CifrasEnVivo {
  const proyectosAbiertos = contar(db, `SELECT COUNT(*) AS n FROM projects WHERE state = 'Open'`);

  // Hitos aprobados de proyectos del Ágora asignados a una cuenta real.
  const hitos = contar(
    db,
    `SELECT COUNT(*) AS n
       FROM milestones m
       JOIN projects p ON p.id = m.project_id
       JOIN users u ON u.wallet = p.assignee_wallet
      WHERE m.approved = 1 AND u.is_demo = 0`
  );
  // Entregas del equipo aprobadas (evento `aprobar`) cuyo dueño es una cuenta real.
  const tareas = contar(
    db,
    `SELECT COUNT(DISTINCT a.id) AS n
       FROM assignments a
       JOIN assignment_events e ON e.assignment_id = a.id
       JOIN users u ON u.wallet = a.owner_wallet
      WHERE e.action = 'aprobar' AND u.is_demo = 0`
  );

  // Firmas del acuerdo con una transacción real de Stellar, de cuentas reales.
  // El filtro del hash se hace aquí y no en SQL: no hay expresiones regulares
  // portables entre SQLite y SQL Server.
  const firmas = (
    db
      .prepare(
        `SELECT cs.tx_id AS tx, cs.signed_at AS fecha
           FROM cla_signatures cs
           JOIN users u ON u.wallet = cs.wallet
          WHERE cs.tx_id IS NOT NULL AND u.is_demo = 0
          ORDER BY cs.id DESC`
      )
      .all() as Array<{ tx: string; fecha: string }>
  ).filter((f) => txVerificable(f.tx));

  const ultima = firmas[0];
  return {
    proyectosAbiertos,
    entregasAprobadas: hitos + tareas,
    firmasRegistradas: firmas.length,
    ultimaFirmaAnclada: ultima ? { tx: ultima.tx, fecha: String(ultima.fecha).slice(0, 10) } : null,
  };
}
