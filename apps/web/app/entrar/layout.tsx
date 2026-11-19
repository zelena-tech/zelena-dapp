import { metadatos } from "@/lib/seo";

// La página es de cliente ("use client") y no puede exportar metadatos: los pone este
// layout. `noindex, follow`: no compite con la home en los buscadores, y NO se bloquea en
// robots.txt, porque entonces Google nunca leería el noindex.
export const metadata = metadatos({
  ruta: "/entrar",
  idioma: "es",
  titulo: "Entrar · Zelena",
  descripcion: "Entra a Zelena con tu llave.",
  indexar: false,
});

export default function EntrarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
