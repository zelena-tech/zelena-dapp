import Link from "next/link";

export const metadata = {
  title: "Para empresas",
  description:
    "Software e incentivos que hacen la logística de LATAM más rápida, inteligente y rentable. ZELENA ayuda a los operadores de almacenes a modernizar sus operaciones y recompensar el desempeño real.",
};

// El contenido vive en constantes, no incrustado en el JSX, para que la capa
// de idiomas solo tenga que añadir el lado en inglés sin tocar la maqueta.
const ESTADO = [
  { etiqueta: "Fase 1", valor: "En producción", vivo: true },
  { etiqueta: "Fase 2", valor: "Verificado en testnet", tenue: true },
  { etiqueta: "Infraestructura", valor: "Stellar · Soroban" },
  { etiqueta: "Cobertura", valor: "Colombia → México → Argentina" },
];

const FASES = [
  {
    num: "01",
    estado: "En producción",
    acento: true,
    titulo: "Columna vertebral de operaciones",
    desc: "El sistema de fulfillment que opera el almacén. Cada pedido, cada operador, cada tarea — rastreados en tiempo real. Construido durante dos años junto a operadores logísticos reales en Latinoamérica.",
  },
  {
    num: "02",
    estado: "Testnet · En camino a mainnet",
    acento: false,
    titulo: "Nómina por desempeño",
    desc: "Distribución automática de incentivos basada en el desempeño medido. Recompensas financiadas en USDC, entregadas a la cuenta bancaria de cada trabajador en moneda local — COP, MXN, ARS — sin fricción cripto.",
  },
];

const PASOS = [
  { n: "01", t: "Crear campaña", d: "El dueño define las reglas de recompensa, el periodo y los parámetros de puntuación." },
  { n: "02", t: "Financiar el fondo", d: "El fondo de recompensas en USDC se deposita automáticamente en Blend. Genera rendimiento mientras el periodo está abierto." },
  { n: "03", t: "Ejecutar tareas", d: "Los trabajadores completan las operaciones. Cada acción se registra en vivo desde el piso." },
  { n: "04", t: "Puntuar y cerrar", d: "El supervisor revisa y aplica el multiplicador de calidad. El periodo se cierra on-chain." },
  { n: "05", t: "Verificar y pagar", d: "Stellar ancla los puntajes. Las recompensas llegan a la cuenta bancaria de cada trabajador." },
];

const STELLAR = [
  { t: "Moneda local, última milla", d: "Los anchors de Stellar convierten USDC directamente a COP, MXN y ARS — entregado como transferencias bancarias estándar, sin necesidad de conocimientos de cripto." },
  { t: "Comisiones de centavos", d: "Pagar a docenas de trabajadores por periodo se vuelve económicamente viable. A escala PyME, esta es la diferencia entre lo posible y lo imposible." },
  { t: "Cero fricción cripto", d: "Autenticación con passkeys. Face ID o huella digital. Los trabajadores reciben recompensas sin saber jamás que hay blockchain de por medio." },
];

