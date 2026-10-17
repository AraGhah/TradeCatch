import { NextRequest, NextResponse } from "next/server";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { renderTwiml } from "@/product/receptionist/voice";
import { getTelephonyRuntime } from "@/product/telephony/runtime";

export const dynamic = "force-dynamic";

/**
 * ConversationRelay <Connect action> callback.
 * If the AI handed off a dial, return <Dial>; otherwise finalize.
 */
export async function POST(request: NextRequest) {
  const form: Record<string, string> = {};
  try {
    const data = await request.formData();
    for (const [k, v] of data.entries()) {
      if (typeof v === "string") form[k] = v;
    }
  } catch {
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }

  if (!(await assertTwilioWebhook(request, form))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const runtime = getReceptionistRuntime();
  await runtime.refresh();
  const callSid = form.CallSid || "";
  const session = callSid
    ? await runtime.store.getSessionByCallSid(callSid)
    : null;

  let handoff: { action?: string; phoneE164?: string; sessionId?: string } = {};
  try {
    handoff = form.HandoffData ? JSON.parse(form.HandoffData) : {};
  } catch {
    handoff = {};
  }

  if (session) {
    const orgId = session.configId.replace(/^rc_org_/, "");
    try {
      await getTelephonyRuntime().events.append({
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

  if (handoff.action === "dial" && handoff.phoneE164 && session) {
    const base = (
      process.env.MISSED_CALL_PUBLIC_WEBHOOK_BASE?.trim() ||
      request.nextUrl.origin
    ).replace(/\/$/, "");
    const plan = {
      sessionId: session.id,
      verbs: [
        {
          verb: "dial" as const,
          next: "dial" as const,
          phoneE164: handoff.phoneE164,
          timeoutSeconds: 25,
          callerIdE164: session.toE164,
        },
      ],
    };
    const xml = renderTwiml(plan, (step, sid) => {
      const url = `${base}/api/twilio/voice/receptionist/${step}`;
      return sid ? `${url}?session=${encodeURIComponent(sid)}` : url;
    });
    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}
