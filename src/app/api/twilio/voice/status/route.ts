import { NextRequest, NextResponse } from "next/server";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";

export const dynamic = "force-dynamic";

function twimlEmpty() {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    },
  );
}

async function parseForm(
  request: NextRequest,
): Promise<Record<string, string>> {
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
 * Resolves client by Twilio To-number (multi-tenant) with MISSED_CALL_CLIENT_ID fallback.
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

  const status = (
    params.DialCallStatus ||
    params.CallStatus ||
    ""
  ).toLowerCase();
  const from = params.From || params.Caller || "";
  const to = params.To || params.Called || "";
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

  const answeredBy = (params.AnsweredBy || "").toLowerCase();
  const machineOrNonHuman = new Set([
    "machine_start",
    "machine_end_beep",
    "machine_end_silence",
    "machine_end_other",
    "fax",
  ]);
  // Prefer explicit AMD "human". Without AnsweredBy, do not invent answered
  // from duration alone — short completed legs stay eligible for recovery.
  const answered =
    status === "completed" &&
    typeof duration === "number" &&
    duration > 0 &&
    answeredBy === "human" &&
    !machineOrNonHuman.has(answeredBy);

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

  const { engine, store } = await ensureMissedCallReady();

  let clientAccountId =
    process.env.MISSED_CALL_CLIENT_ID?.trim() || "client_demo";
  if (to) {
    const byNumber = await store.findClientBySmsFromNumber(to);
    if (byNumber) {
      clientAccountId = byNumber.id;
    }
  }

  // Enforce plan entitlement when the client is linked to a SaaS org.
  try {
    const { getSaasStore } = await import("@/product/saas/runtime");
    const { orgHasFeature } = await import("@/product/saas/entitlements");
    const org =
      await getSaasStore().findOrganizationByMissedCallClientId(clientAccountId);
    if (org && org.status === "active" && !orgHasFeature(org.plan, "MISSED_CALL_RECOVERY")) {
      console.warn("[missed-call/voice] blocked — plan missing MISSED_CALL_RECOVERY", {
        clientAccountId,
        orgId: org.id,
        plan: org.plan,
      });
      return twimlEmpty();
    }
    if (org && org.status !== "active") {
      console.warn("[missed-call/voice] blocked — org not active", {
        clientAccountId,
        orgId: org.id,
        status: org.status,
      });
      return twimlEmpty();
    }
  } catch (err) {
    // SaaS store unavailable must not break single-tenant Module A pilots.
    console.warn("[missed-call/voice] saas entitlement check skipped", err);
  }

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
