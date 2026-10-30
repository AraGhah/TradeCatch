import { NextRequest, NextResponse } from "next/server";
import { voiceCapabilitiesForPlan } from "@/product/receptionist/plan-limits";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { getTelephonyRuntime } from "@/product/telephony/runtime";
import {
  authorizeBusinessMemberOrAdmin,
  loadClientForOrg,
} from "../../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; callId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id, callId } = await params;
  const access = await authorizeBusinessMemberOrAdmin(request, id);
  if (!access.ok) return access.response;

  const client = await loadClientForOrg(access.organization);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const runtime = getReceptionistRuntime();
  const session =
    (await runtime.store.getSession(callId)) ||
    (await runtime.store.getSessionByCallSid(callId));

  if (!session || session.clientAccountId !== client.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const events = await getTelephonyRuntime().events.listForCall({
    organizationId: id,
    callSid: session.callSid,
  });

  // Growth keeps the summary; the full transcript is a Receptionist Plus feature.
  const transcripts = voiceCapabilitiesForPlan(
    access.organization.plan,
  ).transcripts;

  return NextResponse.json({
    ok: true,
    call: {
      id: session.id,
      callSid: session.callSid,
      simulated:
        session.callSid.startsWith("sim_") ||
        session.callSid.startsWith("demo_"),
      fromE164: session.fromE164,
      toE164: session.toE164,
      language: session.language,
      status: session.status,
      outcome: session.outcome,
      intent: session.intent,
      urgency: session.urgency,
      afterHours: session.afterHours,
      slots: session.slots,
      turns: transcripts ? session.turns : [],
      transcriptAvailable: transcripts,
      transfers: session.transfers,
      summary: session.summary,
      recordingUrl: session.recordingUrl,
      durationSeconds: session.durationSeconds,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      finalizedAt: session.finalizedAt,
      notifications: session.notifications,
    },
    events,
  });
}
