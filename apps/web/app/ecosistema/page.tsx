import type { Metadata } from "next";
import Link from "next/link";
import IntroEcosistema from "@/components/IntroEcosistema";

export const metadata: Metadata = {
  title: "El ecosistema",  // el layout le añade "· Zelena DAO"
  description:
    "Qué es Zelena y qué estamos construyendo: una comunidad donde el trabajo se mide con reglas públicas, se paga por hitos y queda registrado a tu nombre. Testnet, sin dinero real.",
};

export default function EcosistemaPage() {
  return (
    <div className="space-y-12">
      <IntroEcosistema />

      <section className="rule pt-8">
        <div className="card p-6 md:p-8">
          <h2 className="font-head text-xl font-bold uppercase tracking-wide text-paper">¿Te sumas?</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            La entrada es por invitación: necesitas un código. Crear tu wallet toma diez segundos y no requiere
            instalar nada.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/entrar" className="btn btn-primary">
              Entrar a la comunidad
            </Link>
            <Link href="/agora" className="btn btn-ghost">
              Ver los proyectos abiertos
            </Link>
            <Link href="/whitepaper" className="btn btn-ghost">
              Leer el whitepaper
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
