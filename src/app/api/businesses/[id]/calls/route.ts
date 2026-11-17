import { getMissedCallReadStore } from "@/product/missed-call/runtime";
import { loadCallFeed } from "@/product/receptionist/call-feed";
import { callState } from "@/product/receptionist/call-history-view";
import { receptionistErrorCode } from "@/product/receptionist/diagnostics";
import { NextRequest, NextResponse } from "next/server";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { CallSession } from "@/product/receptionist/types";
import { authorizeBusinessMemberOrAdmin, loadClientForOrg } from "../_shared";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

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
  const q = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  const runtime = getReceptionistRuntime();
  let calls: CallSession[];
  let incomplete = false;
  try {
    // Both call paths (receptionist and missed-call text-back), this business only.
    const feed = await loadCallFeed({
      clientAccountId: client.id,
      receptionist: runtime.store,
      missedCall: getMissedCallReadStore,
    });
    calls = feed.calls;
    incomplete = feed.missedCallsUnavailable;
  } catch (err) {
    // The history is stored, not gone: say it could not be read instead of
    // answering with an empty list the screen would show as "no calls".
    console.error(
      JSON.stringify({
        event: "tradecatch.calls.list_failed",
        errorCode: receptionistErrorCode(err),
      }),
    );
    return NextResponse.json(
      { ok: false, error: "Calls could not be loaded." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (q) {
    calls = calls.filter((c) => {
      const hay = [
        c.id,
        c.callSid,
        c.fromE164,
        c.outcome,
        c.summary?.callerName,
        c.summary?.issue,
        c.summary?.headline,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  calls = calls.slice(0, limit);

  return NextResponse.json({
    ok: true,
    // True when the missed-call text-back calls could not be read: the list may
    // be missing some, and a client must not present it as the whole history.
    incomplete,
    // Times are stored in UTC; this is the zone to show them in.
    timezone: client.timezone,
    calls: calls.map((c) => {
      // A missed-call text-back record carries only what Module A captured:
      // no language, no dialed number, and nobody to credit with handling it.
      const missedCallPath = c.activity?.origin === "missed_call";
      return {
        id: c.id,
        callSid: c.callSid,
        source: missedCallPath
          ? ("missed_call" as const)
          : ("receptionist" as const),
        simulated: c.callSid.startsWith("sim_") || c.callSid.startsWith("demo_"),
        direction: c.activity?.direction ?? ("inbound" as const),
        provider: c.activity?.provider ?? ("twilio" as const),
        state: callState(c),
        fromE164: c.fromE164,
        toE164: c.toE164 || undefined,
        language: missedCallPath ? undefined : c.language,
        status: c.status,
        outcome: c.outcome,
        handledBy: missedCallPath
          ? c.activity?.disposition === "answered"
            ? "human"
            : null
          : c.outcome === "transferred" || c.outcome === "emergency_transferred"
            ? "human"
            : "ai",
        transferStatus: c.transfers.at(-1)?.status ?? null,
        leadCreated: Boolean(c.summary?.callerName || c.slots.callerName),
        appointmentBooked: c.outcome === "appointment_booked",
        appointmentRequested: c.outcome === "appointment_requested",
        urgency: c.urgency?.level,
        afterHours: c.afterHours,
        summary: c.summary,
        slots: c.slots,
        durationSeconds: c.durationSeconds,
        startedAt: c.startedAt,
        endedAt: c.endedAt,
        finalizedAt: c.finalizedAt,
      };
    }),
  });
}
