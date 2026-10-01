import type { Metadata } from "next";
import Link from "next/link";
import { responsableTratamiento } from "@/lib/legal";

// El responsable y su contacto salen de la configuración del despliegue: se leen
// en cada visita para no congelar en la build un valor que todavía no existe.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacidad", // el layout le añade "· Zelena"
  description:
    "Aviso de tratamiento de datos de Zelena: qué datos guardamos, para qué, qué no hacemos y cómo ejerces tus derechos.",
};

const ENLACE = "text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary";

const QUE_DATOS = [
  "Lo que escribes en los formularios: tu nombre, tu correo, tu empresa y tu mensaje (contacto comercial y avisos de encuentros).",
  "La dirección pública de tu cuenta en Stellar y el nombre visible que eliges al entrar.",
  "Los correos que vincules a tu cuenta.",
  "El identificador de tu chat de Telegram, solo si decides vincularlo.",
];

const PARA_QUE = [
  "Responderte cuando nos escribes.",
  "Avisarte de los encuentros, si nos lo pediste.",
  "Operar tu cuenta: tu acuerdo firmado, tus entregas, tu reputación y tus avisos.",
];

const NO_HACEMOS = [
  "No vendemos ni alquilamos tus datos.",
  "No medimos tus horas, tu ubicación ni cuándo te conectas.",
  "En la red de pruebas de Stellar solo queda la huella del acuerdo que firmaste y una referencia a tu cuenta pública; nunca tu nombre ni tu correo.",
];

function Lista({ items }: { items: string[] }) {
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

export default function Privacidad() {
  const { nombre, contacto } = responsableTratamiento();
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

  return (
    <div className="space-y-20 md:space-y-24">
      {/* ===== APERTURA ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-14">
        <p className="label">Privacidad</p>
        <h1 className="max-w-4xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[68px] lg:leading-[1.08]">
          Tus datos, <em className="font-normal italic text-primary">en claro.</em>
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted lg:text-lg">
          Este aviso explica qué datos tuyos tratamos, para qué y cómo decides sobre ellos, según la ley
          colombiana de protección de datos personales (Ley 1581 de 2012).
        </p>
      </section>

      <Bloque titulo="Quién responde">
        <p className="text-base leading-7 text-muted">
          El responsable del tratamiento es <span className="text-paper">{nombre}</span>. Para cualquier pregunta
          sobre tus datos, {canal}.
        </p>
      </Bloque>

      <Bloque titulo="Qué datos">
        <Lista items={QUE_DATOS} />
      </Bloque>

      <Bloque titulo="Para qué">
        <Lista items={PARA_QUE} />
      </Bloque>

      <Bloque titulo="Lo que no hacemos">
        <Lista items={NO_HACEMOS} />
      </Bloque>

      <Bloque titulo="Tus derechos">
        <p className="text-base leading-7 text-muted">
          Puedes conocer, actualizar, rectificar y suprimir tus datos, y revocar en cualquier momento la autorización
          que nos diste. También puedes pedir prueba de esa autorización, saber qué uso les hemos dado y presentar
          una queja ante la Superintendencia de Industria y Comercio.
        </p>
        <p className="text-base leading-7 text-muted">
          Para ejercerlos, {canal} con tu solicitud. Te respondemos por el mismo medio. Lo que ya quedó en un
          registro público, como la huella de un acuerdo firmado, no se puede borrar de ese registro.
        </p>
      </Bloque>

      <Bloque titulo="Tu autorización">
        <p className="text-base leading-7 text-muted">
          Los formularios de{" "}
          <Link href="/empresas/contacto" className={ENLACE}>
            contacto
          </Link>{" "}
          y de{" "}
          <Link href="/encuentros" className={ENLACE}>
            encuentros
          </Link>{" "}
          te piden marcar una casilla antes de enviar: sin ella, el formulario no se envía.
        </p>
      </Bloque>
    </div>
  );
}
