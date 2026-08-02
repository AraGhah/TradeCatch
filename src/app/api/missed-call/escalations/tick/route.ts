import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { isDurableMissedCallStoreConfigured } from "@/lib/config";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getPgPool } from "@/product/missed-call/postgres-store";

export const dynamic = "force-dynamic";

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

  const { engine, store } = await ensureMissedCallReady();
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

  return NextResponse.json({ ok: true, ...result, queue });
}

// Vercel Cron invokes routes with GET; POST remains available for manual ops.
export const GET = tick;
export const POST = tick;