export default function Empresas() {
  return (
    <div className="space-y-24 md:space-y-32">
      {/* ===== HERO ===== */}
      <section className="grid items-center gap-12 pt-4 md:pt-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-16">
        <div className="flex flex-col gap-7">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
            <span className="h-1.5 w-1.5 animate-pulseline rounded-full bg-primary" />
            Infraestructura de Nómina por Desempeño · Construido en Stellar
          </span>

          <h1 className="max-w-3xl text-3xl normal-case italic leading-[1.08] text-paper sm:text-4xl lg:text-[52px] lg:leading-[1.05]">
            Software e incentivos que hacen la logística de{" "}
            <span className="text-primary glow-text">LATAM</span> más rápida, inteligente y
            rentable.
          </h1>

          <p className="max-w-xl text-base leading-7 text-muted lg:text-lg">
            ZELENA ayuda a los operadores de almacenes a modernizar sus operaciones y recompensar
            el desempeño real — en moneda local, entregado automáticamente a través de Stellar.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <Link href="/empresas/servicios" className="btn btn-primary normal-case tracking-normal">
              Agenda una demostración
            </Link>
            <a href="#como-funciona" className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted transition-colors hover:text-primary">
              Mira cómo funciona <span aria-hidden>↓</span>
            </a>
          </div>
        </div>

        {/* Foto en su recuadro, con la etiqueta flotante de marca */}
        <div className="relative mx-auto w-full max-w-[380px]">
          <div className="overflow-hidden border border-primary/35 bg-surface shadow-glow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/hero.jpg"
              alt="Equipo de almacén celebrando resultados"
              className="aspect-[5/6] w-full object-cover"
            />
          </div>
          <p className="absolute -bottom-4 -left-4 border border-line-strong bg-surface-2 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] text-primary shadow-glow">
            Trabajo real · Recompensas reales
          </p>
        </div>
      </section>

      {/* ===== ESTADO ===== */}
      <section>
        <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {ESTADO.map((e) => (
            <div key={e.etiqueta} className="flex flex-col gap-2 bg-surface-2 px-6 py-5">
              <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    e.vivo ? "animate-pulseline bg-primary" : e.tenue ? "bg-primary/60" : "bg-faint"
                  }`}
                />
                {e.etiqueta}
              </span>
              <span className="text-sm text-paper">{e.valor}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ===== PRODUCTOS ===== */}
      <section id="productos" className="space-y-12">
        <div className="space-y-5">
          <p className="label">Productos</p>
          <h2 className="max-w-3xl text-3xl normal-case leading-[1.05] text-paper sm:text-4xl lg:text-5xl">
            Una plataforma. <span className="text-primary italic glow-text">Dos fases.</span>
          </h2>
          <p className="max-w-xl text-base leading-7 text-muted">
            Las operaciones y los incentivos nunca debieron vivir en sistemas separados.
          </p>
        </div>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-16">
          <div className="flex flex-col gap-6">
            {FASES.map((f, i) => (
              <div
                key={f.num}
                className={`flex flex-col gap-4 py-6 ${i === 0 ? "border-t border-primary" : "border-t border-line"}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[13px] text-primary">Fase {f.num}</span>
                  <span className={`text-[11px] uppercase tracking-[0.18em] ${f.acento ? "text-primary" : "text-muted"}`}>
                    {f.estado}
                  </span>
                </div>
                <h3 className="text-2xl normal-case leading-tight text-paper">{f.titulo}</h3>
                <p className="text-base leading-7 text-muted">{f.desc}</p>
              </div>
            ))}
          </div>

          <div className="card flex flex-col gap-4 border-primary/30 p-8">
            <span className="text-[11px] uppercase tracking-[0.18em] text-primary">
              El corazón de ZELENA
            </span>
            <h3 className="text-4xl leading-none text-paper">Harmony</h3>
            <p className="text-lg normal-case leading-snug text-paper">
              Incentivos reales <span className="text-primary italic">para tu equipo.</span>
            </p>
            <p className="text-base leading-7 text-muted">
              Gamificación y bonos por desempeño integrados para motivar a tu personal de almacén.
              Recompensas calculadas a partir del trabajo real, entregadas en moneda local, con
              total transparencia tanto para dueños como para operadores.
            </p>
            <p className="text-xs uppercase tracking-[0.18em] text-primary">
              Trabajo real · Recompensas reales
            </p>
          </div>
        </div>
      </section>

      {/* ===== CÓMO FUNCIONA ===== */}
      <section id="como-funciona" className="space-y-12">
        <div className="space-y-5">
          <p className="label">Cómo funciona</p>
          <h2 className="max-w-3xl text-3xl normal-case leading-[1.05] text-paper sm:text-4xl lg:text-5xl">
            De la operación <span className="text-primary italic glow-text">a tu billetera.</span>
          </h2>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {PASOS.map((p, i) => (
            <div
              key={p.n}
              className={`flex flex-col gap-3 pt-5 ${i === 0 ? "border-t border-primary" : "border-t border-line"}`}
            >
              <span className="text-[13px] text-primary">{p.n}</span>
              <h3 className="text-lg normal-case leading-tight text-paper">{p.t}</h3>
              <p className="text-sm leading-6 text-muted">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== POR QUÉ STELLAR ===== */}
      <section className="space-y-12">
        <div className="space-y-5">
          <p className="label">Por qué Stellar</p>
          <h2 className="max-w-4xl text-3xl normal-case leading-[1.05] text-paper sm:text-4xl lg:text-5xl">
            Construimos sobre infraestructura de escala{" "}
            <span className="text-primary italic glow-text">global.</span>
          </h2>
        </div>

        <div className="grid gap-10 md:grid-cols-3">
          {STELLAR.map((b) => (
            <div key={b.t} className="flex flex-col gap-3.5 border-t border-line pt-5">
              <h3 className="text-xl normal-case leading-tight text-paper">{b.t}</h3>
              <p className="text-base leading-7 text-muted">{b.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== PUERTAS ===== */}
      <section className="grid gap-10 md:grid-cols-2">
        <Link href="/empresas/servicios" className="group flex flex-col gap-4 border-t border-line pt-7">
          <span className="text-[13px] uppercase tracking-[0.18em] text-primary">Servicios</span>
          <span className="text-2xl normal-case leading-snug text-paper">
            También dirigimos áreas de TI, implementamos Odoo y sostenemos tu nube.
          </span>
          <span className="text-sm text-primary">
            Ver el catálogo{" "}
            <span aria-hidden className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </Link>

        <Link href="/" className="group flex flex-col gap-4 border-t border-line pt-7">
          <span className="text-[13px] uppercase tracking-[0.18em] text-primary">Comunidad</span>
          <span className="text-2xl normal-case leading-snug text-paper">
            Rediseñamos la forma de colaborar.
          </span>
          <span className="text-sm text-primary">
            Conoce la DAO{" "}
            <span aria-hidden className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">
              →
            </span>
          </span>
        </Link>
      </section>

      {/* ===== CIERRE ===== */}
      <section>
        <div className="card flex flex-col items-start gap-8 border-primary/30 p-8 md:p-12 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="max-w-2xl space-y-4">
            <h2 className="text-2xl normal-case leading-tight text-paper sm:text-3xl lg:text-4xl">
              ¿Listo para el futuro de{" "}
              <span className="text-primary italic glow-text">la colaboración?</span>
            </h2>
            <p className="text-base leading-7 text-muted lg:text-lg">
              Agenda una demostración y descubre cómo ZELENA moderniza tu operación.
            </p>
          </div>
          <Link
            href="/empresas/servicios"
            className="btn btn-primary shrink-0 whitespace-nowrap normal-case tracking-normal"
          >
            Agenda una demo <span aria-hidden>→</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
