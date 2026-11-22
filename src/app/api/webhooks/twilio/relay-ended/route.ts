import { NextRequest, NextResponse } from "next/server";
import { logReceptionistDiagnostic } from "@/product/receptionist/diagnostics";
import { readVerifiedTwilioForm } from "@/product/missed-call/twilio-webhook-auth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import type { VoicePlan } from "@/product/receptionist/types";
import { renderTwiml } from "@/product/receptionist/voice";
import { callEventId } from "@/product/telephony/call-events";
import { getTelephonyRuntime } from "@/product/telephony/runtime";

export const dynamic = "force-dynamic";

/**
 * ConversationRelay <Connect action> callback.
 * If the AI handed off a dial, return <Dial>; otherwise finalize.
 */
export async function POST(request: NextRequest) {
  const verified = await readVerifiedTwilioForm(request);
  if (!verified.ok) return verified.response;
  const form = verified.params;

  const runtime = getReceptionistRuntime();
  await runtime.refresh();
  const callSid = form.CallSid || "";
  const session = callSid
    ? await runtime.store.getSessionByCallSid(callSid)
    : null;

  let handoff: {
    action?: string;
    phoneE164?: string;
    sessionId?: string;
    timeoutSeconds?: number;
    screen?: boolean;
    maxLengthSeconds?: number;
  } = {};
  try {
    handoff = form.HandoffData ? JSON.parse(form.HandoffData) : {};
  } catch {
    handoff = {};
  }
  if (!handoff || typeof handoff !== "object") handoff = {};

  if (session) {
    const orgId = session.configId.replace(/^rc_org_/, "");
    try {
      await getTelephonyRuntime().events.append({
        // One row per call, however many times Twilio repeats the callback.
        id: callEventId(session.callSid, "relay_ended"),
        organizationId: orgId,
        clientAccountId: session.clientAccountId,
        callSid: session.callSid,
        sessionId: session.id,
        kind: "relay_ended",
        detail: handoff.action || form.SessionStatus || "ended",
        payload: { handoff, status: form.SessionStatus },
      });
    } catch (err) {
      console.warn("[telephony] relay-ended event failed", err);
    }
  }

  const base = (
    process.env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim() ||
    request.nextUrl.origin
  ).replace(/\/$/, "");
  const twiml = (plan: VoicePlan) =>
    new NextResponse(
      renderTwiml(plan, (step, sid) => {
        const url = `${base}/api/twilio/voice/receptionist/${step}`;
        return sid ? `${url}?session=${encodeURIComponent(sid)}` : url;
      }),
      { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
    );

  if (handoff.action === "dial" && handoff.phoneE164 && session) {
    const timeout = Number(handoff.timeoutSeconds);
    return twiml({
      sessionId: session.id,
      verbs: [
        {
          verb: "dial",
          next: "dial",
          phoneE164: handoff.phoneE164,
          timeoutSeconds:
            Number.isFinite(timeout) && timeout >= 5 && timeout <= 60
              ? timeout
              : 25,
          callerIdE164: session.toE164,
          ...(handoff.screen === true ? { screen: true } : {}),
        },
      ],
    });
  }

  if (handoff.action === "voicemail" && session) {
    const max = Number(handoff.maxLengthSeconds);
    return twiml({
      sessionId: session.id,
      verbs: [
        {
          verb: "record",
          next: "voicemail",
          maxLengthSeconds:
            Number.isFinite(max) && max >= 10 && max <= 300 ? max : 120,
        },
      ],
    });
  }

  // The relay broke before the call was done (bad voice setting, socket
  // unreachable, a turn that failed): keep the caller and carry on with the
  // classic <Gather> voice instead of hanging up on them.
  const relayFailed =
    handoff.action === "fallback" || form.SessionStatus === "failed";
  if (
    relayFailed &&
    session &&
    session.status === "in_progress" &&
    form.CallStatus !== "completed"
  ) {
    logReceptionistDiagnostic({
      event: "relay_fallback",
      callSid: session.callSid,
      code: form.ErrorCode || handoff.action,
    });
    try {
      return twiml(
        await runtime.engine.handleGather({
          sessionId: session.id,
          speech: "",
          callSid: session.callSid,
        }),
      );
    } catch (error) {
      logReceptionistDiagnostic({
        event: "relay_turn_failed",
        callSid: session.callSid,
        error,
      });
    }
  }

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}
