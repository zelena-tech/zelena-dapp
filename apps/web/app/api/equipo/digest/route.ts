/**
 * Exportación del digest diario en TEXTO PLANO (WP15).
 *
 * Es una descarga, no un envío: v1 no manda correos, ni mensajes a Teams, ni
 * notificaciones (eso es la fase "automatizar", NO-ALCANCE de este WP). John
 * copia el texto y lo pega donde quiera.
 *
 * El handler solo invoca: la puerta de acceso y el armado del texto viven en
 * lib/digest.ts (que a su vez delega la regla de visibilidad en lib/roles.ts).
 * Un `core` normal recibe 403 aquí, igual que en la página.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { equipoActor } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { today, TeamError } from "@/lib/team";
import { dailyDigestFor, digestFilename, renderDigestText } from "@/lib/digest";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Entra para ver el digest del equipo." }, { status: 401 });
  }
  if (!rateLimit(`equipo:digest:${session.wallet}:${clientIp(req.headers)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const raw = req.nextUrl.searchParams.get("dia");
  if (raw && !DAY_RE.test(raw)) {
    return NextResponse.json({ error: "El día debe tener formato YYYY-MM-DD." }, { status: 400 });
  }
  const day = raw ?? today();

  // La puerta lee la base (nunca los claims de la cookie). Quien no entra a /equipo
  // recibe 403, igual que quien entra pero no supervisa (lo decide dailyDigestFor).
  const db = getDb();
  const actor = equipoActor(session, db);
  if (!actor) {
    return NextResponse.json({ error: "El digest del equipo es para el founder y los supervisores." }, { status: 403 });
  }
  try {
    const text = renderDigestText(dailyDigestFor(db, actor, day));
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${digestFilename(day)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof TeamError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "No se pudo generar el digest." }, { status: 500 });
  }
}
