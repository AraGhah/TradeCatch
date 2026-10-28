import { NextRequest, NextResponse } from "next/server";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { assertTwilioWebhook } from "@/product/missed-call/twilio-webhook-auth";
import { isOptOut } from "@/product/missed-call/messaging";
import { demoClientAccount } from "@/product/missed-call/fixtures";
import { orgHasFeature } from "@/product/saas/entitlements";
import {
  getStarterServices,
  resolveOrganizationFromSmsTo,
} from "@/product/starter/org-context";
import { BodyTooLargeError, readFormParamsBounded } from "@/lib/request-body";

export const dynamic = "force-dynamic";

const MAX_FORM_BODY_BYTES = 32_768;

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
  const msgs = bodies.map((b) => `<Message>${escapeXml(b)}</Message>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${msgs}</Response>`;
}

async function parseForm(
  request: NextRequest,
): Promise<Record<string, string>> {
  return readFormParamsBounded(request, MAX_FORM_BODY_BYTES);
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
  let moduleAHandled = false;
  let crmOrgId: string | null = null;
  let automationPaused = false;
  try {
    const { resolveOrganizationFromSmsTo: resolveOrg } =
      await import("@/product/starter/org-context");
    const linked = await resolveOrg(to);
    crmOrgId = linked?.id ?? null;
    if (!crmOrgId) {
      const { store } = await ensureMissedCallReady();
      const client = await store.findClientBySmsFromNumber(to);
      if (client) {
        const { getSaasStore } = await import("@/product/saas/runtime");
        const org = await getSaasStore().findOrganizationByMissedCallClientId(
          client.id,
        );
        crmOrgId = org?.status === "active" ? org.id : null;
      }
    }
    if (crmOrgId) {
      const { getCrmService } = await import("@/product/crm/runtime");
      automationPaused = await getCrmService().isAutomationPaused(
        crmOrgId,
        from,
      );
    }
  } catch (err) {
    console.warn("[crm] pause check skipped", err);
  }

  if (!crmOrgId) {
    // No organization or legacy Module A client claims this receiving
    // number. Fail safe (accept the webhook, do not route or reply) and log
    // only the "To" number — TradeCatch's own provisioned number, not
    // customer data — so ops can spot an unprovisioned/misconfigured
    // number without any customer phone number or message content in logs.
    console.warn(
      JSON.stringify({
        event: "tradecatch.sms.unrouted_to_number",
        to,
      }),
    );
  }

  const technicianCommand = /^(accepter|refuser|appeler)\b/i.test(body.trim());
  try {
    if (automationPaused && !technicianCommand) {
      moduleAHandled = true;
    } else {
      const result = await engine.handleInboundSms({
        fromE164: from,
        toE164: to,
        body,
        mediaUrls,
        messageSid: params.MessageSid,
      });
      replies = result.replies;
      moduleAHandled = result.handled;
    }
  } catch (err) {
    console.error("[missed-call/sms]", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  // Quote follow-up: stop on reply / opt-out when Module A did not claim the SMS,
  // or always on STOP keywords so dual workflows still honour opt-out.
  try {
    const org = await resolveOrganizationFromSmsTo(to);
    if (
      org &&
      orgHasFeature(org.plan, "QUOTE_FOLLOW_UP") &&
      !automationPaused &&
      (!moduleAHandled || isOptOut(body, demoClientAccount()))
    ) {
      await getStarterServices().handleInboundSms({
        fromE164: from,
        toE164: to,
        body,
        organizationId: org.id,
      });
    }
  } catch (err) {
    console.warn("[starter/sms] quote dispatcher skipped", err);
  }

  if (crmOrgId && body.trim()) {
    try {
      const { getCrmService } = await import("@/product/crm/runtime");
      const crm = getCrmService();
      await crm.capture({
        organizationId: crmOrgId,
        source: "sms",
        phoneE164: from,
        actor: "sms",
        message: {
          direction: "inbound",
          body,
          fromE164: from,
          toE164: to,
          automated: false,
          providerMessageSid: params.MessageSid,
          deliveryStatus: "delivered",
        },
      });
      for (const reply of replies) {
        await crm.capture({
          organizationId: crmOrgId,
          source: "sms",
          phoneE164: from,
          actor: "sms",
          message: {
            direction: "outbound",
            body: reply,
            fromE164: to,
            toE164: from,
            automated: true,
            simulated: false,
            deliveryStatus: "queued",
          },
        });
      }
    } catch (err) {
      console.warn("[crm] sms sync skipped", err);
    }
  }

  if (crmOrgId && body.trim()) {
    try {
      const { getAutomationServices } =
        await import("@/product/sms-automation/runtime");
      await getAutomationServices().applyInbound({
        organizationId: crmOrgId,
        fromE164: from,
        body,
        messageSid: params.MessageSid,
        skipCrm: true,
      });
      const { emitBusinessEvent } =
        await import("@/product/notifications/hooks");
      await emitBusinessEvent({
        organizationId: crmOrgId,
        type: "customer_message",
        idempotencyKey: `sms:${params.MessageSid}`,
        service: "Customer reply",
        href: "/app/conversations",
        consolidateKey: params.MessageSid,
      });
    } catch (err) {
      console.warn("[sms-automation] inbound skipped", err);
    }
  }

  return new NextResponse(twimlMessages(replies), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
