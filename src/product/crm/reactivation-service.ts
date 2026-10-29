import type { SmsPort } from "@/product/missed-call/types";
import { orgHasFeature } from "@/product/saas/entitlements";
import type { CrmStore } from "./store";
import { buildReactivationMessage, findDormantCustomers } from "./reactivation";

const DEFAULT_DORMANT_AFTER_DAYS = 120;
const DEFAULT_MAX_PER_RUN = 25;

export type ReactivationCampaignResult = {
  sent: number;
  failed: number;
  skippedSuppressed: number;
  candidates: number;
};

/**
 * Sends a reactivation text to each dormant, SMS-opted-in customer, then
 * marks them contacted (lastContactAt) so the next tick doesn't re-send
 * before the dormancy window has elapsed again.
 */
export async function runCustomerReactivationCampaign(
  deps: {
    crmStore: CrmStore;
    sms: SmsPort;
    /** Cross-module opt-out: STOP replies to the missed-call number are
     * recorded there, not in the CRM's own allowSms flag. When the org has
     * a linked missed-call client, honor that suppression list too. */
    isSuppressed?: (phoneE164: string) => Promise<boolean>;
  },
  input: {
    organizationId: string;
    businessName: string;
    fromE164: string;
    now?: Date;
    dormantAfterDays?: number;
    maxPerRun?: number;
  },
): Promise<ReactivationCampaignResult> {
  const now = input.now ?? new Date();
  const dormantAfterDays =
    input.dormantAfterDays ?? DEFAULT_DORMANT_AFTER_DAYS;
  const maxPerRun = input.maxPerRun ?? DEFAULT_MAX_PER_RUN;

  const customers = await deps.crmStore.listCustomers(
    input.organizationId,
    5000,
  );
  const dormant = findDormantCustomers(customers, now, dormantAfterDays);

  let sent = 0;
  let failed = 0;
  let skippedSuppressed = 0;

  for (const customer of dormant.slice(0, maxPerRun)) {
    if (deps.isSuppressed && (await deps.isSuppressed(customer.phoneE164))) {
      skippedSuppressed += 1;
      continue;
    }
    try {
      await deps.sms.send({
        toE164: customer.phoneE164,
        fromE164: input.fromE164,
        body: buildReactivationMessage(input.businessName, customer),
      });
      await deps.crmStore.updateCustomer(input.organizationId, customer.id, {
        lastContactAt: now.toISOString(),
      });
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed, skippedSuppressed, candidates: dormant.length };
}

/**
 * Cron entry point: runs the reactivation campaign for every active,
 * Receptionist-tier organization that has a usable outbound SMS number.
 * Organizations without CUSTOMER_REACTIVATION or without a business phone
 * number are skipped, never defaulted to a shared/demo number.
 */
export async function runDueCustomerReactivationCampaigns(
  dormantAfterDays?: number,
): Promise<{
  organizationsProcessed: number;
  sent: number;
  failed: number;
  skippedSuppressed: number;
}> {
  const { getSaasStore } = await import("@/product/saas/runtime");
  const { getCrmRuntime } = await import("./runtime");
  const { createTwilioSmsPort } = await import("@/product/missed-call/twilio");
  const { ensureMissedCallReady } = await import(
    "@/product/missed-call/runtime"
  );
  const {
    resolveBusinessNameForOrganization,
    resolveSmsFromForOrganization,
  } = await import("@/product/starter/org-context");

  const saas = getSaasStore();
  const crmStore = getCrmRuntime().store;
  const sms = createTwilioSmsPort();

  const orgs = await saas.listOrganizations();
  let organizationsProcessed = 0;
  let sent = 0;
  let failed = 0;
  let skippedSuppressed = 0;

  for (const org of orgs) {
    if (org.status !== "active") continue;
    if (!orgHasFeature(org.plan, "CUSTOMER_REACTIVATION")) continue;
    const fromE164 = await resolveSmsFromForOrganization(org.id);
    if (!fromE164) continue;

    const missedCallClientId = org.missedCallClientId;
    const isSuppressed = missedCallClientId
      ? async (phoneE164: string) => {
          try {
            const { store } = await ensureMissedCallReady();
            return store.isSmsSuppressed(missedCallClientId, phoneE164);
          } catch {
            return false;
          }
        }
      : undefined;

    const businessName = await resolveBusinessNameForOrganization(org.id);
    const result = await runCustomerReactivationCampaign(
      { crmStore, sms, isSuppressed },
      { organizationId: org.id, businessName, fromE164, dormantAfterDays },
    );
    organizationsProcessed += 1;
    sent += result.sent;
    failed += result.failed;
    skippedSuppressed += result.skippedSuppressed;
  }

  return { organizationsProcessed, sent, failed, skippedSuppressed };
}
