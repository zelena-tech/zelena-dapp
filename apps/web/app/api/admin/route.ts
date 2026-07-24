import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { FOUNDER_WALLET } from "@/lib/config";
import { adminActionSchema } from "@/lib/validation";
import {
  approveApplication,
  rejectApplication,
  advanceState,
  approveMilestone,
  toggleContent,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.wallet !== FOUNDER_WALLET) {
    return NextResponse.json({ error: "Solo el founder puede administrar." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = adminActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  const { action, applicationId, projectId, milestoneId, contentId } = parsed.data;

  try {
    switch (action) {
      case "approveApplication":
        if (!applicationId) throw new Error("Falta applicationId.");
        approveApplication(applicationId);
        break;
      case "rejectApplication":
        if (!applicationId) throw new Error("Falta applicationId.");
        rejectApplication(applicationId);
        break;
      case "advanceState": {
        if (!projectId) throw new Error("Falta projectId.");
        const to = advanceState(projectId);
        return NextResponse.json({ ok: true, state: to });
      }
      case "approveMilestone": {
        if (!milestoneId) throw new Error("Falta milestoneId.");
        const r = approveMilestone(milestoneId);
        return NextResponse.json({ ok: true, ...r });
      }
      case "toggleContent":
        if (!contentId) throw new Error("Falta contentId.");
        toggleContent(contentId);
        break;
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
