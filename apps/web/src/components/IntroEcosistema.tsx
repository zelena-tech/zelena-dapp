import React from "react";
import Type from "./Type";

/**
 * Intro del ecosistema: lo que ve alguien que llega por primera vez, antes de
 * conectar una wallet.
 *
 * Criterio de redacción: pocas palabras, jerarquía fuerte y cifras como ancla
 * visual. Nada de párrafos largos — quien llega desde un QR en el celular
 * decide en segundos. Nada de cifras de clientes ni de afirmaciones sobre
 * propiedad de datos de terceros: los datos son de cada empresa.
 *
 * Componente puramente presentacional (sin hooks ni dependencias de servidor):
 * lo usan la página /ecosistema y el paso 0 del alta en /entrar.
 */

function Bloque({ n, titulo, children }: { n: string; titulo: string; children: React.ReactNode }) {
  return (
    <section className="rule pt-8">
      <div className="mb-6 flex items-baseline gap-3">
        <span className="text-xs font-bold text-primary-dim">{n}</span>
        <h2 className="font-head text-xl font-bold uppercase tracking-wide text-paper md:text-2xl">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}

function Cifra({ valor, pie }: { valor: string; pie: string }) {
  return (
    <div className="card p-6">
      <div className="font-head text-5xl font-bold leading-none text-primary glow-text md:text-6xl">{valor}</div>
      <p className="mt-3 text-sm leading-6 text-muted">{pie}</p>
    </div>
  );
}

const EJES = ["Ejecución", "Investigación", "Comunidad", "Gobernanza"];

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
  { activo: "USDC", rol: "Paga el trabajo", detalle: "Líquido. Es dinero y se comporta como dinero." },
  { activo: "Reputación", rol: "Da voto y acceso", detalle: "No se compra ni se transfiere. Se gana entregando." },
  { activo: "ZWORK", rol: "Derecho residual", detalle: "Puntos no transferibles en esta fase." },
];

