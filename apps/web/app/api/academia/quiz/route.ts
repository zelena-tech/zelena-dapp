import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getQuiz, gradeQuiz, statusDeErrorAcademia } from "@/lib/academia";
import { academiaQuizSchema } from "@/lib/validation";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// GET ?token=... → devuelve las 3 preguntas de ESTA lectura (sin respuestas). Valida el
// tiempo mínimo. Siempre las mismas para la misma lectura (hallazgo A2: no recorre el pool).
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.claSigned) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!rateLimit(`aca-quiz-get:${session.wallet}:${clientIp(req.headers)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (token.length < 8) return NextResponse.json({ error: "Token inválido." }, { status: 400 });
  try {
    const questions = getQuiz(getDb(), session.wallet, token);
    return NextResponse.json({ ok: true, questions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: statusDeErrorAcademia(e) });
  }
}

// POST → califica UNA vez las preguntas servidas en esta lectura. Aprobar 2/3 desbloquea
// puntos; si no apruebas, no se dice cuántas acertaste y hay que esperar y volver a leer.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !session.claSigned) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!rateLimit(`aca-quiz:${session.wallet}:${clientIp(req.headers)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = academiaQuizSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  const { token, quizIds, answers } = parsed.data;
  try {
    const r = gradeQuiz(getDb(), session.wallet, token, quizIds, answers);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: statusDeErrorAcademia(e) });
  }
}
