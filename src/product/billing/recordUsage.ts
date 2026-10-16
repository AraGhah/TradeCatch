/**
 * Best-effort usage recording for AI minutes / SMS.
 * Failures are logged and never break telephony or messaging.
 */

import { getSaasStore } from "@/product/saas/runtime";
import {
  getBillingStore,
  getSubscriptionService,
  getUsageService,
} from "./runtime";
import type { UsageMetric } from "./types";

export async function recordBusinessUsage(input: {
  businessId: string;
  metric: UsageMetric;
  quantity: number;
  source: string;
  externalId?: string | null;
}): Promise<void> {
  try {
    const org = await getSaasStore().getOrganization(input.businessId);
    if (!org) return;
    const subscription = await getBillingStore().getSubscription(org.id);
    const entitlements = await getSubscriptionService().getEffective(
      org.id,
      org.plan,
    );
    await getUsageService().recordUsage({
      businessId: org.id,
      metric: input.metric,
      quantity: input.quantity,
      source: input.source,
      externalId: input.externalId ?? null,
      plan: entitlements.plan,
      subscription,
    });
  } catch (err) {
    console.error("[billing] usage record failed", err);
  }
}

export async function recordAiCallMinutes(input: {
  businessId: string;
  durationSeconds: number;
  callSid?: string | null;
}): Promise<void> {
  const minutes = Math.max(1, Math.ceil(input.durationSeconds / 60));
  await recordBusinessUsage({
    businessId: input.businessId,
    metric: "ai_call_minutes",
    quantity: minutes,
    source: "receptionist_call",
    externalId: input.callSid ? `call_${input.callSid}` : null,
  });
  await recordBusinessUsage({
    businessId: input.businessId,
    metric: "telephone_minutes",
    quantity: minutes,
    source: "receptionist_call",
    externalId: input.callSid ? `tel_${input.callSid}` : null,
  });
}

export async function recordSmsSegments(input: {
  businessId: string;
  segments?: number;
  messageSid?: string | null;
}): Promise<void> {
  await recordBusinessUsage({
    businessId: input.businessId,
    metric: "sms_segments",
    quantity: Math.max(1, input.segments ?? 1),
    source: "sms_outbound",
    externalId: input.messageSid ? `sms_${input.messageSid}` : null,
  });
}
