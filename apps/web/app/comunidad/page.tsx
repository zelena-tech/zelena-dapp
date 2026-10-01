import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getActiveGenome } from "@/lib/genome";
import { listAcademia } from "@/lib/repo";
import { fechaLarga, proximosEncuentros } from "@/lib/encuentros";
import { huellaCorta } from "@/lib/agora-labels";
import { EXPLORADOR_TX } from "@/lib/pruebas-testnet";
import { actorDeRitos, asistenciaPropia, decisionesPublicas, detalleRito, ritosPublicos, zonaRitos } from "@/lib/ritos";
import {
  AUDIENCIA_LABEL,
  ESTADO_RITO_LABEL,
  RITE_KINDS,
  RITE_LABEL,
  cadenciaValida,
  cuandoRito,
  duracionTexto,
  fechaRito,
  horaRito,
  zonaTexto,
} from "@/lib/ritos-labels";

// Ritos, asistencia propia y decisiones se leen en cada visita.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Comunidad", // el layout le añade "· Zelena"
  description: "Ritos cortos y fijos, encuentros abiertos y una Academia para aprender haciendo. Nadie construye solo.",
};

const TITULAR_H2 =
  "font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl";
const ENLACE = "text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary";

/** Los primeros 16 caracteres de una huella, para no ocupar media pantalla. */
function corta(huella: string): string {
  return huella.length > 16 ? `${huella.slice(0, 16)}…` : huella;
}

function veces(n: number, una: string, varias: string): string {
  return n === 1 ? `1 ${una}` : `${n} ${varias}`;
}

/**
 * /comunidad (WP31-D, copy de §8.4). Pública: ritos (con su lugar; el enlace de
 * conexión solo con sesión), encuentros, Academia y las decisiones más recientes.
 * Sin listas de personas: de cada rito pasado solo se dice cuántas asistieron.
 */
