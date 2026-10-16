import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getReliabilityService } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "monitoring.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) return missingOpsActorResponse();
  try {
    const service = getReliabilityService();
    await service.recordSchedulerTick();
    const overview = await service.overview();
    const deployments = await service.listDeployments();
    if (deployments.length === 0) await service.recordDeployment();
    return NextResponse.json({ ok: true, overall: overview.overall, checked: overview.services.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, component: "monitoring", error: error instanceof Error ? error.message : "monitor_check_failed" },
      { status: 500 },
    );
  }
}

export const GET = tick;
export const POST = tick;
