import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { getEmailAutomationServices } from "@/product/email-automation/runtime";

export const dynamic = "force-dynamic";

/** Send due email-sequence steps (cron every 15 min or manual ops). */
async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(request, "growth.email.tick");
  if (refusal) return refusal;

  const result = await getEmailAutomationServices().processDue(100);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
