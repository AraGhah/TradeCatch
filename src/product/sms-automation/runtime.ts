import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { shouldUseDryRunSms } from "@/lib/environment";
import { getCrmService } from "@/product/crm/runtime";
import { ensureMissedCallReady } from "@/product/missed-call/runtime";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import { getSaasStore } from "@/product/saas/runtime";
import { getStarterStore } from "@/product/starter/runtime";
import { createPostgresAutomationStore } from "./postgres-store";
import { createAutomationService, type AutomationDeps } from "./service";
import { createMemoryAutomationStore, type AutomationStore } from "./store";

const globalForAutomation = globalThis as unknown as {
  __tradecatchSmsAutomation?: { store: AutomationStore; durable: boolean };
};

function createStore(): { store: AutomationStore; durable: boolean } {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() || process.env.SAAS_DURABLE_STORE === "1";
  if (wantDurable && url) {
    return { store: createPostgresAutomationStore(url), durable: true };
  }
  if (wantDurable && !url) {
    throw new Error("[sms-automation] Durable store requires DATABASE_URL");
  }
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error("[sms-automation] Refusing memory store when SAAS_REQUIRE_DURABLE=1");
  }
  return { store: createMemoryAutomationStore(), durable: false };
}

export function getAutomationStore(): AutomationStore {
  if (!globalForAutomation.__tradecatchSmsAutomation) {
    globalForAutomation.__tradecatchSmsAutomation = createStore();
  }
  return globalForAutomation.__tradecatchSmsAutomation.store;
}

export function resetAutomationRuntimeForTests() {
  delete globalForAutomation.__tradecatchSmsAutomation;
}

function deps(): AutomationDeps {
  const sms = createTwilioSmsPort();
  return {
    store: getAutomationStore(),
    sms,
    now: () => new Date(),
    smsMode: shouldUseDryRunSms() ? "dry-run" : "live",
    async loadOrg(organizationId) {
      const org = await getSaasStore().getOrganization(organizationId);
      if (!org) return null;
      return {
        id: org.id,
        name: org.name,
        status: org.status,
        timezone: org.timezone || "America/Toronto",
        localeDefault: org.localeDefault,
        phoneE164: org.phoneE164,
        accountType: org.accountType,
      };
    },
    async smsFrom(organizationId) {
      const org = await getSaasStore().getOrganization(organizationId);
      if (!org?.missedCallClientId) return null;
      try {
        const { store } = await ensureMissedCallReady();
        const client = await store.getClient(org.missedCallClientId);
        return client?.smsFromNumber ?? null;
      } catch {
        return null;
      }
    },
    async quoteStatus(organizationId, threadId) {
      const thread = await getStarterStore().getQuoteThread(threadId, organizationId);
      return thread?.status ?? null;
    },
    async leadState(organizationId, leadId) {
      try {
        const crm = getCrmService();
        const lead = await crm.getLead(organizationId, leadId);
        if (!lead) return null;
        const humanContact = await crm.isAutomationPaused(
          organizationId,
          lead.customer.phoneE164,
        );
        return { status: lead.status, humanContact };
      } catch {
        return null;
      }
    },
    async listOpenQuotes(organizationId) {
      const threads = await getStarterStore().listQuoteThreads(organizationId);
      return threads.map((thread) => ({
        id: thread.id,
        customerPhoneE164: thread.customerPhoneE164,
        customerName: thread.customerName,
        quoteRef: thread.quoteRef,
        locale: thread.locale,
        status: thread.status,
        quoteSentAt: thread.quoteSentAt,
        serviceName: undefined,
      }));
    },
    async clearQuoteSchedule(organizationId, threadId) {
      await getStarterStore().updateQuoteThread(threadId, organizationId, {
        nextRunAt: undefined,
      });
    },
    async stopQuoteThread(organizationId, threadId, reason) {
      const status =
        reason === "won" ? "won" : reason === "lost" ? "lost" : reason === "customer_reply" ? "paused" : "stopped";
      await getStarterStore().updateQuoteThread(threadId, organizationId, {
        status,
        stopReason: reason,
        nextRunAt: undefined,
        ...(reason === "customer_reply"
          ? { conversationMode: "needs_attention" as const }
          : {}),
      });
    },
    async onCustomerMessage(input) {
      try {
        const crm = getCrmService();
        const captured = await crm.capture({
          organizationId: input.organizationId,
          source: input.direction === "outbound" ? "missed_call" : "sms",
          phoneE164: input.phoneE164,
          displayName: input.customerName,
          preferredLanguage: input.locale,
          service: input.serviceName,
          description:
            input.direction === "inbound" && input.body !== "Simulated missed call"
              ? input.body
              : input.serviceName,
          actor: "sms-automation",
          message:
            input.recordMessage === false
              ? undefined
              : {
                  direction: input.direction,
                  body: input.body,
                  automated: input.automated,
                  simulated: input.simulated,
                  providerMessageSid: input.providerMessageSid,
                  deliveryStatus: input.simulated
                    ? "sent"
                    : input.direction === "inbound"
                      ? "delivered"
                      : "queued",
                },
        });
        if (
          input.direction === "inbound" &&
          !input.optOut &&
          captured.lead.status === "new" &&
          input.body !== "Simulated missed call"
        ) {
          await crm.updateLead(input.organizationId, captured.lead.id, {
            status: "contacted",
            actor: "sms-automation",
          });
        }
        return { leadId: captured.lead.id };
      } catch (err) {
        console.warn("[sms-automation] crm sync skipped", err);
        return undefined;
      }
    },
    async notifyContractor(input) {
      try {
        await getStarterStore().upsertInboxItem({
          organizationId: input.organizationId,
          kind: input.kind,
          refId: input.refId,
          title: input.title,
          reason: input.reason,
          status: "open",
        });
      } catch (err) {
        console.warn("[sms-automation] inbox notify skipped", err);
      }
    },
    async mirrorSuppression(organizationId, phoneE164) {
      try {
        const org = await getSaasStore().getOrganization(organizationId);
        if (!org?.missedCallClientId) return;
        const { store } = await ensureMissedCallReady();
        await store.addSmsSuppression({
          clientAccountId: org.missedCallClientId,
          phoneE164,
          channel: "sms",
          scope: "customer_outbound",
          source: "customer_keyword",
          at: new Date().toISOString(),
          providerStatus: "local_only",
          note: "STOP recorded by SMS automation",
        });
      } catch (err) {
        console.warn("[sms-automation] module A suppression skipped", err);
      }
    },
  };
}

export function getAutomationServices() {
  return createAutomationService(deps());
}
