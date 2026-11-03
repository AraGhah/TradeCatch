import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { isDurableMissedCallStoreConfigured } from "@/lib/config";
import { getMissedCallMaintenanceRuntime } from "@/product/missed-call/runtime";
import { getPgPool } from "@/product/missed-call/postgres-store";
import {
  getSmsInbox,
  isSmsInboxAvailable,
  processSmsInbox,
} from "@/product/sms-receptionist/inbox-runtime";

export const dynamic = "force-dynamic";

/**
 * Resume texts the webhook accepted but a Worker did not finish. This must
 * never stop escalation timers or the outbox from running, so a failure is
 * reported (`ok: false`) instead of thrown.
 */
async function drainInbound() {
  if (!isSmsInboxAvailable()) {
    return { processed: 0, failed: 0, skipped: true };
  }
  let result: { processed: number; failed: number };
  try {
    result = await processSmsInbox();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "tradecatch.sms.inbox_tick_failed",
        code: error instanceof Error ? error.name : "Error",
      }),
    );
    return { processed: 0, failed: 1, skipped: false };
  }
  try {
    await getSmsInbox().purge();
  } catch (error) {
    // Housekeeping only; the next tick tries again.
    console.warn(
      JSON.stringify({
        event: "tradecatch.sms.inbox_purge_failed",
        code: error instanceof Error ? error.name : "Error",
      }),
    );
  }
  return { ...result, skipped: false };
}

/** Process escalation timers (cron or manual). Requires ops bearer auth. */
async function tick(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }
  const audit = logOpsAccess(request, "escalations.tick");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) {
    return missingOpsActorResponse();
  }

  const { engine, store } = getMissedCallMaintenanceRuntime();
  const inbox = await drainInbound();
  const result = await engine.processEscalations();

  if (isDurableMissedCallStoreConfigured()) {
    const url = process.env.DATABASE_URL?.trim();
    if (url) {
      try {
        await getPgPool(url).query(
          `INSERT INTO mc_ops_meta (key, value, updated_at)
           VALUES ('escalations_last_tick', $1, now())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_at = now()`,
          [new Date().toISOString()],
        );
      } catch (err) {
        console.error("[escalations/tick] failed to record freshness", err);
      }
    }
  }

  let queue;
  try {
    queue = await store.getOutboundQueueStats();
  } catch {
    queue = undefined;
  }

  return NextResponse.json({
    ok: result.outboxFailed === 0 && inbox.failed === 0,
    ...result,
    inbox,
    queue,
  });
}

// Vercel Cron invokes routes with GET; POST remains available for manual ops.
export const GET = tick;
export const POST = tick;
