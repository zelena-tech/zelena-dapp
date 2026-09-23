import Link from "next/link";
import ContactoForm from "@/components/ContactoForm";

export const metadata = {
  title: { absolute: "Agenda una demostración · ZELENA" },
  description:
    "Cuéntanos cómo opera tu bodega y coordinamos una demostración de ZELENA: operaciones, incentivos por desempeño y servicios de tecnología.",
};

// Qué pasa después de enviar. Sin plazos inventados: prometer "respuesta en
// 24 h" es un SLA público que el equipo tendría que sostener.
const PASOS = [
  { n: "01", t: "Nos cuentas", d: "Qué operas, cuántas personas hay en piso y qué sistema usan hoy." },
  { n: "02", t: "Conversamos", d: "Una llamada corta para entender la operación antes de proponer nada." },
  { n: "03", t: "Te mostramos", d: "La demostración, sobre tu caso, con lo que de verdad aplica." },
];

export default function Contacto({ searchParams }: { searchParams: { interes?: string } }) {
  return (
    <div className="grid gap-14 pt-6 md:pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <section className="flex flex-col gap-8">
        <p className="label">Empresas</p>
        <h1 className="font-serif text-4xl font-normal normal-case leading-[1.1] tracking-normal text-paper sm:text-5xl lg:text-[60px]">
          Agenda una <em className="font-normal italic text-primary">demostración.</em>
        </h1>
        <p className="max-w-md text-base leading-7 text-muted">
          Cuéntanos cómo opera tu bodega y coordinamos una conversación sobre tu caso real.
        </p>

        <ol className="flex flex-col">
          {PASOS.map((p, i) => (
            <li
              key={p.n}
              className={`grid grid-cols-[40px_minmax(0,1fr)] gap-3 py-4 ${
                i === 0 ? "border-t border-primary" : "border-t border-line"
              }`}
            >
              <span className="text-[13px] text-primary">{p.n}</span>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-paper">{p.t}</span>
                <span className="text-sm leading-6 text-muted">{p.d}</span>
              </div>
            </li>
          ))}
        </ol>

        <p className="text-sm text-muted">
          ¿Prefieres ver primero el detalle?{" "}
          <Link href="/empresas/servicios" className="text-primary hover:underline">
            Revisa el catálogo de servicios
          </Link>
          .
        </p>
      </section>

      <section>
        <ContactoForm interesInicial={searchParams.interes ?? ""} />
      </section>
    </div>
  );
}
