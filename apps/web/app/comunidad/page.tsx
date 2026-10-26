import type { Viewport } from "next";
import { getDb } from "@/lib/db";
import { CIFRAS_EN_CERO, LLAMADA_AVISO, datosComunidad, type DatosComunidad } from "@/lib/landing-datos";
import { metadatos } from "@/lib/seo";
import LandingShell from "../_landing/LandingShell";
import s from "../_landing/landing.module.css";
import { META } from "../_landing/copy-comunidad";
import Hero from "../_landing/comunidad/Hero";
import Cifras from "../_landing/comunidad/Cifras";
import Tecnologia from "../_landing/comunidad/Tecnologia";
import Orbita from "../_landing/comunidad/Orbita";
import Manifiesto from "../_landing/comunidad/Manifiesto";
import Proyectos from "../_landing/comunidad/Proyectos";
import Decisiones from "../_landing/comunidad/Decisiones";
import Encuentros from "../_landing/comunidad/Encuentros";
import Cierre from "../_landing/comunidad/Cierre";

// Community en inglés (WP33), para quien contribuye. Las cifras y las listas se leen de
// la base en cada visita: solo lo real, y con todo en cero se muestra el cero. Los ritos
// que vivían aquí (asistencia, próximos y pasados) están en /comunidad/ritos.
export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export const metadata = metadatos({
  ruta: "/comunidad",
  idioma: "en",
  titulo: META.titulo,
  descripcion: META.descripcion,
});

/** Si la base ni siquiera abre, la página sale entera con sus ceros (nunca un 500). */
function leerDatos(): DatosComunidad {
  try {
    return datosComunidad(getDb(), new Date());
  } catch (e) {
    console.error("[comunidad] datos de la landing", e);
    return { cifras: CIFRAS_EN_CERO, proyectos: [], votaciones: [], citas: [], llamada: LLAMADA_AVISO };
  }
}

export default function ComunidadPage() {
  const { cifras, proyectos, votaciones, citas, llamada } = leerDatos();
  const votacion = votaciones[0] ?? null;
  return (
    <LandingShell pagina="comunidad">
      <Hero cifras={cifras} votacion={votacion} llamada={llamada} />
      <div className={s.anchoContenido}>
        <Cifras cifras={cifras} />
        <Tecnologia cifras={cifras} votacion={votacion} />
        <Orbita cifras={cifras} />
        <Manifiesto />
        <Proyectos proyectos={proyectos} />
        <Decisiones votaciones={votaciones} decisiones={cifras.decisiones} />
        <Encuentros citas={citas} />
        <Cierre llamada={llamada} />
      </div>
    </LandingShell>
  );
}
