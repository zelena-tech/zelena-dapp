/**
 * `/equipo/telegram` — vincular Telegram (WP31-C2, spec §5.C.3, §7 y §8.5).
 *
 * Para cualquiera que entra a `/equipo` (`equipoActor`, leído de la base): por aquí le
 * llega el resumen de sus entregas y lo urgente. Cada quien vincula SU cuenta; el
 * founder, su identidad de equipo (`walletParaVinculo`). Escribir en el tablero por
 * Telegram sigue siendo solo del founder: el resto queda en lectura y nunca ve por ahí
 * más de lo que ve en la web.
 *
 * Puerta propia (el layout no es la puerta, spec §5.A.2). Minimización: de Telegram
 * solo se guarda el id de chat.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { telegramStatus } from "@/lib/config";
import { linkForWallet, walletParaVinculo } from "@/lib/bot-store";
import BotLinkPanel from "@/components/BotLinkPanel";

export const dynamic = "force-dynamic";

export default async function EquipoTelegramPage() {
  const session = await getSession();
  if (!session) redirect("/entrar");
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) redirect("/perfil");

  const link = linkForWallet(db, walletParaVinculo(db, actor.wallet));
  const status = telegramStatus();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-head text-4xl font-bold text-white">Telegram</h1>
        <p className="text-sm text-muted">Recibe aquí el resumen de tus entregas y lo urgente.</p>
      </header>

      <div className="card p-6">
        <BotLinkPanel
          modo="equipo"
          linked={!!link?.telegram_user_id}
          linkedAt={link?.linked_at ?? null}
          enabled={status.enabled && status.configured}
          missing={status.missing}
          optional={status.optional}
          bot={status.botUsername}
        />
      </div>

      <p className="text-xs text-faint">
        Por Telegram solo guardamos tu id de chat.{" "}
        <Link href="/privacidad" className="underline hover:text-primary">
          Ver el aviso de privacidad.
        </Link>
      </p>
    </div>
  );
}
