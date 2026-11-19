import type { Viewport } from "next";
import { metadatos } from "@/lib/seo";
import { RUTA_DEMO } from "@/lib/menu";
import LandingShell from "../_landing/LandingShell";
import s from "../_landing/landing.module.css";
import { FORMULARIO_DEMO, META_DEMO } from "../_landing/copy-demo";
import HeroDemo from "../_landing/demo/HeroDemo";
import PasosDemo from "../_landing/demo/PasosDemo";

// El layout raíz lee la sesión (la píldora de cuenta de la cabecera): la página es dinámica.
export const dynamic = "force-dynamic";

// Landing clara: barra del navegador blanca y controles claros.
export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export const metadata = metadatos({
  ruta: RUTA_DEMO,
  idioma: "en",
  titulo: META_DEMO.titulo,
  descripcion: META_DEMO.descripcion,
});

/** Harmony, salvo que el enlace pida otro interés que el formulario ofrezca (?interes=wms). */
function interesDe(pedido: string | undefined): string {
  return FORMULARIO_DEMO.intereses.some((i) => i.slug === pedido) ? (pedido as string) : "harmony";
}

/**
 * "Book a demo" en inglés, con el cromo de la landing: a dónde llevan los CTA de la home.
 * La solicitud entra por la misma API que el formulario en español (/empresas/contacto).
 */
export default function BookADemo({ searchParams }: { searchParams: { interes?: string } }) {
  return (
    <LandingShell pagina="demo">
      <HeroDemo interesInicial={interesDe(searchParams.interes)} />
      <div className={s.anchoContenido}>
        <PasosDemo />
      </div>
    </LandingShell>
  );
}
