import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

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
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
