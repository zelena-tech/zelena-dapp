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
import { getDb } from "@/lib/db";
import { computeAndStoreEpochFitness, signEpochDecision } from "@/lib/epochs";
import { proposeMutation, revertToVersion, recordNoMutation, type GeneChange } from "@/lib/mutation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.wallet !== FOUNDER_WALLET) {
    return NextResponse.json({ error: "Solo el founder puede administrar." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = adminActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Entrada inválida." }, { status: 400 });
  const { action, applicationId, projectId, milestoneId, contentId, epoch, epochFitnessId, decision, genes, justification, targetVersion } =
    parsed.data;

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
      case "computeEpochFitness": {
        const report = computeAndStoreEpochFitness(getDb(), epoch);
        return NextResponse.json({ ok: true, report });
      }
      case "signEpochDecision": {
        if (!epochFitnessId) throw new Error("Falta epochFitnessId.");
        if (!decision) throw new Error("Falta la decisión (keep/revert).");
        signEpochDecision(getDb(), epochFitnessId, decision);
        break;
      }
      case "proposeMutation": {
        if (!genes || genes.length === 0) throw new Error("Falta el/los gen(es) a mutar.");
        const r = proposeMutation(getDb(), genes as GeneChange[], justification ?? "");
        return NextResponse.json({ ok: true, mutation: r });
      }
      case "revertGenome": {
        if (!targetVersion) throw new Error("Falta la versión de destino.");
        const r = revertToVersion(getDb(), targetVersion, justification ?? "");
        return NextResponse.json({ ok: true, mutation: r });
      }
      case "recordNoMutation": {
        if (!epoch) throw new Error("Falta la época.");
        recordNoMutation(getDb(), epoch, justification ?? "");
        break;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
