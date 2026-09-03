/** WP17 · /clientes — solo los clientes donde participo. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listClientsFor, type Actor } from "@/lib/clients";
import { coverage } from "@/lib/client-graph";
import { FOUNDER_WALLET } from "@/lib/config";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

const COLOR_ESTADO: Record<string, string> = {
  activo: "text-primary border-primary/40 bg-glow",
  pausado: "text-amber-300 border-amber-700/40 bg-amber-950/20",
  prospecto: "text-muted border-line",
};

export default async function ClientesPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const actor: Actor = { wallet: session.wallet, isFounder: session.wallet === FOUNDER_WALLET };
  const db = getDb();
  const clientes = listClientsFor(db, actor);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-head text-3xl font-bold text-white">Clientes</h1>
      <p className="mb-8 mt-1 text-sm text-muted">
        Solo aparecen los clientes donde participas. La participación define el permiso.
      </p>

      {clientes.length === 0 ? (
        <EmptyState
          title="No participas en ningún cliente"
          message="Cuando te sumen al equipo de un cliente, su espacio aparecerá aquí."
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {clientes.map((c) => {
            const cob = coverage(db, c.id);
            return (
              <li key={c.id}>
                <Link href={`/clientes/${c.slug}`} className="card card-hover block p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-head text-xl font-bold text-white">{c.name}</h2>
                    <span className={`tag shrink-0 ${COLOR_ESTADO[c.status] ?? ""}`}>{c.status}</span>
                  </div>
                  {c.industry ? <p className="mt-1 text-sm text-muted">{c.industry}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-4 text-xs">
                    <span className="text-faint">
                      <strong className="text-primary">{cob.total}</strong> nodos
                    </span>
                    <span className="text-faint">
                      <strong className="text-primary">{cob.pctVerified}%</strong> verificado
                    </span>
                    {cob.busFactorCritical > 0 ? (
                      <span className="text-red-300">{cob.busFactorCritical} con bus factor ≤1</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
