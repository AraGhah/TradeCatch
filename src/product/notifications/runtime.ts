import {
  isDurableMissedCallStoreConfigured,
  isProductionRuntime,
  isE2eHarness,
} from "@/lib/config";
import { sendBusinessNotifyEmail } from "@/lib/business-notifications";
import { shouldUseDryRunSms } from "@/lib/environment";
import { createTwilioSmsPort } from "@/product/missed-call/twilio";
import { getSaasStore } from "@/product/saas/runtime";
import { createPostgresNotificationStore } from "./postgres-store";
import { createNotificationService, type NoticeMember } from "./service";
import type { SaasStore } from "@/product/saas/store";
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
  if (isProductionRuntime() && !isE2eHarness()) {
    throw new Error(
      "[notifications] Production notifications require durable PostgreSQL storage",
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

export async function loadNotificationMembers(
  organizationId: string,
  store: SaasStore = getSaasStore(),
): Promise<NoticeMember[]> {
  const memberships =
    await store.listMembershipsForOrganization(organizationId);
  const users = await store.listUsers(
    memberships.map((membership) => membership.userId),
  );
  const byId = new Map(users.map((user) => [user.id, user]));
  return memberships.flatMap((membership) => {
    const user = byId.get(membership.userId);
    return user
      ? [
          {
            userId: user.id,
            name: user.name,
            role: membership.role,
            email: user.email,
            locale: user.locale,
            phoneE164: user.notificationPhoneE164,
            phoneVerifiedAt: user.notificationPhoneVerifiedAt,
          },
        ]
      : [];
  });
}

export function getNotificationService() {
  return createNotificationService({
    store: getNotificationStore(),
    now: () => new Date(),
    listMembers: loadNotificationMembers,
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
