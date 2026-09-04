import React from "react";

/**
 * Intro del ecosistema: lo que ve alguien que llega por primera vez, antes de
 * conectar una wallet. Todo el contenido sale del whitepaper (docs/whitepaper.md)
 * y de las reglas ya implementadas; no promete nada que el proyecto no tenga.
 *
 * Componente puramente presentacional (sin hooks ni dependencias de servidor):
 * lo usan tanto la página /ecosistema como el paso 0 del alta en /entrar.
 */

function Bloque({
  n,
  titulo,
  children,
}: {
  n: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rule pt-8">
      <div className="mb-5 flex items-baseline gap-3">
        <span className="text-xs font-bold text-primary-dim">{n}</span>
        <h2 className="font-head text-xl font-bold uppercase tracking-wide text-paper md:text-2xl">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

function Cifra({ valor, pie }: { valor: string; pie: string }) {
  return (
    <div className="card p-5">
      <div className="font-head text-4xl font-bold text-primary glow-text md:text-5xl">{valor}</div>
      <p className="mt-2 text-sm leading-6 text-muted">{pie}</p>
    </div>
  );
}

const EJES = [
  { eje: "Ejecución", que: "Calidad y cumplimiento al entregar trabajo." },
  { eje: "Investigación", que: "Análisis, documentación y contenido que otros usan." },
  { eje: "Comunidad", que: "Charlas, mentoría y referidos que se activan." },
  { eje: "Gobernanza", que: "Propuestas, votos y participación sostenida." },
];

const PASOS = [
  "Intake",
  "Publicación",
  "Aplicación",
  "Asignación",
  "Ejecución",
  "Evaluación",
  "Distribución",
  "Reputación",
];

const TRIANGULO = [
  {
    activo: "USDC",
    rol: "Paga el trabajo",
    detalle: "Líquido. Sale del 70% del split del proyecto. Es dinero, y se comporta como dinero.",
  },
  {
    activo: "Reputación",
    rol: "Da voto y acceso",
    detalle: "No transferible. No se compra. Abre proyectos grandes y la guardianía.",
  },
  {
    activo: "ZWORK",
    rol: "Derecho residual",
    detalle: "Puntos NO transferibles en esta fase. Derecho a la regalía que la SAS paga al treasury.",
  },
];

export function IntroEcosistema({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className="space-y-12">
      {/* ---------- Portada ---------- */}
      <header>
        <div className="prompt mb-6">zelena --que-estamos-construyendo</div>
        <h1 className="max-w-3xl font-head text-3xl font-bold leading-[1.08] text-paper sm:text-4xl md:text-5xl">
          El valor que entregas
          <br />
          <span className="text-primary glow-text">decide lo que recibes.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-muted">
          Zelena es una comunidad de contribuidores, no una plantilla de empleados. Aquí el trabajo se mide con
          reglas públicas, se paga por hitos y queda registrado a tu nombre en un historial que{" "}
          <span className="text-paper">nadie puede borrar, ni nosotros</span>.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <span className="tag tag-sas">Testnet · sin dinero real</span>
          <span className="tag tag-dao">Entrada por invitación</span>
        </div>
      </header>

      {/* ---------- 01 El problema ---------- */}
      <Bloque n="01" titulo="Por qué existimos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Cifra valor="70%" pie="de las pequeñas y medianas empresas de América Latina operan sin ningún sistema de gestión: papel, WhatsApp y Excel." />
          <Cifra valor="49%" pie="de rotación anual en el personal de bodega. Reemplazar a un operario cuesta entre tres y seis meses de productividad." />
        </div>
        <p className="mt-5 max-w-2xl text-sm leading-7 text-muted">
          Hacia adentro se repite el mismo problema: quien aporta valor —código, investigación, diseño,
          contenido— rara vez tiene un registro portátil y verificable de lo que hizo.{" "}
          <span className="text-paper">Su reputación vive en un CV que nadie puede auditar.</span>
        </p>
      </Bloque>

      {/* ---------- 02 De dónde viene ---------- */}
      <Bloque n="02" titulo="De dónde viene esto">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card p-6">
            <div className="flex items-center justify-between gap-2">
              <span className="label mb-0">Capa 1 · Logística</span>
              <span className="tag tag-sas">En operación</span>
            </div>
            <h3 className="mt-3 font-head text-lg font-bold text-paper">Software que ya mueve bodegas</h3>
            <p className="mt-2 text-sm leading-7 text-muted">
              Construimos tecnología para el sector logístico: control de bodega y fulfillment de punta a punta,{" "}
              <span className="text-paper">once módulos</span> y cerca de{" "}
              <span className="text-paper">diez empresas</span> operando en Colombia. Llegamos ahí por
              recomendación, sin publicidad y sin capital externo.
            </p>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between gap-2">
              <span className="label mb-0">Capa 2 · DAO</span>
              <span className="tag tag-dao">Primera cohorte</span>
            </div>
            <h3 className="mt-3 font-head text-lg font-bold text-paper">La comunidad que lo construye</h3>
            <p className="mt-2 text-sm leading-7 text-muted">
              Si el desempeño se puede medir con datos, el reconocimiento se puede repartir con{" "}
              <span className="text-paper">las mismas reglas para todos</span>. Eso es la DAO: quienes construyen
              estos productos, con su trabajo medido, pagado por hitos y registrado a su nombre.
            </p>
          </div>
        </div>

        <div className="mt-4 border-l-2 border-primary bg-glow p-5">
          <span className="label">Por qué podemos hacer esto y no es solo discurso</span>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-paper">
            Ya somos dueños de los datos donde se mide el desempeño real del trabajo, todos los días, en
            operaciones que facturan. Sobre esa base se puede construir compensación verificable.{" "}
            <span className="text-muted">Sin ella, todo lo demás es opinión.</span>
          </p>
        </div>
      </Bloque>

      {/* ---------- 03 Cómo se mide ---------- */}
      <Bloque n="03" titulo="Cómo se mide tu trabajo">
        <p className="max-w-2xl text-sm leading-7 text-muted">
          Todo proyecto recorre ocho pasos en el <span className="text-paper">Ágora</span>, el tablero público. El
          presupuesto se reparte proporcional al score y el resultado alimenta tu perfil.
        </p>
        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PASOS.map((p, i) => (
            <li key={p} className="card flex items-baseline gap-2 px-3 py-2.5">
              <span className="text-[10px] font-bold text-primary-dim">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-paper">{p}</span>
            </li>
          ))}
        </ol>

        <div className="mt-8">
          <span className="label">Cuatro ejes de reputación, historial que solo crece</span>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {EJES.map((e) => (
              <div key={e.eje} className="border-l-2 border-primary bg-surface/40 py-2 pl-4">
                <div className="font-head text-sm font-bold uppercase tracking-wide text-primary">{e.eje}</div>
                <p className="mt-1 text-sm leading-6 text-muted">{e.que}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <span className="label">Pago por hitos: nadie trabaja gratis ni cobra sin entregar</span>
          <div className="mt-3 flex h-11 w-full overflow-hidden border border-line">
            <div className="flex w-[20%] items-center justify-center bg-primary-dim text-[11px] font-bold text-black">
              20%
            </div>
            <div className="flex w-[70%] items-center justify-center bg-primary text-[11px] font-bold text-black">
              70%
            </div>
            <div className="flex w-[10%] items-center justify-center bg-line-strong text-[11px] font-bold text-muted">
              10%
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[11px] uppercase tracking-wide text-faint">
            <span>Anticipo</span>
            <span>Hitos verificados</span>
            <span>Retención</span>
          </div>
        </div>
      </Bloque>

      {/* ---------- 04 El triángulo ---------- */}
      {!compacta && (
        <Bloque n="04" titulo="Tres activos, tres roles distintos">
          <p className="max-w-2xl text-sm leading-7 text-muted">
            El error que este diseño evita es un token que sea{" "}
            <span className="text-paper">ownership de nada</span>. Una recompensa que se percibe vacía es peor que
            ninguna, así que cada activo tiene un único rol y no sustituye a los otros.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {TRIANGULO.map((t) => (
              <div key={t.activo} className="card p-5">
                <div className="font-head text-lg font-bold text-primary">{t.activo}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-widest text-paper">{t.rol}</div>
                <p className="mt-3 text-sm leading-6 text-muted">{t.detalle}</p>
              </div>
            ))}
          </div>
        </Bloque>
      )}

      {/* ---------- 05 Tu primera misión ---------- */}
      <Bloque n={compacta ? "04" : "05"} titulo="Tu primer punto, hoy mismo">
        <div className="card p-6">
          <p className="max-w-2xl text-sm leading-7 text-muted">
            No hace falta esperar a que aparezca un proyecto grande. Existe una{" "}
            <span className="text-paper">primera misión guiada de menos de dos horas</span> y una biblioteca de
            tareas internas siempre abierta: mejoras a esta misma aplicación, investigación, contenido,
            traducciones. Terminas el día con tu primer punto de reputación.
          </p>
          <p className="mt-4 text-sm leading-7 text-muted">
            El valor individual precede al colectivo: primero te sirve a ti, después a la comunidad.
          </p>
        </div>
      </Bloque>

      {/* ---------- 06 Lo que sí prometemos ---------- */}
      <Bloque n={compacta ? "05" : "06"} titulo="Lo que sí prometemos">
        <p className="max-w-2xl text-sm leading-7 text-muted">
          Esta es la primera vuelta completa del sistema con personas reales, y corre en red de pruebas: entras a
          construirlo, no a un producto terminado. Lo que está escrito y anclado es esto:
        </p>
        <blockquote className="mt-6">
          <p className="max-w-2xl font-head text-xl leading-snug text-paper md:text-2xl">
            No se promete precio.{" "}
            <span className="text-primary glow-text">Se promete memoria.</span>
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            El puntaje que acumules desde el primer día cuenta para cualquier asignación futura, proporcional a tu
            historial. Es un compromiso escrito y anclado, no una intención. Si te alejas, tu historial se congela
            y sigue siendo tuyo cuando vuelvas.
          </p>
        </blockquote>
      </Bloque>

    </div>
  );
}

export default IntroEcosistema;
