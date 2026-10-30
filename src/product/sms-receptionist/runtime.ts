/**
 * Production wiring for the SMS receptionist: the real stores, Twilio port,
 * scheduling backend and model client behind the injected service.
 */

import { isE2eHarness, isRealProductionRuntime } from "@/lib/config";
import { createPhoneScheduler } from "@/product/receptionist/phone-booking";
import { createLlmClientFromEnv } from "@/product/receptionist/llm";
import type { ReceptionistConfig } from "@/product/receptionist/types";
import {
  ensureMissedCallReady,
  isRuntimeUsingDurableStore,
} from "@/product/missed-call/runtime";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import { orgHasFeature } from "@/product/saas/entitlements";
import type { BusinessContext } from "./reply";
import {
  createSmsReceptionist,
  SMS_RECEPTIONIST_EVENT_PREFIX,
  type EscalationReason,
  type SmsReceptionistDeps,
  type SmsReceptionistInput,
  type SmsReceptionistResult,
} from "./service";

const DEFAULT_WINDOW = {
  windowStartHour: 8,
  windowEndHour: 20,
  weekendSending: true,
} as const;

const ESCALATION_TEXT: Record<EscalationReason, string> = {
  urgent: "Urgent customer text — the AI replied with safety guidance",
  customer_request: "Customer text needs a person (AI handed it over)",
  ai_unavailable: "Customer text the AI could not answer — please reply",
  booking_unconfirmed: "Customer asked to book — the time was not confirmed",
  quiet_hours: "Customer text received outside sending hours",
};

const digits = (phone: string) => phone.replace(/\D/g, "");

function logEvent(event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({
    event: `${SMS_RECEPTIONIST_EVENT_PREFIX}${event}`,
    ...fields,
  });
  if (event.endsWith("failed") || event === "ai_failed") console.warn(line);
  else console.info(line);
}

async function receptionistConfigFor(
  clientId: string,
): Promise<{
  config?: ReceptionistConfig;
  llm: ReturnType<typeof createLlmClientFromEnv>;
}> {
  try {
    const { getReceptionistRuntime } =
      await import("@/product/receptionist/runtime");
    const runtime = getReceptionistRuntime();
    await runtime.refresh();
    return {
      config: runtime.configs.find((c) => c.clientAccountId === clientId),
      llm: runtime.llm,
    };
  } catch {
    // The voice runtime being unavailable must not stop texts being answered.
    return { llm: createLlmClientFromEnv() };
  }
}

type Profile = Awaited<ReturnType<typeof receptionistConfigFor>>;

