/**
 * `/equipo/avisos` — la bandeja de cada persona (WP31-C1, spec §8.5).
 *
 * Lo que el motor de recordatorios dejó sobre SUS entregas (o las que estructura o
 * revisa): un resumen al día y lo urgente al momento. Lee los avisos de TODAS las
 * identidades de la persona (`identidadesDe`), así el founder ve también los de su
 * fila de equipo antes de vincularla.
 *
 * Puerta propia (el layout no es la puerta, spec §5.A.2): `equipoActor`, resuelto
 * contra la base. Con la flag `SLA_REMINDERS_ENABLED` apagada se dice que los
 * recordatorios están en pausa: los plazos siguen visibles en cada tarjeta.
 *
 * Doc 16: se habla de la entrega, nunca de la persona; sin horas, sin "cuándo leíste".
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { isSlaRemindersEnabled } from "@/lib/config";
import { avisosDe, enlacesDeAvisos } from "@/lib/avisos";
import AvisosLista, { type AvisoVista } from "@/components/AvisosLista";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EquipoAvisosPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) redirect("/perfil");

  const filas = avisosDe(db, actor.wallet, { limite: 100 });
  const enlaces = enlacesDeAvisos(db, filas);
  const avisos: AvisoVista[] = filas.map((a) => ({
    id: a.id,
    texto: a.texto,
    enlace: enlaces.get(a.id) ?? "/equipo/hoy",
    leido: a.is_leido === 1,
  }));
  const encendido = isSlaRemindersEnabled();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-4xl font-bold text-white">Avisos</h1>
          <p className="mt-1 text-sm text-muted">
            Lo que necesita tu atención en tus entregas. Un resumen al día; lo urgente, al momento.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/equipo/telegram" className="btn btn-ghost py-1.5">
            Recibir también por Telegram
          </Link>
          <Link href="/equipo/hoy" className="btn btn-ghost py-1.5">
            Volver a tu día
          </Link>
        </div>
      </header>

      {encendido ? null : (
        <div className="card border-amber-700/50 p-4">
          <p className="text-sm text-amber-200">
            Los recordatorios están en pausa. Los plazos se ven igual en cada tarjeta.
          </p>
        </div>
      )}

      {avisos.length === 0 ? (
        <EmptyState
          title="No tienes avisos."
          message="Cuando una de tus entregas necesite atención, aparece aquí."
          cta={{ href: "/equipo/hoy", label: "Ir a tu día" }}
        />
      ) : (
        <AvisosLista avisos={avisos} />
      )}
    </div>
  );
}
