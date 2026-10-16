/**
 * Probe existing product systems — never invent "connected" status.
 */

import type { Organization } from "@/product/saas/types";
import type { PlanId } from "@/product/saas/entitlements";
import { orgHasFeature } from "@/product/saas/entitlements";
import { getBillingStore, getSubscriptionService } from "@/product/billing/runtime";
import { getReceptionistRuntime } from "@/product/receptionist/runtime";
import { defaultProfileSettings } from "@/product/receptionist/profile";
import { parsePhoneSettings } from "@/product/telephony/phone-settings";
import { getSchedulingService } from "@/product/scheduling/runtime";
import { getAutomationStore } from "@/product/sms-automation/runtime";
import { getGrowthStore } from "@/product/growth";
import type { ActivationCheck } from "./types";
import { activationChecksForPlan } from "./requirements";
import { newId } from "@/product/saas/ids";

export type LiveIntegrationState = {
  businessConfigured: boolean;
  subscriptionOk: boolean;
  subscriptionDetail: string;
  aiConfigured: boolean;
  aiDetail: string;
  phoneConfigured: boolean;
  phoneVerified: boolean;
  phoneDetail: string;
  transferConfigured: boolean;
  calendarConnected: boolean;
  calendarDetail: string;
  messagingReady: boolean;
  messagingDetail: string;
  liveCallVerified: boolean;
  liveCallDetail: string;
};

export async function probeIntegrations(
  organization: Organization,
): Promise<LiveIntegrationState> {
  const plan = organization.plan as PlanId;
  const businessConfigured = Boolean(
    organization.name?.trim() &&
      organization.timezone &&
      (organization.serviceArea?.trim() || organization.city),
  );

  const entitlements = await getSubscriptionService().getEffective(
    organization.id,
    plan,
  );
  const sub = await getBillingStore().getSubscription(organization.id);
  const subscriptionOk =
    entitlements.accessMode === "manual" ||
    entitlements.accessMode === "full" ||
    entitlements.accessMode === "grace" ||
    entitlements.status === "trialing" ||
    entitlements.status === "active";
  const subscriptionDetail = sub?.stripeSubscriptionId
    ? `Stripe status: ${sub.status}`
    : `Organization plan: ${plan} (${entitlements.accessMode})`;

  const profile = await getReceptionistRuntime().profileStore.getProfile(
    organization.id,
  );
  const settings = profile?.settings ?? defaultProfileSettings();
  const greeting = settings.greetingFr || settings.greetingEn || "";
  const aiConfigured =
    Boolean(settings.receptionistName?.trim()) &&
    Boolean(String(greeting).trim()) &&
    (settings.knowledge?.services?.length ?? 0) > 0;
  const aiDetail = aiConfigured
    ? `Receptionist ${settings.receptionistName} configured`
    : "Greeting, name, or services missing";

  const phone = parsePhoneSettings(settings.phoneSettings);
  const tradecatchNumber =
    phone.tradecatchNumberE164 || profile?.phoneNumberE164 || null;
  const phoneConfigured = Boolean(tradecatchNumber || organization.phoneE164);
  const forwardingAck = Boolean(phone.forwardingInstructionsAck);
  const phoneDetail = tradecatchNumber
    ? `TradeCatch number ${tradecatchNumber}`
    : organization.phoneE164
      ? `Business phone ${organization.phoneE164} — routing not verified`
      : "No phone number configured";

  const transferConfigured = Boolean(
    settings.transferSettings?.primaryTransferE164 ||
      settings.phoneSettings?.humanTransferE164,
  );

  let calendarConnected = false;
  let calendarDetail = "Not connected";
  try {
    if (orgHasFeature(plan, "APPOINTMENT_BOOKING")) {
      const cal = await getSchedulingService().connectionStatus(organization.id);
      calendarConnected =
        cal?.status === "connected" || cal?.status === "simulated";
      calendarDetail = calendarConnected
        ? cal?.status === "simulated"
          ? "Simulated calendar mode (no Google OAuth)"
          : `Calendar connected${cal?.calendarId ? ` (${cal.calendarId})` : ""}`
        : "Google Calendar not connected — bookings stay request-only";
    } else {
      calendarDetail = "Not included in this plan";
    }
  } catch {
    calendarDetail = "Calendar status unavailable";
  }

  let messagingReady = false;
  let messagingDetail = "No automation configured";
  try {
    const automations = await getAutomationStore().listAutomations(
      organization.id,
    );
    const active = automations.filter((a) => a.enabled);
    const settingsGrowth = await getGrowthStore().getOrgSettings(
      organization.id,
    );
    messagingReady =
      active.length > 0 || Boolean(settingsGrowth.notifyEmail?.trim());
    messagingDetail =
      active.length > 0
        ? `${active.length} active automation(s)`
        : settingsGrowth.notifyEmail
          ? `Notify email ${settingsGrowth.notifyEmail}`
          : "No sender / notify destination yet";
  } catch {
    messagingDetail = "Messaging status unavailable";
  }

  // Live-call verification is authoritative only via integration_verifications
  // (written after a controlled test / confirmed inbound). Do not invent it.
  const liveCallVerified = false;
  const liveCallDetail = "No verified inbound test call";

  return {
    businessConfigured,
    subscriptionOk,
    subscriptionDetail,
    aiConfigured,
    aiDetail,
    phoneConfigured,
    phoneVerified: false, // set by verification records in readiness
    phoneDetail: forwardingAck
      ? `${phoneDetail} · forwarding instructions acknowledged`
      : phoneDetail,
    transferConfigured,
    calendarConnected,
    calendarDetail,
    messagingReady,
    messagingDetail,
    liveCallVerified,
    liveCallDetail,
  };
}

export function buildActivationChecks(input: {
  businessId: string;
  plan: PlanId;
  live: LiveIntegrationState;
  phoneVerified: boolean;
  liveCallVerified: boolean;
  nowIso: string;
}): ActivationCheck[] {
  const defs = activationChecksForPlan(input.plan);
  return defs.map((def) => {
    let passed = false;
    let detail: string | null = null;
    switch (def.checkId) {
      case "business_account":
        passed = input.live.businessConfigured;
        detail = passed ? "Business profile saved" : "Complete business information";
        break;
      case "subscription":
        passed = input.live.subscriptionOk;
        detail = input.live.subscriptionDetail;
        break;
      case "ai_receptionist":
        passed = input.live.aiConfigured;
        detail = input.live.aiDetail;
        break;
      case "phone_number":
        passed = input.live.phoneConfigured && input.phoneVerified;
        detail = input.phoneVerified
          ? input.live.phoneDetail
          : "Phone routing verification required";
        break;
      case "first_live_call":
        passed = input.liveCallVerified || input.live.liveCallVerified;
        detail = passed
          ? input.live.liveCallDetail
          : "Complete a successful inbound test call";
        break;
      case "human_transfer":
        passed = input.live.transferConfigured;
        detail = passed
          ? "Transfer destination configured"
          : "Optional — add an authorized transfer number";
        break;
      case "google_calendar":
        passed = input.live.calendarConnected;
        detail = input.live.calendarDetail;
        break;
      case "sms_automation":
        passed = input.live.messagingReady;
        detail = input.live.messagingDetail;
        break;
    }
    return {
      id: newId("acheck"),
      businessId: input.businessId,
      checkId: def.checkId,
      required: def.required,
      passed,
      blocking: def.blocking && def.required,
      label: def.label,
      detail,
      updatedAt: input.nowIso,
    };
  });
}
