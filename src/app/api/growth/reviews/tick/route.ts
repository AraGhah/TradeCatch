import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getGrowthServices } from "@/product/growth";
import {
  resolveBusinessNameForOrganization,
  resolveSmsFromForOrganization,
} from "@/product/starter/org-context";

export const dynamic = "force-dynamic";

/** Process due Google review request SMS (cron or manual ops). */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "growth.reviews.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) {
    return missingOpsActorResponse();
  }

  const result = await getGrowthServices().processReviewRequests({
    businessNameForOrg: resolveBusinessNameForOrganization,
    smsFromForOrg: resolveSmsFromForOrganization,
  });

  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
