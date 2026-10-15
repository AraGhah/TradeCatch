import { NextRequest, NextResponse } from "next/server";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Tenant-scoped call history (real + simulated `sim_*` sessions). */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json({ ok: true, calls: [] });
  }

  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit")) || 50,
    200,
  );
  const runtime = getReceptionistRuntime();
  const calls = await runtime.store.listSessions({
    clientAccountId: client.id,
    limit,
  });

  return NextResponse.json({
    ok: true,
    calls: calls.map((c) => ({
      id: c.id,
      callSid: c.callSid,
      simulated: c.callSid.startsWith("sim_") || c.callSid.startsWith("demo_"),
      fromE164: c.fromE164,
      language: c.language,
      status: c.status,
      outcome: c.outcome,
      intent: c.intent,
      urgency: c.urgency?.level,
      afterHours: c.afterHours,
      summary: c.summary,
      slots: c.slots,
      transfers: c.transfers,
      durationSeconds: c.durationSeconds,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      finalizedAt: c.finalizedAt,
    })),
  });
}
