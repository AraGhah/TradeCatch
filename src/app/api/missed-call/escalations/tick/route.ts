import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";

export const dynamic = "force-dynamic";

/** Process escalation timers (cron or manual). Requires ops bearer auth. */
export async function POST(request: NextRequest) {
  if (!authorizeOpsRequest(request)) {
    return unauthorizedOpsResponse();
  }

  const { engine } = await ensureMissedCallReady();
  const result = await engine.processEscalations();
  return NextResponse.json({ ok: true, ...result });
}
