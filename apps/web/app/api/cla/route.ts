import { NextResponse } from "next/server";
import { readClaText, claCanonicalHash } from "@/lib/cla";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ text: readClaText(), hash: claCanonicalHash() });
}
