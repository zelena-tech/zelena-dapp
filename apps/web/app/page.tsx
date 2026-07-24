import Link from "next/link";
import { cohortStats, listProjects, listDecisions } from "@/lib/repo";
import Type from "@/components/Type";

export const dynamic = "force-dynamic";

const VIEJO_JUEGO = [
  "Tu CV es un rumor que nadie puede verificar.",
  "Tu bono depende del humor de tu jefe.",
  "Tu reputación se borra cada vez que renuncias.",
  "Tu título pesa más que tu último commit.",
];

const PROTOCOLO = [
  {
    n: "01",
    t: "CONSIGUE UNA INVITACIÓN",
    d: "No hay formulario. Cada código viene de alguien que ya construye adentro y responde por ti con su reputación.",
  },
  {
    n: "02",
    t: "FIRMA Y QUEDA ESCRITO",
    d: "Conectas tu wallet (o creas una de prueba en 10 segundos), firmas el acuerdo y el hash queda anclado en Stellar. Sin papeles.",
  },
  {
    n: "03",
    t: "TOMA TU PRIMER BOUNTY",
    d: "Eliges del tablero. Presupuesto, hitos y criterios a la vista. Entregas, te miden, cobras. Tu historial empieza hoy.",
  },
];

function fmtUsd(n: number) {
  return "USD " + n.toLocaleString("es");
}

