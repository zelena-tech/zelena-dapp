import React from "react";
import Link from "next/link";
import { PASOS_METODO } from "@/lib/metodo";

/**
 * Bienvenida: lo que ve alguien que llega por primera vez, antes de crear su
 * cuenta (paso 0 de /entrar, en modo `compacta`).
 *
 * Criterio de redacción: una idea por bloque, frases cortas y nada de terminal.
 * Quien llega desde un QR en el celular decide en segundos. Sin cifras que no
 * podamos sostener y sin afirmaciones sobre datos de terceros.
 *
 * Componente puramente presentacional (sin hooks ni dependencias de servidor):
 * lo importa una página de cliente.
 */

const TITULAR_H2 =
  "font-serif text-2xl font-normal normal-case leading-snug tracking-normal text-paper sm:text-3xl";

function Bloque({ etiqueta, titulo, children }: { etiqueta: string; titulo: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-5 border-t border-line pt-8">
      <p className="label">{etiqueta}</p>
      <h2 className={TITULAR_H2}>{titulo}</h2>
      {children}
    </section>
  );
}

export function IntroEcosistema({ compacta = false }: { compacta?: boolean }) {
  return (
    <div className="space-y-12">
      {/* ---------- Portada ---------- */}
      <header className="space-y-6">
        <p className="label">Bienvenida</p>
        <h1 className="max-w-3xl font-serif text-4xl font-normal normal-case leading-[1.1] tracking-normal text-paper sm:text-5xl">
          Lo que entregas <em className="font-normal italic text-primary">decide lo que recibes.</em>
        </h1>
        <p className="max-w-xl text-base leading-7 text-muted">
          Reglas públicas. Pago por hitos. Y un historial a tu nombre que{" "}
          <span className="text-paper">nadie puede borrar, ni nosotros</span>.
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="tag tag-sas">Red de pruebas de Stellar</span>
          <span className="tag tag-dao">Entrada por invitación</span>
        </div>
      </header>

      {/* ---------- De dónde viene ---------- */}
      {!compacta && (
        <Bloque etiqueta="De dónde viene" titulo="Nació en el piso de una bodega.">
          <p className="max-w-2xl text-base leading-7 text-muted">
            Construimos software junto a operadores logísticos en Colombia y aprendimos que el trabajo de
            quien alista, empaca y despacha casi nunca se ve. Aquí ese trabajo queda registrado a tu nombre.
          </p>
        </Bloque>
      )}

      {/* ---------- Cómo funciona ---------- */}
      <Bloque etiqueta="Cómo funciona" titulo="De una necesidad a una entrega que se paga.">
        <ol className="grid gap-2 sm:grid-cols-2">
          {PASOS_METODO.map((p) => (
            <li key={p.n} className="flex items-baseline gap-3 border-t border-line py-3">
              <span className="text-[11px] text-primary">{p.n}</span>
              <span className="text-sm text-paper">{p.titulo}</span>
            </li>
          ))}
        </ol>
        <Link href="/metodo" className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted transition-colors hover:text-primary">
          Ver el método completo <span aria-hidden>→</span>
        </Link>
      </Bloque>

      {/* ---------- Lo que sí prometemos ---------- */}
      <Bloque
        etiqueta="Lo que sí prometemos"
        titulo={
          <>
            No se promete precio. <em className="font-normal italic text-primary">Se promete memoria.</em>
          </>
        }
      >
        <p className="max-w-2xl text-base leading-7 text-muted">
          Esta es la primera vuelta completa del sistema con personas reales: entras a construirlo, no a un producto
          terminado. Lo que aportes desde el primer día cuenta, y si te alejas, tu historial sigue siendo tuyo cuando
          vuelvas.
        </p>
      </Bloque>
    </div>
  );
}

export default IntroEcosistema;
