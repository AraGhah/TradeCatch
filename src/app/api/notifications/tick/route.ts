import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getNotificationService } from "@/product/notifications/runtime";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  const dedicatedSecret = process.env.NOTIFICATION_RETRY_SECRET?.trim();
  const authorized = dedicatedSecret
    ? authorizeOpsRequest(request, {
        ...process.env,
        MISSED_CALL_OPS_SECRET: dedicatedSecret,
        CRON_SECRET: undefined,
      })
    : authorizeOpsRequest(request);
  if (!authorized) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "notifications.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) return missingOpsActorResponse();
  const service = getNotificationService();
  const processed = await service.processDue(25);
  const escalated = await service.processEscalations();
  return NextResponse.json({ ok: true, ...processed, ...escalated });
}

export const GET = tick;
export const POST = tick;