export default function Landing() {
  const stats = cohortStats();
  const bounties = listProjects({ state: "Open" }).slice(0, 6);
  const decisions = listDecisions().slice(0, 3);
  const pct = Math.min(100, Math.round((stats.points / stats.epochBudget) * 100));

  return (
    <div className="space-y-28 md:space-y-36">
      {/* ===== BOOT + HERO ===== */}
      <section className="pt-8 md:pt-14">
        <Type
          lines={[
            "> conectando a zelena…",
            "> red: testnet — sin humo, sin dinero real todavía.",
            "> acceso: SOLO POR INVITACIÓN.",
          ]}
        />
        <h1 className="mt-8 max-w-4xl text-4xl leading-[1.02] text-paper sm:text-6xl md:text-7xl">
          El título
          <br />
          no paga.
          <br />
          <span className="text-primary glow-text">El trabajo sí.</span>
        </h1>
        <p className="mt-8 max-w-xl text-base leading-7 text-muted">
          Zelena es una comunidad de gente que construye. Cada entrega se mide con un score
          verificable, cada hito se paga, y tu reputación queda escrita on-chain —{" "}
          <span className="text-paper">tuya, portátil, imposible de borrar</span>.
        </p>
        <p className="mt-3 text-xs uppercase tracking-widest text-faint">
          Real work, Real rewards. Del piso a la wallet.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/entrar" className="btn btn-primary">
            [ tengo_invitación ]
          </Link>
          <Link href="/agora" className="btn btn-ghost">
            ver_bounties →
          </Link>
        </div>
      </section>

      {/* ===== EL VIEJO JUEGO ===== */}
      <section>
        <div className="prompt mb-8">cat viejo_juego.txt</div>
        <div className="space-y-5">
          {VIEJO_JUEGO.map((l, i) => (
            <p key={i} className="max-w-3xl text-xl leading-snug text-muted md:text-3xl">
              <span className="mr-3 text-sm text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="strike-zine">{l}</span>
            </p>
          ))}
        </div>
        <div className="rule mt-10 pt-8">
          <p className="max-w-3xl text-2xl leading-tight text-paper md:text-4xl">
            Aquí eso no corre. <span className="text-primary">Score verificable. Pagos por hitos. Reputación que te pertenece.</span>
          </p>
        </div>
      </section>

      {/* ===== TABLERO DE BOUNTIES (vivo) ===== */}
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="prompt">zelena bounties --open</div>
          <span className="text-xs text-faint">dinero real · proyectos reales · tu aplicación es tu plan</span>
        </div>
        <div className="border-b border-dashed border-line">
          {bounties.map((p) => (
            <Link key={p.id} href={`/agora/${p.id}`} className="file-row group">
              <span className="text-xs font-bold text-primary">[ABIERTO]</span>
              <span className="text-sm text-paper md:text-base">{p.title}</span>
              <span className="dots hidden flex-1 overflow-hidden whitespace-nowrap text-xs md:inline">
                {"·".repeat(80)}
              </span>
              <span className="text-sm font-bold text-paper">{fmtUsd(p.budget_usd)}</span>
              <span className="text-xs text-muted">{p.weeks} sem</span>
              <span className="text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100">→</span>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted">
          Sin entrevistas de cinco rondas. Aplicas con tu enfoque y tu plazo; te eligen por mérito.{" "}
          <Link href="/agora" className="text-primary underline decoration-dashed underline-offset-4 hover:glow-text">
            Ver el tablero completo
          </Link>
        </p>
      </section>

      {/* ===== EL PROTOCOLO ===== */}
      <section>
        <div className="prompt mb-8">man protocolo_de_entrada</div>
        <div className="space-y-0">
          {PROTOCOLO.map((s) => (
            <div key={s.n} className="rule grid gap-2 py-7 md:grid-cols-[80px_1fr_2fr] md:gap-6">
              <div className="text-3xl font-bold text-primary/40">{s.n}</div>
              <h3 className="text-lg text-paper">{s.t}</h3>
              <p className="text-sm leading-6 text-muted">{s.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">
          Sin CV. Sin LinkedIn. Sin pedirle permiso a nadie — <span className="text-paper">excepto al código</span>.
        </p>
      </section>

      {/* ===== LO QUE ACUMULAS ===== */}
      <section>
        <div className="prompt mb-8">ls recompensas/</div>
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="text-4xl font-bold text-primary glow-text">USD</div>
            <p className="mt-3 text-sm leading-6 text-muted">
              Cada hito aprobado libera pago. 20% de anticipo al empezar, el resto conforme entregas.
              El presupuesto está fondeado <span className="text-paper">antes</span> de que escribas una línea.
            </p>
          </div>
          <div>
            <div className="text-4xl font-bold text-primary glow-text">REP</div>
            <p className="mt-3 text-sm leading-6 text-muted">
              Reputación en 4 ejes, append-only. Abre proyectos más grandes, da voto en gobernanza
              y te sigue aunque cambies de ciudad, de empleo o de país.
            </p>
          </div>
          <div>
            <div className="text-4xl font-bold text-primary glow-text">ZWORK</div>
            <p className="mt-3 text-sm leading-6 text-muted">
              Tu parte del upside del ecosistema. Hoy son puntos no transferibles — sin humo, sin
              promesas de precio. Lo que acumules en Génesis cuenta <span className="text-paper">para siempre</span>.
            </p>
          </div>
        </div>
      </section>

      {/* ===== TRANSMISIONES + STATS ===== */}
      <section className="grid gap-10 md:grid-cols-2">
        <div>
          <div className="prompt mb-6">tail -f decisiones.log</div>
          <div className="space-y-0">
            {decisions.map((d) => (
              <div key={d.id} className="rule py-4">
                <div className="text-xs text-faint">{d.date}</div>
                <div className="mt-1 text-sm text-paper">{d.title}</div>
              </div>
            ))}
          </div>
          <Link href="/gobernanza" className="mt-4 inline-block text-sm text-primary underline decoration-dashed underline-offset-4">
            Todo el decision log →
          </Link>
        </div>
        <div>
          <div className="prompt mb-6">zelena stats --live</div>
          <div className="term">
            <div>
              contribuidores <span className="dots">{"·".repeat(12)}</span>{" "}
              <span className="text-primary">{stats.contributors}</span>
            </div>
            <div>
              bounties_totales <span className="dots">{"·".repeat(10)}</span>{" "}
              <span className="text-primary">{stats.bounties}</span>
            </div>
            <div>
              cla_firmados <span className="dots">{"·".repeat(14)}</span>{" "}
              <span className="text-primary">{stats.clas}</span>
            </div>
            <div>
              puntos_distribuidos <span className="dots">{"·".repeat(7)}</span>{" "}
              <span className="text-primary">{stats.points.toLocaleString("es")}</span>
              <span className="text-faint"> / {stats.epochBudget.toLocaleString("es")}</span>
            </div>
            <div className="bar-track mt-3 h-2 w-full">
              <div className="bar-fill h-full" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-xs text-faint">época génesis · {pct}% emitido · presupuesto con techo duro</div>
          </div>
        </div>
      </section>

      {/* ===== CTA FINAL ===== */}
      <section className="pb-8 text-center md:pb-16">
        <div className="rule mx-auto max-w-3xl pt-14">
          <h2 className="text-4xl leading-tight text-paper md:text-6xl">
            La puerta no está abierta.
            <br />
            <span className="text-primary glow-text">Está ganada.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-sm leading-6 text-muted">
            Cada invitación viene de alguien que ya demostró lo que hace. Si tienes la tuya, el
            primer punto de reputación puede ser hoy. Si no, encuentra a alguien de la cohorte y
            demuéstrale por qué deberías estar adentro.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/entrar" className="btn btn-primary">
              [ entrar_ahora ]
            </Link>
            <Link href="/whitepaper" className="btn btn-ghost">
              leer_el_whitepaper
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
