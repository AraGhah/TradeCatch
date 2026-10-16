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
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
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
