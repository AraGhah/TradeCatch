import { NextRequest, NextResponse } from "next/server";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { BodyTooLargeError, readFormParamsBounded } from "@/lib/request-body";
import { runAfterResponse } from "@/lib/after-response";
import { withPostgresRequestScope } from "@/lib/postgres-pool";
import {
  getSmsInbox,
  processSmsInbox,
} from "@/product/sms-receptionist/inbox-runtime";

export const dynamic = "force-dynamic";

const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function twiml(replies: string[]) {
  if (!replies.length) return EMPTY_TWIML;
  const messages = replies.map((r) => `<Message>${escapeXml(r)}</Message>`);
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messages.join("")}</Response>`;
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  let params: Record<string, string>;
  try {
    params = await readFormParamsBounded(request, 32_768);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid form" },
      {
        status: error instanceof BodyTooLargeError ? 413 : 400,
      },
    );
  }
  if (!(await assertTwilioWebhook(request, params))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }
  const id = params.MessageSid || params.SmsSid;
  if (!id || !params.From || !params.To || !/^[A-Za-z0-9_-]{3,128}$/.test(id)) {
    return NextResponse.json(
      { error: "Missing message identity" },
      { status: 400 },
    );
  }
  params.MessageSid = id;
  let replies: string[] = [];
  try {
    const { store, engine } = await ensureMissedCallReady();
    const client = await store.findClientBySmsFromNumber(params.To);
    const org = client
      ? await getSaasStore().findOrganizationByMissedCallClientId(client.id)
      : null;
    if (client && org?.status === "active") {
      await getSmsInbox().enqueue({
        id,
        organizationId: org.id,
        clientId: client.id,
        fromE164: params.From,
        toE164: params.To,
        params,
      });
      await runAfterResponse(async () => {
        await withPostgresRequestScope(
          async () => {
            await processSmsInbox();
          },
          { independent: true },
        );
      });
    } else if (client) {
      // A business whose organization is suspended or missing gets no AI reply
      // and no CRM record, but a customer's STOP and a technician's reply must
      // still be honored, exactly as before the inbox existed.
      const mediaCount = Math.min(
        10,
        Math.max(0, Number(params.NumMedia) || 0),
      );
      const result = await engine.handleInboundSms({
        fromE164: params.From,
        toE164: params.To,
        body: params.Body ?? "",
        mediaUrls: Array.from(
          { length: mediaCount },
          (_, i) => params[`MediaUrl${i}`],
        ).filter(Boolean),
        messageSid: id,
      });
      replies = result.replies;
      console.warn(
        JSON.stringify({
          event: "tradecatch.sms.inactive_organization",
          messageSid: id,
        }),
      );
    } else {
      console.warn(
        JSON.stringify({
          event: "tradecatch.sms.unrouted_to_number",
          messageSid: id,
        }),
      );
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "tradecatch.sms.receipt_failed",
        messageSid: id,
        code: error instanceof Error ? error.name : "Error",
      }),
    );
    return NextResponse.json(
      { error: "Receipt could not be saved" },
      { status: 503 },
    );
  }
  console.info(
    JSON.stringify({
      event: "tradecatch.sms.received",
      messageSid: id,
      receiptMs: Date.now() - started,
    }),
  );
  return new NextResponse(twiml(replies), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
