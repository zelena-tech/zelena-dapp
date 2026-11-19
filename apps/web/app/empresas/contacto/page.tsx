import type { Viewport } from "next";
import { metadatos } from "@/lib/seo";
import { RUTA_CONTACTO } from "@/lib/menu";
import MarcoEmpresas from "../../_landing/empresas/MarcoEmpresas";
import s from "../../_landing/landing.module.css";
import HeroDemo from "../../_landing/demo/HeroDemo";
import PasosDemo from "../../_landing/demo/PasosDemo";
import {
  FORMULARIO_CONTACTO,
  HERO_CONTACTO,
  META_CONTACTO,
  PASOS_CONTACTO,
  interesContacto,
} from "../../_landing/copy-contacto";

// Igual que las páginas de la landing: el layout raíz lee la sesión.
export const dynamic = "force-dynamic";

// Diseño claro de la landing: barra del navegador blanca y controles claros.
export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export const metadata = metadatos({
  ruta: RUTA_CONTACTO,
  idioma: "es",
  // Sin imagen, igual que el resto de páginas para empresas: la de public/og/ es de la comunidad.
  imagen: null,
  titulo: META_CONTACTO.titulo,
  descripcion: META_CONTACTO.descripcion,
});

/**
 * El contacto en español, con el diseño de zelena.tech (pedido del founder, 2026-11-17:
 * nada del diseño oscuro viejo). Es "Book a demo" en español: el mismo hero con el
 * formulario y los mismos tres pasos, dentro del cromo de la inicio. Llega con
 * `?interes=<slug>` desde cada "Quiero esta solución"; un interés que el formulario no
 * ofrece se ignora. Todo el texto vive en copy-contacto.ts.
 */
export default function Contacto({ searchParams }: { searchParams: { interes?: string } }) {
  return (
    <MarcoEmpresas pagina="contacto">
      <HeroDemo hero={HERO_CONTACTO} formulario={FORMULARIO_CONTACTO} interesInicial={interesContacto(searchParams.interes)} />
      <div className={s.anchoContenido}>
        <PasosDemo textos={PASOS_CONTACTO} />
      </div>
    </MarcoEmpresas>
  );
}
