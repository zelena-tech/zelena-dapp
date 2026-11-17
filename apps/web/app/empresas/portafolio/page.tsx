import Link from "next/link";
import { BuscadorYPortafolio, CicloDeTrabajo } from "@/components/PortafolioInteractivo";
import { POR_QUE, SECTORES } from "@/lib/portafolio";
import { metadatos } from "@/lib/seo";

export const metadata = metadatos({
  ruta: "/empresas/portafolio",
  idioma: "es",
  // Sin imagen, igual que el resto de /empresas: la de public/og/ es de la comunidad.
  imagen: null,
  titulo: "Portafolio de soluciones · Zelena",
  descripcion:
    "Ordenamos la operación de tu pyme: un producto propio (ZELENA WMS), cinco servicios que se contratan por separado y un programa de incentivos en dólares digitales para tu equipo.",
});

// Lo primero que ve quien llega con el enlace y no nos conoce: qué hace el
// negocio, en tres verbos. Cada uno lleva a su parte del portafolio.
const EN_TRES_LINEAS = [
  {
    verbo: "Ordenamos",
    que: "tus procesos, tu información y tu tecnología.",
    como: "Cinco servicios: procesos, Odoo, datos, nube y dirección de TI.",
    href: "#portafolio",
  },
  {
    verbo: "Operamos",
    que: "tu bodega con tecnología propia.",
    como: "ZELENA WMS: inventario exacto y despachos validados.",
    href: "#portafolio",
  },
  {
    verbo: "Reconocemos",
    que: "el trabajo real de tu equipo.",
    como: "Incentivos por desempeño, pagados en dólares digitales.",
    href: "/empresas/incentivos",
  },
];

const CIFRAS = [
  { n: "1 producto", t: "propio: ZELENA WMS" },
  { n: "5 servicios", t: "que se contratan por separado" },
  { n: "1 programa", t: "de incentivos para tu equipo" },
  { n: "1 aliado", t: "para toda tu operación" },
];

export default function Portafolio() {
  return (
    <div className="space-y-24 md:space-y-32">
      {/* ===== HERO ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-14">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
          <span className="h-1.5 w-1.5 animate-pulseline rounded-full bg-primary" />
          Construyendo el futuro de la colaboración
        </span>

        <h1 className="max-w-5xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl lg:text-[76px] lg:leading-[1.08]">
          Ordenamos la operación de tu <em className="font-normal italic text-primary">pyme.</em>
        </h1>

        <p className="max-w-2xl text-base leading-7 text-muted lg:text-lg">
          Primero tus procesos, después tu bodega y tu gestión. Tecnología propia y servicios para que tu
          inventario cuadre, tus despachos salgan bien y decidas con datos. Y cuando la operación ya se
          mide, un incentivo que reconoce a quien la hace posible.
        </p>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <a href="#situacion" className="btn btn-primary normal-case tracking-normal">
            Encontrar mi solución
          </a>
          <a
            href="#portafolio"
            className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted transition-colors hover:text-primary"
          >
            Ver portafolio <span aria-hidden>↓</span>
          </a>
        </div>
      </section>

      {/* ===== ZELENA EN TRES LÍNEAS ===== */}
      <section aria-label="Qué hace ZELENA" className="space-y-6">
        <p className="label">ZELENA en tres líneas</p>
        <div className="grid gap-px border border-line bg-line md:grid-cols-3">
          {EN_TRES_LINEAS.map((l) => (
            <Link
              key={l.verbo}
              href={l.href}
              className="group flex flex-col gap-3 bg-surface-2 p-6 transition-colors duration-150 hover:bg-surface md:p-8"
            >
              <span className="font-serif text-3xl font-normal italic normal-case tracking-normal text-primary lg:text-4xl">
                {l.verbo}
              </span>
              <span className="text-base leading-7 text-paper">{l.que}</span>
              <span className="text-sm leading-6 text-muted">{l.como}</span>
              <span aria-hidden className="mt-auto pt-2 text-primary transition-transform duration-150 group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
          {CIFRAS.map((c) => (
            <div key={c.n} className="flex flex-col gap-1 bg-surface-2 px-6 py-5">
              <span className="text-lg text-paper">{c.n}</span>
              <span className="text-xs leading-5 text-muted">{c.t}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ===== 01 situación + 02 portafolio (interactivo) ===== */}
      <BuscadorYPortafolio />

      {/* ===== 03 · cómo trabajamos ===== */}
      <section id="como-trabajamos" className="space-y-10">
        <div className="space-y-5">
          <p className="label">03 · Cómo trabajamos</p>
          <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]">
            El mismo ciclo <em className="font-normal italic text-primary">en todas las líneas.</em>
          </h2>
          <p className="max-w-xl text-base leading-7 text-muted">
            Cuatro pasos, una sola forma de trabajar. Por eso un servicio abre la puerta al siguiente.
          </p>
        </div>
        <CicloDeTrabajo />
      </section>

      {/* ===== 04 · por qué ===== */}
      <section id="por-que" className="space-y-10">
        <div className="space-y-5">
          <p className="label">04 · Por qué ZELENA</p>
          <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]">
            Un solo <em className="font-normal italic text-primary">aliado,</em> no cinco proveedores.
          </h2>
        </div>

        <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {POR_QUE.map((p) => (
            <div key={p.n} className="flex flex-col gap-3 bg-surface-2 p-6">
              <span className="text-xs uppercase tracking-[0.14em] text-primary">{p.n}</span>
              <h3 className="text-lg normal-case leading-snug text-paper">{p.titulo}</h3>
              <p className="text-sm leading-6 text-muted">{p.texto}</p>
            </div>
          ))}
        </div>

        <div className="card grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:p-10">
          <div className="space-y-3">
            <p className="label">Para quién trabajamos</p>
            <p className="text-base leading-7 text-paper">
              Pymes en Colombia de 10 a 200 empleados que necesitan ordenar y digitalizar su operación, con
              foco en inventario, bodegas, despachos o distribución.
            </p>
          </div>
          <ul className="flex flex-wrap content-start gap-2">
            {SECTORES.map((s) => (
              <li key={s} className="border border-line-strong px-3 py-1.5 text-sm text-muted">
                {s}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ===== CIERRE ===== */}
      <section>
        <div className="card flex flex-col items-start gap-8 border-primary/30 p-8 md:p-12 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="max-w-2xl space-y-4">
            <h2 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-3xl lg:text-[40px]">
              Hablemos de tu <em className="font-normal italic text-primary">operación.</em>
            </h2>
            <p className="text-base leading-7 text-muted lg:text-lg">
              Cuéntanos qué está pasando en tu empresa y te proponemos por dónde empezar.
            </p>
            <p className="text-xs uppercase tracking-[0.14em] text-faint">Medellín, Colombia</p>
          </div>
          <Link href="/empresas/contacto" className="btn btn-primary shrink-0 whitespace-nowrap normal-case tracking-normal">
            Hablemos <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
