import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
} from "@/lib/config";
import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import { shouldUseDryRunSms } from "@/lib/environment";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import { getSaasStore } from "@/product/saas/runtime";
import { createPostgresNotificationStore } from "./postgres-store";
import { createNotificationService } from "./service";
import { createMemoryNotificationStore, type NotificationStore } from "./store";

const globalForNotifications = globalThis as unknown as {
  __tradecatchNotifications?: { store: NotificationStore };
};

function createStore(): NotificationStore {
  const url = process.env.DATABASE_URL?.trim();
  const wantDurable =
    isDurableMissedCallStoreConfigured() ||
    process.env.SAAS_DURABLE_STORE === "1";
  if (wantDurable && url) return createPostgresNotificationStore(url);
  if (wantDurable && !url)
    throw new Error("[notifications] Durable store requires DATABASE_URL");
  if (isProductionRuntime() && process.env.SAAS_REQUIRE_DURABLE === "1") {
    throw new Error(
      "[notifications] Refusing memory store when SAAS_REQUIRE_DURABLE=1",
    );
  }
  return createMemoryNotificationStore();
}

export function getNotificationStore(): NotificationStore {
  if (!globalForNotifications.__tradecatchNotifications) {
    globalForNotifications.__tradecatchNotifications = { store: createStore() };
  }
  return globalForNotifications.__tradecatchNotifications.store;
}

export function resetNotificationRuntimeForTests() {
  delete globalForNotifications.__tradecatchNotifications;
}

export function getNotificationService() {
  return createNotificationService({
    store: getNotificationStore(),
    now: () => new Date(),
    async listMembers(organizationId) {
      const memberships =
        await getSaasStore().listMembershipsForOrganization(organizationId);
      const members = [];
      for (const membership of memberships) {
        const user = await getSaasStore().getUser(membership.userId);
        if (!user) continue;
        members.push({
          userId: user.id,
          role: membership.role,
          email: user.email,
          locale: user.locale,
        });
      }
      return members;
    },
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
    async sendEmail(input) {
      const result = await sendBusinessNotifyEmail({
        idempotencyKey: input.idempotencyKey,
        toEmail: input.to,
        subject: input.subject,
        title: input.title,
        lines: [{ label: "Notice", value: input.message }],
      });
      return {
        sent: result.sent,
        temporary: result.reason === "send_failed",
        reason: result.reason,
      };
    },
    async sendSms(input) {
      if (shouldUseDryRunSms())
        return { sent: false, temporary: false, reason: "dry_run" };
      const sms = createTwilioSmsPort();
      const from = process.env.TWILIO_FROM_NUMBER?.trim();
      if (!from)
        return { sent: false, temporary: false, reason: "missing_from" };
      try {
        const sent = await sms.send({
          toE164: input.to,
          fromE164: from,
          body: input.body,
        });
        return { sent: true, sid: sent.sid };
      } catch (error) {
        const message = error instanceof Error ? error.message : "sms_failed";
        const temporary =
          !/Twilio SMS failed: 4/.test(message) || /\b429\b/.test(message);
        return { sent: false, temporary, reason: message.slice(0, 160) };
      }
    },
  });
}
