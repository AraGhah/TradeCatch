import { NextRequest, NextResponse } from "next/server";
import { authorizeOpsRequest, guardOpsRequest } from "@/lib/ops-auth";
import { recordServerError } from "@/lib/api-error";
import { getReliabilityService } from "@/product/reliability/runtime";
import { safeEqual } from "@/lib/safe-compare";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  const secret = process.env.MONITORING_SECRET?.trim();
  const bearer = request.headers.get("authorization") || "";
  const refusal = guardOpsRequest(
    request,
    "monitoring.tick",
    Boolean(secret && safeEqual(bearer, `Bearer ${secret}`)) ||
      authorizeOpsRequest(request),
  );
  if (refusal) return refusal;
  try {
    const service = getReliabilityService();
    const overview = await service.overview({ notifyOnFailure: true });
    const deployments = await service.listDeployments();
    if (deployments.length === 0) await service.recordDeployment();
    return NextResponse.json({
      ok: true,
      overall: overview.overall,
      checked: overview.services.length,
    });
  } catch (error) {
    const requestId = await recordServerError(error, {
      route: "monitoring.tick",
      request,
    });
    return NextResponse.json(
      {
        ok: false,
        component: "monitoring",
        error: "monitor_check_failed",
        requestId,
      },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}

export const GET = tick;
export const POST = tick;
