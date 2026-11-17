import Link from "next/link";
import { metadatos } from "@/lib/seo";

export const metadata = metadatos({
  ruta: "/empresas/incentivos",
  idioma: "es",
  // Sin imagen, igual que el resto de /empresas: la de public/og/ es de la comunidad.
  imagen: null,
  titulo: "Incentivos en dólares digitales · Zelena",
  descripcion:
    "Un programa de incentivos ligado al desempeño real de tu equipo, pagado en dólares digitales: una herramienta de ahorro para las personas, más productividad para la operación y sentido de pertenencia.",
});

// Lo que esta página afirma tiene que coincidir con /empresas (lo cuida
// sitio-publico.test.ts): hoy el incentivo llega en USDC a la billetera de cada
// persona; entregarlo en pesos a la cuenta bancaria es la meta, no lo que ya funciona.

const DOLAR_DIGITAL = [
  { t: "Siempre vale un dólar", d: "Es un dólar en formato digital: está hecho para valer siempre un dólar estadounidense. Su nombre técnico es USDC." },
  { t: "Vive en el celular", d: "Se recibe y se guarda en una billetera en el teléfono, sin cuenta en el exterior y sin monto mínimo." },
  { t: "Es de quien lo gana", d: "Llega directo a la billetera de cada persona y cada pago se puede verificar. Guardarlo o usarlo lo decide quien lo recibe." },
];

const BENEFICIOS = [
  {
    n: "01",
    titulo: "Una herramienta de ahorro para tu equipo",
    texto:
      "Ahorrar en dólares era un privilegio de quien podía abrir una cuenta afuera. Con dólares digitales, cada incentivo puede ser el comienzo de un ahorro en dólares, de a poco y desde el celular.",
  },
  {
    n: "02",
    titulo: "Más productividad, porque se premia lo que se mide",
    texto:
      "El incentivo sigue al desempeño real registrado en la operación. Las reglas se conocen antes de empezar, así que cada persona sabe exactamente qué hacer para ganarlo, y lo que se mide mejora.",
  },
  {
    n: "03",
    titulo: "Sentido de pertenencia",
    texto:
      "Cuando el reconocimiento es justo, visible y llega a tiempo, el equipo siente suyo el resultado. Cada logro queda en un historial a nombre de la persona: lo que hizo no se borra.",
  },
];

const PASOS = [
  { n: "01", t: "Defines las reglas", d: "Qué se premia, cuánto y en qué periodo. El presupuesto lo pones tú y se conoce desde el principio." },
  { n: "02", t: "Se mide en la operación", d: "El trabajo real queda registrado en el sistema mientras ocurre. Nada de planillas ni cálculos a mano." },
  { n: "03", t: "Se cierra el periodo", d: "Los resultados se calculan con las mismas reglas para todos y cada persona ve los suyos." },
  { n: "04", t: "Cada quien recibe y decide", d: "El incentivo llega en dólares digitales a su billetera. Guardarlo como ahorro o usarlo lo decide cada persona." },
];

const PARA_LA_EMPRESA = [
  "Un incentivo que no depende del criterio de un jefe",
  "Presupuesto definido por periodo, sin sorpresas",
  "Datos de desempeño para decidir mejor",
  "Un argumento real para que la gente se quede",
];

const PARA_EL_EQUIPO = [
  "Reglas claras antes de empezar",
  "Un ahorro en dólares al alcance de la mano",
  "Reconocimiento a tiempo, no cuando alguien se acuerda",
  "Un historial de logros que es suyo",
];

const REGLAS_CLARAS = [
  "Es adicional al salario. Nunca lo reemplaza.",
  "El dólar digital sigue al dólar: su valor en pesos sube y baja con la tasa de cambio.",
  "Hoy el incentivo llega en dólares digitales a la billetera de cada persona. Entregarlo en pesos, directo a la cuenta bancaria, es la meta en la que trabajamos.",
];

