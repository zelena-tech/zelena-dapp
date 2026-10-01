import type { Metadata } from "next";
import Link from "next/link";
import { claCanonicalHash, readClaText } from "@/lib/cla";
import { Markdown } from "@/components/Markdown";

// El texto se lee en cada visita, igual que lo sirve /api/cla al firmar: lo que
// lees aquí es exactamente lo que firma cada persona.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Acuerdo de contribución", // el layout le añade "· Zelena"
  description:
    "El texto completo del acuerdo que firma cada persona al entrar a Zelena, con su huella verificable.",
};

const EN_POCAS_PALABRAS = [
  { t: "Tu autoría es tuya.", d: "Siempre se reconoce quién hizo qué. Ese derecho no se cede." },
  {
    t: "Lo que aportas puede llegar a clientes.",
    d: "Al firmar cedes a Zelena los derechos patrimoniales de tus contribuciones.",
  },
  {
    t: "No es un contrato de trabajo.",
    d: "Firmar no te convierte en empleado ni en socio, y la reputación o los puntos que recibas no son salario.",
  },
];

export default function Acuerdo() {
  const texto = readClaText();
  const huella = claCanonicalHash();

  return (
    <div className="space-y-20 md:space-y-28">
      {/* ===== APERTURA ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-14">
        <p className="label">Acuerdo de contribución</p>
        <h1 className="max-w-4xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[68px] lg:leading-[1.08]">
          Lo que firmas, <em className="font-normal italic text-primary">completo.</em>
        </h1>
        <p className="max-w-2xl text-base leading-8 text-muted lg:text-lg">
          Este es el texto exacto que firma cada persona al entrar. Su huella queda registrada en la red de
          pruebas de Stellar, así que cualquiera puede comprobar que no cambió.
        </p>
      </section>

      {/* ===== EN POCAS PALABRAS ===== */}
      <section className="space-y-8">
        <p className="label">En pocas palabras</p>
        <ol className="flex flex-col">
          {EN_POCAS_PALABRAS.map((p, i) => (
            <li
              key={p.t}
              className={`grid gap-3 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-baseline md:gap-10 ${
                i === 0 ? "border-t border-primary" : "border-t border-line"
              } ${i === EN_POCAS_PALABRAS.length - 1 ? "border-b border-line" : ""}`}
            >
              <h2 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper">{p.t}</h2>
              <p className="max-w-xl text-base leading-7 text-muted">{p.d}</p>
            </li>
          ))}
        </ol>
        <p className="max-w-2xl text-sm leading-7 text-faint">
          El resumen no reemplaza al texto: si algo no coincide, manda el acuerdo de abajo.
        </p>
      </section>

      {/* ===== EL TEXTO ===== */}
      <section className="space-y-6">
        <p className="label">El texto completo</p>
        <article className="card p-6 md:p-8">
          <Markdown source={texto} />
        </article>
        <p className="break-all font-mono text-[11px] leading-5 text-faint">Huella (SHA-256): {huella}</p>
        <p className="text-sm text-muted">
          Para firmarlo necesitas una invitación.{" "}
          <Link href="/entrar" className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
            Entrar
          </Link>
          {" · "}
          <Link href="/privacidad" className="text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
            Aviso de privacidad
          </Link>
        </p>
      </section>
    </div>
  );
}
