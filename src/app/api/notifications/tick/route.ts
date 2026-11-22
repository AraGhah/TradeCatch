import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { authorizeNotificationJob } from "@/product/notifications/job-auth";
import { getNotificationService } from "@/product/notifications/runtime";

export const dynamic = "force-dynamic";

async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(
    request,
    "notifications.tick",
    authorizeNotificationJob(request),
  );
  if (refusal) return refusal;
  const service = getNotificationService();
  const processed = await service.processDue(10);
  const escalated = await service.processEscalations();
  return NextResponse.json({ ok: true, ...processed, ...escalated });
}

export const GET = tick;
export const POST = tick;
