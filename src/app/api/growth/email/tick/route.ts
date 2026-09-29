import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getEmailAutomationServices } from "@/product/email-automation/runtime";

export const dynamic = "force-dynamic";

/** Send due email-sequence steps (cron every 15 min or manual ops). */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "growth.email.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) return missingOpsActorResponse();

  const result = await getEmailAutomationServices().processDue(100);
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
