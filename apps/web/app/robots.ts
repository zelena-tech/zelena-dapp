import type { MetadataRoute } from "next";
import { RUTAS_FUERA_DE_ROBOTS, SITIO } from "@/lib/seo";

// /robots.txt. /entrar NO se bloquea aquí: lleva `noindex` en su meta, y si se bloqueara
// Google nunca lo leería. Tampoco /_next/: Google lo necesita para pintar las páginas.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...RUTAS_FUERA_DE_ROBOTS] }],
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
