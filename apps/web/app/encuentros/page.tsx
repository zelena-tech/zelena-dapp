import Link from "next/link";
import AvisoEncuentrosForm from "@/components/AvisoEncuentrosForm";
import { FORMATOS, diasPara, fechaLarga, proximosEncuentros } from "@/lib/encuentros";

export const metadata = {
  title: { absolute: "Encuentros · ZELENA" },
  description:
    "Jornadas abiertas para construir, mostrar lo que hiciste y conocer a la comunidad de ZELENA. Deja tu correo y te avisamos de la próxima fecha.",
};

// Los días que faltan cambian solos: se recalcula cada hora.
export const revalidate = 3600;

function faltan(dias: number) {
  if (dias === 0) return "Es hoy";
  if (dias === 1) return "Falta 1 día";
  return `Faltan ${dias} días`;
}

export default function Encuentros() {
  const proximos = proximosEncuentros();

  return (
    <div className="space-y-24 md:space-y-32">
      {/* ===== APERTURA ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-14">
        <p className="label">Encuentros</p>
        <h1 className="max-w-5xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[76px] lg:leading-[1.08]">
          Construir juntos empieza por <em className="font-normal italic text-primary">conocerse.</em>
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted lg:text-lg">
          Las invitaciones a ZELENA no se piden: se ganan construyendo junto a alguien. Los
          encuentros son el lugar donde eso pasa. Espacios abiertos para crear, aprender y conocer
          a gente que cree que <span className="text-paper">el trabajo bien hecho merece ser visto</span>.
        </p>
      </section>

      {/* ===== PRÓXIMOS ===== */}
      <section id="proximos" className="space-y-10">
        <div className="space-y-5">
          <p className="label">Próximos encuentros</p>
          {proximos.length === 0 ? (
            <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl sm:leading-[1.15] lg:text-[52px]">
              Estamos preparando <em className="font-normal italic text-primary">la primera fecha.</em>
            </h2>
          ) : null}
        </div>

        {proximos.length > 0 ? (
          <ol className="flex flex-col">
            {proximos.map((e, i) => (
              <li
                key={e.slug}
                className={`grid gap-5 py-8 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:gap-10 ${
                  i === 0 ? "border-t border-primary" : "border-t border-line"
                } ${i === proximos.length - 1 ? "border-b border-line" : ""}`}
              >
                <div className="flex flex-col gap-3">
                  <h3 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-3xl sm:leading-snug">
                    {e.titulo}
                  </h3>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                    <span>{e.ciudad}</span>
                    <span>{fechaLarga(e.fecha)}</span>
                    <span>{e.lugar}</span>
                  </p>
                  <p className="max-w-xl text-base leading-7 text-muted">{e.descripcion}</p>
                </div>
                <div className="flex flex-col items-start gap-3 md:items-end">
                  <span className="text-xl text-primary">{e.precio}</span>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted">
                    {faltan(diasPara(e.fecha))}
                  </span>
                  <a
                    href={e.registro}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary normal-case tracking-normal"
                  >
                    Inscribirme <span aria-hidden>↗</span>
                  </a>
                </div>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <p className="max-w-md text-base leading-7 text-muted">
            {proximos.length === 0
              ? "Déjanos tu correo y te avisamos apenas la publiquemos. Si nos cuentas tu ciudad, nos ayudas a decidir dónde empezar."
              : "¿Ninguna fecha te sirve? Déjanos tu correo y te avisamos de las siguientes."}
          </p>
          <AvisoEncuentrosForm />
        </div>
      </section>

      {/* ===== FORMATOS ===== */}
      <section className="space-y-12">
        <div className="space-y-5">
          <p className="label">Formatos</p>
          <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl sm:leading-[1.15] lg:text-[52px]">
            Así queremos <em className="font-normal italic text-primary">que sean.</em>
          </h2>
          <p className="max-w-xl text-base leading-7 text-muted">
            Los estamos diseñando con la primera cohorte. Van a cambiar con lo que aprendamos en
            cada edición.
          </p>
        </div>

        <ol className="flex flex-col">
          {FORMATOS.map((f, i) => (
            <li
              key={f.n}
              className={`grid gap-3 py-7 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,2fr)] md:items-baseline md:gap-10 ${
                i === 0 ? "border-t border-primary" : "border-t border-line"
              } ${i === FORMATOS.length - 1 ? "border-b border-line" : ""}`}
            >
              <span className="text-[13px] text-primary">{f.n}</span>
              <h3 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper">
                {f.t}
              </h3>
              <p className="max-w-xl text-base leading-7 text-muted">{f.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ===== MANIFIESTO ===== */}
      <section>
        <Link href="/manifiesto" className="group flex flex-col gap-4 border-t border-line pt-7">
          <span className="text-[13px] uppercase tracking-[0.18em] text-primary">Manifiesto</span>
          <span className="max-w-2xl font-serif text-3xl normal-case leading-snug text-paper">
            Antes de venir, lee <em className="italic text-primary">lo que creemos.</em>
          </span>
          <span className="text-sm text-primary">
            Leer el manifiesto{" "}
            <span aria-hidden className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </Link>
      </section>
    </div>
  );
}
