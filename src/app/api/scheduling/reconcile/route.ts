import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  guardOpsRequest,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import {
  getSchedulingStore,
  getSchedulingService,
  reconcileCalcomAll,
  reconcileCalcomFor,
  reconcileGoogleBusy,
  runGoogleSyncTick,
} from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(request, "scheduling.reconcile");
  if (refusal) return refusal;
  const confirmations =
    await getSchedulingService().retryPendingConfirmations();
  // Cal.com bookings are checked against the contractor's own account: a time
  // moved or cancelled there is followed, and a request that never answered
  // is settled. Counts only; nothing about a customer leaves this handler.
  const calcom = await reconcileCalcomAll().catch(() => ({ failed: true }));
  // Google Calendar has its own once-a-minute tick; this is the fallback that
  // keeps it moving if that schedule ever stops.
  const google = await runGoogleSyncTick().catch(() => ({ failed: true }));
  return NextResponse.json({
    ok: true,
    confirmations,
    calcom,
    google,
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
