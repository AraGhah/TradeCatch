import { NextRequest, NextResponse } from "next/server";
import { recordServerError } from "@/lib/api-error";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { safeEqual } from "@/lib/safe-compare";
import { runMonitorOnce } from "@/product/reliability/runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The once-a-minute monitor (KAN-28), called by the Cloudflare scheduler.
 *
 * It answers ok:true even when it finds problems: finding an incident is the
 * monitor doing its job, and the scheduler reads ok:false (or a top-level
 * `failed` count) as "this job broke". Only a run that could not complete,
 * because nothing could be stored, answers 503.
 */
async function watch(request: NextRequest) {
  const secret = process.env.MONITORING_SECRET?.trim();
  const bearer = request.headers.get("authorization") || "";
  if (
    !(secret && safeEqual(bearer, `Bearer ${secret}`)) &&
    !authorizeOpsRequest(request)
  )
    return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "monitoring.watch");
  const isCron = Boolean(request.headers.get("x-vercel-cron"));
  if (audit.missingActor && !isCron) return missingOpsActorResponse();

  try {
    const run = await runMonitorOnce();
    // Only the storage-down path sets `emergency`: the run could check the
    // database but not record anything, which is a failed run, not a quiet one.
    if (run.emergency !== undefined)
      return NextResponse.json(
        {
          ok: false,
          component: "monitoring",
          error: "storage_unavailable",
          emergency: run.emergency,
          checks: run.checks,
        },
        { status: 503, headers: NO_STORE },
      );
    return NextResponse.json({ ok: true, ...run }, { headers: NO_STORE });
  } catch (error) {
    const requestId = await recordServerError(error, {
      route: "monitoring.watch",
      request,
    });
    return NextResponse.json(
      {
        ok: false,
        component: "monitoring",
        error: "monitor_run_failed",
        requestId,
      },
      { status: 500, headers: { ...NO_STORE, "x-request-id": requestId } },
    );
  }
}

export const GET = watch;
export const POST = watch;