export default async function ComunidadPage() {
  const db = getDb();
  const session = await getSession();
  // El enlace de conexión, solo a una cuenta ACTIVA (la fila manda, no basta la cookie).
  const actor = session ? actorDeRitos(db, session.wallet) : null;
  const genoma = getActiveGenome(db);
  const tz = zonaRitos(db);
  const { proximos, pasados } = ritosPublicos(db);
  const enlaces = new Map<number, string>();
  if (session && actor) {
    for (const p of proximos) {
      if (p.sessionId && p.conEnlace) {
        const url = detalleRito(db, p.sessionId, true, session.wallet)?.join_url;
        if (url) enlaces.set(p.sessionId, url);
      }
    }
  }
  const encuentros = proximosEncuentros().slice(0, 2);
  const academia = listAcademia().slice(0, 3);
  const decisiones = decisionesPublicas(db, 3);
  const asistencia = session ? asistenciaPropia(db, session.wallet) : null;

  return (
    <div className="space-y-20 md:space-y-28">
      {/* ===== APERTURA ===== */}
      <header className="flex flex-col gap-8 pt-6 md:pt-14">
        <p className="label">Comunidad</p>
        <h1 className="max-w-4xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[76px] lg:leading-[1.08]">
          Nadie construye solo.
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted lg:text-lg">
          Ritos cortos y fijos, encuentros abiertos y una Academia para aprender haciendo.
        </p>
        {asistencia ? (
          <p className="max-w-2xl font-serif text-xl normal-case italic leading-snug text-primary">
            Has estado en {veces(asistencia.total, "rito", "ritos")}. Esta temporada: {asistencia.estaEpoca}.
          </p>
        ) : null}
      </header>

      {/* ===== LOS RITOS ===== */}
      <section className="space-y-10" aria-labelledby="ritos">
        <div className="space-y-4">
          <h2 id="ritos" className={TITULAR_H2}>
            Los ritos
          </h2>
          <p className="max-w-2xl font-serif text-xl normal-case italic leading-snug text-primary">
            Estar es suficiente. Faltar no resta nada.
          </p>
        </div>
        <ol className="flex flex-col">
          {RITE_KINDS.map((k, i) => {
            const cad = genoma.RITES_CADENCE?.[k];
            const valida = cadenciaValida(cad) ? cad : null; // una cadencia mal escrita no pinta datos falsos
            const cuando = cuandoRito(valida);
            const r = RITE_LABEL[k];
            return (
              <li
                key={k}
                className={`grid gap-3 py-7 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-baseline md:gap-10 ${
                  i === 0 ? "border-t border-primary" : "border-t border-line"
                } ${i === RITE_KINDS.length - 1 ? "border-b border-line" : ""}`}
              >
                <div className="flex flex-col gap-1">
                  <h3 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper">
                    {r.nombre}
                  </h3>
                  <p className="text-[13px] text-muted">
                    {valida ? `${duracionTexto(valida.duracion_min)} · ${cuando} (${zonaTexto(tz)})` : null}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="max-w-xl text-base leading-7 text-paper">{r.descripcion}</p>
                  <p className="text-sm text-muted">{AUDIENCIA_LABEL[r.audiencia]}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ===== CÓMO PARTICIPAR ===== */}
      <section className="space-y-4" aria-labelledby="participar">
        <h2 id="participar" className={TITULAR_H2}>
          Cómo participar
        </h2>
        <p className="max-w-2xl text-base leading-8 text-muted">
          La entrada es por invitación. El camino más corto: ven a una demo abierta o a un{" "}
          <Link href="/encuentros" className={ENLACE}>
            encuentro
          </Link>
          .
        </p>
      </section>

      {/* ===== PRÓXIMOS ===== */}
      <section id="proximos" className="space-y-8" aria-labelledby="proximos-titulo">
        <h2 id="proximos-titulo" className={TITULAR_H2}>
          Próximos
        </h2>
        {proximos.length === 0 ? (
          <p className="text-base leading-7 text-muted">Aún no hay ritos abiertos a la comunidad en el calendario.</p>
        ) : (
          <ol className="flex flex-col">
            {proximos.map((p, i) => {
              const url = p.sessionId ? enlaces.get(p.sessionId) : undefined;
              return (
                <li
                  key={`${p.kind}-${p.inicio.toISOString()}`}
                  className={`flex flex-col gap-2 py-6 ${i === 0 ? "border-t border-primary" : "border-t border-line"}`}
                >
                  <p className="font-serif text-2xl font-normal normal-case leading-snug text-paper">
                    {RITE_LABEL[p.kind].nombre}: {fechaRito(p.inicio, tz)}, {horaRito(p.inicio, tz)}
                  </p>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                    <span>{duracionTexto(p.duracionMin)}</span>
                    <span>{zonaTexto(tz)}</span>
                    {p.state ? <span>{ESTADO_RITO_LABEL[p.state] ?? p.state}</span> : null}
                    {p.lugar ? <span>{p.lugar}</span> : null}
                  </p>
                  <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    {p.conEnlace ? (
                      url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className={ENLACE}>
                          Enlace para conectarte
                        </a>
                      ) : (
                        <Link href="/entrar" className={ENLACE}>
                          Entra para ver el enlace.
                        </Link>
                      )
                    ) : null}
                    {p.sessionId ? (
                      <Link href={`/comunidad/ritos/${p.sessionId}`} className={ENLACE}>
                        {p.state === "Open" ? "Registrar mi asistencia" : "Ver el rito"}
                      </Link>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ===== PASADOS ===== */}
      <section className="space-y-8" aria-labelledby="pasados">
        <h2 id="pasados" className={TITULAR_H2}>
          Pasados
        </h2>
        {pasados.length === 0 ? (
          <p className="text-base leading-7 text-muted">Todavía no se ha cerrado ningún rito.</p>
        ) : (
          <ol className="flex flex-col">
            {pasados.map((r, i) => {
              const inicio = new Date(r.scheduledFor);
              return (
                <li key={r.id} className={`flex flex-col gap-2 py-6 ${i === 0 ? "border-t border-primary" : "border-t border-line"}`}>
                  <Link href={`/comunidad/ritos/${r.id}`} className="font-serif text-2xl font-normal normal-case leading-snug text-paper hover:text-primary">
                    {RITE_LABEL[r.kind].nombre}: {fechaRito(inicio, tz)}
                  </Link>
                  <p className="text-[13px] text-muted">{veces(r.asistentes, "asistente", "asistentes")}</p>
                  {r.summary ? <p className="max-w-2xl text-base leading-7 text-muted">{r.summary}</p> : null}
                  <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                    {r.notesUrl ? (
                      <a href={r.notesUrl} target="_blank" rel="noopener noreferrer" className={ENLACE}>
                        Acta
                      </a>
                    ) : null}
                    {r.txId ? (
                      <a href={`${EXPLORADOR_TX}${r.txId}`} target="_blank" rel="noopener noreferrer" className={ENLACE}>
                        Ver la huella en la red de pruebas
                      </a>
                    ) : r.huella ? (
                      <span className="text-faint">huella: {corta(r.huella)}</span>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ===== ENCUENTROS ===== */}
      <section className="space-y-6" aria-labelledby="encuentros">
        <h2 id="encuentros" className={TITULAR_H2}>
          Encuentros
        </h2>
        {encuentros.length === 0 ? (
          <p className="max-w-2xl text-base leading-7 text-muted">
            Estamos preparando la primera fecha.{" "}
            <Link href="/encuentros" className={ENLACE}>
              Déjanos tu correo y te avisamos
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {encuentros.map((e) => (
              <li key={e.slug}>
                <Link href="/encuentros#proximos" className="group flex flex-col gap-1">
                  <span className="font-serif text-2xl normal-case leading-snug text-paper group-hover:text-primary">{e.titulo}</span>
                  <span className="text-sm text-muted">
                    {e.ciudad} · {fechaLarga(e.fecha)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== ACADEMIA ===== */}
      <section className="space-y-6" aria-labelledby="academia">
        <h2 id="academia" className={TITULAR_H2}>
          Aprende haciendo
        </h2>
        {academia.length === 0 ? (
          <p className="text-base leading-7 text-muted">La Academia se está preparando.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-3">
            {academia.map((c) => (
              <li key={c.id}>
                <Link href={`/academia/${c.slug}`} className="card card-hover flex h-full flex-col gap-2 p-5">
                  <span className="font-serif text-xl normal-case leading-snug text-paper">{c.title}</span>
                  <span className="text-sm text-muted">{c.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/academia" className={`${ENLACE} text-sm`}>
          Ir a la Academia
        </Link>
      </section>

      {/* ===== DECISIONES ===== */}
      <section className="space-y-6" aria-labelledby="decisiones">
        <h2 id="decisiones" className={TITULAR_H2}>
          Lo último que decidimos
        </h2>
        {decisiones.length === 0 ? (
          <p className="text-base leading-7 text-muted">Todavía no hay decisiones publicadas.</p>
        ) : (
          <ol className="flex flex-col">
            {decisiones.map((d, i) => (
              <li key={d.id} className={`flex flex-col gap-2 py-5 ${i === 0 ? "border-t border-primary" : "border-t border-line"}`}>
                <p className="text-[13px] text-muted">{d.date}</p>
                <p className="font-serif text-xl normal-case leading-snug text-paper">{d.title}</p>
                <p className="max-w-3xl text-sm leading-6 text-muted">{d.reason}</p>
                <p className="text-xs text-faint">huella: {huellaCorta(d)}</p>
              </li>
            ))}
          </ol>
        )}
        <Link href="/gobernanza" className={`${ENLACE} text-sm`}>
          Ver todas las decisiones
        </Link>
      </section>
    </div>
  );
}
