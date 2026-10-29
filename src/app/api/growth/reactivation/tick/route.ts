import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { runDueCustomerReactivationCampaigns } from "@/product/crm/reactivation-service";

export const dynamic = "force-dynamic";

/**
 * Sends reactivation SMS to dormant customers of Receptionist-tier
 * organizations (cron, or manual ops run).
 */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "growth.reactivation.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) {
    return missingOpsActorResponse();
  }

  const result = await runDueCustomerReactivationCampaigns();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