async function buildDeps(profile: Profile): Promise<SmsReceptionistDeps> {
  const [
    { store },
    { getSaasStore },
    { getAutomationStore },
    { getCrmService },
    { getStarterStore },
  ] = await Promise.all([
    ensureMissedCallReady(),
    import("@/product/saas/runtime"),
    import("@/product/sms-automation/runtime"),
    import("@/product/crm/runtime"),
    import("@/product/starter/runtime"),
  ]);
  const sms = createTwilioSmsPort();
  const saas = getSaasStore();
  const automation = getAutomationStore();
  const crm = getCrmService();
  const durable = isRuntimeUsingDurableStore();

  const scheduler = createPhoneScheduler({
    async scheduling() {
      const { getSchedulingService } =
        await import("@/product/scheduling/runtime");
      return getSchedulingService();
    },
    async findOrganizationId(config) {
      if (isRealProductionRuntime() && !isE2eHarness() && !durable) return null;
      const org = await saas.findOrganizationByMissedCallClientId(
        config.clientAccountId,
      );
      return org && org.status === "active" ? org.id : null;
    },
  });

  const deps: SmsReceptionistDeps = {
    now: () => new Date(),

    async getOrganization(id) {
      const org = await saas.getOrganization(id);
      if (!org) return null;
      return {
        status: org.status,
        entitled: orgHasFeature(org.plan, "MISSED_CALL_RECOVERY"),
      };
    },

    async isSuppressed({ organizationId, clientId, phoneE164 }) {
      if (
        await store.isSmsSuppressed(clientId, phoneE164, { asCustomer: true })
      ) {
        return true;
      }
      return automation.isSuppressed(organizationId, phoneE164);
    },

    async hasActiveWorkflow(clientId, phoneE164) {
      return Boolean(
        await store.findActiveWorkflowByCaller(clientId, phoneE164),
      );
    },

    async quietHours(organizationId) {
      const record = await automation.getAutomationByType(
        organizationId,
        "missed_call_recovery",
      );
      return record
        ? {
            windowStartHour: record.config.windowStartHour,
            windowEndHour: record.config.windowEndHour,
            weekendSending: record.config.weekendSending,
          }
        : { ...DEFAULT_WINDOW };
    },

    async history(organizationId, phoneE164, limit) {
      const rows = await crm.recentMessagesByPhone(
        organizationId,
        phoneE164,
        limit,
      );
      return rows.map((m) => ({
        direction: m.direction,
        body: m.body,
        at: m.at,
        providerMessageSid: m.providerMessageSid,
        automated: m.automated,
      }));
    },

    async loadBusiness(client) {
      const { config } = profile;
      const areas = client.approvedServiceAreas.map((a) => a.label).join(", ");
      const context: BusinessContext = {
        name: client.contractorDisplayName,
        assistantName: config?.receptionistName,
        timezone: client.timezone,
        hours: client.businessHours,
        serviceAreaNotes: client.serviceAreaNotes || areas || undefined,
        businessFacts: config?.businessFacts,
        personality: config?.personality,
        faqs: config?.faqs ?? [],
        collectPreferredTime: config?.collectPreferredTime ?? true,
      };
      return {
        context,
        bookingConfig: config?.phoneBooking ? config : undefined,
      };
    },

    scheduler,
    llm: profile.llm,

    outbox: {
      enqueue: (message) => store.enqueueOutbound(message),
      claim: (id) => store.claimOutboundById(id),
      markSent: (id, providerSid) => store.markOutboundSent(id, providerSid),
      // "retry": the cron outbox flush picks it up again.
      markFailed: (id, error) => store.markOutboundFailed(id, error, "retry"),
    },

    sendSms: (message) => sms.send(message),

    async recordOutbound({
      organizationId,
      customerE164,
      businessE164,
      body,
      sent,
    }) {
      await crm.capture({
        organizationId,
        source: "sms",
        phoneE164: customerE164,
        actor: "sms_receptionist",
        message: {
          direction: "outbound",
          body,
          fromE164: businessE164,
          toE164: customerE164,
          automated: true,
          simulated: false,
          deliveryStatus: sent ? "sent" : "queued",
        },
      });
    },

    async escalate(input) {
      const { organizationId, client, customerE164, messageSid } = input;
      await getStarterStore().upsertInboxItem({
        organizationId,
        // The inbox only knows three kinds; a text that needs a person is a
        // "missed_call"-style review item.
        kind: "missed_call",
        refId: `sms:${digits(customerE164)}`,
        title: customerE164,
        reason: ESCALATION_TEXT[input.reason],
        status: "open",
      });

      if (input.alertStaff) {
        const primary = client.technicianRoster.find(
          (t) => t.id === client.mainTechnicianId && t.active,
        );
        const staffPhone = client.humanReviewPhone ?? primary?.phone;
        if (staffPhone) {
          const id = `smsesc_${messageSid}`;
          const nowIso = new Date().toISOString();
          const body = `${client.contractorDisplayName} — SMS à traiter / SMS needs attention. ${ESCALATION_TEXT[input.reason]}. ${customerE164}`;
          await store.enqueueOutbound({
            id,
            clientAccountId: client.id,
            toE164: staffPhone,
            fromE164: client.smsFromNumber,
            body,
            detail: "sms_receptionist_alert",
            status: "queued",
            attempts: 0,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          if (await store.claimOutboundById(id)) {
            try {
              const result = await sms.send({
                toE164: staffPhone,
                fromE164: client.smsFromNumber,
                body,
                internal: true,
              });
              await store.markOutboundSent(id, result.sid);
            } catch (err) {
              await store.markOutboundFailed(
                id,
                err instanceof Error ? err.name : "Error",
                "retry",
              );
              throw err;
            }
          }
        }
      }

      if (input.handOff) {
        const conversationId = await crm.latestConversationIdByPhone(
          organizationId,
          customerE164,
        );
        if (conversationId) {
          await crm.setControl(
            organizationId,
            conversationId,
            "human_managed",
            "sms_receptionist",
          );
        }
      }
    },

    log: logEvent,
  };
  return deps;
}

/**
 * Entry point for the inbound SMS webhook. Never throws: the webhook has
 * already claimed this MessageSid, so a failure here is logged and (where a
 * reply was already queued) retried by the outbox flush, not by Twilio.
 */
export async function handleCustomerSms(
  input: SmsReceptionistInput,
): Promise<SmsReceptionistResult> {
  try {
    const profile = await receptionistConfigFor(input.client.id);
    const deps = await buildDeps(profile);
    return await createSmsReceptionist(deps).handleCustomerSms(input);
  } catch (err) {
    logEvent("failed", {
      organizationId: input.organizationId,
      clientId: input.client.id,
      messageSid: input.messageSid,
      reason: err instanceof Error ? err.name : "Error",
      stage: "runtime",
    });
    return { status: "skipped", reason: "unexpected_error" };
  }
}
