import { NextResponse } from "next/server";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";

export const dynamic = "force-dynamic";

/** Process escalation timers (cron or manual). */
export async function POST() {
  const { engine } = await ensureMissedCallReady();
  const result = await engine.processEscalations();
  return NextResponse.json({ ok: true, ...result });
}
