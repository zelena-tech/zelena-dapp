/**
 * `/equipo/publicar/[id]` — publicar una entrega en el Ágora (WP31-C2, spec §5.C.4,
 * §7 y §8.5). Founder o supervisor.
 *
 * Puerta propia (el layout no es la puerta, spec §5.A.2): `equipoActor` contra la base
 * y, además, `puedeVerTodoElEquipo`. Una pieza de un proyecto de cliente que la persona
 * no ve no existe para ella (404).
 *
 * Lo que se publica es visible para cualquiera: el formulario llega prellenado desde
 * la tarea y con la campaña "Zelena" (nunca con el nombre de la iniciativa), todo es
 * editable y hay una vista previa antes de confirmar.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { puedeVerTodoElEquipo } from "@/lib/roles";
import { listInitiatives } from "@/lib/team";
import { borradorPublicacion, motivoNoPublicable, piezaParaPublicar, COPY_PUBLICAR } from "@/lib/agora-publicar";
import PublicarAgoraForm from "@/components/PublicarAgoraForm";

export const dynamic = "force-dynamic";

function Cabecera() {
  return (
    <header className="space-y-3">
      <h1 className="font-head text-4xl font-bold text-white">Publicar en el Ágora</h1>
      <p className="max-w-2xl text-sm text-amber-200">
        Lo que publiques será visible para cualquiera. No incluyas nombres de clientes sin su permiso.
      </p>
    </header>
  );
}

function SinAcceso() {
  return (
    <div className="space-y-6">
      <h1 className="font-head text-4xl font-bold text-white">Publicar en el Ágora</h1>
      <div className="card p-6">
        <p className="text-sm text-muted">
          Publicar una entrega en el Ágora es del founder o de un supervisor. Si crees que una pieza debería abrirse
          a la comunidad, díselo a quien estructura tu proyecto.
        </p>
        <Link href="/equipo/hoy" className="btn btn-primary mt-5">
          Ir a tu día
        </Link>
      </div>
    </div>
  );
}

export default async function PublicarEnAgoraPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) redirect("/perfil");
  if (!puedeVerTodoElEquipo({ role: actor.role, isSupervisor: actor.isSupervisor })) return <SinAcceso />;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const row = piezaParaPublicar(db, actor, id);
  if (!row) notFound();

  const proyecto = row.initiative_id != null ? listInitiatives(db).find((i) => i.id === row.initiative_id) : undefined;
  const volver = proyecto
    ? { href: `/equipo/proyectos/${encodeURIComponent(proyecto.slug)}`, label: "← Volver al tablero del proyecto" }
    : { href: "/equipo/proyectos", label: "← Volver a los proyectos" };
  const motivo = motivoNoPublicable(row);

  return (
    <div className="space-y-6">
      <Link href={volver.href} className="text-sm text-muted hover:text-primary">
        {volver.label}
      </Link>
      <Cabecera />
      <p className="text-sm text-faint">
        Entrega #{row.id} · {row.title}
      </p>

      {motivo ? (
        <div className="card space-y-3 p-6">
          <p className="text-sm text-white">{motivo}</p>
          {motivo === COPY_PUBLICAR.yaPublicada && row.published_as_project_id != null ? (
            <Link href={`/agora/${row.published_as_project_id}`} className="btn btn-ghost">
              Ver en el Ágora
            </Link>
          ) : (
            <p className="text-xs text-faint">
              Se publica una pieza que está en Backlog y sin responsable. Desde que se publica, se paga por sus hitos
              en el Ágora.
            </p>
          )}
        </div>
      ) : (
        <PublicarAgoraForm inicial={borradorPublicacion(db, row)} />
      )}
    </div>
  );
}
