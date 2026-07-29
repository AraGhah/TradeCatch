import { NextRequest, NextResponse } from "next/server";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";

export const dynamic = "force-dynamic";

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function twimlMessages(bodies: string[]) {
  if (bodies.length === 0) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  }
  const msgs = bodies
    .map((b) => `<Message>${escapeXml(b)}</Message>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${msgs}</Response>`;
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
 * Twilio Messaging webhook — customer + technician SMS replies for Module A.
 * Outbound prompts are primarily sent via REST; TwiML Message used for
 * immediate technician guidance replies when the engine returns them.
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

  const from = params.From ?? "";
  const to = params.To ?? "";
  const body = params.Body ?? "";
  const numMedia = Number(params.NumMedia || "0");
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
  }

  if (!from || !to) {
    return new NextResponse(twimlMessages([]), {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  const { engine } = await ensureMissedCallReady();
  let replies: string[] = [];
  try {
    const result = await engine.handleInboundSms({
      fromE164: from,
      toE164: to,
      body,
      mediaUrls,
    });
    // Prefer REST-sent prompts (engine already sent). Only echo TwiML for
    // short tech confirmations that weren't also sent via REST.
    replies = result.replies.filter((r) =>
      /acceptée|enregistré|Répondez OUI|désabonné|unsubscribed/i.test(r),
    );
  } catch (err) {
    console.error("[missed-call/sms]", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return new NextResponse(twimlMessages(replies), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
