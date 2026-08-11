import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getGrowthServices } from "@/product/growth";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "growth.crm.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) {
    return missingOpsActorResponse();
  }

  const result = await getGrowthServices().processCrmDlq();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
