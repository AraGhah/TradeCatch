import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { isOptOut } from "@/product/missed-call/messaging";
import { getSaasStore } from "@/product/saas/runtime";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getCrmService } from "@/product/crm/runtime";
import { getStarterStore } from "@/product/starter/runtime";
import { getStarterServices } from "@/product/starter/org-context";
import { handleCustomerSms } from "./runtime";
import type { SmsInboxJob } from "./inbox";

/** What history and the assistant see for an MMS that arrived without any text. */
export const PHOTO_ONLY_BODY = "[photo]";

/** Work runs under a durable, per-conversation inbox claim. */
export async function processInboundSms(job: SmsInboxJob): Promise<void> {
  const { store, engine } = await ensureMissedCallReady();
  const client = await store.findClientBySmsFromNumber(job.toE164);
  const org = await getSaasStore().getOrganization(job.organizationId);
  // Never expose an old tenant's text if its number was reassigned while queued.
  if (
    !client ||
    client.id !== job.clientId ||
    !org ||
    org.status !== "active" ||
    org.missedCallClientId !== client.id
  ) {
    console.warn(
      JSON.stringify({
        event: "tradecatch.sms.routing_changed",
        messageSid: job.id,
      }),
    );
    return;
  }
  const { fromE164: from, toE164: to, params } = job;
  const body = params.Body ?? "";
  // A standard text has NumMedia=0 and no MediaUrl fields; an MMS lists its
  // attachments (and may have no text at all).
  const mediaCount = Math.min(10, Math.max(0, Number(params.NumMedia) || 0));
  const mediaUrls = Array.from(
    { length: mediaCount },
    (_, i) => params[`MediaUrl${i}`],
  ).filter(Boolean);
  // History and the assistant need something to show for a picture sent alone.
  const visibleBody = body.trim() || (mediaUrls.length ? PHOTO_ONLY_BODY : body);
  const crm = getCrmService();
  const paused = await crm.isAutomationPaused(org.id, from);
  const stop = isOptOut(body, client) || params.OptOutType === "STOP";
  const technicianCommand = /^(accepter|refuser|appeler)\b/i.test(body.trim());
  const quoteThreadActive = Boolean(
    await getStarterStore().findActiveQuoteByPhone(org.id, from),
  );
  // Failure to save history must retry before a reply is generated.
  await crm.capture({
    organizationId: org.id,
    source: "sms",
    phoneE164: from,
    actor: "sms",
    message: {
      direction: "inbound",
      body: visibleBody,
      fromE164: from,
      toE164: to,
      automated: false,
      providerMessageSid: job.id,
      deliveryStatus: "delivered",
    },
  });
  const result =
    paused && !technicianCommand && !stop
      ? { handled: true, replies: [] }
      : await engine.handleInboundSms({
          fromE164: from,
          toE164: to,
          body: params.OptOutType === "STOP" ? "STOP" : body,
          mediaUrls,
          messageSid: job.id,
        });
  if (
    orgHasFeature(org.plan, "QUOTE_FOLLOW_UP") &&
    (!paused || stop) &&
    (!result.handled || stop)
  ) {
    await getStarterServices().handleInboundSms({
      fromE164: from,
      toE164: to,
      body,
      organizationId: org.id,
    });
  }
  // Technician guidance now uses the outbox. Advanced Opt-Out sends its own ack.
  if (!params.OptOutType && result.replies.length) {
    for (const [i, reply] of result.replies.entries()) {
      const now = new Date().toISOString();
      await store.enqueueOutbound({
        id: `smscmd_${job.id}_${i}`,
        clientAccountId: client.id,
        fromE164: to,
        toE164: from,
        body: reply,
        detail: "sms_command",
        status: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    // This used to be an instant TwiML reply; do not make a technician wait for
    // the next minute's tick. Best effort: the tick still retries anything left.
    await engine.flushOutbound().catch((error: unknown) => {
      console.warn(
        JSON.stringify({
          event: "tradecatch.sms.command_flush_failed",
          messageSid: job.id,
          code: error instanceof Error ? error.name : "Error",
        }),
      );
    });
  }
  if (!result.handled && visibleBody.trim()) {
    const outcome = await handleCustomerSms({
      organizationId: org.id,
      client,
      fromE164: from,
      toE164: to,
      body: visibleBody,
      messageSid: job.id,
      paused,
      quoteThreadActive,
    });
    if (
      outcome.status === "skipped" &&
      ["unexpected_error", "persistence_failed"].includes(outcome.reason)
    ) {
      throw new Error("SMS processing must retry");
    }
  }
  const { getAutomationServices } =
    await import("@/product/sms-automation/runtime");
  await getAutomationServices().applyInbound({
    organizationId: org.id,
    fromE164: from,
    body,
    messageSid: job.id,
    skipCrm: true,
  });
  const { emitBusinessEvent } = await import("@/product/notifications/hooks");
  await emitBusinessEvent({
    organizationId: org.id,
    type: "customer_message",
    idempotencyKey: `sms:${job.id}`,
    service: "Customer reply",
    href: "/app/conversations",
    consolidateKey: job.id,
  });
}
