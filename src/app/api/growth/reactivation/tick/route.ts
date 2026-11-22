import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { runDueCustomerReactivationCampaigns } from "@/product/crm/reactivation-service";

export const dynamic = "force-dynamic";

/**
 * Sends reactivation SMS to dormant customers of Receptionist-tier
 * organizations (cron, or manual ops run).
 */
async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(request, "growth.reactivation.tick");
  if (refusal) return refusal;

  const result = await runDueCustomerReactivationCampaigns();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
