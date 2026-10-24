import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import {
  getSchedulingStore,
  getSchedulingService,
  reconcileGoogleBusy,
} from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "scheduling.reconcile");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) return missingOpsActorResponse();
  const confirmations =
    await getSchedulingService().retryPendingConfirmations();
  return NextResponse.json({
    ok: true,
    confirmations,
    note: "Per-business reconcile runs when a calendar is connected.",
    ready: Boolean(getSchedulingStore()),
  });
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (organizationId) {
    if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
    const result = await reconcileGoogleBusy(organizationId);
    return NextResponse.json({ ok: true, ...result });
  }
  return tick(request);
}

export const GET = tick;
