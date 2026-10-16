import { getSaasStore } from "@/product/saas/runtime";
import { getAutomationServices, getAutomationStore } from "./runtime";

/**
 * When missed-call recovery is enabled for the contractor, the configurable
 * scheduler owns the recovery SMS. Module A keeps its workflow and must not
 * also send the opening text.
 * Returns false when the automation is missing or disabled, so existing
 * recovery behaviour is unchanged.
 */
export async function deferMissedCallOpening(input: {
  clientAccountId: string;
  callId: string;
  callerE164: string;
  disposition: string;
  customerLanguage?: "en" | "fr";
}): Promise<boolean> {
  const org = await getSaasStore().findOrganizationByMissedCallClientId(
    input.clientAccountId,
  );
  if (!org || org.status !== "active") return false;
  const result = await getAutomationServices().scheduleMissedCall({
    organizationId: org.id,
    callId: input.callId,
    callerE164: input.callerE164,
    disposition: input.disposition,
    language: input.customerLanguage,
    simulated: false,
  });
  return result.deferred;
}

export async function handQuoteToSmsAutomation(input: {
  organizationId: string;
  threadId: string;
  phoneE164: string;
  customerName?: string;
  quoteRef?: string;
  locale?: "en" | "fr";
  quoteSentAt: string;
}): Promise<boolean> {
  const result = await getAutomationServices().scheduleQuoteFollowUps({
    ...input,
    simulated: false,
  });
  return result.scheduled;
}

export async function cancelQuoteAutomation(
  organizationId: string,
  threadId: string,
  reason: string,
): Promise<void> {
  await getAutomationServices().cancelQuote(organizationId, threadId, reason);
}

export async function quoteAutomationHasJob(
  organizationId: string,
  threadId: string,
): Promise<boolean> {
  return getAutomationStore().hasJobForQuote(organizationId, threadId);
}
