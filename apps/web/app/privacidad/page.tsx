import type { Metadata } from "next";
import Link from "next/link";
import { responsableTratamiento } from "@/lib/legal";
import { AVISO_PRIVACIDAD, AVISO_PRIVACIDAD_VERSION } from "@/lib/aviso-privacidad";
import { avisoVigente } from "@/lib/consentimiento";

// El responsable y su contacto salen de la configuración del despliegue: se leen
// en cada visita para no congelar en la build un valor que todavía no existe.
//
// Los textos viven en lib/aviso-privacidad.ts (hallazgo A3): cada solicitud de los
// formularios guarda la versión y la huella de ESE texto como prueba de la autorización,
// así que esta página pinta exactamente lo que se resume en la huella.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacidad", // el layout le añade "· Zelena"
  description:
    "Aviso de tratamiento de datos de Zelena: qué datos guardamos, para qué, qué no hacemos y cómo ejerces tus derechos.",
};

const ENLACE = "text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary";

function Lista({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex flex-col">
      {items.map((t, i) => (
        <li
          key={t}
          className={`py-4 text-base leading-7 text-muted ${i === 0 ? "border-t border-primary" : "border-t border-line"} ${
            i === items.length - 1 ? "border-b border-line" : ""
          }`}
        >
          {t}
        </li>
      ))}
    </ul>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
      <h2 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-3xl">
        {titulo}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Cambia las `{marcas}` del texto por nodos (enlaces, el responsable, el canal). */
function conMarcas(texto: string, marcas: Record<string, React.ReactNode>): React.ReactNode {
  return texto.split(/(\{\w+\})/).map((parte, i) => {
    const m = /^\{(\w+)\}$/.exec(parte);
    return m && m[1] in marcas ? <span key={i}>{marcas[m[1]]}</span> : parte;
  });
}

export default function Privacidad() {
  const { nombre, contacto } = responsableTratamiento();
  const { huella } = avisoVigente();
  const canal = contacto ? (
    <>
      escríbenos a{" "}
      <a href={`mailto:${contacto}`} className={ENLACE}>
        {contacto}
      </a>
    </>
  ) : (
    <>
      escríbenos por el{" "}
      <Link href="/empresas/contacto" className={ENLACE}>
        formulario de contacto
      </Link>
    </>
  );
  const marcas: Record<string, React.ReactNode> = {
    responsable: <span className="text-paper">{nombre}</span>,
    canal,
    contacto: (
      <Link href="/empresas/contacto" className={ENLACE}>
        contacto
      </Link>
    ),
    encuentros: (
      <Link href="/encuentros" className={ENLACE}>
        encuentros
      </Link>
    ),
  };
  const parrafo = (t: string) => (
    <p key={t} className="text-base leading-7 text-muted">
      {conMarcas(t, marcas)}
    </p>
  );

  return (
    <div className="space-y-20 md:space-y-24">
      {/* ===== APERTURA ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-14">
        <p className="label">Privacidad</p>
        <h1 className="max-w-4xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[68px] lg:leading-[1.08]">
          Tus datos, <em className="font-normal italic text-primary">en claro.</em>
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted lg:text-lg">{AVISO_PRIVACIDAD.intro}</p>
      </section>

      <Bloque titulo="Quién responde">{parrafo(AVISO_PRIVACIDAD.quienResponde)}</Bloque>

      <Bloque titulo="Qué datos">
        <Lista items={AVISO_PRIVACIDAD.queDatos} />
      </Bloque>

      <Bloque titulo="Para qué">
        <Lista items={AVISO_PRIVACIDAD.paraQue} />
      </Bloque>

      <Bloque titulo="Lo que no hacemos">
        <Lista items={AVISO_PRIVACIDAD.noHacemos} />
      </Bloque>

      <Bloque titulo="Tus derechos">{AVISO_PRIVACIDAD.derechos.map(parrafo)}</Bloque>

      <Bloque titulo="Tu autorización">
        {AVISO_PRIVACIDAD.autorizacion.map(parrafo)}
        <p className="break-all font-mono text-[11px] leading-5 text-faint">
          Versión de este aviso: {AVISO_PRIVACIDAD_VERSION} · huella (SHA-256): {huella}
        </p>
      </Bloque>
    </div>
  );
}
