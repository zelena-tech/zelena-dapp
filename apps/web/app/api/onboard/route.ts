import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { consumeInvite, InviteConsumeError } from "@/lib/invites";
import { onboardSchema } from "@/lib/validation";
import { setSessionCookie } from "@/lib/session";
import { claCanonicalHash } from "@/lib/cla";
import { CLA_VERSION } from "@/lib/config";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  if (!rateLimit(`onboard:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const parsed = onboardSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  const { code, wallet, name, isDemo, claHash, signature } = parsed.data;

  // Verifica que el hash del CLA coincide con el texto canónico del servidor.
  if (claHash !== claCanonicalHash()) {
    return NextResponse.json({ error: "El hash del CLA no coincide con la versión oficial." }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare(`SELECT wallet FROM users WHERE wallet = ?`).get(wallet);
  if (existing) {
    return NextResponse.json({ error: "Esta wallet ya está registrada." }, { status: 409 });
  }

  let issuer: string;
  try {
    issuer = consumeInvite(db, code, wallet);
  } catch (e) {
    if (e instanceof InviteConsumeError) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: "No se pudo usar la invitación." }, { status: 400 });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (wallet, display_name, tier, invited_by, is_demo, cla_signed) VALUES (?, ?, 'Bronze', ?, ?, 1)`
    ).run(wallet, name, issuer, isDemo ? 1 : 0);
    db.prepare(
      `INSERT INTO cla_signatures (wallet, cla_version, cla_hash, signature, anchor_status) VALUES (?, ?, ?, ?, 'pending')`
    ).run(wallet, CLA_VERSION, claHash, signature);
    db.prepare(
      `INSERT INTO anchor_queue (kind, ref, data_key, payload_hash, status) VALUES ('cla', ?, ?, ?, 'pending')`
    ).run(wallet, `cla:v${CLA_VERSION}:${wallet.slice(0, 12)}`, claHash);
  });
  tx();

  await setSessionCookie({ wallet, name, tier: "Bronze", isFounder: false, claSigned: true, isDemo });
  return NextResponse.json({ ok: true });
}
