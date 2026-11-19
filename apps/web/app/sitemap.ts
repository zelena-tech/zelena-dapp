import type { MetadataRoute } from "next";
import { listAcademia, listProjects } from "@/lib/repo";
import { RUTAS_SITEMAP, SITIO } from "@/lib/seo";

// Se lee la base de producción en cada pedido, no al compilar (en CI no hay base real).
export const dynamic = "force-dynamic";

/**
 * /sitemap.xml: las rutas públicas fijas, los contenidos activos de la Academia y los
 * proyectos publicados del Ágora (`listProjects` deja fuera los borradores). Sin
 * `lastModified`: Google ignora fechas que siempre dicen "ahora".
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const urls: MetadataRoute.Sitemap = RUTAS_SITEMAP.map((r) => ({ url: `${SITIO}${r}` }));
  try {
    for (const a of listAcademia()) urls.push({ url: `${SITIO}/academia/${encodeURIComponent(a.slug)}` });
    for (const p of listProjects()) urls.push({ url: `${SITIO}/agora/${p.id}` });
  } catch (e) {
    // El sitemap nunca se cae por la base: salen al menos las rutas fijas.
    console.error("[sitemap]", e);
  }
  return urls;
}
