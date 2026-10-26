/**
 * Layout de los entornos por cliente (WP17/WP20) — su puerta de entrada.
 *
 * `middleware.ts` ya exige sesión para `/clientes`, pero tener sesión no alcanza:
 * WP17 dice "solo equipo interno accede". Aquí se exige ser del equipo interno,
 * resuelto contra la base (`equipoInternoActor`), no contra los claims de la
 * cookie. Después, cada cliente aplica `client_members` (404 si no participas).
 */
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoInternoActor } from "@/lib/authz";

export default async function ClientesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/entrar");
  if (!equipoInternoActor(session, getDb())) redirect("/perfil");
  return <>{children}</>;
}
