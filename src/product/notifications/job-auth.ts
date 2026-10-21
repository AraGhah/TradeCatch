import type { NextRequest } from "next/server";
import { authorizeOpsRequest } from "@/lib/ops-auth";

/**
 * Scheduled notification jobs prefer the dedicated NOTIFICATION_RETRY_SECRET.
 * Existing ops credentials remain the fallback while it is not provisioned.
 */
export function authorizeNotificationJob(request: NextRequest): boolean {
  const dedicatedSecret = process.env.NOTIFICATION_RETRY_SECRET?.trim();
  return dedicatedSecret
    ? authorizeOpsRequest(request, {
        ...process.env,
        MISSED_CALL_OPS_SECRET: dedicatedSecret,
        CRON_SECRET: undefined,
      })
    : authorizeOpsRequest(request);
}
