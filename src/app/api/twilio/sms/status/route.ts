import { NextRequest, NextResponse } from "next/server";
import { getMissedCallReadStore } from "@/product/missed-call/runtime";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";

export const dynamic = "force-dynamic";

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
 * Twilio Message StatusCallback — updates outbox delivery state.
 * Configure StatusCallback on outbound sends (see createTwilioSmsPort).
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

  const sid = params.MessageSid || params.SmsSid;
  const status = params.MessageStatus || params.SmsStatus;
  if (!sid || !status) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const store = getMissedCallReadStore();
    const updated = await store.applyOutboundProviderStatus(sid, status);
    if (!updated) {
      console.warn("[twilio/sms/status] unknown MessageSid", sid, status);
    }
  } catch (err) {
    console.error("[twilio/sms/status]", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  try {
    const { getAutomationServices } =
      await import("@/product/sms-automation/runtime");
    await getAutomationServices().applyDeliveryStatus({
      providerSid: sid,
      providerStatus: status,
      price: params.Price,
      priceUnit: params.PriceUnit,
      eventId: `${sid}:${status}:${params.ErrorCode ?? ""}`,
    });
  } catch (err) {
    console.warn("[sms-automation] status skipped", err);
  }

  try {
    const { getNotificationService } =
      await import("@/product/notifications/runtime");
    await getNotificationService().applyProviderStatus(
      sid,
      status,
      params.ErrorCode,
    );
  } catch (err) {
    console.error("[notifications] status processing failed", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
