import LandingShell from "../_landing/LandingShell";

// Provisional (WP33): la página Community en inglés la reemplaza quien construye sus
// secciones. Los ritos que vivían aquí están en /comunidad/ritos.
export const dynamic = "force-dynamic";

export default function ComunidadPage() {
  return (
    <LandingShell pagina="comunidad">
      <h1>Community</h1>
    </LandingShell>
  );
}
