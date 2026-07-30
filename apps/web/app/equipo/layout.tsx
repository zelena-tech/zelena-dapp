/**
 * Layout del módulo equipo (WP14/WP15) — y su ÚNICA puerta de entrada.
 *
 * `middleware.ts` ya exige sesión para `/equipo`, pero "tener sesión" no alcanza:
 * cualquier contribuidor de la cohorte Génesis tiene sesión, y `/equipo/proyectos`
 * mostraba el backlog interno COMPLETO (títulos, responsables, motivos de bloqueo)
 * a cualquiera que hubiera entrado con una invitación. Aquí se cierra: el módulo es
 * trabajo interno de la SAS, así que exige ser del equipo interno, resuelto contra
 * la base (`equipoInternoActor`), no contra los claims de la cookie.
 *
 * Un `core` pasa; el dashboard de WP15 aplica DESPUÉS su propio gate más estrecho
 * (solo founder y supervisores). Dos reglas distintas, cada una en su sitio.
 *
 * Monta además el banner del segundo correo personal (WP13, doc 15 §2) para todo
 * `/equipo`: es donde el core team pasa el día, el único sitio donde "persistente"
 * significa algo. Se autoconsulta y no se dibuja si ya hay correo vinculado.
 */
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoInternoActor } from "@/lib/authz";
import { EntraSecondEmailBanner } from "@/components/EntraSecondEmailBanner";

export default async function EquipoLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/entrar");
  if (!equipoInternoActor(session, getDb())) redirect("/perfil");

  return (
    <>
      <EntraSecondEmailBanner />
      {children}
    </>
  );
}