export default function Incentivos() {
  return (
    <div className="space-y-24 md:space-y-32">
      {/* ===== HERO ===== */}
      <section className="flex flex-col gap-8 pt-6 md:pt-14">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
          <span className="h-1.5 w-1.5 animate-pulseline rounded-full bg-primary" />
          Harmony · Programa de incentivos
        </span>

        <h1 className="max-w-5xl font-serif text-4xl font-normal normal-case leading-[1.12] tracking-normal text-paper sm:text-5xl lg:text-[76px] lg:leading-[1.08]">
          Reconoce el trabajo real de tu equipo, en{" "}
          <em className="font-normal italic text-primary">dólares digitales.</em>
        </h1>

        <p className="max-w-2xl text-base leading-7 text-muted lg:text-lg">
          Un incentivo ligado a lo que tu equipo de verdad hace en la operación. Reglas claras antes de
          empezar, resultados visibles al cerrar, y un pago que además les sirve para ahorrar.
        </p>

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Link href="/empresas/contacto?interes=harmony" className="btn btn-primary normal-case tracking-normal">
            Llevarlo a mi empresa
          </Link>
          <a
            href="#como-funciona"
            className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted transition-colors hover:text-primary"
          >
            Mira cómo funciona <span aria-hidden>↓</span>
          </a>
        </div>
      </section>

      {/* ===== QUÉ SON ===== */}
      <section className="space-y-8">
        <div className="space-y-5">
          <p className="label">Primero lo primero</p>
          <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]">
            ¿Qué es un <em className="font-normal italic text-primary">dólar digital?</em>
          </h2>
          <p className="max-w-xl text-base leading-7 text-muted">
            Dinero en dólares que se mueve como un mensaje. Nada que aprender, nada que instalar más allá
            del celular.
          </p>
        </div>
        <div className="grid gap-px border border-line bg-line md:grid-cols-3">
          {DOLAR_DIGITAL.map((x) => (
            <div key={x.t} className="flex flex-col gap-3 bg-surface-2 p-6 md:p-8">
              <h3 className="text-lg normal-case text-paper">{x.t}</h3>
              <p className="text-sm leading-6 text-muted">{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== BENEFICIOS ===== */}
      <section id="beneficios" className="space-y-10">
        <div className="space-y-5">
          <p className="label">Por qué funciona</p>
          <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]">
            Ahorro, productividad y <em className="font-normal italic text-primary">pertenencia.</em>
          </h2>
        </div>
        <div className="flex flex-col">
          {BENEFICIOS.map((b, i) => (
            <div
              key={b.n}
              className={`grid gap-4 py-8 md:grid-cols-[80px_minmax(0,1fr)_minmax(0,1.2fr)] md:gap-10 ${
                i === 0 ? "border-t border-primary" : "border-t border-line"
              } ${i === BENEFICIOS.length - 1 ? "border-b border-line" : ""}`}
            >
              <span className="text-sm text-primary">{b.n}</span>
              <h3 className="text-2xl normal-case leading-tight text-paper">{b.titulo}</h3>
              <p className="text-base leading-7 text-muted">{b.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== CÓMO FUNCIONA ===== */}
      <section id="como-funciona" className="space-y-10">
        <div className="space-y-5">
          <p className="label">Cómo funciona</p>
          <h2 className="max-w-3xl font-serif text-3xl font-normal normal-case leading-[1.15] tracking-normal text-paper sm:text-4xl lg:text-[52px]">
            De la regla al ahorro, <em className="font-normal italic text-primary">en cuatro pasos.</em>
          </h2>
        </div>
        <ol className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {PASOS.map((p) => (
            <li key={p.n} className="flex flex-col gap-3 bg-surface-2 p-6">
              <span className="text-sm text-primary">{p.n}</span>
              <h3 className="text-lg normal-case leading-snug text-paper">{p.t}</h3>
              <p className="text-sm leading-6 text-muted">{p.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ===== PARA QUIÉN ES CADA PARTE ===== */}
      <section className="grid gap-px border border-line bg-line md:grid-cols-2">
        {[
          { titulo: "Para la empresa", items: PARA_LA_EMPRESA },
          { titulo: "Para el equipo", items: PARA_EL_EQUIPO },
        ].map((col) => (
          <div key={col.titulo} className="space-y-5 bg-surface-2 p-6 md:p-10">
            <h2 className="font-serif text-2xl font-normal italic normal-case tracking-normal text-primary sm:text-3xl">
              {col.titulo}
            </h2>
            <ul className="space-y-3">
              {col.items.map((x) => (
                <li key={x} className="flex gap-3 text-base leading-7 text-paper">
                  <span className="text-primary" aria-hidden>✓</span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* ===== REGLAS CLARAS ===== */}
      <section className="space-y-5">
        <p className="label">Reglas claras</p>
        <ul className="space-y-3 border-l-2 border-primary bg-glow p-6 md:p-8">
          {REGLAS_CLARAS.map((r) => (
            <li key={r} className="text-base leading-7 text-paper">
              {r}
            </li>
          ))}
        </ul>
      </section>

      {/* ===== CIERRE ===== */}
      <section>
        <div className="card flex flex-col items-start gap-8 border-primary/30 p-8 md:p-12 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="max-w-2xl space-y-4">
            <h2 className="font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-3xl lg:text-[40px]">
              ¿Tu operación ya se mide? Entonces ya se puede{" "}
              <em className="font-normal italic text-primary">reconocer.</em>
            </h2>
            <p className="text-base leading-7 text-muted lg:text-lg">
              Y si todavía no se mide, empezamos por ahí: el incentivo es el último paso de una operación
              ordenada, no el primero.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3">
            <Link href="/empresas/contacto?interes=harmony" className="btn btn-primary whitespace-nowrap normal-case tracking-normal">
              Hablemos <span aria-hidden>→</span>
            </Link>
            <Link href="/empresas/portafolio" className="btn btn-ghost whitespace-nowrap normal-case tracking-normal">
              Ver todo el portafolio
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
