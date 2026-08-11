import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { getSaasStore } from "@/product/saas/runtime";
import { orgHasFeature, type FeatureId } from "@/product/saas/entitlements";
import type { Organization } from "@/product/saas/types";
import { getGrowthStore } from "@/product/growth/runtime";
import { createStarterServices } from "./services";
import { getStarterStore } from "./runtime";

export function getStarterServices() {
  return createStarterServices({
    store: getStarterStore(),
    sms: createTwilioSmsPort(),
    growth: getGrowthStore(),
  });
}

/**
 * Resolve SaaS org from the Twilio "To" number via the linked Module A client.
 */
export async function resolveOrganizationFromSmsTo(
  toE164: string,
): Promise<Organization | null> {
  try {
    const { store } = await ensureMissedCallReady();
    const client = await store.findClientBySmsFromNumber(toE164);
    if (!client) return null;
    return getSaasStore().findOrganizationByMissedCallClientId(client.id);
  } catch {
    return null;
  }
}

export async function organizationHasFeature(
  organization: Organization,
  feature: FeatureId,
): Promise<boolean> {
  return orgHasFeature(organization.plan, feature);
}

export async function resolveSmsFromForOrganization(
  organizationId: string,
): Promise<string | null> {
  const org = await getSaasStore().getOrganization(organizationId);
  if (!org?.missedCallClientId) return null;
  try {
    const { store } = await ensureMissedCallReady();
    const client = await store.getClient(org.missedCallClientId);
    return client?.smsFromNumber ?? null;
  } catch {
    return null;
  }
}

export async function resolveBusinessNameForOrganization(
  organizationId: string,
): Promise<string> {
  const org = await getSaasStore().getOrganization(organizationId);
  if (!org) return "TradeCatch";
  if (!org.missedCallClientId) return org.name;
  try {
    const { store } = await ensureMissedCallReady();
    const client = await store.getClient(org.missedCallClientId);
    return client?.contractorDisplayName || client?.name || org.name;
  } catch {
    return org.name;
  }
}

export function looksLikeE164(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
}
