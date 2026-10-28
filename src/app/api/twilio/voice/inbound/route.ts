import { NextRequest, NextResponse } from "next/server";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";
import { resolveOnCallTechnicianId } from "@/product/missed-call/technicians";
import { BodyTooLargeError, readFormParamsBounded } from "@/lib/request-body";

export const dynamic = "force-dynamic";

const MAX_FORM_BODY_BYTES = 8_192;

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function twimlReject() {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

function twimlDial(technicianPhoneE164: string) {
  // The number's own StatusCallback (set at purchase time — see
  // number-provisioning.ts) reports call completion to
  // /api/twilio/voice/status independently of this TwiML, which is how
  // missed-call detection keeps working regardless of what we return here.
  // No AnsweringMachineDetection is configured yet, so `AnsweredBy` stays
  // empty on that callback — the status route already treats an empty
  // AnsweredBy conservatively (eligible for recovery) rather than guessing.
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="20" callerId="${escapeXml(technicianPhoneE164)}"><Number>${escapeXml(technicianPhoneE164)}</Number></Dial></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } },
  );
}

async function parseForm(
  request: NextRequest,
): Promise<Record<string, string>> {
  return readFormParamsBounded(request, MAX_FORM_BODY_BYTES);
}

/**
 * Twilio VoiceUrl for Module A numbers: forwards the call to whichever
 * technician is on call right now, resolved per-organization by the
 * receiving ("To") number — the same multi-tenant lookup already used by
 * the SMS inbound and voice status webhooks. Fails safe (rejects the call,
 * logs only the "To" number) when no organization claims the number.
 */
export async function POST(request: NextRequest) {
  let params: Record<string, string>;
  try {
    params = await parseForm(request);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid form" }, { status: 400 });
  }

  const ok = await assertTwilioWebhook(request, params);
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const to = params.To ?? "";
  if (!to) return twimlReject();

  const { store } = await ensureMissedCallReady();
  const client = await store.findClientBySmsFromNumber(to);
  if (!client) {
    console.warn(
      JSON.stringify({ event: "tradecatch.voice.unrouted_to_number", to }),
    );
    return twimlReject();
  }

  const technicianId = resolveOnCallTechnicianId(client, new Date());
  const technician = client.technicianRoster.find(
    (t) => t.id === technicianId && t.active,
  );
  if (!technician) {
    console.warn(
      JSON.stringify({
        event: "tradecatch.voice.no_active_technician",
        clientAccountId: client.id,
      }),
    );
    return twimlReject();
  }

  return twimlDial(technician.phone);
}
