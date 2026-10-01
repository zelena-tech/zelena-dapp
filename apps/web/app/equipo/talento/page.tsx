/**
 * `/equipo/talento` — directorio de talento (WP31-A2, spec §4.A.7 y §8.5).
 *
 * Las personas y sus roles son DATOS: aquí se cambia el rol (core ↔ contributor),
 * la supervisión y el vínculo de una fila del roster con la cuenta real. Lo ven el
 * founder y los supervisores; las acciones son solo del founder (`adminActor` en la
 * ruta, y aquí `rolPuedeAdministrar` para no pintarlas a quien no puede usarlas).
 *
 * Puerta propia (el layout no es la puerta, spec §5.A.2): equipo interno resuelto
 * contra la base, con la cuenta activa (`cuentaActiva`: `equipoInternoActor` no mira
 * el estado) y, además, `puedeVerTodoElEquipo`.
 *
 * Doc 16: la carga abierta sirve para repartir trabajo, no para evaluar. El orden es
 * alfabético; no hay posiciones, puntos ni comparaciones entre personas.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoInternoActor, rolPuedeAdministrar } from "@/lib/authz";
import { PENDING_PREFIX, ROLE_LABEL, puedeVerTodoElEquipo } from "@/lib/roles";
import { mismaPersona } from "@/lib/identidades";
import { candidatosAVincular, cuentaActiva, directorioTalento } from "@/lib/talento";
import TeamTalentRow, { type PersonaTalento } from "@/components/TeamTalentRow";
import TeamImportCsv from "@/components/TeamImportCsv";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const FILTROS: Array<{ valor: "interno" | "externo" | null; label: string }> = [
  { valor: null, label: "Todas" },
  { valor: "interno", label: "Interno" },
  { valor: "externo", label: "Externo" },
];

function SinAcceso() {
  return (
    <div className="space-y-6">
      <h1 className="font-head text-4xl font-bold text-white">Talento</h1>
      <div className="card p-6">
        <p className="text-sm text-muted">
          El directorio de talento es para el founder y los supervisores: sirve para repartir el trabajo y dar
          acceso a los proyectos, no para evaluar a nadie. Tu vista es tu día, con tus entregas.
        </p>
        <Link href="/equipo/hoy" className="btn btn-primary mt-5">
          Ir a tu día
        </Link>
      </div>
    </div>
  );
}

export default async function EquipoTalentoPage({ searchParams }: { searchParams: { vinculo?: string } }) {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const db = getDb();
  const actor = equipoInternoActor(session, db);
  // Una cuenta dada de baja no ve el directorio aunque conserve su rol (la puerta mira el estado).
  if (!actor || !cuentaActiva(db, actor.wallet)) redirect("/perfil");
  if (!puedeVerTodoElEquipo({ role: actor.role, isSupervisor: actor.isSupervisor })) return <SinAcceso />;

  const filtro = searchParams.vinculo === "interno" || searchParams.vinculo === "externo" ? searchParams.vinculo : null;
  const personas = directorioTalento(db, filtro ? { vinculo: filtro } : undefined);
  const esFounder = rolPuedeAdministrar(actor.role);

  const filas = personas.map((p) => {
    const slug = p.pendiente ? p.wallet.slice(PENDING_PREFIX.length) : null;
    const persona: PersonaTalento = {
      wallet: p.wallet,
      nombre: p.nombre,
      role: p.role,
      rolLabel: ROLE_LABEL[p.role],
      isSupervisor: p.isSupervisor,
      status: p.status,
      pendiente: p.pendiente,
      tieneCla: p.tieneCla,
      vinculo: p.vinculo,
      abiertas: p.abiertas,
      slug,
      membresias: p.membresias.map((m) => ({ slug: m.slug, nombre: m.nombre, roles: m.roles })),
    };
    const editable = esFounder && p.role !== "founder" && !mismaPersona(db, actor.wallet, p.wallet);
    const vinculable = esFounder && slug !== null;
    return { persona, editable, vinculable, candidatos: vinculable && slug ? candidatosAVincular(db, slug, actor.wallet) : [] };
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-4xl font-bold text-white">Talento</h1>
          <p className="mt-1 text-sm text-muted">
            Las personas y sus roles son datos: se cambian aquí, no en el código.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/equipo/proyectos" className="btn btn-ghost py-1.5">
            Proyectos
          </Link>
          <Link href="/equipo/hoy" className="btn btn-ghost py-1.5">
            Volver a tu día
          </Link>
        </div>
      </header>

      <div>
        <nav className="flex flex-wrap gap-2" aria-label="Filtro por vínculo">
          {FILTROS.map((f) => (
            <Link
              key={f.label}
              href={f.valor ? `/equipo/talento?vinculo=${f.valor}` : "/equipo/talento"}
              className={`btn py-1.5 text-sm ${filtro === f.valor ? "btn-primary" : "btn-ghost"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2 text-xs text-faint">
          {"«Abiertas» es la carga de cada persona para repartir el trabajo, no una evaluación."}
          {esFounder ? null : " Los cambios de rol, supervisión y vínculo los hace el founder."}
        </p>
      </div>

      {filas.length === 0 ? (
        <EmptyState
          title="Nadie con este filtro"
          message="Cuando alguien entre a un proyecto con este vínculo aparecerá aquí."
          cta={{ href: "/equipo/talento", label: "Ver todas" }}
        />
      ) : (
        <ul className="space-y-4">
          {filas.map((f) => (
            <TeamTalentRow
              key={f.persona.wallet}
              persona={f.persona}
              editable={f.editable}
              vinculable={f.vinculable}
              candidatos={f.candidatos}
            />
          ))}
        </ul>
      )}

      {/* Importar backlog (founder y supervisores; la página ya lo exige). /equipo/proyectos lo enlaza. */}
      <section id="importar" className="scroll-mt-24 space-y-3">
        <h2 className="font-head text-2xl font-bold text-white">Importar CSV</h2>
        <TeamImportCsv />
      </section>
    </div>
  );
}
