import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import { safeDatabaseErrorCode } from "@/lib/postgres-pool";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import { createNotificationRetryJob } from "@/product/receptionist/notification-retry";
import { createReceptionistNotifier } from "@/product/receptionist/notifications";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

function retryNotifications(
  runtime: ReturnType<typeof getReceptionistRuntime>,
) {
  return createNotificationRetryJob({
    store: runtime.store,
    notifier: createReceptionistNotifier({
      sms: createTwilioSmsPort(),
      sendEmail: sendBusinessNotifyEmail,
    }),
    configFor: (session) =>
      runtime.configs.find((config) => config.id === session.configId),
  }).run();
}

/**
 * Maintenance (cron every 15 min): finalize calls whose Twilio status callback
 * was lost, and purge transcripts past each profile's retention window.
 */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "receptionist.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) return missingOpsActorResponse();

  const runtime = getReceptionistRuntime();
  await runtime.refresh();
  if (runtime.configs.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no_receptionist_profiles" });
  }
  const result = await runtime.engine.tick();

  // Owner notifications that failed transiently. Isolated from the work above:
  // a failure here is reported but never undoes finalizing or purging.
  let notifications: Awaited<ReturnType<typeof retryNotifications>>;
  try {
    notifications = await retryNotifications(runtime);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "tradecatch.receptionist.notification_retry_failed",
        code: error instanceof Error ? error.name : "Error",
        sqlState: safeDatabaseErrorCode(error),
      }),
    );
    return NextResponse.json({ ok: false, ...result, notifications: null });
  }
  return NextResponse.json({ ok: true, ...result, notifications });
}

export const GET = tick;
export const POST = tick;
