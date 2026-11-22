import { NextRequest, NextResponse } from "next/server";
import { guardOpsRequest } from "@/lib/ops-auth";
import { runGoogleSyncTick } from "@/product/scheduling/runtime";

export const dynamic = "force-dynamic";

/**
 * The once-a-minute pass for Google Calendar: reads what changed in each
 * connected calendar (the safety net behind push notifications), renews push
 * channels before they expire, and sends the changes that are queued or waiting
 * to be retried. It returns counts only.
 */
async function tick(request: NextRequest) {
  const refusal = guardOpsRequest(request, "calendar.google.tick");
  if (refusal) return refusal;
  const result = await runGoogleSyncTick();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = tick;
export const POST = tick;
