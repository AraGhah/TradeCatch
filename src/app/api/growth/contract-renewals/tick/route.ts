import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { getGrowthServices } from "@/product/growth";
import {
  resolveBusinessNameForOrganization,
  resolveSmsFromForOrganization,
} from "@/product/starter/org-context";

export const dynamic = "force-dynamic";

/** Send due service-contract renewal reminder SMS (cron or manual ops). */
async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(request, "growth.contract-renewals.tick");
  if (refusal) return refusal;

  const result = await getGrowthServices().processContractRenewalReminders({
    businessNameForOrg: resolveBusinessNameForOrganization,
    smsFromForOrg: resolveSmsFromForOrganization,
  });

  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
