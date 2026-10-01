import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  COPY_ASISTENCIA,
  actorDeRitos,
  detalleRito,
  estadoAsistencia,
  margenVentanaMin,
  puedePresentarRito,
  rotacionCodigoS,
  zonaRitos,
} from "@/lib/ritos";
import {
  AUDIENCIA_LABEL,
  ESTADO_RITO_LABEL,
  RITE_LABEL,
  dentroDeVentana,
  duracionTexto,
  fechaRito,
  horaRito,
  margenTexto,
  personasRegistradas,
  ventanaRito,
  zonaTexto,
} from "@/lib/ritos-labels";
import RitoCodigo from "@/components/RitoCodigo";
import RitoAsistenciaForm from "@/components/RitoAsistenciaForm";
import RitoAnfitrionAcciones from "@/components/RitoAnfitrionAcciones";

// El estado del rito (y el código) cambia minuto a minuto.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rito", // el layout le añade "· Zelena"
  description: "Un rito de la comunidad: cuándo es, dónde y cómo registrar tu asistencia.",
};

const ENLACE = "text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary";

/**
 * /comunidad/ritos/[id] (WP31-D). Vista pública del rito; con sesión, el enlace para
 * conectarse y el registro de asistencia; para quien presenta (anfitrión, founder o
 * supervisor), abrir, cerrar y el código rotativo con el CONTEO de registrados.
 */
export default async function RitoPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const db = getDb();
  const session = await getSession();
  // La fila manda, no la cookie: una cuenta inactiva con el JWT vigente no ve el
  // enlace, y el del sync solo lo recibe quien pasa la puerta de su asistencia.
  const actor = session ? actorDeRitos(db, session.wallet) : null;
  const rito = session ? detalleRito(db, id, !!actor, session.wallet) : detalleRito(db, id, false);
  if (!rito) notFound();

  const tz = zonaRitos(db);
  const margen = margenVentanaMin(db);
  const ahora = new Date();
  const inicio = new Date(rito.scheduled_for);
  const enVentana = dentroDeVentana(ahora, ventanaRito(inicio, rito.duration_min, margen));
  const abierto = rito.state === "Open" && enVentana;
  const presenta = actor ? puedePresentarRito(db, actor, id) : false;
  const asistencia = session && abierto ? estadoAsistencia(db, session.wallet, id, ahora) : null;
  const label = RITE_LABEL[rito.kind];

  return (
    <div className="space-y-14 md:space-y-20">
      <header className="flex flex-col gap-6 pt-6 md:pt-14">
        <p className="label">
          <Link href="/comunidad" className="hover:text-primary">
            Comunidad
          </Link>{" "}
          · Rito
        </p>
        <h1 className="max-w-4xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl lg:text-[64px] lg:leading-[1.08]">
          {label.nombre}
        </h1>
        <p className="font-serif text-2xl normal-case italic leading-snug text-primary">
          {fechaRito(inicio, tz)}, {horaRito(inicio, tz)} · {duracionTexto(rito.duration_min)}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          <span>{ESTADO_RITO_LABEL[rito.state] ?? rito.state}</span>
          <span>{zonaTexto(tz)}</span>
          {rito.lugar ? <span>{rito.lugar}</span> : null}
        </p>
        <p className="max-w-2xl text-base leading-8 text-muted">
          {label.descripcion} {AUDIENCIA_LABEL[label.audiencia]}
        </p>
        {rito.conEnlace && rito.state !== "Closed" ? (
          rito.join_url ? (
            <a href={rito.join_url} target="_blank" rel="noopener noreferrer" className={`${ENLACE} text-base`}>
              Enlace para conectarte
            </a>
          ) : !actor ? (
            <Link href="/entrar" className={`${ENLACE} text-base`}>
              Entra para ver el enlace.
            </Link>
          ) : null
        ) : null}
      </header>

      {/* ===== QUIEN PRESENTA ===== */}
      {presenta && rito.state !== "Closed" ? (
        <section className="flex flex-col gap-6" aria-label="Quien presenta">
          {rito.state === "Open" && enVentana ? <RitoCodigo sessionId={id} rotacionS={rotacionCodigoS(db)} /> : null}
          {rito.state === "Open" && !enVentana ? (
            <p className="text-base text-muted">La ventana de este rito ya pasó. Ciérralo cuando quieras.</p>
          ) : null}
          <RitoAnfitrionAcciones sessionId={id} state={rito.state} margen={margenTexto(margen)} />
        </section>
      ) : null}

      {/* ===== ASISTENCIA ===== */}
      {rito.state === "Closed" ? (
        <section className="flex flex-col gap-3 border-t border-line pt-7">
          <p className="label">Cerrado</p>
          <p className="text-base text-paper">{personasRegistradas(rito.asistentes)}</p>
          {rito.summary ? <p className="max-w-2xl text-base leading-7 text-muted">{rito.summary}</p> : null}
          {rito.notes_url ? (
            <a href={rito.notes_url} target="_blank" rel="noopener noreferrer" className={`${ENLACE} text-sm`}>
              Acta
            </a>
          ) : null}
        </section>
      ) : !abierto ? (
        <p className="border-t border-line pt-7 text-base text-muted">{COPY_ASISTENCIA.noAbierto}</p>
      ) : !session ? (
        <p className="border-t border-line pt-7 text-base text-muted">
          <Link href="/entrar" className={ENLACE}>
            {COPY_ASISTENCIA.sinSesion}
          </Link>
        </p>
      ) : asistencia?.puede ? (
        <RitoAsistenciaForm sessionId={id} />
      ) : (
        <p className="border-t border-line pt-7 text-base text-muted">
          {asistencia?.mensaje === COPY_ASISTENCIA.sinAcuerdo ? (
            <Link href="/entrar" className={ENLACE}>
              {COPY_ASISTENCIA.sinAcuerdo}
            </Link>
          ) : (
            asistencia?.mensaje ?? COPY_ASISTENCIA.noAbierto
          )}
        </p>
      )}

      <p className="text-sm text-faint">Estar es suficiente. Faltar no resta nada.</p>
    </div>
  );
}
