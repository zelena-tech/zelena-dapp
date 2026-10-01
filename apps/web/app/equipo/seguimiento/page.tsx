/**
 * Seguimiento de tareas por cliente y proyecto, con fechas límite.
 *
 * Responde la pregunta que ninguna pantalla respondía: qué está atrasado, de
 * qué cliente y de quién. El tablero por iniciativa ordena por prioridad y la
 * pantalla personal solo ve lo propio, así que un retraso en un cliente podía
 * pasar semanas sin que nadie lo viera.
 *
 * Los clientes se ordenan por tareas atrasadas, no alfabéticamente: lo urgente
 * va arriba solo.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FOUNDER_WALLET } from "@/lib/config";
import {
  seguimientoPorCliente,
  resumenSeguimiento,
  listInitiatives,
  actorDesdeWallet,
  type TareaSeguimiento,
} from "@/lib/assignments";
import { listClientsFor } from "@/lib/clients";
import { shortWallet, EmptyState } from "@/components/ui";
import NuevaAsignacion from "@/components/NuevaAsignacion";

export const dynamic = "force-dynamic";

export const metadata = { title: "Seguimiento" };

const SELLO_VENCIMIENTO: Record<string, { texto: (t: TareaSeguimiento) => string; clase: string }> = {
  atrasada: {
    texto: (t) => `${Math.abs(t.diasRestantes ?? 0)} ${Math.abs(t.diasRestantes ?? 0) === 1 ? "día" : "días"} tarde`,
    clase: "border-red-700/50 bg-red-950/30 text-red-300",
  },
  hoy: { texto: () => "vence hoy", clase: "border-amber-600/50 bg-amber-950/30 text-amber-300" },
  proxima: {
    texto: (t) => `en ${t.diasRestantes} ${t.diasRestantes === 1 ? "día" : "días"}`,
    clase: "border-primary/40 bg-glow text-primary",
  },
  a_tiempo: { texto: (t) => t.dueDate ?? "", clase: "border-line text-muted" },
  sin_fecha: { texto: () => "sin fecha", clase: "border-line text-faint" },
};

const COLOR_ESTADO: Record<string, string> = {
  Backlog: "text-muted border-line",
  Asignada: "text-amber-300 border-amber-700/40",
  "En curso": "text-primary border-primary/40",
  "En revisión": "text-sky-300 border-sky-700/40",
  Bloqueada: "text-red-300 border-red-700/40",
};

function Cifra({ valor, pie, alerta = false }: { valor: number; pie: string; alerta?: boolean }) {
  return (
    <div className={`card p-4 ${alerta && valor > 0 ? "border-red-700/50" : ""}`}>
      <div className={`font-head text-3xl font-bold ${alerta && valor > 0 ? "text-red-400" : "text-primary"}`}>
        {valor}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted">{pie}</div>
    </div>
  );
}

export default async function SeguimientoPage() {
  const session = await getSession();
  if (!session) redirect("/entrar?next=/equipo/seguimiento");

  const db = getDb();
  const esFundador = session.wallet === FOUNDER_WALLET;
  const actor = actorDesdeWallet(db, session.wallet, esFundador);
  const supervisa = actor.isFounder || actor.isSupervisor;

  const grupos = seguimientoPorCliente(db);
  const resumen = resumenSeguimiento(grupos);

  const clientes = supervisa
    ? listClientsFor(db, { wallet: session.wallet, isFounder: esFundador }).map((c) => ({ id: c.id, nombre: c.name }))
    : [];
  const iniciativas = supervisa ? listInitiatives(db).map((i) => ({ id: i.id, nombre: i.name })) : [];
  const personas = supervisa
    ? (db
        .prepare(`SELECT wallet, display_name FROM users WHERE status = 'active' ORDER BY display_name`)
        .all() as Array<{ wallet: string; display_name: string }>).map((u) => ({
        wallet: u.wallet,
        nombre: u.display_name || shortWallet(u.wallet),
      }))
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-3xl font-bold text-white">Seguimiento</h1>
          <p className="mt-1 text-sm text-muted">
            Qué está atrasado, de qué cliente y de quién. Ordenado por urgencia, no por nombre.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/equipo/hoy" className="btn btn-ghost py-1.5 text-sm">Lo mío de hoy</Link>
          <Link href="/equipo/proyectos" className="btn btn-ghost py-1.5 text-sm">Backlog</Link>
          {supervisa ? <NuevaAsignacion clientes={clientes} iniciativas={iniciativas} personas={personas} /> : null}
        </div>
      </div>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Cifra valor={resumen.atrasadas} pie="atrasadas" alerta />
        <Cifra valor={resumen.venceHoy} pie="vencen hoy" />
        <Cifra valor={resumen.total} pie="abiertas" />
        <Cifra valor={resumen.sinFecha} pie="sin fecha" />
        <Cifra valor={resumen.sinResponsable} pie="sin responsable" />
      </section>

      {grupos.length === 0 ? (
        <EmptyState
          title="No hay trabajo abierto"
          message={
            supervisa
              ? "Crea la primera tarea con el botón de arriba: elige cliente, proyecto, responsable y fecha límite."
              : "Cuando te asignen trabajo aparecerá aquí."
          }
        />
      ) : null}

      <div className="space-y-8">
        {grupos.map((cliente) => (
          <section key={String(cliente.clientId ?? "interno")} className="card p-5 md:p-6">
            <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
              <div className="flex items-baseline gap-3">
                <h2 className="font-head text-xl font-bold text-white">{cliente.clientName}</h2>
                <span className="text-xs text-faint">
                  {cliente.total} {cliente.total === 1 ? "tarea" : "tareas"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {cliente.atrasadas > 0 ? (
                  <span className="tag border-red-700/50 bg-red-950/30 text-red-300">
                    {cliente.atrasadas} atrasada{cliente.atrasadas === 1 ? "" : "s"}
                  </span>
                ) : null}
                {cliente.venceHoy > 0 ? (
                  <span className="tag border-amber-600/50 bg-amber-950/30 text-amber-300">
                    {cliente.venceHoy} vence{cliente.venceHoy === 1 ? "" : "n"} hoy
                  </span>
                ) : null}
                {cliente.sinResponsable > 0 ? (
                  <span className="tag border-line text-faint">{cliente.sinResponsable} sin responsable</span>
                ) : null}
              </div>
            </header>

            <div className="space-y-5">
              {cliente.proyectos.map((proyecto) => (
                <div key={String(proyecto.initiativeId ?? "sin-proyecto")}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="label mb-0">{proyecto.initiativeName}</span>
                    {proyecto.atrasadas > 0 ? (
                      <span className="text-xs text-red-400">· {proyecto.atrasadas} en rojo</span>
                    ) : null}
                  </div>

                  <ul className="divide-y divide-line/60 border-t border-line/60">
                    {proyecto.tareas.map((t) => {
                      const sello = SELLO_VENCIMIENTO[t.vencimiento];
                      return (
                        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                          <span className={`tag ${sello.clase}`}>{sello.texto(t)}</span>
                          <span className="flex-1 text-sm text-paper">{t.title}</span>
                          <span className={`tag ${COLOR_ESTADO[t.status] ?? "border-line text-muted"}`}>
                            {t.status}
                          </span>
                          <span className="text-xs text-muted">
                            {t.ownerWallet ? shortWallet(t.ownerWallet) : "sin responsable"}
                          </span>
                          {t.priority === "alta" ? (
                            <span className="text-xs font-bold text-amber-300">alta</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
