import { NextRequest, NextResponse } from "next/server";
import {
  authorizeOpsRequest,
  logOpsAccess,
  missingOpsActorResponse,
  unauthorizedOpsResponse,
} from "@/lib/ops-auth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";

export const dynamic = "force-dynamic";

/** Ops list of AI receptionist calls (summaries only — no transcripts). */
export async function GET(request: NextRequest) {
  if (!authorizeOpsRequest(request)) return unauthorizedOpsResponse();
  const audit = logOpsAccess(request, "receptionist.calls.list");
  if (audit.missingActor) return missingOpsActorResponse();

  const clientAccountId =
    request.nextUrl.searchParams.get("clientAccountId")?.trim() || undefined;
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit")) || 50,
    200,
  );

  const { store } = getReceptionistRuntime();
  const calls = await store.listSessions({ clientAccountId, limit });
  return NextResponse.json({
    ok: true,
    calls: calls.map((c) => ({
      id: c.id,
      callSid: c.callSid,
      clientAccountId: c.clientAccountId,
      fromE164: c.fromE164,
      language: c.language,
      status: c.status,
      outcome: c.outcome,
      intent: c.intent,
      urgency: c.urgency?.level,
      afterHours: c.afterHours,
      summary: c.summary,
      transfers: c.transfers,
      notifications: c.notifications,
      turnCount: c.turns.length,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      finalizedAt: c.finalizedAt,
    })),
  });
}
