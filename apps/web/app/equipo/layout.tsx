/**
 * Layout del módulo equipo (WP14/WP15).
 *
 * Monta el banner del segundo correo personal (WP13, doc 15 §2) para TODO `/equipo`.
 * Aquí y no en el layout raíz porque este es donde el core team pasa el día: es el
 * único sitio donde "persistente" significa algo. El banner se autoconsulta y no se
 * dibuja si ya hay correo vinculado, así que va sin condicionales.
 *
 * No bloquea nada: lo único pendiente sin segundo correo es recibir puntos o pagos.
 */
import { EntraSecondEmailBanner } from "@/components/EntraSecondEmailBanner";

export default function EquipoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EntraSecondEmailBanner />
      {children}
    </>
  );
}
