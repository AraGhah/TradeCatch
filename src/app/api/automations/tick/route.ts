import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getAutomationServices } from "@/product/sms-automation/runtime";

export const dynamic = "force-dynamic";

/** Claim and send due automation jobs. Invoked by the Cloudflare cron, not a logged-in user. */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "automations.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) {
    return missingOpsActorResponse();
  }
  const result = await getAutomationServices().processDue({ limit: 25 });
  return NextResponse.json({
    ok: true,
    processed: result.processed,
    outcomes: result.jobs.map((job) => ({
      id: job.id,
      // A job put back in the queue after a failed attempt is reported as a retry, so the
      // scheduler's monitoring sees it. A failed or uncertain send is reported as such and
      // is never folded into a success.
      status: job.status === "pending" && job.lastError ? "retry" : job.status,
      reason: job.cancelReason || job.lastError || job.responseStatus,
      simulated: job.simulated,
    })),
  });
}

export const GET = tick;
export const POST = tick;
