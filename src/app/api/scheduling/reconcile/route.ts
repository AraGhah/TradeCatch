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
  reconcileCalcomAll,
  reconcileCalcomFor,
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
  // Cal.com bookings are checked against the contractor's own account: a time
  // moved or cancelled there is followed, and a request that never answered
  // is settled. Counts only; nothing about a customer leaves this handler.
  const calcom = await reconcileCalcomAll().catch(() => ({ failed: true }));
  return NextResponse.json({
    ok: true,
    confirmations,
    calcom,
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
    const calcom = await reconcileCalcomFor(organizationId).catch(() => ({
      failed: true,
    }));
    return NextResponse.json({ ok: true, ...result, calcom });
  }
  return tick(request);
}

export const GET = tick;
