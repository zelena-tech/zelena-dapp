import Link from "next/link";
import { SERVICIOS } from "@/lib/servicios";

export const metadata = {
  title: { absolute: "Servicios · ZELENA" },
  description:
    "Seis líneas de servicio con entregas reales detrás: Gestión de Área TI, Odoo/ERP, WMS, Transformación Digital, Datos y Analítica, Cloud e Infraestructura.",
};

export default function Servicios() {
  return (
    <div className="space-y-20 md:space-y-28">
      <section className="space-y-12 pt-4 md:pt-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <div className="space-y-5">
            <p className="label">Servicios</p>
            <h1 className="font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl sm:leading-[1.12] lg:text-[68px]">
              Lo que ya <em className="font-normal italic text-primary">hacemos.</em>
            </h1>
          </div>
          <p className="max-w-md text-base leading-7 text-muted">
            Seis líneas con entregas reales detrás. Cada una es una forma de empezar a trabajar
            juntos, y todas se conectan con la misma operación.
          </p>
        </div>

        <div className="flex flex-col">
          {SERVICIOS.map((s, i) => (
            <div
              key={s.nombre}
              className={`grid gap-6 py-8 md:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)] md:gap-10 ${
                i === 0 ? "border-t border-primary" : "border-t border-line"
              } ${i === SERVICIOS.length - 1 ? "border-b border-line" : ""}`}
            >
              <span className="text-sm text-primary">{String(i + 1).padStart(2, "0")}</span>

              <div className="flex flex-col gap-2.5">
                <h2 className="text-2xl normal-case leading-tight text-paper">{s.nombre}</h2>
                <p className="text-base leading-7 text-muted">{s.linea}</p>
              </div>

              <div className="flex flex-col gap-3.5">
                <ul className="flex flex-col gap-1.5">
                  {s.incluye.map((x) => (
                    <li key={x} className="text-sm leading-6 text-muted">
                      {x}
                    </li>
                  ))}
                </ul>
                <p className="text-xs uppercase tracking-[0.14em] text-primary">{s.meta}</p>
                <Link
                  href={`/empresas/contacto?interes=${s.slug}`}
                  aria-label={`Solicitar propuesta de ${s.nombre}`}
                  className="group inline-flex min-h-[44px] w-fit items-center gap-2 text-sm text-paper transition-colors hover:text-primary"
                >
                  Solicitar propuesta
                  <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">
                    →
                  </span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="card flex flex-col items-start gap-8 border-primary/30 p-8 md:p-12 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="max-w-2xl space-y-4">
            <h2 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-3xl sm:leading-snug lg:text-[40px]">
              ¿Por dónde empezamos?
            </h2>
            <p className="text-base leading-7 text-muted lg:text-lg">
              Cuéntanos cómo trabajas hoy y te decimos cuál de estas puertas abre más rápido.
            </p>
          </div>
          <Link href="/empresas/contacto" className="btn btn-primary shrink-0 whitespace-nowrap normal-case tracking-normal">
            Hablemos <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
