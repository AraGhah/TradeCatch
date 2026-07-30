import { NextRequest, NextResponse } from "next/server";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";

export const dynamic = "force-dynamic";

function twimlEmpty() {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

async function parseForm(request: NextRequest): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") params[k] = v;
  }
  return params;
}

/**
 * Twilio StatusCallback / voice webhook for Module A.
 * Expects CallStatus, From, To, CallSid, CallDuration (optional).
 * Map Twilio To-number → client via MISSED_CALL_CLIENT_ID (single-tenant v1).
 */
export async function POST(request: NextRequest) {
  let params: Record<string, string>;
  try {
    params = await parseForm(request);
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }

  const ok = await assertTwilioWebhook(request, params);
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const status = (params.DialCallStatus || params.CallStatus || "").toLowerCase();
  const from = params.From || params.Caller || "";
  const callSid = params.CallSid;
  const duration = params.CallDuration
    ? Number(params.CallDuration)
    : params.DialCallDuration
      ? Number(params.DialCallDuration)
      : undefined;

  // Only act on terminal / no-answer style events
  const terminal = [
    "completed",
    "busy",
    "failed",
    "no-answer",
    "canceled",
    "cancelled",
  ];
  if (!terminal.includes(status) && status !== "") {
    return twimlEmpty();
  }

  const answered =
    status === "completed" &&
    typeof duration === "number" &&
    duration > 0 &&
    params.AnsweredBy !== "machine_start" &&
    params.AnsweredBy !== "fax";

  // Abandoned: very short unanswered ring / canceled quickly
  const abandoned =
    status === "canceled" ||
    status === "cancelled" ||
    (status === "no-answer" && typeof duration === "number" && duration < 5);

  // Unanswered that should recover: no-answer / busy / failed, or completed with 0 talk time
  const isMissedLike =
    status === "no-answer" ||
    status === "busy" ||
    status === "failed" ||
    (status === "completed" && !answered && !abandoned);

  if (!from || (!isMissedLike && !answered && !abandoned)) {
    return twimlEmpty();
  }

  const clientAccountId =
    process.env.MISSED_CALL_CLIENT_ID?.trim() || "client_demo";
  const { engine } = await ensureMissedCallReady();

  try {
    await engine.handleCallEvent({
      clientAccountId,
      callerE164: from,
      answered: Boolean(answered),
      abandoned: Boolean(abandoned) && !answered,
      twilioCallSid: callSid,
      durationSeconds: Number.isFinite(duration) ? duration : undefined,
    });
  } catch (err) {
    console.error("[missed-call/voice]", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return twimlEmpty();
}
