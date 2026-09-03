/**
 * WP17 + WP20 · /clientes/[slug] — el entorno de un cliente.
 *
 * Pestañas: Operación (el grafo) · Backlog · Marca · Accesos · Equipo.
 *
 * SEGURIDAD: si quien pide no participa en este cliente, se responde 404 —
 * nunca 403. Revelar que el cliente existe ya es filtrar información.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  getClientForActor,
  accessLevelFor,
  hasAtLeast,
  listMembers,
  listBrandAssets,
  listCredentials,
  type Actor,
} from "@/lib/clients";
import { listNodes, getNode, coverage, exposureMap, coverageHistory } from "@/lib/client-graph";
import { listBacklog } from "@/lib/assignments";
import { FOUNDER_WALLET } from "@/lib/config";
import { EmptyState, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

const PESTANAS = [
  { id: "operacion", label: "Operación" },
  { id: "backlog", label: "Backlog" },
  { id: "marca", label: "Marca" },
  { id: "accesos", label: "Accesos" },
  { id: "equipo", label: "Equipo" },
] as const;

const COLOR_CONFIANZA: Record<string, string> = {
  verificado: "text-primary border-primary/40 bg-glow",
  declarado: "text-amber-300 border-amber-700/40 bg-amber-950/20",
  inferido: "text-muted border-line",
  sospechoso: "text-red-300 border-red-700/40 bg-red-950/20",
};

const ETIQUETA_ARISTA: Record<string, string> = {
  pertenece_a: "pertenece a",
  varia_de: "varía de",
  depende_de: "depende de",
  implementado_en: "implementado en",
  ejecutado_por: "ejecutado por",
  usa_credencial: "usa credencial",
  bloquea: "bloquea",
  documentado_en: "documentado en",
  reemplaza: "reemplaza",
  sincroniza_con: "sincroniza con",
};

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { tab?: string; nodo?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/entrar");

  const actor: Actor = { wallet: session.wallet, isFounder: session.wallet === FOUNDER_WALLET };
  const db = getDb();

  // getClientForActor devuelve null tanto si el cliente no existe como si el
  // actor no participa. Las dos rutas terminan en el mismo 404, a propósito.
  const cliente = getClientForActor(db, params.slug, actor);
  if (!cliente) notFound();

  const nivel = accessLevelFor(db, cliente.id, actor)!;
  const puedeVerAccesos = hasAtLeast(nivel, "colaborador");
  const tab = PESTANAS.some((p) => p.id === searchParams.tab) ? searchParams.tab! : "operacion";
  const cob = coverage(db, cliente.id);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/clientes" className="text-xs text-muted hover:text-primary">
        ← Clientes
      </Link>

      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-head text-3xl font-bold text-white">{cliente.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {cliente.status}
            {cliente.industry ? ` · ${cliente.industry}` : ""} · tu nivel: {nivel}
          </p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Nodos del grafo" value={cob.total} />
        <StatCard
          label="Conocimiento verificado"
          value={`${cob.pctVerified}%`}
          hint="comprobado contra el sistema"
        />
        <StatCard label="Preguntas abiertas" value={cob.openQuestions} hint="lo que aún no sabemos" />
        <StatCard label="Bus factor ≤ 1" value={cob.busFactorCritical} hint="piezas con un solo dueño" />
      </div>

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-line/60">
        {PESTANAS.filter((p) => p.id !== "accesos" || puedeVerAccesos).map((p) => (
          <Link
            key={p.id}
            href={`/clientes/${cliente.slug}?tab=${p.id}`}
            className={`rounded-t-md px-4 py-2 text-sm transition-colors ${
              tab === p.id ? "border-b-2 border-primary text-primary" : "text-muted hover:text-white"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      {tab === "operacion" ? (
        <OperacionTab clientId={cliente.id} slug={cliente.slug} actor={actor} nodoId={searchParams.nodo} />
      ) : null}
      {tab === "backlog" ? <BacklogTab clientId={cliente.id} /> : null}
      {tab === "marca" ? <MarcaTab clientId={cliente.id} actor={actor} /> : null}
      {tab === "accesos" && puedeVerAccesos ? <AccesosTab clientId={cliente.id} actor={actor} /> : null}
      {tab === "equipo" ? <EquipoTab clientId={cliente.id} /> : null}
    </main>
  );
}

// ─── Operación: el grafo ─────────────────────────────────────────────────

function OperacionTab({
  clientId,
  slug,
  actor,
  nodoId,
}: {
  clientId: number;
  slug: string;
  actor: Actor;
  nodoId?: string;
}) {
  const db = getDb();
  const nodos = listNodes(db, clientId, actor);

  if (nodos.length === 0) {
    return (
      <EmptyState
        title="Sin grafo de operación todavía"
        message="El grafo vive en el repositorio privado zelena-ops. Genera grafo.json con construir_grafo.py e impórtalo para ver aquí los procesos, variantes y sistemas del cliente."
      />
    );
  }

  const detalle = nodoId ? getNode(db, clientId, nodoId, actor) : null;
  const porTipo = new Map<string, typeof nodos>();
  for (const n of nodos) porTipo.set(n.kind, [...(porTipo.get(n.kind) ?? []), n]);
  const exposicion = exposureMap(db, clientId, actor);
  const historia = coverageHistory(db, clientId);

  if (detalle) {
    const n = detalle.node;
    return (
      <div>
        <Link href={`/clientes/${slug}?tab=operacion`} className="text-xs text-muted hover:text-primary">
          ← Todo el grafo
        </Link>
        <div className="card mt-3 p-6">
          <div className="text-xs uppercase tracking-widest text-faint">{n.kind}</div>
          <h2 className="mt-1 font-head text-2xl font-bold text-white">{n.name}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`tag ${COLOR_CONFIANZA[n.confidence] ?? ""}`}>{n.confidence}</span>
            <span className="tag border-line text-muted">{n.state}</span>
            {n.criticality ? <span className="tag border-line text-muted">criticidad {n.criticality}</span> : null}
            {n.busFactor !== null ? (
              <span className={`tag ${n.busFactor <= 1 ? "border-red-700/40 text-red-300" : "border-line text-muted"}`}>
                bus factor {n.busFactor}
              </span>
            ) : null}
          </div>

          {n.confidence !== "verificado" ? (
            <p className="mt-4 rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-sm text-amber-200">
              Este nodo no está verificado contra el sistema. Fuente: {n.source ?? "sin registrar"}.
            </p>
          ) : null}

          <Seccion titulo="Qué es" texto={n.whatIs} />
          <Seccion titulo="Cómo funciona" texto={n.howItWorks} />
          <Seccion titulo="Reglas de negocio" texto={n.businessRules} />
          <Seccion titulo="Detalle técnico" texto={n.techDetail} mono />
          <Seccion titulo={`Preguntas abiertas (${n.openCount})`} texto={n.openQuestions} />

          <Vecinos titulo="Depende de / apunta a" items={detalle.outgoing} slug={slug} />
          <Vecinos titulo="Lo referencian" items={detalle.incoming} slug={slug} />

          <div className="mt-6 border-t border-line/60 pt-3 text-xs text-faint">
            Fuente de verdad: <code className="text-muted">zelena-ops/{n.sourcePath}</code>
            {n.verifiedAt ? ` · verificado el ${n.verifiedAt}` : null}
            <br />
            Para editar este nodo se abre un PR en zelena-ops. La dapp no escribe el grafo.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {historia.length > 1 ? (
        <div className="card p-5">
          <div className="mb-3 text-xs uppercase tracking-widest text-faint">Evolución del conocimiento</div>
          <div className="flex flex-wrap items-end gap-4">
            {historia.slice(-8).map((h, i) => (
              <div key={i} className="text-center">
                <div className="font-head text-xl font-bold text-primary">{h.pct_verified}%</div>
                <div className="text-xs text-faint">{h.generated_at}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {[...porTipo.entries()].map(([tipo, lista]) => (
        <section key={tipo}>
          <h3 className="mb-2 font-head text-lg font-bold text-white">
            {tipo} <span className="text-sm font-normal text-faint">({lista.length})</span>
          </h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {lista.map((n) => (
              <li key={n.nodeId}>
                <Link
                  href={`/clientes/${slug}?tab=operacion&nodo=${encodeURIComponent(n.nodeId)}`}
                  className="card card-hover block p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-white">{n.name}</span>
                    <span className={`tag shrink-0 ${COLOR_CONFIANZA[n.confidence] ?? ""}`}>{n.confidence}</span>
                  </div>
                  {n.whatIs ? <p className="mt-1 line-clamp-2 text-sm text-muted">{n.whatIs}</p> : null}
                  {n.openCount > 0 ? (
                    <div className="mt-2 text-xs text-amber-300">{n.openCount} preguntas abiertas</div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {exposicion.length > 0 ? (
        <section>
          <h3 className="mb-2 font-head text-lg font-bold text-white">Mapa de exposición</h3>
          <p className="mb-3 text-sm text-muted">
            De quién depende cada pieza crítica. Es información de riesgo organizacional, no una
            evaluación de personas.
          </p>
          <ul className="space-y-2">
            {exposicion.map((g) => (
              <li key={g.persona} className="card p-4">
                <div className="flex items-center justify-between">
                  <span className="text-white">{g.persona}</span>
                  <span className="tag border-red-700/40 text-red-300">{g.total} piezas</span>
                </div>
                <div className="mt-1 text-xs text-faint">{g.nodos.map((n) => n.name).join(" · ")}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Seccion({ titulo, texto, mono }: { titulo: string; texto: string | null; mono?: boolean }) {
  if (!texto) return null;
  return (
    <div className="mt-5">
      <div className="mb-1 text-xs uppercase tracking-widest text-faint">{titulo}</div>
      <div className={`whitespace-pre-wrap text-sm text-muted ${mono ? "font-mono text-xs" : ""}`}>{texto}</div>
    </div>
  );
}

function Vecinos({
  titulo,
  items,
  slug,
}: {
  titulo: string;
  items: Array<{ node: { nodeId: string; name: string }; kind: string }>;
  slug: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="mb-1 text-xs uppercase tracking-widest text-faint">{titulo}</div>
      <ul className="space-y-1">
        {items.map((v) => (
          <li key={`${v.kind}-${v.node.nodeId}`} className="text-sm">
            <Link
              href={`/clientes/${slug}?tab=operacion&nodo=${encodeURIComponent(v.node.nodeId)}`}
              className="text-white hover:text-primary"
            >
              {v.node.name}
            </Link>
            <span className="ml-2 text-xs text-faint">{ETIQUETA_ARISTA[v.kind] ?? v.kind}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Resto de pestañas ───────────────────────────────────────────────────

function BacklogTab({ clientId }: { clientId: number }) {
  const items = listBacklog(getDb(), { clientId });
  if (items.length === 0) {
    return <EmptyState title="Sin trabajo abierto" message="Las asignaciones de este cliente aparecerán aquí." />;
  }
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tag border-line text-muted">{a.status}</span>
            <span className="tag border-line text-muted">{a.priority}</span>
            <span className="text-white">{a.title}</span>
          </div>
          {a.blockedReason ? <p className="mt-1 text-sm text-red-300">Bloqueada: {a.blockedReason}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function MarcaTab({ clientId, actor }: { clientId: number; actor: Actor }) {
  const assets = listBrandAssets(getDb(), clientId, actor);
  if (assets.length === 0) {
    return <EmptyState title="Sin identidad visual registrada" message="Colores, logos y guía de marca van aquí." />;
  }
  const colores = assets.filter((a) => a.kind === "color");
  const otros = assets.filter((a) => a.kind !== "color");
  return (
    <div className="space-y-6">
      {colores.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {colores.map((c) => (
            <div key={c.id} className="card p-3 text-center">
              <div className="h-16 w-24 rounded border border-line" style={{ background: c.value ?? "#000" }} />
              <div className="mt-2 text-xs text-white">{c.label}</div>
              <code className="text-xs text-muted">{c.value}</code>
            </div>
          ))}
        </div>
      ) : null}
      {otros.map((a) => (
        <div key={a.id} className="card p-4">
          <div className="text-xs uppercase tracking-widest text-faint">{a.kind}</div>
          <div className="text-white">{a.label}</div>
          {a.fileUrl ? (
            <a href={a.fileUrl} className="text-sm text-primary hover:underline" target="_blank" rel="noreferrer">
              Abrir ↗
            </a>
          ) : null}
          {a.notes ? <p className="mt-1 text-sm text-muted">{a.notes}</p> : null}
        </div>
      ))}
    </div>
  );
}

function AccesosTab({ clientId, actor }: { clientId: number; actor: Actor }) {
  const creds = listCredentials(getDb(), clientId, actor);
  return (
    <div>
      <div className="card mb-4 border-primary/30 bg-glow/40 p-4 text-sm text-muted">
        Este inventario registra <strong className="text-white">dónde vive</strong> cada credencial y{" "}
        <strong className="text-white">quién responde</strong> por ella. Nunca su valor. Cada consulta a esta
        pestaña queda registrada.
      </div>
      {creds.length === 0 ? (
        <EmptyState title="Inventario vacío" message="Registra dónde vive cada credencial del cliente." />
      ) : (
        <ul className="space-y-2">
          {creds.map((c) => (
            <li key={c.id} className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-white">{c.name}</span>
                <span className="tag border-line text-muted">{c.type}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-muted">{c.location}</div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-faint">
                {c.scope ? <span>alcance: {c.scope}</span> : null}
                {c.ownerWallet ? <span>dueño: {c.ownerWallet}</span> : null}
                {c.expiresAt ? <span>vence: {c.expiresAt}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EquipoTab({ clientId }: { clientId: number }) {
  const miembros = listMembers(getDb(), clientId);
  return (
    <ul className="space-y-2">
      {miembros.map((m) => (
        <li key={m.wallet} className="card flex items-center justify-between p-4">
          <span className="text-white">{m.displayName}</span>
          <span className="tag border-line text-muted">{m.accessLevel}</span>
        </li>
      ))}
    </ul>
  );
}
