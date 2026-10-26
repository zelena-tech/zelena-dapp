/**
 * Layout del módulo equipo (WP14/WP15/WP31). Es un ATAJO DE UX, no la puerta.
 *
 * `middleware.ts` ya exige sesión para `/equipo`, pero "tener sesión" no alcanza:
 * cualquier contribuidor de la cohorte Génesis tiene sesión. Aquí se evita pintar el
 * marco a quien no tiene acceso, resuelto contra la base (`equipoActor`), nunca
 * contra los claims de la cookie: entra el equipo interno y, desde WP31, quien
 * trabaja por proyecto (contributor con el acuerdo firmado y al menos una membresía).
 *
 * La regla dura (spec WP31 §5.A.2): en App Router el layout NO se vuelve a evaluar en
 * cada navegación del cliente y una petición RSC puede pedir solo el segmento de la
 * página. Por eso cada `page.tsx` de `/equipo` repite su propia puerta, y cada ruta
 * de `/api/equipo` la suya; lo vigila un test estático en lib/authz.test.ts.
 *
 * Monta además el banner del segundo correo personal (WP13, doc 15 §2) para el equipo
 * interno: es donde el core team pasa el día. Se autoconsulta y no se dibuja si ya
 * hay correo vinculado.
 */
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { EntraSecondEmailBanner } from "@/components/EntraSecondEmailBanner";

export default async function EquipoLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const actor = equipoActor(session, getDb());
  if (!actor) redirect("/perfil");

  return (
    <>
      {actor.alcance === "equipo" ? <EntraSecondEmailBanner /> : null}
      {children}
    </>
  );
}
