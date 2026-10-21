import { NextRequest, NextResponse } from "next/server";
import {
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { authorizeNotificationJob } from "@/product/notifications/job-auth";
import { getNotificationService } from "@/product/notifications/runtime";

export const dynamic = "force-dynamic";

/**
 * Cron (every 15 min): queue each opted-in member's summary of the local day
 * once their business reaches the summary hour. The queued events are
 * delivered by the every-minute /api/notifications/tick.
 */
async function tick(request: NextRequest) {
  if (!authorizeNotificationJob(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "notifications.daily-summary.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) return missingOpsActorResponse();
  const summaries = await getNotificationService().generateDailySummaries();
  return NextResponse.json({ ok: true, ...summaries });
}

export const GET = tick;
export const POST = tick;