export function IntroEcosistema({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className="space-y-14">
      {/* ---------- Portada ---------- */}
      <header>
        <Type
          lines={[
            "> conectando a zelena…",
            "> lo que construyas queda con tu nombre.",
            "> tu parte empieza aquí.",
          ]}
        />
        <div className="mt-8" />
        <h1 className="max-w-3xl font-head text-4xl font-bold leading-[1.04] text-paper sm:text-5xl md:text-6xl">
          El valor que entregas
          <br />
          <span className="text-primary glow-text">decide lo que recibes.</span>
        </h1>
        <p className="mt-7 max-w-xl text-base leading-7 text-muted">
          Reglas públicas. Pago por hitos. Y un historial a tu nombre que{" "}
          <span className="text-paper">nadie puede borrar, ni nosotros</span>.
        </p>
        <div className="mt-7 flex flex-wrap gap-2">
          <span className="tag tag-sas">Testnet · sin dinero real</span>
          <span className="tag tag-dao">Entrada por invitación</span>
        </div>
      </header>

      {/* ---------- 01 Por qué existimos ---------- */}
      <Bloque n="01" titulo="Por qué existimos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Cifra valor="70%" pie="de las pymes de América Latina operan sin ningún sistema: papel, WhatsApp y Excel." />
          <Cifra valor="49%" pie="de rotación anual en bodega. Reemplazar a alguien cuesta meses de productividad." />
        </div>
        <p className="mt-6 max-w-xl font-head text-lg leading-snug text-paper md:text-xl">
          Y quien aporta valor casi nunca tiene una prueba de lo que hizo.
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
              Tecnología para el sector logístico: control de bodega y fulfillment de punta a punta, con{" "}
              <span className="text-paper">clientes reales</span> en Colombia. Llegamos por recomendación, sin
              publicidad y sin capital externo.
            </p>
          </div>
          <div className="card p-6">
            <div className="flex items-center justify-between gap-2">
              <span className="label mb-0">Capa 2 · DAO</span>
              <span className="tag tag-dao">Primera cohorte</span>
            </div>
            <h3 className="mt-3 font-head text-lg font-bold text-paper">La comunidad que lo construye</h3>
            <p className="mt-2 text-sm leading-7 text-muted">
              Quienes construyen estos productos, con su trabajo{" "}
              <span className="text-paper">medido, pagado por hitos y registrado a su nombre</span>.
            </p>
          </div>
        </div>

        <div className="mt-4 border-l-2 border-primary bg-glow p-6">
          <span className="label">Nuestro oficio</span>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-paper">
            Gobernamos la información de operaciones que no pueden fallar: ordenarla, protegerla y volverla
            utilizable. <span className="text-muted">Los datos son de cada empresa; nuestro trabajo es hacerlos
            confiables.</span> Esa misma disciplina es la que aquí mide el aporte de cada persona con datos y no
            con opiniones.
          </p>
        </div>
      </Bloque>

      {/* ---------- 03 Cómo se mide ---------- */}
      <Bloque n="03" titulo="Cómo se mide tu trabajo">
        <span className="label">El Ágora: de la necesidad a la reputación</span>
        <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PASOS.map((p, i) => (
            <li key={p} className="card flex items-baseline gap-2 px-3 py-3">
              <span className="text-[10px] font-bold text-primary-dim">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-xs font-bold uppercase tracking-wide text-paper">{p}</span>
            </li>
          ))}
        </ol>

        <div className="mt-8">
          <span className="label">Cuatro ejes. Historial que solo crece.</span>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EJES.map((e) => (
              <div key={e} className="border-l-2 border-primary bg-surface/40 px-4 py-3">
                <span className="font-head text-sm font-bold uppercase tracking-wide text-primary">{e}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <span className="label">Pago por hitos</span>
          <div className="mt-3 flex h-12 w-full overflow-hidden border border-line">
            <div className="flex w-[20%] items-center justify-center bg-primary-dim text-[11px] font-bold text-black">
              20%
            </div>
            <div className="flex w-[70%] items-center justify-center bg-primary text-xs font-bold text-black">
              70%
            </div>
            <div className="flex w-[10%] items-center justify-center bg-line-strong text-[11px] font-bold text-muted">
              10%
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[11px] uppercase tracking-wide text-faint">
            <span>Arranque</span>
            <span>Entrega aprobada</span>
            <span>Cierre</span>
          </div>
        </div>
      </Bloque>

      {/* ---------- 04 El triángulo ---------- */}
      {!compacta && (
        <Bloque n="04" titulo="Tres activos, tres roles">
          <div className="grid gap-4 md:grid-cols-3">
            {TRIANGULO.map((t) => (
              <div key={t.activo} className="card p-5">
                <div className="font-head text-2xl font-bold text-primary">{t.activo}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-widest text-paper">{t.rol}</div>
                <p className="mt-3 text-sm leading-6 text-muted">{t.detalle}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-xl text-sm leading-7 text-muted">
            Ninguno sustituye a otro. Una recompensa que se siente vacía es peor que ninguna.
          </p>
        </Bloque>
      )}

      {/* ---------- 05 Tu primer punto ---------- */}
      <Bloque n={compacta ? "04" : "05"} titulo="Tu primer punto, hoy mismo">
        <div className="card p-6">
          <p className="max-w-2xl font-head text-lg leading-snug text-paper md:text-xl">
            Una primera misión de menos de dos horas.
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            Mejoras a esta misma aplicación, investigación, contenido, traducciones. No hay que esperar un proyecto
            grande para empezar a construir historial.
          </p>
        </div>
      </Bloque>

      {/* ---------- 06 Lo que sí prometemos ---------- */}
      <Bloque n={compacta ? "05" : "06"} titulo="Lo que sí prometemos">
        <p className="max-w-2xl text-sm leading-7 text-muted">
          Esta es la primera vuelta completa del sistema con personas reales. Entras a construirlo, no a un
          producto terminado.
        </p>
        <blockquote className="mt-7">
          <p className="max-w-2xl font-head text-2xl leading-snug text-paper md:text-3xl">
            No se promete precio.
            <br />
            <span className="text-primary glow-text">Se promete memoria.</span>
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted">
            Lo que aportes desde el primer día cuenta para cualquier reparto futuro. Si te alejas, tu historial se
            congela y sigue siendo tuyo cuando vuelvas.
          </p>
        </blockquote>
      </Bloque>
    </div>
  );
}

export default IntroEcosistema;
